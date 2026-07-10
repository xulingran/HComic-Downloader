import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { LibraryAssetDetail } from '@shared/types'
import { useLocalLibraryProgress, useLocalLibraryReader } from '../../hooks/useLocalLibraryReader'
import { useReaderSettings, type BlankPosition } from '../../hooks/useReaderSettings'
import { usePageTracking } from '../../hooks/usePageTracking'
import { useSliderDrag } from '../../hooks/useSliderDrag'
import { useZoom } from '../../hooks/useZoom'
import { useFailedPages } from '../../hooks/useFailedPages'
import { useReducedMotionPreference } from '../../lib/anim'
import { ChapterPicker } from '../ChapterPicker'
import { PageFlipView } from '../PageFlipView'
import { ReaderPage } from '../ReaderPage'

interface LocalLibraryReaderModalProps {
  asset: LibraryAssetDetail | null
  open: boolean
  onClose: () => void
}

/** Local reader backed by the same presentation components as remote preview. */
export function LocalLibraryReaderModal({ asset, open, onClose }: LocalLibraryReaderModalProps) {
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
  const reduceMotion = useReducedMotionPreference()
  const { failedCount, retryGen, markFailed, markLoaded, retryAll, clearAll } = useFailedPages()
  const { saveProgress, flush } = useLocalLibraryProgress(asset?.assetId ?? null)

  const imageCacheRef = useRef<Map<number, string>>(new Map())
  const pendingLoadsRef = useRef<Map<number, Promise<string>>>(new Map())
  const [cachedPageUrls, setCachedPageUrls] = useState<Map<number, string>>(new Map())
  const [cacheVersion, setCacheVersion] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])

  const clearPageCache = useCallback(() => {
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
    reset()
    clearPageCache()
    setSettingsOpen(false)
    setChapterSelected(false)
  }, [open, flush, reset, clearPageCache])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!open || !asset || totalPages <= 0 || currentPage <= 0) return
    saveProgress(currentChapterId, currentPage, totalPages)
  }, [open, asset, currentChapterId, currentPage, totalPages, saveProgress])

  const loadLocalImage = useCallback(async (_url: string, index: number): Promise<string> => {
    if (!asset) throw new Error('漫画资产已关闭')
    const cached = imageCacheRef.current.get(index)
    if (cached) return cached
    const pending = pendingLoadsRef.current.get(index)
    if (pending) return pending
    const request = materializePage(asset.assetId, currentChapterId, index + 1)
      .then((imageUrl) => {
        imageCacheRef.current.set(index, imageUrl)
        pendingLoadsRef.current.delete(index)
        setCachedPageUrls((cached) => new Map(cached).set(index, imageUrl))
        setCacheVersion((version) => version + 1)
        return imageUrl
      })
      .catch((error) => {
        pendingLoadsRef.current.delete(index)
        throw error
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

  useEffect(() => {
    if (open && loadingState === 'loaded' && displayMode !== 'scroll') preloadAround(currentPage)
  }, [open, loadingState, displayMode, currentPage, preloadAround])

  usePageTracking(
    pageRefs,
    scrollContainerRef,
    false,
    currentPage,
    setCurrentPage,
    loadingState,
    imageUrls.length,
  )

  const effectiveTotal = displayMode === 'double' && blankPosition === 'front' ? totalPages + 1 : totalPages
  const {
    isDragging,
    sliderRef,
    handleSliderPointerDown,
    handleSliderPointerMove,
    handleSliderPointerUp,
    cancelDrag,
  } = useSliderDrag(effectiveTotal, setCurrentPage, preloadAround)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (displayMode === 'scroll') return
      const step = displayMode === 'double' ? 2 : 1
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
  }, [open, onClose, displayMode, currentPage, effectiveTotal, setCurrentPage])

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

  if (!open || !asset) return null
  const showChapterPicker = chapters.length > 1 && !chapterSelected && loadingState !== 'loading'

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col bg-[var(--bg-reader)] text-white"
      data-testid="local-library-reader"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2 text-sm">
        <h3 className="min-w-0 flex-1 truncate">{asset.title}</h3>
        {chapters.length > 1 && (
          <button className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20" onClick={() => setChapterSelected(false)}>
            章节
          </button>
        )}
        <button aria-label="缩小" className="rounded bg-white/10 px-2 py-1" onClick={zoomOut}>−</button>
        <button aria-label="重置缩放" className="rounded bg-white/10 px-2 py-1 text-xs" onClick={resetZoom}>{Math.round(zoom * 100)}%</button>
        <button aria-label="放大" className="rounded bg-white/10 px-2 py-1" onClick={zoomIn}>＋</button>
        <button className="rounded bg-white/10 px-2 py-1 text-xs" onClick={() => setSettingsOpen((open) => !open)}>设置</button>
        <span className="text-xs text-gray-400">{currentPage} / {totalPages || '?'}</span>
        <button className="rounded bg-white/10 px-3 py-1 text-xs hover:bg-white/20" onClick={onClose}>关闭 ✕</button>
      </header>

      {settingsOpen && (
        <div className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-black/20 px-4 py-2 text-xs">
          <label>模式
            <select className="ml-1 rounded bg-black/40 px-2 py-1" value={displayMode} onChange={(event) => setDisplayMode(event.target.value as typeof displayMode)}>
              <option value="scroll">滚动</option><option value="single">单页</option><option value="double">双页</option>
            </select>
          </label>
          <label>宽度 <input type="range" min="25" max="100" value={imageWidth} onChange={(event) => setImageWidth(Number(event.target.value))} /></label>
          <label>页距 <input type="range" min="0" max="64" value={pageGap} onChange={(event) => setPageGap(Number(event.target.value))} /></label>
          {displayMode === 'double' && (
            <label>空白页
              <select className="ml-1 rounded bg-black/40 px-2 py-1" value={blankPosition} onChange={(event) => setBlankPosition(event.target.value as BlankPosition)}>
                <option value="none">无</option><option value="front">开头</option><option value="end">结尾</option>
              </select>
            </label>
          )}
        </div>
      )}

      {failedCount > 0 && (
        <div className="flex items-center justify-center gap-3 bg-red-950/50 px-4 py-2 text-xs">
          <span>{failedCount} 页加载失败</span>
          <button className="rounded bg-white/10 px-2 py-1" onClick={retryAll}>全部重试</button>
          <button className="rounded bg-white/10 px-2 py-1" onClick={handleReload}>重新载入资产</button>
        </div>
      )}

      {showChapterPicker ? (
        <ChapterPicker chapters={chapters} onSelect={(id) => void handleChapterSelect(id)} title={asset.title} />
      ) : loadingState === 'loading' ? (
        <div className="flex flex-1 items-center justify-center text-sm text-gray-400">正在加载本地漫画…</div>
      ) : loadingState === 'error' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-red-300">
          <p>{errorMessage || '加载失败'}</p>
          <button className="rounded bg-white/10 px-4 py-2" onClick={handleReload}>重新载入</button>
        </div>
      ) : displayMode === 'scroll' ? (
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
          displayMode={displayMode}
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
        />
      )}

      {totalPages > 0 && !showChapterPicker && loadingState === 'loaded' && (
        <footer className="border-t border-white/10 px-4 py-2">
          <div
            ref={sliderRef}
            className="relative h-5 cursor-pointer"
            onPointerDown={handleSliderPointerDown}
            onPointerMove={handleSliderPointerMove}
            onPointerUp={handleSliderPointerUp}
            onPointerCancel={cancelDrag}
          >
            <div className="absolute left-0 right-0 top-2 h-1 rounded bg-white/15" />
            <div className="absolute left-0 top-2 h-1 rounded bg-[var(--accent)]" style={{ width: `${(currentPage / Math.max(1, effectiveTotal)) * 100}%` }} />
            <div className="absolute top-0 h-5 w-2 rounded bg-white" style={{ left: `calc(${(currentPage / Math.max(1, effectiveTotal)) * 100}% - 4px)` }} />
          </div>
          {isDragging && <div className="text-center text-xs text-gray-400">第 {currentPage} 页</div>}
        </footer>
      )}
    </motion.div>
  )
}
