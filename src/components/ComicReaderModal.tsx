import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ComicInfo, IMAGE_QUALITIES } from '@shared/types'
import { useComicReader } from '../hooks/useComicReader'
import { useReaderSettings, type BlankPosition } from '../hooks/useReaderSettings'
import { usePreloadManager } from '../hooks/usePreloadManager'
import { usePageTracking } from '../hooks/usePageTracking'
import { useZoom } from '../hooks/useZoom'
import { useReaderProgressNavigation } from '../hooks/useReaderProgressNavigation'
import { useReaderModeTransition } from '../hooks/useReaderModeTransition'
import { prepareScrollAnchor, type ScrollAnchorController } from '../lib/reader-scroll'
import { useFailedPages } from '../hooks/useFailedPages'
import { useHistory } from '../hooks/useIpc'
import { useHistoryStore } from '../stores/useHistoryStore'
import { useReaderStore } from '../stores/useReaderStore'
import { useToastStore } from '../stores/useToastStore'
import { PageFlipView } from './PageFlipView'
import { ReaderPage } from './ReaderPage'
import { ChapterPicker } from './ChapterPicker'
import { ReaderShell, ReaderLoadingState, ReaderErrorState, ReaderEmptyState } from './common/ReaderShell'
import { ReaderModeStage } from './common/ReaderModeStage'
import { OnlineReaderDetailPage } from './OnlineReaderDetailPage'
import { resolveReaderTailNavigation } from '../lib/reader-mode'

interface ComicReaderModalProps {
  comic: ComicInfo | null
  open: boolean
  onClose: () => void
}

