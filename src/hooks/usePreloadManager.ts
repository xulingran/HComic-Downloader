import { useCallback, useEffect, useRef, useState } from 'react'

function computeContiguousRanges(indices: number[], total: number): {start: number, end: number}[] {
  if (indices.length === 0) return []
  const sorted = [...indices].sort((a, b) => a - b)
  const ranges: {start: number, end: number}[] = []
  let rangeStart = sorted[0]
  let rangeEnd = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === rangeEnd + 1) {
      rangeEnd = sorted[i]
    } else {
      ranges.push({start: rangeStart + 1, end: Math.min(rangeEnd + 1, total)})
      rangeStart = sorted[i]
      rangeEnd = sorted[i]
    }
  }
  ranges.push({start: rangeStart + 1, end: Math.min(rangeEnd + 1, total)})
  return ranges
}

function recomputeRanges(cache: Map<number, string>, total: number): {start: number, end: number}[] {
  const indices: number[] = []
  cache.forEach((_, idx) => indices.push(idx))
  return computeContiguousRanges(indices, total)
}

/**
 * Manages concurrent preloading of reader page images around a jump target.
 * Uses a worker-pool pattern to fetch multiple pages in parallel.
 */
export function usePreloadManager(imageUrls: string[], loadingState: string, scrambleId?: string, comicId?: string) {
  const imageCacheRef = useRef(new Map<number, string>())
  const [cacheVersion, setCacheVersion] = useState(0)
  const [preloadedRanges, setPreloadedRanges] = useState<{start: number, end: number}[]>([])
  const [preloadTarget, setPreloadTarget] = useState<number | null>(null)

  const clearCache = useCallback(() => {
    imageCacheRef.current.clear()
    setCacheVersion(0)
    setPreloadedRanges([])
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

    for (let i = 1; i <= FORWARD; i++) {
      const pg = preloadTarget + i
      if (pg >= 1 && pg <= imageUrls.length && !cache.has(pg - 1)) queue.push(pg)
    }
    for (let i = 1; i <= BACKWARD; i++) {
      const pg = preloadTarget - i
      if (pg >= 1 && pg <= imageUrls.length && !cache.has(pg - 1)) queue.push(pg)
    }

    if (queue.length === 0) return

    const total = imageUrls.length
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
              setPreloadedRanges(recomputeRanges(cache, total))
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
    preloadedRanges,
    preloadTarget,
    setPreloadTarget,
    clearCache,
  }
}
