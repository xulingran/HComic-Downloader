import { useRef, useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { DisplayMode, BlankPosition } from '../hooks/useReaderSettings'
import { usePageFlipVariants } from '../lib/anim'

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
  imageQuality?: string
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
  imageQuality,
}: PageFlipViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [panOffset, setPanOffset] = useState(0)
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, offset: 0 })

  // 变更 3：翻页方向感知 + isFlipping 门控。
  // 4 个翻页触发路径（键盘/点击/wheel/滑块）都最终走 setCurrentPage，
  // 此处统一用 prevPageRef 推断 direction，无需改外部接口。
  const prevPageRef = useRef(currentPage)
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward')
  const [isFlipping, setIsFlipping] = useState(false)

  const isDoubleMode = displayMode === 'double'
  const step = isDoubleMode ? 2 : 1

  const effectiveTotal = isDoubleMode && blankPosition === 'front' ? totalPages + 1 : totalPages

  const canGoPrev = currentPage > 1
  const canGoNext = isDoubleMode
    ? currentPage + step <= effectiveTotal
    : currentPage < effectiveTotal

  const pageVariants = usePageFlipVariants()

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
    if (isFlipping) return // 翻页动画中忽略拖拽
    isPanning.current = true
    panStart.current = { x: e.clientX, offset: panOffset }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [panOffset, isFlipping])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return
    const dx = e.clientX - panStart.current.x
    const newOffset = panStart.current.offset + dx
    setPanOffset(clampPanOffset(newOffset))
  }, [clampPanOffset])

  const handlePointerUp = useCallback(() => {
    isPanning.current = false
  }, [])

  // 变更 3：wheel 节流改为 isFlipping 门控——动画完成才响应下一次 wheel，
  // 避免固定 200ms 节流导致 AnimatePresence 内页面层堆积。
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (isFlipping) return
    if (e.deltaY > 0) goNext()
    else if (e.deltaY < 0) goPrev()
  }, [goNext, goPrev, isFlipping])

  // Trigger preloading when currentPage changes or on initial render
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current || currentPage !== prevPageRef.current) {
      isFirstRender.current = false
      // 变更 3：推断翻页方向（首次渲染不推断）
      if (!isFirstRender.current && currentPage !== prevPageRef.current) {
        setDirection(currentPage > prevPageRef.current ? 'forward' : 'backward')
      }
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

  const handleAnimationComplete = useCallback(() => {
    setIsFlipping(false)
  }, [])

  // currentPage 变化即触发翻页动画，置 isFlipping=true
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsFlipping(true)
  }, [currentPage])

  const renderPageContent = () => {
    if (isDoubleMode) {
      // double 模式：左右两页 + 可能的空白页用同一 motion.div 包裹，整体滑动
      return (
        <div className="h-full flex items-center justify-center" style={{ gap: '4px' }}>
          <div className="h-full flex items-center justify-center">
            {leftIsBlank ? <BlankPage /> : (
              <FlipPage url={imageUrls[leftRealIdx]} index={leftRealIdx} cachedDataUri={imageCacheRef.current?.get(leftRealIdx)} scrambleId={scrambleId} comicId={comicId} imageQuality={imageQuality} />
            )}
          </div>
          {(rightRealIdx !== null || rightIsBlank) && (
            <div className="h-full flex items-center justify-center">
              {rightIsBlank ? <BlankPage /> : (
                <FlipPage url={imageUrls[rightRealIdx!]} index={rightRealIdx!} cachedDataUri={imageCacheRef.current?.get(rightRealIdx!)} scrambleId={scrambleId} comicId={comicId} imageQuality={imageQuality} />
              )}
            </div>
          )}
        </div>
      )
    }
    // single 模式
    return (
      <div className="h-full flex items-center justify-center">
        <FlipPage url={imageUrls[leftRealIdx]} index={leftRealIdx} cachedDataUri={imageCacheRef.current?.get(leftRealIdx)} scrambleId={scrambleId} comicId={comicId} imageQuality={imageQuality} />
      </div>
    )
  }

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
          width: `${imageWidth}%`,
          transform: `translateX(${panOffset}px) scale(${zoom})`,
          transition: isPanning.current ? 'none' : undefined, // eslint-disable-line react-hooks/refs
        }}
      >
        {/* 翻页过渡：AnimatePresence + mode="popLayout" 让新旧页过渡期间同时存在。
            initial={false} 避免首次进入也播动画。
            key={currentPage} 让每次翻页触发 exit/enter。
            custom={direction} 把方向传给 variants 函数。 */}
        <AnimatePresence custom={direction} mode="popLayout" initial={false}>
          <motion.div
            key={currentPage}
            variants={pageVariants}
            custom={direction}
            initial="enter"
            animate="center"
            exit="exit"
            onAnimationComplete={handleAnimationComplete}
            className="h-full flex items-center justify-center"
            style={{ pointerEvents: isFlipping ? 'none' : undefined }}
          >
            {/* renderPageContent 读取 imageCacheRef.current 取预加载图，属原模式 */}
            {/* eslint-disable-next-line react-hooks/refs */}
            {renderPageContent()}
          </motion.div>
        </AnimatePresence>
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

function FlipPage({ url, index, cachedDataUri, scrambleId, comicId, imageQuality }: { url: string; index: number; cachedDataUri?: string; scrambleId?: string; comicId?: string; imageQuality?: string }) {
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
    window.hcomic!.fetchPreviewImage(url, scrambleId, comicId, imageQuality)
      .then((result) => {
        if (cancelled) return
        if (result?.dataUri) setDataUri(result.dataUri)
        else throw new Error('Empty response')
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => { cancelled = true }
  }, [url, cachedDataUri, scrambleId, comicId, imageQuality])

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
