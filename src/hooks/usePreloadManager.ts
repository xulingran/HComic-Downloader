import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Manages serial preloading of reader page images around a jump target.
 * Returns the cache map (via ref), a cacheVersion counter to trigger re-renders,
 * and setters for preloadTarget.
 */
export function usePreloadManager(imageUrls: string[], loadingState: string) {
  const imageCacheRef = useRef(new Map<number, string>())
  const [cacheVersion, setCacheVersion] = useState(0)
  const [preloadTarget, setPreloadTarget] = useState<number | null>(null)

  const clearCache = useCallback(() => {
    imageCacheRef.current.clear()
    setCacheVersion(0)
    setPreloadTarget(null)
  }, [])

  // Serial preloading around jump target
  useEffect(() => {
    if (preloadTarget == null || loadingState !== 'loaded') return
    let cancelled = false
    const cache = imageCacheRef.current
    const FORWARD = 5
    const BACKWARD = 2
    const queue: number[] = []

    for (let i = 0; i <= FORWARD; i++) {
      const pg = preloadTarget + i
      if (pg >= 1 && pg <= imageUrls.length && !cache.has(pg - 1)) queue.push(pg)
    }
    for (let i = 1; i <= BACKWARD; i++) {
      const pg = preloadTarget - i
      if (pg >= 1 && pg <= imageUrls.length && !cache.has(pg - 1)) queue.push(pg)
    }

    if (queue.length === 0) return

    ;(async () => {
      for (const pg of queue) {
        if (cancelled) return
        try {
          const result = await window.hcomic!.fetchPreviewImage(imageUrls[pg - 1])
          if (cancelled) return
          if (result?.dataUri) {
            cache.set(pg - 1, result.dataUri)
            setCacheVersion((v) => v + 1)
          }
        } catch {
          // Individual page preload failures are non-critical
        }
      }
    })()

    return () => { cancelled = true }
  }, [preloadTarget, loadingState, imageUrls])

  return {
    imageCacheRef,
    cacheVersion,
    preloadTarget,
    setPreloadTarget,
    clearCache,
  }
}
