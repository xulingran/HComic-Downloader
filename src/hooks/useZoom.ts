import { useState, useCallback, useEffect } from 'react'

const ZOOM_MIN = 0.25
const ZOOM_MAX = 4.0
const ZOOM_STEP = 0.1

export function useZoom(open: boolean) {
  const [zoom, setZoom] = useState(1)

  const zoomIn = useCallback(() => {
    setZoom(z => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(1)))
  }, [])

  const zoomOut = useCallback(() => {
    setZoom(z => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(1)))
  }, [])

  const resetZoom = useCallback(() => {
    setZoom(1)
  }, [])

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

  return { zoom, zoomIn, zoomOut, resetZoom }
}
