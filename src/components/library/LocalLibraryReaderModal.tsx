import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LibraryAssetDetail } from '@shared/types'
import { useLocalLibraryProgress, useLocalLibraryReader } from '../../hooks/useLocalLibraryReader'
import { useReaderSettings, type BlankPosition } from '../../hooks/useReaderSettings'
import { usePageTracking } from '../../hooks/usePageTracking'
import { useReaderProgressNavigation } from '../../hooks/useReaderProgressNavigation'
import { useReaderModeTransition } from '../../hooks/useReaderModeTransition'
import { prepareScrollAnchor, type ScrollAnchorController } from '../../lib/reader-scroll'
import { useZoom } from '../../hooks/useZoom'
import { useFailedPages } from '../../hooks/useFailedPages'
import { ChapterPicker } from '../ChapterPicker'
import { PageFlipView } from '../PageFlipView'
import { ReaderPage } from '../ReaderPage'
import { ReaderShell, ReaderLoadingState, ReaderErrorState } from '../common/ReaderShell'
import { ReaderModeStage } from '../common/ReaderModeStage'

interface LocalLibraryReaderModalProps {
  asset: LibraryAssetDetail | null
  open: boolean
  onClose: () => void
  onExitComplete?: () => void
}

/** Local reader backed by the same presentation shell as remote preview. */
export function LocalLibraryReaderModal({ asset, open, onClose, onExitComplete }: LocalLibraryReaderModalProps) {
  const {
    imageUrls,
    totalPages,
    currentPage,
    loadingState,
    errorMessage,
    chapters,
    currentChapterId,
    setCurrentPage,
    fetchAsset,
    goToChapter,
    materializePage,
    reset,
  } = useLocalLibraryReader()
  const { pageGap, imageWidth, setPageGap, setImageWidth, displayMode, setDisplayMode } = useReaderSettings()
  const [blankPosition, setBlankPosition] = useState<BlankPosition>('none')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [chapterSelected, setChapterSelected] = useState(false)
  const { zoom, zoomIn, zoomOut, resetZoom } = useZoom(open)
  const { failedCount, retryGen, retryAll, markFailed, markLoaded, clearAll } = useFailedPages()
  const { saveProgress, flush } = useLocalLibraryProgress(asset?.assetId ?? null)

  const imageCacheRef = useRef<Map<number, string>>(new Map())
  const pendingLoadsRef = useRef<Map<number, Promise<string>>>(new Map())
  const cacheGenerationRef = useRef(0)
  const [cachedPageUrls, setCachedPageUrls] = useState<Map<number, string>>(new Map())
  const [cacheVersion, setCacheVersion] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])

  const clearPageCache = useCallback(() => {
    cacheGenerationRef.current += 1
    imageCacheRef.current.clear()
    pendingLoadsRef.current.clear()
    setCachedPageUrls(new Map())
    setCacheVersion((version) => version + 1)
    clearAll()
  }, [clearAll])

  /* eslint-disable react-hooks/set-state-in-effect -- opening or closing a modal intentionally resets its reader session */
  useEffect(() => {
    if (!open || !asset) return
    clearPageCache()
    setChapterSelected(Boolean(asset.readingChapterId))
    void fetchAsset(asset.assetId, asset.readingChapterId, asset.readingPage)
  }, [open, asset, clearPageCache, fetchAsset])

  useEffect(() => {
    if (open) return
    flush()
  }, [open, flush])
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleExitComplete = useCallback(() => {
    reset()
    clearPageCache()
    setSettingsOpen(false)
    setChapterSelected(false)
    onExitComplete?.()
  }, [clearPageCache, onExitComplete, reset])

  useEffect(() => {
    if (!open || !asset || loadingState !== 'loaded' || totalPages <= 0 || currentPage <= 0) return
    saveProgress(currentChapterId, currentPage, totalPages)
  }, [open, asset, currentChapterId, currentPage, totalPages, loadingState, saveProgress])

  const loadLocalImage = useCallback(async (_url: string, index: number): Promise<string> => {
    if (!asset) throw new Error('漫画资产已关闭')
    const cached = imageCacheRef.current.get(index)
    if (cached) return cached
    const pending = pendingLoadsRef.current.get(index)
    if (pending) return pending
    const requestGeneration = cacheGenerationRef.current
    const request = materializePage(asset.assetId, currentChapterId, index + 1)
      .then((imageUrl) => {
        if (cacheGenerationRef.current !== requestGeneration) {
          throw new Error('页面请求已失效')
        }
        imageCacheRef.current.set(index, imageUrl)
        setCachedPageUrls((cached) => new Map(cached).set(index, imageUrl))
        setCacheVersion((version) => version + 1)
        return imageUrl
      })
      .finally(() => {
        if (pendingLoadsRef.current.get(index) === request) {
          pendingLoadsRef.current.delete(index)
        }
      })
    pendingLoadsRef.current.set(index, request)
    return request
  }, [asset, currentChapterId, materializePage])

  const preloadAround = useCallback((page: number) => {
    if (!asset || totalPages <= 0) return
    const first = Math.max(0, page - 3)
    const last = Math.min(totalPages - 1, page + 1)
    for (let index = first; index <= last; index++) {
      if (!imageCacheRef.current.has(index)) void loadLocalImage(imageUrls[index], index).catch(() => {})
    }
  }, [asset, imageUrls, loadLocalImage, totalPages])

  const scrollAnchorRef = useRef<ScrollAnchorController | null>(null)
  const prepareModeTarget = useCallback((mode: 'scroll' | 'single' | 'double', anchorPage: number) => {
    if (mode !== 'scroll' || anchorPage <= 0) return true
    scrollAnchorRef.current?.clear()
    scrollAnchorRef.current = prepareScrollAnchor((idx) => pageRefs.current[idx] ?? null, anchorPage)
    return true
  }, [])
  const {
    visibleMode,
    targetMode,
    phase: modeTransitionPhase,
    isModeTransitioning,
    reduceMotion: reduceModeMotion,
    requestDisplayMode,
  } = useReaderModeTransition({
    displayMode,
    setDisplayMode,
    currentPage,
    setCurrentPage,
    totalPages,
    blankPosition,
    setBlankPosition,
    enabled: open && loadingState === 'loaded' && totalPages > 0,
    prepareTarget: prepareModeTarget,
  })

  useEffect(() => {
    if (open && loadingState === 'loaded' && visibleMode !== 'scroll') preloadAround(currentPage)
  }, [open, loadingState, visibleMode, currentPage, preloadAround])

  // Stop pinning the scroll anchor once the mode transition has shown the
  // target view; the ResizeObserver re-scroll is only needed while preparing.
  useEffect(() => {
    if (modeTransitionPhase === 'idle' && scrollAnchorRef.current) {
      scrollAnchorRef.current.clear()
      scrollAnchorRef.current = null
    }
  }, [modeTransitionPhase])
  useEffect(() => () => scrollAnchorRef.current?.clear(), [])

  const effectiveTotal = targetMode === 'double' && blankPosition === 'front' ? totalPages + 1 : totalPages
  const {
    isDragging,
    sliderRef,
    handleSliderPointerDown,
    handleSliderPointerMove,
    handleSliderPointerUp,
    cancelDrag,
    freezePageTrackingRef,
  } = useReaderProgressNavigation({
    totalPages: effectiveTotal,
    currentPage,
    setCurrentPage,
    displayMode: visibleMode,
    loadingState,
    pageRefs,
    onDragEnd: preloadAround,
    disabled: isModeTransitioning,
  })

  usePageTracking(
    pageRefs,
    scrollContainerRef,
    isDragging,
    currentPage,
    setCurrentPage,
    loadingState,
    imageUrls.length,
    visibleMode,
    freezePageTrackingRef,
    isModeTransitioning,
  )

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (isModeTransitioning || visibleMode === 'scroll' || loadingState !== 'loaded' || totalPages <= 0) return
      const step = visibleMode === 'double' ? 2 : 1
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault()
        setCurrentPage(Math.min(effectiveTotal, currentPage + step))
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault()
        setCurrentPage(Math.max(1, currentPage - step))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose, visibleMode, isModeTransitioning, loadingState, totalPages, currentPage, effectiveTotal, setCurrentPage])

  const handleCached = useCallback((index: number, imageUrl: string) => {
    if (imageCacheRef.current.get(index) === imageUrl) return
    imageCacheRef.current.set(index, imageUrl)
    setCachedPageUrls((cached) => new Map(cached).set(index, imageUrl))
    setCacheVersion((version) => version + 1)
  }, [])

  const setPageRef = useCallback((index: number, element: HTMLDivElement | null) => {
    pageRefs.current[index] = element
  }, [])

  const handleChapterSelect = useCallback(async (chapterId: string) => {
    if (!asset) return
    flush()
    clearPageCache()
    setChapterSelected(true)
    try {
      await goToChapter(asset.assetId, chapterId)
    } catch {
      // The hook exposes the error state to the reader surface.
    }
  }, [asset, clearPageCache, flush, goToChapter])

  const handleReload = useCallback(() => {
    if (!asset) return
    clearPageCache()
    void fetchAsset(asset.assetId, currentChapterId, currentPage)
  }, [asset, clearPageCache, currentChapterId, currentPage, fetchAsset])

  // 从 currentChapterId 推导章节索引，供 ReaderShell 渲染上/下一章按钮
  const currentChapterIndex = useMemo(() => {
    if (chapters.length <= 1 || !currentChapterId) return -1
    return chapters.findIndex((c) => c.id === currentChapterId)
  }, [chapters, currentChapterId])

  const handleGoToChapter = useCallback((index: number) => {
    if (!asset || index < 0 || index >= chapters.length) return
    const target = chapters[index]
    if (!target) return
    void handleChapterSelect(target.id)
  }, [asset, chapters, handleChapterSelect])

  const handleOpenChapterPicker = useCallback(() => {
    flush()
    setChapterSelected(false)
  }, [flush])

  if (!asset) return null
  const needsValidChapter = loadingState === 'loaded' && !currentChapterId && totalPages === 0
  const showChapterPicker = chapters.length > 1
    && (!chapterSelected || needsValidChapter)
    && loadingState !== 'loading'
  const navigationEnabled = loadingState === 'loaded' && totalPages > 0 && !showChapterPicker

  return (
    <ReaderShell
      open={open}
      onClose={onClose}
      onExitComplete={handleExitComplete}
      title={asset.title}
      currentPage={currentPage}
      effectiveTotal={effectiveTotal}
      chapters={chapters}
      currentChapterIndex={currentChapterIndex}
      onGoToChapter={handleGoToChapter}
      onOpenChapterPicker={handleOpenChapterPicker}
      navigationEnabled={navigationEnabled}
      displayMode={targetMode}
      onDisplayModeRequest={requestDisplayMode}
      imageWidth={imageWidth}
      setImageWidth={setImageWidth}
      pageGap={pageGap}
      setPageGap={setPageGap}
      blankPosition={blankPosition}
      setBlankPosition={setBlankPosition}
      zoom={zoom}
      zoomIn={zoomIn}
      zoomOut={zoomOut}
      resetZoom={resetZoom}
      settingsOpen={settingsOpen}
      setSettingsOpen={setSettingsOpen}
      sliderRef={sliderRef}
      isDragging={isDragging}
      handleSliderPointerDown={handleSliderPointerDown}
      handleSliderPointerMove={handleSliderPointerMove}
      handleSliderPointerUp={handleSliderPointerUp}
      cancelDrag={cancelDrag}
      preloadedRanges={[]}
    >
      <ReaderModeStage phase={modeTransitionPhase} reduceMotion={reduceModeMotion}>
      {/* 内容区：loading/error/ChapterPicker/scroll/PageFlipView 分支 */}
      {showChapterPicker ? (
        <ChapterPicker chapters={chapters} onSelect={(id) => void handleChapterSelect(id)} title={asset.title} />
      ) : loadingState === 'loading' ? (
        <ReaderLoadingState className="flex-1" />
      ) : loadingState === 'error' ? (
        <ReaderErrorState
          message={errorMessage || '加载失败'}
          onRetry={handleReload}
          onClose={onClose}
          className="flex-1"
        />
      ) : visibleMode === 'scroll' ? (
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto" onPointerUp={cancelDrag}>
          <div className="mx-auto" style={{ width: `${imageWidth}%`, transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
            {imageUrls.map((url, index) => (
              <div key={url} ref={(element) => setPageRef(index, element)} style={{ marginBottom: `${pageGap}px` }}>
                <ReaderPage
                  url={url}
                  index={index}
                  priority={index < 2}
                  cachedUrlHash={cachedPageUrls.get(index)}
                  imageLoader={loadLocalImage}
                  onFailed={markFailed}
                  onLoaded={markLoaded}
                  onCached={handleCached}
                  retryGen={retryGen}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <PageFlipView
          imageUrls={imageUrls}
          totalPages={totalPages}
          currentPage={currentPage}
          setCurrentPage={setCurrentPage}
          displayMode={visibleMode}
          imageWidth={imageWidth}
          zoom={zoom}
          imageCacheRef={imageCacheRef}
          cacheVersion={cacheVersion}
          onPageChange={preloadAround}
          blankPosition={blankPosition}
          imageLoader={loadLocalImage}
          onFailed={markFailed}
          onLoaded={markLoaded}
          onCached={handleCached}
          retryGen={retryGen}
          modeTransitioning={isModeTransitioning}
        />
      )}
      </ReaderModeStage>

      {/* 失败页重试浮层（本地版用内联 banner；在线版用阈值 Toast） */}
      {failedCount > 0 && (
        <div className="pointer-events-none absolute left-1/2 bottom-24 -translate-x-1/2 z-10">
          <div
            className="px-4 py-2 rounded-full text-sm text-white shadow-lg flex items-center gap-3"
            style={{ background: 'rgba(180,40,40,0.9)', backdropFilter: 'blur(4px)' }}
          >
            <span>{failedCount} 页加载失败</span>
            <button className="rounded bg-white/20 px-2 py-0.5 text-xs pointer-events-auto" onClick={retryAll}>全部重试</button>
            <button className="rounded bg-white/20 px-2 py-0.5 text-xs pointer-events-auto" onClick={handleReload}>重载</button>
          </div>
        </div>
      )}
    </ReaderShell>
  )
}
