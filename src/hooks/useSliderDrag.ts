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
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
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
    dragPageRef.current = 0
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (disabled) cancelDrag()
  }, [cancelDrag, disabled])

  return {
    isDragging,
    sliderRef,
    handleSliderPointerDown,
    handleSliderPointerMove,
    handleSliderPointerUp,
    cancelDrag,
  }
}
