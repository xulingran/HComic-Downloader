import { useCallback, useEffect, useRef } from 'react'

export type PreloadReason = 'preload'

interface UsePaginatedPreloaderArgs {
  currentPage: number
  totalPages: number
  contextKey: string
  enabled: boolean
  hasPage: (page: number) => boolean
  // signal: 当前 contextKey 的 AbortSignal，contextKey 变化或卸载时 abort()。
  // loadPage 实现必须在 IPC await 完成后、写入缓存前检查 signal.aborted 并丢弃结果。
  loadPage: (page: number, reason: PreloadReason, signal: AbortSignal) => Promise<void>
  // signal: 同 loadPage 的 AbortSignal。commitPage 之后若需派生异步任务（如封面预载），
  // 可用此 signal 跟随 contextKey 切换中断。commit 本身已受 generation 检查保护。
  commitPage?: (page: number, contextKey: string, signal: AbortSignal) => void | Promise<void>
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
  loadPage: (page: number, reason: PreloadReason, signal: AbortSignal) => Promise<void>
  commitPage?: (page: number, contextKey: string, signal: AbortSignal) => void | Promise<void>
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
  // 当前 contextKey 的 AbortController，每个 contextKey 拥有一个共享 signal；
  // contextKey 变化或卸载时 abort()，让 loadPage 在写入缓存前丢弃迟到结果。
  const abortControllerRef = useRef<AbortController>(new AbortController())

  const drain = useCallback(() => {
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
          await state.loadPage(page, 'preload', abortControllerRef.current.signal)
          if (!state.cancelled && state.generation === generationRef.current) {
            await state.commitPage?.(page, state.contextKey, abortControllerRef.current.signal)
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
  }, [])

  useEffect(() => {
    drainRef.current = drain
  }, [drain])

  useEffect(() => {
    generationRef.current += 1
    inFlightRef.current.clear()
    pendingPagesRef.current = []
    // 中断旧 contextKey 的所有 in-flight 请求，并为新 contextKey 创建全新 signal。
    abortControllerRef.current.abort()
    abortControllerRef.current = new AbortController()
    return () => {
      // 卸载时中断当前 contextKey 残留的 in-flight 请求，防止迟到结果写入。
      abortControllerRef.current.abort()
    }
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
