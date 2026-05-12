import { useState, useCallback } from 'react'

const PAGE_GAP_KEY = 'hcomic-reader-page-gap'
const IMAGE_WIDTH_KEY = 'hcomic-reader-image-width'

const PAGE_GAP_MIN = 0
const PAGE_GAP_MAX = 80
const PAGE_GAP_DEFAULT = 4

const IMAGE_WIDTH_MIN = 30
const IMAGE_WIDTH_MAX = 100
const IMAGE_WIDTH_DEFAULT = 70

function readStoredValue(key: string, min: number, max: number, fallback: number): number {
  const raw = localStorage.getItem(key)
  if (raw === null) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  if (parsed < min || parsed > max) return fallback
  return parsed
}

export function useReaderSettings() {
  const [pageGap, setPageGapInternal] = useState(() =>
    readStoredValue(PAGE_GAP_KEY, PAGE_GAP_MIN, PAGE_GAP_MAX, PAGE_GAP_DEFAULT)
  )
  const [imageWidth, setImageWidthInternal] = useState(() =>
    readStoredValue(IMAGE_WIDTH_KEY, IMAGE_WIDTH_MIN, IMAGE_WIDTH_MAX, IMAGE_WIDTH_DEFAULT)
  )

  const setPageGap = useCallback((value: number) => {
    const clamped = Math.max(PAGE_GAP_MIN, Math.min(PAGE_GAP_MAX, value))
    setPageGapInternal(clamped)
    localStorage.setItem(PAGE_GAP_KEY, String(clamped))
  }, [])

  const setImageWidth = useCallback((value: number) => {
    const clamped = Math.max(IMAGE_WIDTH_MIN, Math.min(IMAGE_WIDTH_MAX, value))
    setImageWidthInternal(clamped)
    localStorage.setItem(IMAGE_WIDTH_KEY, String(clamped))
  }, [])

  return { pageGap, imageWidth, setPageGap, setImageWidth }
}
