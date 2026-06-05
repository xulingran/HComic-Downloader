import { useState, useRef, useCallback } from 'react'

export function useSliderDrag(
  totalPages: number,
  onPageChange: (page: number) => void,
  onDragEnd?: (page: number) => void,
) {
  const [isDragging, setIsDragging] = useState(false)
  const isDraggingRef = useRef(false)
  const dragPageRef = useRef(0)
  const sliderRef = useRef<HTMLDivElement>(null)

  const updateDragPosition = useCallback((e: React.PointerEvent) => {
    const track = sliderRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const page = Math.max(1, Math.round(pct * totalPages))
    dragPageRef.current = page
    onPageChange(page)
  }, [totalPages, onPageChange])

  const handleSliderPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    isDraggingRef.current = true
    setIsDragging(true)
    updateDragPosition(e)
  }, [updateDragPosition])

  const handleSliderPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return
    updateDragPosition(e)
  }, [updateDragPosition])

  const handleSliderPointerUp = useCallback(() => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    setIsDragging(false)
    if (dragPageRef.current > 0 && onDragEnd) {
      onDragEnd(dragPageRef.current)
    }
  }, [onDragEnd])

  const cancelDrag = useCallback(() => {
    isDraggingRef.current = false
    setIsDragging(false)
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
