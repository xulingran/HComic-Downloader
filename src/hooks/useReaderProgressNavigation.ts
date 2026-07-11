import { useCallback, useEffect, useRef } from 'react'
import type { DisplayMode } from './useReaderSettings'
import { useSliderDrag } from './useSliderDrag'

interface ReaderProgressNavigationOptions {
  totalPages: number
  currentPage: number
  setCurrentPage: (page: number) => void
  displayMode: DisplayMode
  loadingState: string
  pageRefs: React.MutableRefObject<(HTMLDivElement | null)[]>
  onDragEnd?: (page: number) => void
}

/**
 * Coordinates the shared reader progress slider with visible page navigation.
 * Page tracking is frozen synchronously before a drag updates currentPage, so
 * stale IntersectionObserver notifications cannot overwrite the user's target.
 */
export function useReaderProgressNavigation({
  totalPages,
  currentPage,
  setCurrentPage,
  displayMode,
  loadingState,
  pageRefs,
  onDragEnd,
}: ReaderProgressNavigationOptions) {
  const freezePageTrackingRef = useRef(false)
  const previousDragPageRef = useRef(currentPage)
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pageRefsRef = useRef(pageRefs)

  const clearReleaseTimer = useCallback(() => {
    if (releaseTimerRef.current === null) return
    clearTimeout(releaseTimerRef.current)
    releaseTimerRef.current = null
  }, [])

  const beginDrag = useCallback(() => {
    clearReleaseTimer()
    freezePageTrackingRef.current = true
  }, [clearReleaseTimer])

  const changePageFromSlider = useCallback((page: number) => {
    freezePageTrackingRef.current = true
    setCurrentPage(page)
  }, [setCurrentPage])

  const finishDrag = useCallback((page: number) => {
    onDragEnd?.(page)
  }, [onDragEnd])

  const slider = useSliderDrag(totalPages, changePageFromSlider, finishDrag, beginDrag)

  const scrollToPage = useCallback((page: number, immediate = false) => {
    const element = pageRefsRef.current.current[page - 1]
    if (!element) return false

    const scroll = () => element.scrollIntoView({ behavior: 'instant', block: 'start' })
    if (immediate) {
      scroll()
    } else {
      freezePageTrackingRef.current = true
      requestAnimationFrame(() => {
        scroll()
        setTimeout(() => {
          freezePageTrackingRef.current = false
        }, 50)
      })
    }
    return true
  }, [])

  useEffect(() => {
    if (displayMode !== 'scroll' || !slider.isDragging || loadingState !== 'loaded') {
      previousDragPageRef.current = currentPage
      return
    }
    if (currentPage === previousDragPageRef.current) return
    previousDragPageRef.current = currentPage
    scrollToPage(currentPage, true)
  }, [currentPage, displayMode, loadingState, scrollToPage, slider.isDragging])

  useEffect(() => {
    clearReleaseTimer()
    if (slider.isDragging) return
    releaseTimerRef.current = setTimeout(() => {
      freezePageTrackingRef.current = false
      releaseTimerRef.current = null
    }, 200)
    return clearReleaseTimer
  }, [clearReleaseTimer, slider.isDragging])

  useEffect(() => () => {
    clearReleaseTimer()
    freezePageTrackingRef.current = false
  }, [clearReleaseTimer])

  return {
    ...slider,
    freezePageTrackingRef,
    scrollToPage,
  }
}
