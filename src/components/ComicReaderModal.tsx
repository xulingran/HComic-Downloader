import { useCallback, useEffect, useRef, useState } from 'react'
import { ComicInfo } from '@shared/types'
import { useComicReader } from '../hooks/useComicReader'
import { useReaderSettings, type BlankPosition } from '../hooks/useReaderSettings'
import { usePreloadManager } from '../hooks/usePreloadManager'
import { usePageTracking } from '../hooks/usePageTracking'
import { useZoom } from '../hooks/useZoom'
import { useSliderDrag } from '../hooks/useSliderDrag'
import { useModalAnimation } from '../hooks/useModalAnimation'
import { useHistory } from '../hooks/useIpc'
import { useHistoryStore } from '../stores/useHistoryStore'
import { useReaderStore } from '../stores/useReaderStore'
import { PageFlipView } from './PageFlipView'
import { ReaderPage } from './ReaderPage'
import { ChapterPicker } from './ChapterPicker'

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
    chapters,
    fetchUrls,
    fetchChapterUrls,
    setCurrentPage,
    reset,
  } = useComicReader()

  const { pageGap, imageWidth, setPageGap, setImageWidth, displayMode, setDisplayMode } = useReaderSettings()
  const [blankPosition, setBlankPosition] = useState<BlankPosition>('none')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { zoom, zoomIn, zoomOut, resetZoom } = useZoom(open)
  const { mounted, visible, handleTransitionEnd } = useModalAnimation(open)

  const {
    imageCacheRef,
    cacheVersion,
    preloadTarget,
    setPreloadTarget,
    clearCache,
  } = usePreloadManager(imageUrls, loadingState, scrambleId, comicId)

  const effectiveTotalPages = displayMode === 'double' && blankPosition === 'front' ? totalPages + 1 : totalPages
  const {
    isDragging,
    sliderRef,
    handleSliderPointerDown,
    handleSliderPointerMove,
    handleSliderPointerUp,
    cancelDrag,
  } = useSliderDrag(effectiveTotalPages, setCurrentPage, setPreloadTarget)

  const { addHistory } = useHistory()
  const historyStore = useHistoryStore()
  const { initialPage, initialChapterId } = useReaderStore()
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [currentChapterIndex, setCurrentChapterIndex] = useState(-1)
  const [chapterFlipHint, setChapterFlipHint] = useState<'next' | 'prev' | null>(null)
  const lastRecordedPageRef = useRef<number>(0)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const comicRef = useRef<ComicInfo | null>(null)

  // Keep a ref to the current comic so we can still access it on close
  useEffect(() => {
    if (comic) {
      comicRef.current = comic
    }
  }, [comic])

  const recordHistory = useCallback((page: number) => {
    if (!comic || page === lastRecordedPageRef.current) return
    lastRecordedPageRef.current = page
    addHistory({
      comicId: comic.id,
      title: comic.title,
      coverUrl: comic.coverUrl,
      source: comic.source,
      sourceSite: comic.sourceSite || '',
      mediaId: comic.mediaId || '',
      sourceUrl: comic.url,
      lastPage: page,
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
  const settingsPanelRef = useRef<HTMLDivElement>(null)
  const freezePageTrackingRef = useRef(false)

  usePageTracking(
    pageRefs, scrollContainerRef, isDragging, currentPage, setCurrentPage,
    loadingState, imageUrls.length, freezePageTrackingRef,
  )

  // Jump to initial page when opening from history
  useEffect(() => {
    if (!open || !initialPage || loadingState !== 'loaded') return
    if (initialPage > 0 && initialPage <= totalPages) {
      setCurrentPage(initialPage)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPage, loadingState])

  // Close settings panel on outside click
  useEffect(() => {
    if (!settingsOpen) return
    const handler = (e: MouseEvent) => {
      if (settingsPanelRef.current?.contains(e.target as Node)) return
      const btn = (e.target as Element).closest('[aria-label="阅读设置"]')
      if (btn) return
      setSettingsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [settingsOpen])

  const handleSetDisplayMode = useCallback((mode: typeof displayMode) => {
    setDisplayMode(mode)
    if (mode !== 'double') setBlankPosition('none')
  }, [setDisplayMode])

  const hasPrevChapter = currentChapterIndex > 0
  const hasNextChapter = currentChapterIndex >= 0 && currentChapterIndex < chapters.length - 1

  const goToChapter = useCallback((idx: number) => {
    if (idx < 0 || idx >= chapters.length) return
    setCurrentChapterIndex(idx)
    setChapterFlipHint(null)
    setSelectedChapterId(chapters[idx].id)
    fetchChapterUrls(chapters[idx].id, comic?.albumId ?? comic?.id)
  }, [chapters, fetchChapterUrls, comic])

  const handleSelectChapter = useCallback((chapterId: string) => {
    const idx = chapters.findIndex((c) => c.id === chapterId)
    if (idx >= 0) {
      goToChapter(idx)
    } else {
      setSelectedChapterId(chapterId)
      fetchChapterUrls(chapterId, comic?.albumId ?? comic?.id)
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
        fetchChapterUrls(initialChapterId, comic.albumId ?? comic.id)
      } else {
        fetchUrls(comic)
      }
    } else {
      // Modal closing — save current page immediately if needed
      const c = comicRef.current
      if (c && currentPage > 0 && currentPage !== lastRecordedPageRef.current) {
        lastRecordedPageRef.current = currentPage
        addHistory({
          comicId: c.id,
          title: c.title,
          coverUrl: c.coverUrl,
          source: c.source,
          sourceSite: c.sourceSite || '',
          mediaId: c.mediaId || '',
          sourceUrl: c.url,
          lastPage: currentPage,
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, comic?.id, fetchUrls, fetchChapterUrls, reset, clearCache])

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

  // Keyboard handler
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
      } else if (displayMode === 'scroll') {
        if (e.key === 'ArrowDown' || e.key === ' ') {
          e.preventDefault()
          scrollContainerRef.current?.scrollBy({ top: 300, behavior: 'smooth' })
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          scrollContainerRef.current?.scrollBy({ top: -300, behavior: 'smooth' })
        }
      } else {
        const step = displayMode === 'double' ? 2 : 1
        const navTotal = displayMode === 'double' && blankPosition === 'front' ? totalPages + 1 : totalPages
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') {
          e.preventDefault()
          if (currentPage + step <= navTotal) {
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
          if (currentPage > 1) {
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
  }, [open, onClose, displayMode, blankPosition, currentPage, totalPages, setCurrentPage,
      chapters.length, hasNextChapter, hasPrevChapter, chapterFlipHint, currentChapterIndex, goToChapter])

  const prevDisplayModeRef = useRef(displayMode)
  useEffect(() => {
    const prevMode = prevDisplayModeRef.current
    prevDisplayModeRef.current = displayMode

    if (prevMode === displayMode) return

    if (displayMode === 'double' && currentPage > 1 && currentPage % 2 === 0) {
      setCurrentPage(currentPage - 1)
    }

    if (displayMode === 'scroll' && currentPage > 1 && loadingState === 'loaded') {
      freezePageTrackingRef.current = true
      requestAnimationFrame(() => {
        const el = pageRefs.current[currentPage - 1]
        if (el) {
          el.scrollIntoView({ behavior: 'instant', block: 'start' })
        }
        setTimeout(() => {
          freezePageTrackingRef.current = false
        }, 50)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMode])

  if (!mounted) return null

  const progress = effectiveTotalPages > 0 ? Math.round((currentPage / effectiveTotalPages) * 100) : 0

  return (
    <div className="fixed inset-0 z-50">
      {/* 半透明遮罩层，点击可关闭 */}
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-300 ${
          visible ? 'opacity-50' : 'opacity-0'
        }`}
        onClick={onClose}
      />
      {/* 模态内容层，垂直方向滑入滑出 */}
      <div
        onTransitionEnd={handleTransitionEnd}
        className={`absolute inset-0 flex flex-col bg-[#1a1a2e] transition-transform duration-300 ease-out ${
          visible ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3 shrink-0"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-white text-sm hover:bg-white/10 transition-colors"
            style={{ background: 'rgba(255,255,255,0.1)' }}
          >
            关闭
          </button>
          <span className="text-sm text-gray-400 truncate max-w-[300px]">{comic?.title}</span>
        </div>
        <span
          className="px-2.5 py-1 rounded-full text-xs text-white"
          style={{ background: 'rgba(255,255,255,0.15)' }}
        >
          {currentPage} / {effectiveTotalPages}
        </span>
      </div>

      {/* Content */}
      {showChapterPicker ? (
        <ChapterPicker
          chapters={chapters}
          onSelect={handleSelectChapter}
          title={comic?.title}
        />
      ) : displayMode === 'scroll' ? (
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
                const cachedDataUri = imageCacheRef.current.get(idx)
                return (
                <div
                  key={idx}
                  ref={(el) => { pageRefs.current[idx] = el }}
                  style={{ width: Math.min(imageWidth * zoom, 100) + '%' }}
                >
                  <ReaderPage
                    url={url}
                    index={idx}
                    priority={preloadTarget != null && Math.abs(idx + 1 - preloadTarget) <= 5}
                    cachedDataUri={cachedDataUri}
                    scrambleId={scrambleId}
                    comicId={comicId}
                  />
                </div>
                )
              })}
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
              displayMode={displayMode}
              imageWidth={imageWidth}
              zoom={zoom}
              imageCacheRef={imageCacheRef}
              cacheVersion={cacheVersion}
              onPageChange={(page) => setPreloadTarget(page)}
              blankPosition={blankPosition}
              scrambleId={scrambleId}
              comicId={comicId}
            />
          )}
        </>
      )}

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

      {/* Footer */}
      <div
        className="px-5 py-2 shrink-0 relative"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
      >
        <div className="flex items-center gap-3">
          {chapters.length > 1 && (
            <button
              aria-label="上一章"
              disabled={!hasPrevChapter}
              onClick={() => goToChapter(currentChapterIndex - 1)}
              className="px-2 py-1 rounded text-xs text-white transition-colors hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
              style={{ background: 'rgba(255,255,255,0.08)' }}
            >
              ‹ 上一章
            </button>
          )}
          <span className="text-xs text-gray-500">{currentPage} / {effectiveTotalPages}</span>
          <div
            ref={sliderRef}
            data-track
            role="slider"
            aria-valuemin={1}
            aria-valuemax={effectiveTotalPages}
            aria-valuenow={currentPage}
            aria-label="页面进度"
            className="flex-1 h-6 flex items-center cursor-pointer"
            style={{ padding: '8px 0' }}
            onPointerDown={handleSliderPointerDown}
            onPointerMove={handleSliderPointerMove}
            onPointerUp={handleSliderPointerUp}
            onPointerCancel={cancelDrag}
            onLostPointerCapture={cancelDrag}
          >
            <div className="w-full relative" style={{ height: '4px' }}>
              <div className="absolute inset-0 rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }} />
              <div
                className="absolute left-0 top-0 bottom-0 rounded-full"
                style={{ width: `${progress}%`, background: '#6c8cff' }}
              />
              <div
                className="absolute top-1/2 rounded-full"
                style={{
                  left: `${progress}%`,
                  transform: 'translate(-50%, -50%)',
                  width: isDragging ? 18 : 14,
                  height: isDragging ? 18 : 14,
                  background: '#6c8cff',
                  boxShadow: '0 0 6px rgba(108,140,255,0.5)',
                  transition: isDragging ? 'none' : 'left 0.2s, width 0.15s, height 0.15s',
                  ...(isDragging ? { touchAction: 'none' } : {}),
                }}
              />
            </div>
          </div>
          {chapters.length > 1 && (
            <button
              aria-label="下一章"
              disabled={!hasNextChapter}
              onClick={() => goToChapter(currentChapterIndex + 1)}
              className="px-2 py-1 rounded text-xs text-white transition-colors hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
              style={{ background: 'rgba(255,255,255,0.08)' }}
            >
              下一章 ›
            </button>
          )}
          <span className="text-xs text-gray-500">
            {displayMode === 'scroll' ? 'ESC 关闭 | ↑↓ 滚动' : 'ESC 关闭 | ←→ 翻页'}
          </span>
          <button
            aria-label="阅读设置"
            onClick={() => setSettingsOpen(!settingsOpen)}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            style={{ color: settingsOpen ? '#6c8cff' : 'rgba(255,255,255,0.5)' }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="2.5" />
              <path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06" />
            </svg>
          </button>
        </div>

        {settingsOpen && (
          <div
            ref={settingsPanelRef}
            className="absolute bottom-full right-4 mb-2 rounded-lg"
            style={{
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(8px)',
              padding: '12px 16px',
              width: '220px',
            }}
          >
            <div className="flex flex-col gap-3">
              {/* Display mode switcher */}
              <div className="flex rounded-md overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <ModeButton
                  label="连续滚动"
                  icon={scrollIcon}
                  active={displayMode === 'scroll'}
                  onClick={() => handleSetDisplayMode('scroll')}
                />
                <ModeButton
                  label="单页显示"
                  icon={singleIcon}
                  active={displayMode === 'single'}
                  onClick={() => handleSetDisplayMode('single')}
                />
                <ModeButton
                  label="双页显示"
                  icon={doubleIcon}
                  active={displayMode === 'double'}
                  onClick={() => handleSetDisplayMode('double')}
                />
              </div>
              {displayMode === 'double' && (
                <div className="flex rounded-md overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <ModeButton
                    label="无补白"
                    icon={blankNoneIcon}
                    active={blankPosition === 'none'}
                    onClick={() => setBlankPosition('none')}
                  />
                  <ModeButton
                    label="前补白"
                    icon={blankFrontIcon}
                    active={blankPosition === 'front'}
                    onClick={() => setBlankPosition('front')}
                  />
                  <ModeButton
                    label="后补白"
                    icon={blankEndIcon}
                    active={blankPosition === 'end'}
                    onClick={() => setBlankPosition('end')}
                  />
                </div>
              )}
              {displayMode === 'scroll' && (
                <>
                  <label className="flex items-center justify-between gap-2 text-xs text-gray-300">
                    <span>页面间距</span>
                    <span className="text-gray-500" style={{ minWidth: '32px', textAlign: 'right' }}>{pageGap}px</span>
                  </label>
                  <input
                    aria-label="页面间距"
                    type="range"
                    min={0}
                    max={80}
                    step={2}
                    value={pageGap}
                    onChange={(e) => setPageGap(Number(e.target.value))}
                    className="w-full accent-[#6c8cff]"
                  />
                </>
              )}
              <label className="flex items-center justify-between gap-2 text-xs text-gray-300">
                <span>图片宽度</span>
                <span className="text-gray-500" style={{ minWidth: '32px', textAlign: 'right' }}>{imageWidth}%</span>
              </label>
              <input
                aria-label="图片宽度"
                type="range"
                min={30}
                max={100}
                step={1}
                value={imageWidth}
                onChange={(e) => setImageWidth(Number(e.target.value))}
                className="w-full accent-[#6c8cff]"
              />
              {/* Zoom controls */}
              <label className="flex items-center justify-between gap-2 text-xs text-gray-300">
                <span>缩放</span>
                <span className="text-gray-500" style={{ minWidth: '40px', textAlign: 'right' }}>{Math.round(zoom * 100)}%</span>
              </label>
              <div className="flex items-center gap-1">
                <button
                  onClick={zoomOut}
                  className="px-2 py-0.5 text-xs rounded bg-white/10 hover:bg-white/20 transition-colors text-white/70 hover:text-white"
                >
                  −
                </button>
                <button
                  onClick={zoomIn}
                  className="px-2 py-0.5 text-xs rounded bg-white/10 hover:bg-white/20 transition-colors text-white/70 hover:text-white"
                >
                  +
                </button>
                <button
                  onClick={resetZoom}
                  className="px-2 py-0.5 text-xs rounded bg-white/10 hover:bg-white/20 transition-colors text-white/70 hover:text-white ml-auto"
                >
                  重置
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  </div>
  )
}

function ModeButton({ label, icon, active, onClick }: {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex-1 flex items-center justify-center py-1.5 transition-colors"
      style={{
        background: active ? 'rgba(108,140,255,0.2)' : 'transparent',
        color: active ? '#6c8cff' : 'rgba(255,255,255,0.4)',
      }}
    >
      {icon}
    </button>
  )
}

const scrollIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="1" width="8" height="14" rx="1" />
    <path d="M8 11v2.5M6 12l2 1.5L10 12" />
  </svg>
)

const singleIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="1" width="10" height="14" rx="1" />
  </svg>
)

const doubleIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="1" width="6" height="14" rx="1" />
    <rect x="9" y="1" width="6" height="14" rx="1" />
  </svg>
)

const blankNoneIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="1" width="6" height="14" rx="1" />
    <rect x="9" y="1" width="6" height="14" rx="1" />
  </svg>
)

const blankFrontIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="1" width="6" height="14" rx="1" strokeDasharray="2 2" />
    <rect x="9" y="1" width="6" height="14" rx="1" />
  </svg>
)

const blankEndIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="1" width="6" height="14" rx="1" />
    <rect x="9" y="1" width="6" height="14" rx="1" strokeDasharray="2 2" />
  </svg>
)

function ReaderLoadingState({ className }: { className: string }) {
  return (
    <div className={`flex items-center justify-center ${className} text-gray-400`}>
      <svg className="animate-spin h-8 w-8 mr-3" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      加载中...
    </div>
  )
}

function ReaderErrorState({ message, onClose, className }: { message: string; onClose: () => void; className: string }) {
  return (
    <div className={`flex flex-col items-center justify-center ${className} text-gray-400 gap-3`}>
      <span>无法加载漫画内容</span>
      <span className="text-xs text-gray-500">{message}</span>
      <button
        onClick={onClose}
        className="px-4 py-2 rounded-lg text-sm text-white"
        style={{ background: 'rgba(255,255,255,0.1)' }}
      >
        关闭
      </button>
    </div>
  )
}

function ReaderEmptyState({ onClose, className }: { onClose: () => void; className: string }) {
  return (
    <div className={`flex flex-col items-center justify-center ${className} text-gray-400 gap-3`}>
      <span>无可用图片</span>
      <button
        onClick={onClose}
        className="px-4 py-2 rounded-lg text-sm text-white"
        style={{ background: 'rgba(255,255,255,0.1)' }}
      >
        关闭
      </button>
    </div>
  )
}
