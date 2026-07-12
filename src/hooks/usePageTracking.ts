import { useEffect, useRef } from 'react'
import type { DisplayMode } from './useReaderSettings'

/**
 * Tracks which reader page is currently visible using IntersectionObserver.
 * Updates currentPage when the user scrolls to a different page.
 *
 * `visibleMode` is part of the observer's re-subscription deps: switching into
 * scroll mode mounts the scroll container, so the observer must be rebuilt with
 * the now-available container as `root`. Without this, the observer keeps a
 * stale `root: null` (viewport) captured while paged mode was active, and page
 * tracking drifts after a scroll→paged→scroll round-trip.
 */
export function usePageTracking(
  pageRefs: React.MutableRefObject<(HTMLDivElement | null)[]>,
  scrollContainerRef: React.RefObject<HTMLDivElement | null>,
  isDragging: boolean,
  currentPage: number,
  setCurrentPage: (page: number) => void,
  loadingState: string,
  imageCount: number,
  visibleMode: DisplayMode,
  freezeRef?: React.RefObject<boolean>,
  frozen = false,
) {
  const observerRef = useRef<IntersectionObserver | null>(null)
  const isDraggingRef = useRef(isDragging)
  isDraggingRef.current = isDragging // eslint-disable-line react-hooks/refs
  const currentPageRef = useRef(currentPage)
  currentPageRef.current = currentPage // eslint-disable-line react-hooks/refs
  const frozenRef = useRef(frozen)
  frozenRef.current = frozen // eslint-disable-line react-hooks/refs

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect()
    }
  }, [])

  useEffect(() => {
    if (loadingState !== 'loaded' || imageCount === 0) return

    observerRef.current?.disconnect()

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (isDraggingRef.current) return
        if (freezeRef?.current) return
        if (frozenRef.current) return
        let topPage = currentPageRef.current
        let topY = Infinity
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = pageRefs.current.indexOf(entry.target as HTMLDivElement)
            if (idx !== -1) {
              const rect = entry.boundingClientRect
              if (rect.top < topY) {
                topY = rect.top
                topPage = idx + 1
              }
            }
          }
        }
        if (topPage !== currentPageRef.current && topPage > 0) {
          setCurrentPage(topPage)
        }
      },
      { root: scrollContainerRef.current, threshold: 0.1 }
    )

    for (const ref of pageRefs.current) {
      if (ref) observerRef.current!.observe(ref)
    }

    return () => { observerRef.current?.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingState, imageCount, visibleMode])

  return observerRef
}
