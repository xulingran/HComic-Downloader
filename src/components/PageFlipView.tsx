import { useRef, useCallback, useEffect, useState } from 'react'
import type { DisplayMode, BlankPosition } from '../hooks/useReaderSettings'

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
  blankPosition: BlankPosition
  scrambleId?: string
  comicId?: string
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
  blankPosition,
  scrambleId,
  comicId,
}: PageFlipViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [panOffset, setPanOffset] = useState(0)
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, offset: 0 })

  const isDoubleMode = displayMode === 'double'
  const step = isDoubleMode ? 2 : 1

  const effectiveTotal = isDoubleMode && blankPosition === 'front' ? totalPages + 1 : totalPages

  const canGoPrev = currentPage > 1
  const canGoNext = isDoubleMode
    ? currentPage + step <= effectiveTotal
    : currentPage < effectiveTotal

  const goNext = useCallback(() => {
    if (!canGoNext) return
    const next = Math.min(currentPage + step, effectiveTotal)
    setCurrentPage(next)
    setPanOffset(0)
  }, [canGoNext, currentPage, step, effectiveTotal, setCurrentPage])

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

  let leftRealIdx: number
  let rightRealIdx: number | null
  let leftIsBlank = false
  let rightIsBlank = false

  if (isDoubleMode && blankPosition === 'front') {
    leftRealIdx = currentPage - 2
    rightRealIdx = currentPage - 1
    leftIsBlank = leftRealIdx < 0
    rightIsBlank = rightRealIdx >= totalPages
  } else if (isDoubleMode && blankPosition === 'end') {
    leftRealIdx = currentPage - 1
    rightRealIdx = currentPage < totalPages ? currentPage : null
    rightIsBlank = rightRealIdx === null
  } else {
    leftRealIdx = currentPage - 1
    rightRealIdx = isDoubleMode && currentPage < totalPages ? currentPage : null
  }

  // cacheVersion triggers re-render to pick up newly preloaded images from imageCacheRef
  void cacheVersion

  // Clamp panOffset when zoom changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
          transition: isPanning.current ? 'none' : undefined, // eslint-disable-line react-hooks/refs
        }}
      >
        <div className="h-full flex items-center justify-center">
          {leftIsBlank ? <BlankPage /> : (
            // eslint-disable-next-line react-hooks/refs
            <FlipPage url={imageUrls[leftRealIdx]} index={leftRealIdx} cachedDataUri={imageCacheRef.current?.get(leftRealIdx)} scrambleId={scrambleId} comicId={comicId} />
          )}
        </div>
        {(rightRealIdx !== null || rightIsBlank) && (
          <div className="h-full flex items-center justify-center">
            {rightIsBlank ? <BlankPage /> : (
              // eslint-disable-next-line react-hooks/refs
              <FlipPage url={imageUrls[rightRealIdx!]} index={rightRealIdx!} cachedDataUri={imageCacheRef.current?.get(rightRealIdx!)} scrambleId={scrambleId} comicId={comicId} />
            )}
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
          onPointerDown={(e) => e.stopPropagation()}
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
          onPointerDown={(e) => e.stopPropagation()}
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

function BlankPage() {
  return (
    <div
      className="h-full flex items-center justify-center"
      style={{
        aspectRatio: '3/4',
        border: '2px dashed rgba(255,255,255,0.15)',
        borderRadius: '4px',
        background: 'rgba(255,255,255,0.03)',
      }}
    />
  )
}

function FlipPage({ url, index, cachedDataUri, scrambleId, comicId }: { url: string; index: number; cachedDataUri?: string; scrambleId?: string; comicId?: string }) {
  const [dataUri, setDataUri] = useState<string | null>(() => cachedDataUri ?? null)
  const [error, setError] = useState(false)

  useEffect(() => {
    // If cache provides the data, use it directly and skip IPC fetch
    if (cachedDataUri) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDataUri(cachedDataUri)
      setError(false)
      return
    }

    // Reset state when url changes and no cache hit
    setDataUri(null)
    setError(false)

    let cancelled = false
    window.hcomic!.fetchPreviewImage(url, scrambleId, comicId)
      .then((result) => {
        if (cancelled) return
        if (result?.dataUri) setDataUri(result.dataUri)
        else throw new Error('Empty response')
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => { cancelled = true }
  }, [url, cachedDataUri, scrambleId, comicId])

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