export function ComicReaderModal({ comic, open, onClose }: ComicReaderModalProps) {
  const {
    imageUrls,
    totalPages,
    currentPage,
    loadingState,
    errorMessage,
    scrambleId,
    comicId,
    chapters: fetchedChapters,
    fetchUrls,
    fetchChapterUrls,
    setCurrentPage,
    reset,
  } = useComicReader()
  const chapters = useMemo(
    () => fetchedChapters.length > 0 ? fetchedChapters : (comic?.chapters ?? []),
    [comic?.chapters, fetchedChapters],
  )

  const { pageGap, imageWidth, setPageGap, setImageWidth, displayMode, setDisplayMode } = useReaderSettings()
  const [blankPosition, setBlankPosition] = useState<BlankPosition>('none')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [bikaImageQuality, setBikaImageQuality] = useState<string>('original')
  const [preloadForward, setPreloadForward] = useState(8)
  const [preloadBackward, setPreloadBackward] = useState(2)
  const [preloadConcurrency, setPreloadConcurrency] = useState(3)
  const [adaptiveEnabled, setAdaptiveEnabled] = useState(false)
  const { zoom, zoomIn, zoomOut, resetZoom } = useZoom(open)

  // 失败页聚合：跟踪所有加载失败的页索引，>3 时弹常驻重试 Toast。
  // 详见 openspec/changes/preview-retry-toast/design.md
  const {
    failedCount,
    retryGen,
    markFailed,
    markLoaded,
    retryAll,
    clearAll: clearFailedPages,
  } = useFailedPages()
  // 阈值 Toast 用的 ref/常量（声明在前，供 modal 关闭 effect 与阈值 effect 共用）
  const FAILED_THRESHOLD = 3
  const prevFailedCountRef = useRef(0)
  const hadFailedToastRef = useRef(false)
  const handleRetryAll = useCallback(() => {
    retryAll()
  }, [retryAll])

  const {
    imageCacheRef,
    cacheVersion,
    preloadedRanges,
    preloadTarget,
    setPreloadTarget,
    clearCache,
    markCached,
  } = usePreloadManager(
    imageUrls,
    loadingState,
    scrambleId,
    comicId,
    comic?.sourceSite === 'bika' ? bikaImageQuality : undefined,
    preloadForward,
    preloadBackward,
    preloadConcurrency,
    { enabled: adaptiveEnabled },
  )

  // 叶子组件取图成功后回写共享缓存（见 specs/reader-image-cache）。
  // markCached 内部已去重 + bump cacheVersion，此处仅透传。
  const handleCached = useCallback((index: number, urlHash: string) => {
    markCached(index, urlHash)
  }, [markCached])

  const { addHistory } = useHistory()
  const historyStore = useHistoryStore()
  const { initialPage, initialChapterId } = useReaderStore()
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [currentChapterIndex, setCurrentChapterIndex] = useState(-1)
  const [chapterFlipHint, setChapterFlipHint] = useState<'next' | 'prev' | null>(null)
  const lastRecordedPageRef = useRef<number>(0)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const comicRef = useRef<ComicInfo | null>(null)

  // History can open a chapter directly without first calling getPreviewUrls.
  // Derive its index from the ComicInfo chapter list as soon as it is available.
  useEffect(() => {
    if (!selectedChapterId || chapters.length === 0) return
    const index = chapters.findIndex((chapter) => chapter.id === selectedChapterId)
    if (index < 0 || index === currentChapterIndex) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentChapterIndex(index)
  }, [chapters, currentChapterIndex, selectedChapterId])

  // Keep a ref to the current comic so we can still access it on close
  useEffect(() => {
    if (comic) {
      comicRef.current = comic
    }
  }, [comic])

  useEffect(() => {
    window.hcomic?.getConfig().then((result) => {
      const cfg = result.config
      const q = cfg?.bikaImageQuality
      if (typeof q === 'string') setBikaImageQuality(q)
      if (typeof cfg?.previewPreloadForward === 'number') setPreloadForward(cfg.previewPreloadForward)
      if (typeof cfg?.previewPreloadBackward === 'number') setPreloadBackward(cfg.previewPreloadBackward)
      if (typeof cfg?.previewPreloadConcurrency === 'number') setPreloadConcurrency(cfg.previewPreloadConcurrency)
      if (typeof cfg?.previewPreloadAdaptive === 'boolean') setAdaptiveEnabled(cfg.previewPreloadAdaptive)
    }).catch(() => {})
  }, [])

  const recordHistory = useCallback((page: number) => {
    const imagePage = Math.min(page, totalPages)
    if (!comic || imagePage <= 0 || imagePage === lastRecordedPageRef.current) return
    lastRecordedPageRef.current = imagePage
    addHistory({
      comicId: comic.id,
      title: comic.title,
      coverUrl: comic.coverUrl,
      source: comic.source,
      sourceSite: comic.sourceSite || '',
      mediaId: comic.mediaId || '',
      sourceUrl: comic.url,
      lastPage: imagePage,
      totalPages,
      lastChapterId: chapters[currentChapterIndex]?.id ?? '',
      lastChapterName: chapters[currentChapterIndex]?.name ?? '',
    }).catch((err) => {
      console.error('Failed to record history:', err)
    }).finally(() => {
      historyStore.clearCache()
    })
  }, [comic, totalPages, addHistory, historyStore, chapters, currentChapterIndex])

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const scrollAnchorRef = useRef<ScrollAnchorController | null>(null)
  const prepareModeTarget = useCallback((mode: 'scroll' | 'single' | 'double', anchorPage: number) => {
    if (mode !== 'scroll' || anchorPage <= 0) return true
    scrollAnchorRef.current?.clear()
    const controller = prepareScrollAnchor((idx) => pageRefs.current[idx] ?? null, anchorPage)
    scrollAnchorRef.current = controller
    // controller.clear detaches its own ResizeObserver; defer so coordinator
    // token checks still run, but the anchor pinning stops on the next tick.
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
    hasTail: totalPages > 0 && (chapters.length <= 1 || currentChapterIndex === chapters.length - 1),
  })
  const hasDetailTail = totalPages > 0 && (chapters.length <= 1 || currentChapterIndex === chapters.length - 1)
  const targetTailNavigation = resolveReaderTailNavigation(totalPages, targetMode, blankPosition)
  const visibleTailNavigation = resolveReaderTailNavigation(totalPages, visibleMode, blankPosition)
  const effectiveTotalPages = hasDetailTail
    ? targetTailNavigation.tailPosition
    : targetTailNavigation.imageEffectiveTotal
  const isDetailPage = hasDetailTail && currentPage === visibleTailNavigation.tailPosition

  // Stop pinning the scroll anchor once the mode transition has shown the
  // target view; the ResizeObserver re-scroll is only needed while preparing.
  useEffect(() => {
    if (modeTransitionPhase === 'idle' && scrollAnchorRef.current) {
      scrollAnchorRef.current.clear()
      scrollAnchorRef.current = null
    }
  }, [modeTransitionPhase])
  useEffect(() => () => scrollAnchorRef.current?.clear(), [])
  const {
    isDragging,
    sliderRef,
    handleSliderPointerDown,
    handleSliderPointerMove,
    handleSliderPointerUp,
    cancelDrag,
    freezePageTrackingRef,
  } = useReaderProgressNavigation({
    totalPages: effectiveTotalPages,
    currentPage,
    setCurrentPage,
    displayMode: visibleMode,
    loadingState,
    pageRefs,
    onDragEnd: setPreloadTarget,
    disabled: isModeTransitioning,
  })

  usePageTracking(
    pageRefs, scrollContainerRef, isDragging, currentPage, setCurrentPage,
    loadingState, imageUrls.length + (hasDetailTail ? 1 : 0), visibleMode, freezePageTrackingRef, isModeTransitioning,
  )

  // Keep preload target in sync with current page during scroll mode
  // so usePreloadManager preloads pages ahead/behind the visible viewport
  // Only enable for comics with enough pages to make preloading meaningful
  // Suppress during drag — onDragEnd in useSliderDrag handles the final target
  useEffect(() => {
    if (isDragging) return
    if (visibleMode === 'scroll' && loadingState === 'loaded' && imageUrls.length > 9 && !isDetailPage) {
      setPreloadTarget(Math.min(currentPage, totalPages))
    }
  }, [visibleMode, currentPage, loadingState, imageUrls.length, isDragging, isDetailPage, setPreloadTarget, totalPages])

  // Jump to initial page when opening from history
  useEffect(() => {
    if (!open || !initialPage || loadingState !== 'loaded') return
    if (initialPage > 0 && initialPage <= totalPages) {
      setCurrentPage(initialPage)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPage, loadingState])

  const hasPrevChapter = currentChapterIndex > 0
  const hasNextChapter = currentChapterIndex >= 0 && currentChapterIndex < chapters.length - 1

  const goToChapter = useCallback((idx: number) => {
    if (idx < 0 || idx >= chapters.length) return
    setCurrentChapterIndex(idx)
    setChapterFlipHint(null)
    setSelectedChapterId(chapters[idx].id)
    fetchChapterUrls(chapters[idx].id, comic?.albumId ?? comic?.id, comic?.sourceSite)
  }, [chapters, fetchChapterUrls, comic])

  const handleSelectChapter = useCallback((chapterId: string) => {
    const idx = chapters.findIndex((c) => c.id === chapterId)
    if (idx >= 0) {
      goToChapter(idx)
    } else {
      setSelectedChapterId(chapterId)
      fetchChapterUrls(chapterId, comic?.albumId ?? comic?.id, comic?.sourceSite)
    }
  }, [chapters, goToChapter, fetchChapterUrls, comic])

  // 多章节专辑且尚未选章时，显示选章首屏而非翻页视图
  const showChapterPicker = chapters.length > 1 && !selectedChapterId

  // Fetch URLs when modal opens
  useEffect(() => {
    if (open && comic) {
      if (initialChapterId) {
        // Jump straight into a specific chapter (e.g. resumed from history)
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedChapterId(initialChapterId)
        fetchChapterUrls(initialChapterId, comic.albumId ?? comic.id, comic.sourceSite)
      } else {
        fetchUrls(comic)
      }
    } else {
      // Modal closing — save current page immediately if needed
      const c = comicRef.current
      const imagePage = Math.min(currentPage, totalPages)
      if (c && imagePage > 0 && imagePage !== lastRecordedPageRef.current) {
        lastRecordedPageRef.current = imagePage
        addHistory({
          comicId: c.id,
          title: c.title,
          coverUrl: c.coverUrl,
          source: c.source,
          sourceSite: c.sourceSite || '',
          mediaId: c.mediaId || '',
          sourceUrl: c.url,
          lastPage: imagePage,
          totalPages,
          lastChapterId: chapters[currentChapterIndex]?.id ?? '',
          lastChapterName: chapters[currentChapterIndex]?.name ?? '',
        }).catch(() => {}).finally(() => {
          historyStore.clearCache()
        })
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      lastRecordedPageRef.current = 0
      setSelectedChapterId(null)
      setCurrentChapterIndex(-1)
      setChapterFlipHint(null)
      reset()
      clearCache()
      // 清理失败页聚合状态与残留 Toast，避免下本漫画看到上一本的失败提示
      prevFailedCountRef.current = 0
      hadFailedToastRef.current = false
      clearFailedPages()
      useToastStore.getState().dismiss()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, comic?.id, fetchUrls, fetchChapterUrls, reset, clearCache, clearFailedPages])

  // Debounced history recording on page change
  useEffect(() => {
    if (!open || !comic || loadingState !== 'loaded' || currentPage <= 0) return
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(() => {
      recordHistory(currentPage)
    }, 2000)
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- comic?.id is sufficient; recordHistory already captures comic
  }, [open, comic?.id, currentPage, loadingState, recordHistory])

  // Keyboard handler（含边界翻章二次确认，留在 modal 内——ReaderShell 只管视觉）
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if ((e.key === '=' || e.key === '+') && e.ctrlKey) {
        e.preventDefault()
        zoomIn()
      } else if (e.key === '-' && e.ctrlKey) {
        e.preventDefault()
        zoomOut()
      } else if (e.key === '0' && e.ctrlKey) {
        e.preventDefault()
        resetZoom()
      } else if (visibleMode === 'scroll') {
        if (isModeTransitioning) return
        if (e.key === 'ArrowDown' || e.key === ' ') {
          e.preventDefault()
          scrollContainerRef.current?.scrollBy({ top: 300, behavior: 'smooth' })
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          scrollContainerRef.current?.scrollBy({ top: -300, behavior: 'smooth' })
        }
      } else {
        if (isModeTransitioning) return
        const step = visibleMode === 'double' ? 2 : 1
        const tailNavigation = resolveReaderTailNavigation(totalPages, visibleMode, blankPosition)
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') {
          e.preventDefault()
          if (hasDetailTail && currentPage === tailNavigation.tailPosition) {
            return
          }
          if (hasDetailTail && currentPage >= tailNavigation.lastImagePosition) {
            setChapterFlipHint(null)
            setCurrentPage(tailNavigation.tailPosition)
          } else if (currentPage + step <= tailNavigation.imageEffectiveTotal) {
            setChapterFlipHint(null)
            setCurrentPage(currentPage + step)
          } else if (hasNextChapter) {
            if (chapterFlipHint === 'next') {
              goToChapter(currentChapterIndex + 1)
            } else {
              setChapterFlipHint('next')
            }
          }
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
          e.preventDefault()
          if (hasDetailTail && currentPage === tailNavigation.tailPosition) {
            setChapterFlipHint(null)
            setCurrentPage(tailNavigation.lastImagePosition)
          } else if (currentPage > 1) {
            setChapterFlipHint(null)
            setCurrentPage(Math.max(currentPage - step, 1))
          } else if (hasPrevChapter) {
            if (chapterFlipHint === 'prev') {
              goToChapter(currentChapterIndex - 1)
            } else {
              setChapterFlipHint('prev')
            }
          }
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, visibleMode, blankPosition, currentPage, totalPages, setCurrentPage, isModeTransitioning,
      chapters.length, hasNextChapter, hasPrevChapter, hasDetailTail, chapterFlipHint, currentChapterIndex, goToChapter])

  // 失败页阈值 Toast 逻辑（详见 openspec/changes/preview-retry-toast/design.md 决策 3）：
  // - failedCount > 3：常驻 Toast，文案"N 页加载失败"，带"全部重试"按钮
  // - failedCount 从 >0 变 0 且曾弹过失败 Toast：切 success Toast"已恢复全部页面"，自动消失
  // - failedCount 回落到 ≤3（仍 >0）：直接 dismiss，不显示恢复提示
  // 切换章节时 imageUrls 引用变化 → 清空失败集合（在下面独立的 effect 中处理）
  useEffect(() => {
    const prev = prevFailedCountRef.current
    // failedCount 不变时不做事
    if (prev === failedCount) return
    prevFailedCountRef.current = failedCount

    if (failedCount > FAILED_THRESHOLD) {
      // 超阈值：常驻失败 Toast
      hadFailedToastRef.current = true
      useToastStore.getState().error(`${failedCount} 页加载失败`, {
        actionLabel: '全部重试',
        onAction: handleRetryAll,
        persistent: true,
      })
    } else if (failedCount === 0 && hadFailedToastRef.current) {
      // 曾弹过失败 Toast 且现已全部恢复：切 success，自动消失
      hadFailedToastRef.current = false
      useToastStore.getState().success('已恢复全部页面')
    } else {
      // 回落到 (0, FAILED_THRESHOLD]：直接 dismiss
      hadFailedToastRef.current = false
      useToastStore.getState().dismiss()
    }
  }, [failedCount, handleRetryAll])

  // 切换章节（imageUrls 引用变化）时清空失败集合与残留 Toast。
  // 跳过首次（modal 打开时集合本为空，clearAll 无副作用但 dismiss 多余）。
  const prevImageUrlsRef = useRef(imageUrls)
  useEffect(() => {
    if (prevImageUrlsRef.current === imageUrls) return
    prevImageUrlsRef.current = imageUrls
    prevFailedCountRef.current = 0
    hadFailedToastRef.current = false
    clearFailedPages()
    useToastStore.getState().dismiss()
  }, [imageUrls, clearFailedPages])

  // bika 图片清晰度设置面板插槽
  const bikaImageQualitySlot = comic?.sourceSite === 'bika' ? (
    <>
      <label className="flex items-center justify-between gap-2 text-xs text-gray-300">
        <span>图片清晰度</span>
        <span className="text-gray-500" style={{ minWidth: '32px', textAlign: 'right' }}>
          {bikaImageQuality === 'low' ? '低' : bikaImageQuality === 'medium' ? '中' : bikaImageQuality === 'high' ? '高' : '原画'}
        </span>
      </label>
      <div className="flex rounded-md overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
        {IMAGE_QUALITIES.map((q) => (
          <button
            key={q}
            onClick={() => {
              setBikaImageQuality(q)
              window.hcomic?.setConfig('bikaImageQuality', q).catch(() => {})
            }}
            className="flex-1 py-1 text-xs transition-colors"
            style={{
              background: bikaImageQuality === q ? 'rgba(108,140,255,0.2)' : 'transparent',
              color: bikaImageQuality === q ? '#6c8cff' : 'rgba(255,255,255,0.4)',
            }}
          >
            {q === 'low' ? '低' : q === 'medium' ? '中' : q === 'high' ? '高' : '原画'}
          </button>
        ))}
      </div>
    </>
  ) : undefined

  return (
    <ReaderShell
      open={open}
      onClose={onClose}
      title={comic?.title ?? ''}
      currentPage={currentPage}
      currentItemLabel={isDetailPage ? '详情' : undefined}
      effectiveTotal={effectiveTotalPages}
      chapters={chapters}
      currentChapterIndex={currentChapterIndex}
      onGoToChapter={goToChapter}
      navigationEnabled={loadingState === 'loaded' && imageUrls.length > 0 && !showChapterPicker}
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
      preloadedRanges={preloadedRanges}
      bikaImageQualitySlot={bikaImageQualitySlot}
    >
      <ReaderModeStage phase={modeTransitionPhase} reduceMotion={reduceModeMotion}>
      {/* 内容区：各 loading/error/empty/ChapterPicker/scroll/PageFlipView 分支 */}
      {showChapterPicker ? (
        <ChapterPicker
          chapters={chapters}
          onSelect={handleSelectChapter}
          title={comic?.title}
        />
      ) : visibleMode === 'scroll' ? (
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
          {(loadingState === 'loading' || loadingState === 'idle') && (
            <ReaderLoadingState className="h-full" />
          )}
          {loadingState === 'error' && (
            <ReaderErrorState message={errorMessage} onClose={onClose} className="h-full" />
          )}
          {loadingState === 'loaded' && imageUrls.length === 0 && (
            <ReaderEmptyState onClose={onClose} className="h-full" />
          )}
          {loadingState === 'loaded' && imageUrls.length > 0 && (
            <div className="flex flex-col items-center py-2" style={{ gap: pageGap + 'px' }}>
              {/* eslint-disable-next-line react-hooks/refs */}
              {imageUrls.map((url, idx) => {
                const cachedUrlHash = imageCacheRef.current.get(idx)
                return (
                <div
                  key={idx}
                  ref={(el) => { pageRefs.current[idx] = el }}
                  data-reader-page={idx + 1}
                  style={{ width: Math.min(imageWidth * zoom, 100) + '%' }}
                >
                  <ReaderPage
                    url={url}
                    index={idx}
                    priority={preloadTarget != null && Math.abs(idx + 1 - preloadTarget) <= 5}
                    cachedUrlHash={cachedUrlHash}
                    scrambleId={scrambleId}
                    comicId={comicId}
                    imageQuality={comic?.sourceSite === 'bika' ? bikaImageQuality : undefined}
                    onFailed={markFailed}
                    onLoaded={markLoaded}
                    onCached={handleCached}
                    retryGen={retryGen}
                  />
                </div>
                )
              })}
              {hasDetailTail && comic && (
                <div
                  ref={(el) => { pageRefs.current[imageUrls.length] = el }}
                  data-reader-page={visibleTailNavigation.tailPosition}
                  className="w-full min-h-[80vh]"
                >
                  <OnlineReaderDetailPage
                    comic={comic}
                    active={isDetailPage}
                    observeVisibility
                    onCloseReader={onClose}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          {(loadingState === 'loading' || loadingState === 'idle') && (
            <ReaderLoadingState className="flex-1" />
          )}
          {loadingState === 'error' && (
            <ReaderErrorState message={errorMessage} onClose={onClose} className="flex-1" />
          )}
          {loadingState === 'loaded' && imageUrls.length === 0 && (
            <ReaderEmptyState onClose={onClose} className="flex-1" />
          )}
          {loadingState === 'loaded' && imageUrls.length > 0 && (
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
              onPageChange={(page) => setPreloadTarget(page)}
              blankPosition={blankPosition}
              scrambleId={scrambleId}
              comicId={comicId}
              imageQuality={comic?.sourceSite === 'bika' ? bikaImageQuality : undefined}
              onFailed={markFailed}
              onLoaded={markLoaded}
              onCached={handleCached}
              retryGen={retryGen}
              modeTransitioning={isModeTransitioning}
              tailContent={hasDetailTail && comic ? (
                <OnlineReaderDetailPage
                  comic={comic}
                  active={isDetailPage}
                  onCloseReader={onClose}
                />
              ) : undefined}
            />
          )}
        </>
      )}
      </ReaderModeStage>

      {/* 边界翻章提示浮层 */}
      {chapterFlipHint && (
        <div className="pointer-events-none absolute left-1/2 bottom-24 -translate-x-1/2 z-10">
          <div
            className="px-4 py-2 rounded-full text-sm text-white shadow-lg"
            style={{ background: 'rgba(108,140,255,0.9)', backdropFilter: 'blur(4px)' }}
          >
            {chapterFlipHint === 'next' ? '再翻一次进入下一章 →' : '← 再翻一次进入上一章'}
          </div>
        </div>
      )}
    </ReaderShell>
  )
}
