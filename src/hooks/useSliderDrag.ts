import { useState, useRef, useCallback, useEffect } from 'react'

export function useSliderDrag(
  totalPages: number,
  onPageChange: (page: number) => void,
  onDragEnd?: (page: number) => void,
  onDragStart?: () => void,
  disabled = false,
) {
  const [isDragging, setIsDragging] = useState(false)
  const isDraggingRef = useRef(false)
  const dragPageRef = useRef(0)
  const sliderRef = useRef<HTMLDivElement>(null)
  // 记录活跃拖拽的 pointerId 与捕获元素，供组件卸载时按 id 释放 pointer capture。
  // 用独立 ref 而非 sliderRef：React 卸载时会先把 sliderRef.current 置 null，
  // 早于 effect cleanup 执行，故 cleanup 闭包里读到的 sliderRef.current 已是 null。
  const pointerIdRef = useRef<number | null>(null)
  const capturedElRef = useRef<HTMLElement | null>(null)

  const getDragPage = useCallback((e: React.PointerEvent): number | null => {
    const track = sliderRef.current
    if (!track || totalPages <= 0) return null
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return null
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    return Math.max(1, Math.min(totalPages, Math.round(pct * totalPages)))
  }, [totalPages])

  const updateDragPosition = useCallback((e: React.PointerEvent) => {
    const page = getDragPage(e)
    if (page === null || page === dragPageRef.current) return
    dragPageRef.current = page
    onPageChange(page)
  }, [getDragPage, onPageChange])

  const handleSliderPointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled) return
    const page = getDragPage(e)
    if (page === null) return
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    pointerIdRef.current = e.pointerId
    capturedElRef.current = el
    isDraggingRef.current = true
    dragPageRef.current = 0
    onDragStart?.()
    setIsDragging(true)
    dragPageRef.current = page
    onPageChange(page)
  }, [disabled, getDragPage, onDragStart, onPageChange])

  const handleSliderPointerMove = useCallback((e: React.PointerEvent) => {
    if (disabled) return
    if (!isDraggingRef.current) return
    updateDragPosition(e)
  }, [disabled, updateDragPosition])

  const handleSliderPointerUp = useCallback(() => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    pointerIdRef.current = null
    capturedElRef.current = null
    setIsDragging(false)
    const finalPage = dragPageRef.current
    dragPageRef.current = 0
    if (finalPage > 0 && onDragEnd) {
      onDragEnd(finalPage)
    }
  }, [onDragEnd])

  const cancelDrag = useCallback(() => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    pointerIdRef.current = null
    capturedElRef.current = null
    dragPageRef.current = 0
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (disabled) cancelDrag()
  }, [cancelDrag, disabled])

  // 卸载清理：拖拽进行中组件卸载时（如阅读器在 keep-alive 下退场）主动释放
  // pointer capture 并复位拖拽态，避免遗留捕获导致重挂载后新滑块无法接收事件。
  // 用 capturedElRef 而非 sliderRef：React 卸载时 sliderRef.current 已被置 null。
  useEffect(() => {
    return () => {
      if (isDraggingRef.current && capturedElRef.current && pointerIdRef.current !== null) {
        try {
          capturedElRef.current.releasePointerCapture(pointerIdRef.current)
        } catch {
          // 元素可能已脱离 DOM，忽略释放异常
        }
      }
      isDraggingRef.current = false
      dragPageRef.current = 0
      pointerIdRef.current = null
      capturedElRef.current = null
    }
  }, [])

  return {
    isDragging,
    sliderRef,
    handleSliderPointerDown,
    handleSliderPointerMove,
    handleSliderPointerUp,
    cancelDrag,
  }
}
