import { useEffect, useRef, useState } from 'react'
import { ComicInfo } from '@shared/types'
import { useComicReader } from '../hooks/useComicReader'
import { useReaderSettings } from '../hooks/useReaderSettings'
import { usePreloadManager } from '../hooks/usePreloadManager'
import { usePageTracking } from '../hooks/usePageTracking'

interface ComicReaderModalProps {
  comic: ComicInfo
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

  const { pageGap, imageWidth, setPageGap, setImageWidth } = useReaderSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)

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

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const settingsPanelRef = useRef<HTMLDivElement>(null)

  usePageTracking(
    pageRefs, scrollContainerRef, isDragging, currentPage, setCurrentPage,
    loadingState, imageUrls.length,
  )

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

  // Fetch URLs when modal opens
  useEffect(() => {
    if (open) {
      fetchUrls(comic)
    } else {
      reset()
      clearCache()
    }
  }, [open, comic.id, fetchUrls, reset, clearCache])

  // Keyboard handler
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault()
        scrollContainerRef.current?.scrollBy({ top: 300, behavior: 'smooth' })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        scrollContainerRef.current?.scrollBy({ top: -300, behavior: 'smooth' })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const progress = totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0

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
    const page = Math.max(1, Math.round(pct * totalPages))
    dragPageRef.current = page
    pageRefs.current[page - 1]?.scrollIntoView({ behavior: 'instant' })
    setCurrentPage(page)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#1a1a2e]">
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
          <span className="text-sm text-gray-400 truncate max-w-[300px]">{comic.title}</span>
        </div>
        <span
          className="px-2.5 py-1 rounded-full text-xs text-white"
          style={{ background: 'rgba(255,255,255,0.15)' }}
        >
          {currentPage} / {totalPages}
        </span>
      </div>

      {/* Content */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {(loadingState === 'loading' || loadingState === 'idle') && (
          <div className="flex items-center justify-center h-full text-gray-400">
            <svg className="animate-spin h-8 w-8 mr-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            加载中...
          </div>
        )}

        {loadingState === 'error' && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
            <span>无法加载漫画内容</span>
            <span className="text-xs text-gray-500">{errorMessage}</span>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-white"
              style={{ background: 'rgba(255,255,255,0.1)' }}
            >
              关闭
            </button>
          </div>
        )}

        {loadingState === 'loaded' && imageUrls.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
            <span>无可用图片</span>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-white"
              style={{ background: 'rgba(255,255,255,0.1)' }}
            >
              关闭
            </button>
          </div>
        )}

        {loadingState === 'loaded' && imageUrls.length > 0 && (
          <div className="flex flex-col items-center py-2" style={{ gap: pageGap + 'px' }}>
            {imageUrls.map((url, idx) => {
              // cacheVersion forces React to re-read the cache ref when preload completes
              void cacheVersion
              const cachedDataUri = imageCacheRef.current.get(idx)
              return (
              <div
                key={idx}
                ref={(el) => { pageRefs.current[idx] = el }}
                style={{ width: imageWidth + '%' }}
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

      {/* Footer */}
      <div
        className="px-5 py-2 shrink-0 relative"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{progress}%</span>
          <div
            ref={sliderRef}
            data-track
            role="slider"
            aria-valuemin={1}
            aria-valuemax={totalPages}
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
          {isDragging && (
            <span
              className="text-xs px-2 py-0.5 rounded"
              style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
            >
              {currentPage} / {totalPages}
            </span>
          )}
          <span className="text-xs text-gray-500">ESC 关闭 | ↑↓ 滚动</span>
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
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ReaderPage({ url, index, priority, cachedDataUri }: {
  url: string
  index: number
  priority?: boolean
  cachedDataUri?: string
}) {
  const [error, setError] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [dataUri, setDataUri] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    setError(false)
    setErrorMessage('')
    setDataUri(null)
    setRetryTick(0)
  }, [url])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setIsVisible(true) },
      { rootMargin: '400px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (cachedDataUri && !dataUri) {
      setDataUri(cachedDataUri)
      return
    }
    if (dataUri || error) return
    if (!isVisible && !priority) return
    let cancelled = false

    Promise.resolve()
      .then(() => window.hcomic!.fetchPreviewImage(url))
      .then((result) => {
        if (cancelled) return
        if (!result?.dataUri) {
          throw new Error('Empty preview image response')
        }
        setDataUri(result.dataUri)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[preview] fetchPreviewImage failed', { url, err })
        setErrorMessage(err instanceof Error ? err.message : '图片加载失败')
        setError(true)
      })
    return () => { cancelled = true }
  }, [cachedDataUri, dataUri, error, isVisible, priority, retryTick, url])

  const retry = () => {
    setError(false)
    setErrorMessage('')
    setDataUri(null)
    setRetryTick(t => t + 1)
  }

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 text-gray-400"
        style={{ aspectRatio: '3/4' }}
      >
        <span className="text-xs">第 {index + 1} 页加载失败</span>
        {errorMessage && <span className="max-w-full truncate px-3 text-[10px] text-gray-500">{errorMessage}</span>}
        <button
          onClick={retry}
          className="text-xs px-3 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors"
        >
          重试
        </button>
      </div>
    )
  }

  return (
    <div ref={containerRef} style={dataUri ? undefined : { aspectRatio: '3/4' }} className="relative flex items-center justify-center">
      {(isVisible || priority || dataUri) ? (
        <>
          {!dataUri && (
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="animate-spin h-6 w-6 text-gray-600" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          )}
          {dataUri && (
            <img
              src={dataUri}
              alt={`第 ${index + 1} 页`}
              onError={() => {
                setErrorMessage('浏览器无法解码后端返回的图片')
                setError(true)
              }}
              className="w-full h-auto"
            />
          )}
        </>
      ) : (
        <div
          className="w-full h-full"
          style={{
            background: 'repeating-linear-gradient(0deg, transparent, transparent 8px, rgba(255,255,255,0.03) 8px, rgba(255,255,255,0.03) 16px)',
          }}
        />
      )}
    </div>
  )
}
