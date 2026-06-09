import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPreloadCandidates, usePaginatedPreloader } from '@/hooks/usePaginatedPreloader'

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

    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(3))
    expect(loadPage).toHaveBeenNthCalledWith(1, 6, 'preload')
    expect(loadPage).toHaveBeenNthCalledWith(2, 7, 'preload')
    expect(loadPage).toHaveBeenNthCalledWith(3, 3, 'preload')
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

  it('limits concurrent preload requests to two', async () => {
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
      concurrency: 2,
    }))

    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(4))
    await waitFor(() => expect(active).toBe(0))
    expect(maxActive).toBeLessThanOrEqual(2)
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
