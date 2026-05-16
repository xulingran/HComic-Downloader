import { useEffect, useRef } from 'react'

/**
 * Tracks which reader page is currently visible using IntersectionObserver.
 * Updates currentPage when the user scrolls to a different page.
 */
export function usePageTracking(
  pageRefs: React.MutableRefObject<(HTMLDivElement | null)[]>,
  scrollContainerRef: React.RefObject<HTMLDivElement | null>,
  isDragging: boolean,
  currentPage: number,
  setCurrentPage: (page: number) => void,
  loadingState: string,
  imageCount: number,
) {
  const observerRef = useRef<IntersectionObserver | null>(null)
  const isDraggingRef = useRef(isDragging)
  isDraggingRef.current = isDragging
  const currentPageRef = useRef(currentPage)
  currentPageRef.current = currentPage

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
  }, [loadingState, imageCount])

  return observerRef
}
