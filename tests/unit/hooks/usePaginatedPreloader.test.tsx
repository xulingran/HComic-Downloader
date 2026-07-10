import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPreloadCandidates, usePaginatedPreloader } from '@/hooks/usePaginatedPreloader'

function createDeferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

describe('getPreloadCandidates', () => {
  it('returns nearby pages in priority order for middle pages', () => {
    expect(getPreloadCandidates(5, 10)).toEqual([6, 4, 7, 3])
  })

  it('skips pages below 1 near the beginning', () => {
    expect(getPreloadCandidates(1, 10)).toEqual([2, 3])
    expect(getPreloadCandidates(2, 10)).toEqual([3, 1, 4])
  })

  it('skips pages above totalPages near the end', () => {
    expect(getPreloadCandidates(10, 10)).toEqual([9, 8])
    expect(getPreloadCandidates(9, 10)).toEqual([10, 8, 7])
  })
})

describe('usePaginatedPreloader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preloads uncached nearby pages only', async () => {
    const loadPage = vi.fn().mockResolvedValue(undefined)
    const hasPage = vi.fn((page: number) => page === 4)

    renderHook(() => usePaginatedPreloader({
      currentPage: 5,
      totalPages: 10,
      contextKey: 'search:hcomic:keyword:test:',
      enabled: true,
      hasPage,
      loadPage,
    }))

    const anySignal = expect.any(AbortSignal)
    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(3))
    expect(loadPage).toHaveBeenNthCalledWith(1, 6, 'preload', anySignal)
    expect(loadPage).toHaveBeenNthCalledWith(2, 7, 'preload', anySignal)
    expect(loadPage).toHaveBeenNthCalledWith(3, 3, 'preload', anySignal)
  })

  it('does not preload when disabled', async () => {
    const loadPage = vi.fn().mockResolvedValue(undefined)

    renderHook(() => usePaginatedPreloader({
      currentPage: 5,
      totalPages: 10,
      contextKey: 'history',
      enabled: false,
      hasPage: () => false,
      loadPage,
    }))

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(loadPage).not.toHaveBeenCalled()
  })

  it('does not preload when total pages is one or less', async () => {
    const loadPage = vi.fn().mockResolvedValue(undefined)

    renderHook(() => usePaginatedPreloader({
      currentPage: 1,
      totalPages: 1,
      contextKey: 'history',
      enabled: true,
      hasPage: () => false,
      loadPage,
    }))

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(loadPage).not.toHaveBeenCalled()
  })

  it('uses a default concurrency limit of two', async () => {
    let active = 0
    let maxActive = 0
    const loadPage = vi.fn(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 10))
      active -= 1
    })

    renderHook(() => usePaginatedPreloader({
      currentPage: 5,
      totalPages: 10,
      contextKey: 'history',
      enabled: true,
      hasPage: () => false,
      loadPage,
    }))

    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(4))
    await waitFor(() => expect(active).toBe(0))
    expect(maxActive).toBeLessThanOrEqual(2)
  })

  it('honors an explicit concurrency override of three', async () => {
    let active = 0
    let maxActive = 0
    const loadPage = vi.fn(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 10))
      active -= 1
    })

    renderHook(() => usePaginatedPreloader({
      currentPage: 5,
      totalPages: 10,
      contextKey: 'favourites:hcomic',
      enabled: true,
      hasPage: () => false,
      loadPage,
      concurrency: 3,
    }))

    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(4))
    await waitFor(() => expect(active).toBe(0))
    expect(maxActive).toBe(3)
  })

  it('counts existing in-flight requests toward concurrency after current page changes', async () => {
    const requests: ReturnType<typeof createDeferred>[] = []
    let active = 0
    let maxActive = 0
    const loadPage = vi.fn(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      const request = createDeferred()
      requests.push(request)
      await request.promise
      active -= 1
    })

    const { rerender } = renderHook(
      ({ currentPage }) => usePaginatedPreloader({
        currentPage,
        totalPages: 10,
        contextKey: 'history',
        enabled: true,
        hasPage: () => false,
        loadPage,
        concurrency: 2,
      }),
      { initialProps: { currentPage: 5 } },
    )

    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2))
    rerender({ currentPage: 6 })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(loadPage).toHaveBeenCalledTimes(2)
    expect(active).toBe(2)
    expect(maxActive).toBeLessThanOrEqual(2)

    await act(async () => {
      requests.forEach((request) => request.resolve())
      await Promise.all(requests.map((request) => request.promise))
    })
  })

  it('continues preloading latest current page candidates after a slot is released', async () => {
    const requests = new Map<number, ReturnType<typeof createDeferred>>()
    let active = 0
    let maxActive = 0
    const loadPage = vi.fn(async (page: number) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      const request = createDeferred()
      requests.set(page, request)
      await request.promise
      active -= 1
    })

    const { rerender } = renderHook(
      ({ currentPage }) => usePaginatedPreloader({
        currentPage,
        totalPages: 10,
        contextKey: 'history',
        enabled: true,
        hasPage: () => false,
        loadPage,
        concurrency: 2,
      }),
      { initialProps: { currentPage: 5 } },
    )

    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2))
    expect(loadPage).toHaveBeenNthCalledWith(1, 6, 'preload', expect.any(AbortSignal))
    expect(loadPage).toHaveBeenNthCalledWith(2, 4, 'preload', expect.any(AbortSignal))

    rerender({ currentPage: 8 })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(loadPage).toHaveBeenCalledTimes(2)
    expect(active).toBe(2)

    await act(async () => {
      requests.get(6)?.resolve()
      await requests.get(6)?.promise
    })

    await waitFor(() => expect(loadPage).toHaveBeenCalledWith(9, 'preload', expect.any(AbortSignal)))
    expect(maxActive).toBeLessThanOrEqual(2)

    await act(async () => {
      requests.forEach((request) => request.resolve())
      await Promise.all(Array.from(requests.values()).map((request) => request.promise))
    })
  })

  it('does not request an in-flight page again', async () => {
    const deferred = createDeferred()
    const loadPage = vi.fn(async (page: number) => {
      if (page === 6) {
        await deferred.promise
      }
    })

    const { rerender } = renderHook(
      ({ currentPage }) => usePaginatedPreloader({
        currentPage,
        totalPages: 10,
        contextKey: 'history',
        enabled: true,
        hasPage: () => false,
        loadPage,
        concurrency: 1,
      }),
      { initialProps: { currentPage: 5 } },
    )

    await waitFor(() => expect(loadPage).toHaveBeenCalledWith(6, 'preload', expect.any(AbortSignal)))
    rerender({ currentPage: 4 })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(loadPage).toHaveBeenCalledTimes(1)
    expect(loadPage.mock.calls.filter(([page]) => page === 6)).toHaveLength(1)

    await act(async () => {
      deferred.resolve()
      await deferred.promise
    })
  })

  it('does not report preload errors to page state by default', async () => {
    const loadPage = vi.fn().mockRejectedValue(new Error('network failed'))

    renderHook(() => usePaginatedPreloader({
      currentPage: 1,
      totalPages: 3,
      contextKey: 'history',
      enabled: true,
      hasPage: () => false,
      loadPage,
    }))

    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2))
  })

  it('reports preload errors through the optional callback', async () => {
    const error = new Error('network failed')
    const loadPage = vi.fn().mockRejectedValue(error)
    const onPreloadError = vi.fn()

    renderHook(() => usePaginatedPreloader({
      currentPage: 1,
      totalPages: 2,
      contextKey: 'history',
      enabled: true,
      hasPage: () => false,
      loadPage,
      onPreloadError,
    }))

    await waitFor(() => expect(onPreloadError).toHaveBeenCalledWith(2, error))
  })

  it('does not report preload errors after context changes', async () => {
    const firstRequest = createDeferred()
    const secondRequest = createDeferred()
    const error = new Error('network failed')
    const loadPage = vi.fn()
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise)
    const onPreloadError = vi.fn()

    const { rerender } = renderHook(
      ({ contextKey }) => usePaginatedPreloader({
        currentPage: 1,
        totalPages: 2,
        contextKey,
        enabled: true,
        hasPage: () => false,
        loadPage,
        onPreloadError,
      }),
      { initialProps: { contextKey: 'search:first' } },
    )

    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(1))
    rerender({ contextKey: 'search:second' })
    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2))

    await act(async () => {
      firstRequest.reject(error)
      await firstRequest.promise.catch(() => undefined)
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(onPreloadError).not.toHaveBeenCalled()

    await act(async () => {
      secondRequest.resolve()
      await secondRequest.promise
    })
  })

  it('does not commit completed preload results after context changes', async () => {
    const firstRequest = createDeferred()
    const secondRequest = createDeferred()
    const loadPage = vi.fn()
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise)
    const commitPage = vi.fn()

    const { rerender } = renderHook(
      ({ contextKey }) => usePaginatedPreloader({
        currentPage: 1,
        totalPages: 2,
        contextKey,
        enabled: true,
        hasPage: () => false,
        loadPage,
        commitPage,
      }),
      { initialProps: { contextKey: 'search:first' } },
    )

    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(1))
    rerender({ contextKey: 'search:second' })
    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2))

    await act(async () => {
      firstRequest.resolve()
      await firstRequest.promise
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(commitPage).not.toHaveBeenCalled()

    await act(async () => {
      secondRequest.resolve()
      await secondRequest.promise
    })

    await waitFor(() => expect(commitPage).toHaveBeenCalledWith(2, 'search:second', expect.any(AbortSignal)))
    expect(commitPage).toHaveBeenCalledTimes(1)
  })

  it('aborts the AbortSignal passed to loadPage when contextKey changes', async () => {
    const signals: AbortSignal[] = []
    const deferred = createDeferred()
    const loadPage = vi.fn(async (_page: number, _reason: string, signal: AbortSignal) => {
      signals.push(signal)
      await deferred.promise
    })

    const { rerender } = renderHook(
      ({ contextKey }) => usePaginatedPreloader({
        currentPage: 1,
        totalPages: 2,
        contextKey,
        enabled: true,
        hasPage: () => false,
        loadPage,
      }),
      { initialProps: { contextKey: 'search:first' } },
    )

    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(1))
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(false)

    rerender({ contextKey: 'search:second' })
    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2))

    // 旧 contextKey 的请求拿到的 signal 必须已被 abort
    expect(signals[0].aborted).toBe(true)
    // 新 contextKey 的请求拿到全新的、未中断的 signal
    expect(signals[1].aborted).toBe(false)

    await act(async () => {
      deferred.resolve()
      await deferred.promise
    })
  })

  it('aborts the AbortSignal passed to loadPage when the hook unmounts', async () => {
    const signals: AbortSignal[] = []
    const deferred = createDeferred()
    const loadPage = vi.fn(async (_page: number, _reason: string, signal: AbortSignal) => {
      signals.push(signal)
      await deferred.promise
    })

    const { unmount } = renderHook(() =>
      usePaginatedPreloader({
        currentPage: 1,
        totalPages: 2,
        contextKey: 'search:first',
        enabled: true,
        hasPage: () => false,
        loadPage,
      }),
    )

    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(1))
    expect(signals[0].aborted).toBe(false)

    unmount()

    // 卸载后，仍挂起的请求拿到的 signal 必须已被 abort
    expect(signals[0].aborted).toBe(true)

    await act(async () => {
      deferred.resolve()
      await deferred.promise.catch(() => undefined)
    })
  })

  it('does not abort the AbortSignal while contextKey stays the same', async () => {
    const signals: AbortSignal[] = []
    const loadPage = vi.fn(async (_page: number, _reason: string, signal: AbortSignal) => {
      signals.push(signal)
    })

    const { rerender } = renderHook(
      ({ currentPage }) => usePaginatedPreloader({
        currentPage,
        totalPages: 10,
        contextKey: 'search:first',
        enabled: true,
        hasPage: () => false,
        loadPage,
      }),
      { initialProps: { currentPage: 5 } },
    )

    await waitFor(() => expect(loadPage).toHaveBeenCalled())
    const firstBatchCount = signals.length
    expect(signals.every((s) => !s.aborted)).toBe(true)

    // 仅换 currentPage、不换 contextKey —— signal 不应被中断
    rerender({ currentPage: 6 })
    await waitFor(() => expect(loadPage).toHaveBeenCalled())
    expect(signals.every((s) => !s.aborted)).toBe(true)
    expect(signals.length).toBeGreaterThan(firstBatchCount)
  })

  it('starts a new generation when context changes', async () => {
    const calls: string[] = []
    const loadPage = vi.fn(async (page: number) => {
      calls.push(String(page))
    })

    const { rerender } = renderHook(
      ({ contextKey }) => usePaginatedPreloader({
        currentPage: 5,
        totalPages: 10,
        contextKey,
        enabled: true,
        hasPage: () => false,
        loadPage,
      }),
      { initialProps: { contextKey: 'search:first' } },
    )

    await waitFor(() => expect(loadPage).toHaveBeenCalled())
    loadPage.mockClear()
    rerender({ contextKey: 'search:second' })

    await waitFor(() => expect(loadPage).toHaveBeenCalled())
    expect(calls.length).toBeGreaterThan(0)
  })
})
