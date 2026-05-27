import { useCallback, useEffect, useRef, useState } from 'react'
import { ComicInfo } from '@shared/types'
import { useComicReader } from '../hooks/useComicReader'
import { useReaderSettings, type BlankPosition } from '../hooks/useReaderSettings'
import { usePreloadManager } from '../hooks/usePreloadManager'
import { usePageTracking } from '../hooks/usePageTracking'
import { useHistory } from '../hooks/useIpc'
import { useHistoryStore } from '../stores/useHistoryStore'
import { useReaderStore } from '../stores/useReaderStore'
import { PageFlipView } from './PageFlipView'
import { ReaderPage } from './ReaderPage'

const ZOOM_MIN = 0.25
const ZOOM_MAX = 4.0
const ZOOM_STEP = 0.1

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
    fetchUrls,
    setCurrentPage,
    reset,
  } = useComicReader()

  const { pageGap, imageWidth, setPageGap, setImageWidth, displayMode, setDisplayMode } = useReaderSettings()
  const [blankPosition, setBlankPosition] = useState<BlankPosition>('none')
  const effectiveTotalPages = displayMode === 'double' && blankPosition === 'front' ? totalPages + 1 : totalPages
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true)
      // 双层 RAF：等待 DOM mount + 浏览器完成样式计算后再触发 CSS transition
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true))
      })
    } else {
      setVisible(false)
    }
  }, [open])

  const handleTransitionEnd = useCallback(() => {
    if (!visible) {
      setMounted(false)
    }
  }, [visible])

  const [isDragging, setIsDragging] = useState(false)
  const dragPageRef = useRef(0)
  const sliderRef = useRef<HTMLDivElement>(null)

  const {
    imageCacheRef,
    cacheVersion,
    preloadTarget,
    setPreloadTarget,
    clearCache,
  } = usePreloadManager(imageUrls, loadingState)

  const { addHistory } = useHistory()
  const historyStore = useHistoryStore()
  const { initialPage } = useReaderStore()
  const lastRecordedPageRef = useRef<number>(0)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const comicRef = useRef<ComicInfo | null>(null)

  // Keep a ref to the current comic so we can still access it on close
  if (comic) {
    comicRef.current = comic
  }

  const recordHistory = useCallback((page: number) => {
    const c = comic || comicRef.current
    if (!c || page === lastRecordedPageRef.current) return
    lastRecordedPageRef.current = page
    addHistory(
      c.id,
      c.title,
      c.coverUrl,
      c.source,
      c.url,
      page,
      totalPages,
    ).catch((err) => {
      console.error('Failed to record history:', err)
    }).finally(() => {
      historyStore.clearCache()
    })
  }, [comic, totalPages, addHistory, historyStore])

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const settingsPanelRef = useRef<HTMLDivElement>(null)

  usePageTracking(
    pageRefs, scrollContainerRef, isDragging, currentPage, setCurrentPage,
    loadingState, imageUrls.length,
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

  const zoomIn = useCallback(() => {
    setZoom(z => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(1)))
  }, [])

  const zoomOut = useCallback(() => {
    setZoom(z => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(1)))
  }, [])

  const resetZoom = useCallback(() => {
    setZoom(1)
  }, [])

  const handleSetDisplayMode = useCallback((mode: typeof displayMode) => {
    setDisplayMode(mode)
    if (mode !== 'double') setBlankPosition('none')
  }, [setDisplayMode])

  // Ctrl+Wheel zoom
  useEffect(() => {
    if (!open) return
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault()
        if (e.deltaY < 0) zoomIn()
        else if (e.deltaY > 0) zoomOut()
      }
    }
    window.addEventListener('wheel', handler, { passive: false })
    return () => window.removeEventListener('wheel', handler)
  }, [open, zoomIn, zoomOut])

  // Fetch URLs when modal opens
  useEffect(() => {
    if (open && comic) {
      fetchUrls(comic)
    } else {
      // Modal closing — save current page immediately if needed
      const c = comicRef.current
      if (c && currentPage > 0 && currentPage !== lastRecordedPageRef.current) {
        lastRecordedPageRef.current = currentPage
        addHistory(
          c.id,
          c.title,
          c.coverUrl,
          c.source,
          c.url,
          currentPage,
          totalPages,
        ).catch(() => {}).finally(() => {
          historyStore.clearCache()
        })
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      lastRecordedPageRef.current = 0
      reset()
      clearCache()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, comic?.id, fetchUrls, reset, clearCache])

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
            setCurrentPage(currentPage + step)
          }
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
          e.preventDefault()
          if (currentPage > 1) {
            setCurrentPage(Math.max(currentPage - step, 1))
          }
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, displayMode, blankPosition, currentPage, totalPages, setCurrentPage])

  // Align currentPage to odd in double mode
  // Intentionally reads currentPage from closure without listing it as a dependency.
  // Only align on displayMode change; adding currentPage would cause infinite re-runs.
  useEffect(() => {
    if (displayMode === 'double' && currentPage > 1 && currentPage % 2 === 0) {
      setCurrentPage(currentPage - 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMode])

  if (!mounted) return null

  const progress = effectiveTotalPages > 0 ? Math.round((currentPage / effectiveTotalPages) * 100) : 0

  const handleSliderPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setIsDragging(true)
    updateDragPosition(e)
  }

  const handleSliderPointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return
    updateDragPosition(e)
  }

  const handleSliderPointerUp = () => {
    if (!isDragging) return
    setIsDragging(false)
    if (dragPageRef.current > 0) {
      setPreloadTarget(dragPageRef.current)
    }
  }

  const updateDragPosition = (e: React.PointerEvent) => {
    const track = sliderRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const page = Math.max(1, Math.round(pct * effectiveTotalPages))
    dragPageRef.current = page
    pageRefs.current[page - 1]?.scrollIntoView({ behavior: 'instant' })
    setCurrentPage(page)
  }

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
      {displayMode === 'scroll' ? (
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
            />
          )}
        </>
      )}

      {/* Footer */}
      <div
        className="px-5 py-2 shrink-0 relative"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
      >
        <div className="flex items-center gap-3">
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
            onPointerCancel={() => setIsDragging(false)}
            onLostPointerCapture={() => setIsDragging(false)}
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
