import { useRef, useCallback, useEffect, useState } from 'react'
import type { DisplayMode } from '../hooks/useReaderSettings'

interface PageFlipViewProps {
  imageUrls: string[]
  totalPages: number
  currentPage: number
  setCurrentPage: (page: number) => void
  displayMode: DisplayMode
  imageWidth: number
  zoom: number
  imageCacheRef: React.RefObject<Map<number, string>>
  cacheVersion: number
  onPageChange: (page: number) => void
}

export function PageFlipView({
  imageUrls,
  totalPages,
  currentPage,
  setCurrentPage,
  displayMode,
  imageWidth,
  zoom,
  imageCacheRef,
  cacheVersion,
  onPageChange,
}: PageFlipViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [panOffset, setPanOffset] = useState(0)
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, offset: 0 })

  const isDoubleMode = displayMode === 'double'
  const step = isDoubleMode ? 2 : 1

  const canGoPrev = currentPage > 1
  const canGoNext = isDoubleMode
    ? currentPage + step <= totalPages
    : currentPage < totalPages

  const goNext = useCallback(() => {
    if (!canGoNext) return
    const next = Math.min(currentPage + step, totalPages)
    setCurrentPage(next)
    setPanOffset(0)
  }, [canGoNext, currentPage, step, totalPages, setCurrentPage])

  const goPrev = useCallback(() => {
    if (!canGoPrev) return
    const prev = Math.max(currentPage - step, 1)
    setCurrentPage(prev)
    setPanOffset(0)
  }, [canGoPrev, currentPage, step, setCurrentPage])

  const clampPanOffset = useCallback((offset: number) => {
    const container = containerRef.current
    if (!container) return offset
    const visualWidth = container.scrollWidth * zoom
    const panRange = Math.max(0, (visualWidth - container.offsetWidth) / 2)
    return Math.max(-panRange, Math.min(panRange, offset))
  }, [zoom])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isPanning.current = true
    panStart.current = { x: e.clientX, offset: panOffset }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [panOffset])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return
    const dx = e.clientX - panStart.current.x
    const newOffset = panStart.current.offset + dx
    setPanOffset(clampPanOffset(newOffset))
  }, [clampPanOffset])

  const handlePointerUp = useCallback(() => {
    isPanning.current = false
  }, [])

  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (wheelTimer.current) return
    if (e.deltaY > 0) goNext()
    else if (e.deltaY < 0) goPrev()
    wheelTimer.current = setTimeout(() => {
      wheelTimer.current = null
    }, 200)
  }, [goNext, goPrev])

  useEffect(() => {
    return () => {
      if (wheelTimer.current) clearTimeout(wheelTimer.current)
    }
  }, [])

  // Trigger preloading when currentPage changes or on initial render
  const isFirstRender = useRef(true)
  const prevPageRef = useRef(currentPage)
  useEffect(() => {
    if (isFirstRender.current || currentPage !== prevPageRef.current) {
      isFirstRender.current = false
      prevPageRef.current = currentPage
      onPageChange(currentPage)
    }
  }, [currentPage, onPageChange])

  const leftPageIdx = currentPage - 1
  const rightPageIdx = isDoubleMode && currentPage < totalPages ? currentPage : null

  // Track cacheVersion so re-renders pick up newly cached pages
  void cacheVersion

  // Clamp panOffset when zoom changes
  useEffect(() => {
    setPanOffset(prev => clampPanOffset(prev))
  }, [clampPanOffset])

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden relative flex items-center justify-center"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        className="flex items-center justify-center h-full"
        style={{
          gap: isDoubleMode ? '4px' : undefined,
          width: `${imageWidth}%`,
          transform: `translateX(${panOffset}px) scale(${zoom})`,
          transition: isPanning.current ? 'none' : undefined,
        }}
      >
        <div className="h-full flex items-center justify-center">
          <FlipPage url={imageUrls[leftPageIdx]} index={leftPageIdx} cachedDataUri={imageCacheRef.current?.get(leftPageIdx)} />
        </div>
        {rightPageIdx !== null && (
          <div className="h-full flex items-center justify-center">
            <FlipPage url={imageUrls[rightPageIdx]} index={rightPageIdx} cachedDataUri={imageCacheRef.current?.get(rightPageIdx)} />
          </div>
        )}
      </div>

      {/* Click-to-flip overlay */}
      <div className="absolute inset-0 flex pointer-events-none">
        <button
          aria-label="上一页"
          aria-disabled={!canGoPrev}
          className="w-[40%] h-full pointer-events-auto cursor-pointer flex items-center justify-start pl-4 group"
          onClick={goPrev}
          style={{ background: 'transparent', border: 'none' }}
        >
          <svg
            width="32" height="32" viewBox="0 0 32 32" fill="none"
            className="opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            style={{ color: 'rgba(255,255,255,0.5)' }}
          >
            <path d="M20 8l-8 8 8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          aria-label="下一页"
          aria-disabled={!canGoNext}
          className="w-[60%] h-full pointer-events-auto cursor-pointer flex items-center justify-end pr-4 group"
          onClick={goNext}
          style={{ background: 'transparent', border: 'none' }}
        >
          <svg
            width="32" height="32" viewBox="0 0 32 32" fill="none"
            className="opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            style={{ color: 'rgba(255,255,255,0.5)' }}
          >
            <path d="M12 8l8 8-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function FlipPage({ url, index, cachedDataUri }: { url: string; index: number; cachedDataUri?: string }) {
  const [dataUri, setDataUri] = useState<string | null>(() => cachedDataUri ?? null)
  const [error, setError] = useState(false)

  useEffect(() => {
    // If cache provides the data, use it directly and skip IPC fetch
    if (cachedDataUri) {
      setDataUri(cachedDataUri)
      setError(false)
      return
    }

    // Reset state when url changes and no cache hit
    setDataUri(null)
    setError(false)

    let cancelled = false
    window.hcomic!.fetchPreviewImage(url)
      .then((result) => {
        if (cancelled) return
        if (result?.dataUri) setDataUri(result.dataUri)
        else throw new Error('Empty response')
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => { cancelled = true }
  }, [url, cachedDataUri])

  if (error) {
    return (
      <div className="flex items-center justify-center text-gray-400 text-xs" style={{ height: '100%' }}>
        第 {index + 1} 页加载失败
      </div>
    )
  }

  if (!dataUri) {
    return (
      <div className="flex items-center justify-center" style={{ height: '100%' }}>
        <svg className="animate-spin h-8 w-8 text-gray-600" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  return (
    <img
      src={dataUri}
      alt={`第 ${index + 1} 页`}
      className="h-full w-auto max-w-none"
      draggable={false}
    />
  )
}
