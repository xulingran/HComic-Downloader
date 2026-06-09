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

interface PreloadState {
  currentPage: number
  totalPages: number
  contextKey: string
  enabled: boolean
  hasPage: (page: number) => boolean
  loadPage: (page: number, reason: PreloadReason) => Promise<void>
  commitPage?: (page: number, contextKey: string) => void | Promise<void>
  onPreloadError?: (page: number, error: unknown) => void
  concurrency: number
  generation: number
  cancelled: boolean
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
  const inFlightRef = useRef(new Map<string, number>())
  const pendingPagesRef = useRef<number[]>([])
  const generationRef = useRef(0)
  const latestStateRef = useRef<PreloadState | null>(null)
  const drainRef = useRef<() => void>(() => {})

  drainRef.current = () => {
    const state = latestStateRef.current
    if (!state || state.cancelled || !state.enabled || state.totalPages <= 1 || state.generation !== generationRef.current) return

    const contextPrefix = `${state.contextKey}:`
    const activeInContext = Array.from(inFlightRef.current.keys()).filter((requestKey) => requestKey.startsWith(contextPrefix)).length
    let availableSlots = Math.max(0, state.concurrency - activeInContext)

    while (availableSlots > 0 && pendingPagesRef.current.length > 0) {
      const page = pendingPagesRef.current.shift()
      if (page == null) return

      const requestKey = `${state.contextKey}:${page}`
      if (state.hasPage(page) || inFlightRef.current.has(requestKey)) continue

      inFlightRef.current.set(requestKey, state.generation)
      availableSlots -= 1

      void (async () => {
        try {
          await state.loadPage(page, 'preload')
          if (!state.cancelled && state.generation === generationRef.current) {
            await state.commitPage?.(page, state.contextKey)
          }
        } catch (error) {
          if (!state.cancelled && state.generation === generationRef.current) {
            state.onPreloadError?.(page, error)
          }
        } finally {
          if (inFlightRef.current.get(requestKey) === state.generation) {
            inFlightRef.current.delete(requestKey)
          }
          if (state.generation === generationRef.current) {
            drainRef.current()
          }
        }
      })()
    }
  }

  useEffect(() => {
    generationRef.current += 1
    inFlightRef.current.clear()
    pendingPagesRef.current = []
  }, [contextKey])

  useEffect(() => {
    const state: PreloadState = {
      currentPage,
      totalPages,
      contextKey,
      enabled,
      hasPage,
      loadPage,
      commitPage,
      onPreloadError,
      concurrency,
      generation: generationRef.current,
      cancelled: false,
    }

    latestStateRef.current = state
    pendingPagesRef.current = enabled && totalPages > 1
      ? getPreloadCandidates(currentPage, totalPages).filter((page) => {
          const requestKey = `${contextKey}:${page}`
          return !hasPage(page) && !inFlightRef.current.has(requestKey)
        })
      : []
    drainRef.current()

    return () => {
      state.cancelled = true
    }
  }, [currentPage, totalPages, contextKey, enabled, hasPage, loadPage, commitPage, onPreloadError, concurrency])
}
