import { useEffect, useRef } from 'react'

export type PreloadReason = 'preload'

interface UsePaginatedPreloaderArgs {
  currentPage: number
  totalPages: number
  contextKey: string
  enabled: boolean
  hasPage: (page: number) => boolean
  loadPage: (page: number, reason: PreloadReason) => Promise<void>
  commitPage?: (page: number, contextKey: string) => void | Promise<void>
  onPreloadError?: (page: number, error: unknown) => void
  concurrency?: number
}

export function getPreloadCandidates(currentPage: number, totalPages: number): number[] {
  const candidates = [currentPage + 1, currentPage - 1, currentPage + 2, currentPage - 2]
  return candidates.filter((page) => page >= 1 && page <= totalPages)
}

export function usePaginatedPreloader({
  currentPage,
  totalPages,
  contextKey,
  enabled,
  hasPage,
  loadPage,
  commitPage,
  onPreloadError,
  concurrency = 2,
}: UsePaginatedPreloaderArgs) {
  const inFlightRef = useRef(new Set<string>())
  const generationRef = useRef(0)

  useEffect(() => {
    generationRef.current += 1
    inFlightRef.current.clear()
  }, [contextKey])

  useEffect(() => {
    if (!enabled || totalPages <= 1) return

    let cancelled = false
    const generation = generationRef.current
    const queue = getPreloadCandidates(currentPage, totalPages).filter((page) => {
      const requestKey = `${contextKey}:${page}`
      return !hasPage(page) && !inFlightRef.current.has(requestKey)
    })

    if (queue.length === 0) return

    const workerCount = Math.min(concurrency, queue.length)

    const runWorker = async () => {
      while (!cancelled && queue.length > 0 && generation === generationRef.current) {
        const page = queue.shift()
        if (page == null) return
        const requestKey = `${contextKey}:${page}`
        if (hasPage(page) || inFlightRef.current.has(requestKey)) continue

        inFlightRef.current.add(requestKey)
        try {
          await loadPage(page, 'preload')
          if (!cancelled && generation === generationRef.current) {
            await commitPage?.(page, contextKey)
          }
        } catch (error) {
          onPreloadError?.(page, error)
        } finally {
          inFlightRef.current.delete(requestKey)
        }
      }
    }

    const workers = Array.from({ length: workerCount }, () => runWorker())
    void Promise.all(workers)

    return () => {
      cancelled = true
    }
  }, [currentPage, totalPages, contextKey, enabled, hasPage, loadPage, commitPage, onPreloadError, concurrency])
}
