import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Manages concurrent preloading of reader page images around a jump target.
 * Uses a worker-pool pattern to fetch multiple pages in parallel.
 */
export function usePreloadManager(imageUrls: string[], loadingState: string, scrambleId?: string, comicId?: string) {
  const imageCacheRef = useRef(new Map<number, string>())
  const [cacheVersion, setCacheVersion] = useState(0)
  const [preloadTarget, setPreloadTarget] = useState<number | null>(null)

  const clearCache = useCallback(() => {
    imageCacheRef.current.clear()
    setCacheVersion(0)
    setPreloadTarget(null)
  }, [])

  useEffect(() => {
    if (preloadTarget == null || loadingState !== 'loaded') return
    let cancelled = false
    const cache = imageCacheRef.current
    const FORWARD = 8
    const BACKWARD = 2
    const CONCURRENCY = 3
    const queue: number[] = []

    // Start from +1 to skip the current page (already loaded by the visible component)
    for (let i = 1; i <= FORWARD; i++) {
      const pg = preloadTarget + i
      if (pg >= 1 && pg <= imageUrls.length && !cache.has(pg - 1)) queue.push(pg)
    }
    for (let i = 1; i <= BACKWARD; i++) {
      const pg = preloadTarget - i
      if (pg >= 1 && pg <= imageUrls.length && !cache.has(pg - 1)) queue.push(pg)
    }

    if (queue.length === 0) return

    const workerCount = Math.min(CONCURRENCY, queue.length)
    const workers: Promise<void>[] = []

    for (let i = 0; i < workerCount; i++) {
      workers.push((async () => {
        while (queue.length > 0 && !cancelled) {
          const pg = queue.shift()!
          try {
            const result = await window.hcomic!.fetchPreviewImage(imageUrls[pg - 1], scrambleId, comicId)
            if (cancelled) return
            if (result?.dataUri) {
              cache.set(pg - 1, result.dataUri)
              setCacheVersion((v) => v + 1)
            }
          } catch {
            // Individual page preload failures are non-critical
          }
        }
      })())
    }

    return () => { cancelled = true }
  }, [preloadTarget, loadingState, imageUrls, scrambleId, comicId])

  return {
    imageCacheRef,
    cacheVersion,
    preloadTarget,
    setPreloadTarget,
    clearCache,
  }
}
