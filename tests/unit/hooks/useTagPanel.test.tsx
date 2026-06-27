import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetTagList, mockRefreshTagList, mockGetFavouriteTags } = vi.hoisted(() => ({
  mockGetTagList: vi.fn(),
  mockRefreshTagList: vi.fn(),
  mockGetFavouriteTags: vi.fn(),
}))

vi.mock('@/hooks/useIpc', () => ({
  useTagList: () => ({
    getTagList: mockGetTagList,
    refreshTagList: mockRefreshTagList,
  }),
  useFavouriteTags: () => ({
    getFavouriteTags: mockGetFavouriteTags,
  }),
}))

import { useTagPanel } from '@/hooks/useTagPanel'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const emptyFavourites = { tags: [] }

describe('useTagPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRefreshTagList.mockResolvedValue(undefined)
    mockGetFavouriteTags.mockResolvedValue(emptyFavourites)
  })

  it('合并收藏标签后仍遵守 popular 与 name 排序', async () => {
    mockGetTagList.mockResolvedValue({
      tags: [
        { tag: 'alpha', count: 1 },
        { tag: 'zeta', count: 10 },
        { tag: 'beta', count: 5 },
      ],
      total: 3,
    })
    mockGetFavouriteTags.mockResolvedValue({ tags: [{ tag: 'alpha', count: 2 }] })

    const { result } = renderHook(() => useTagPanel('nh', true))
    act(() => result.current.setExpanded(true))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.tags.map(item => item.tag)).toEqual(['zeta', 'beta', 'alpha'])

    act(() => result.current.setSort('name'))

    await waitFor(() => expect(mockGetTagList).toHaveBeenLastCalledWith(
      'nh', undefined, undefined, undefined, 'name',
    ))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.tags.map(item => item.tag)).toEqual(['alpha', 'beta', 'zeta'])
  })

  it('忽略较晚返回的旧排序响应', async () => {
    const popularRequest = deferred<{ tags: Array<{ tag: string; count: number }>; total: number }>()
    const nameRequest = deferred<{ tags: Array<{ tag: string; count: number }>; total: number }>()
    mockGetTagList.mockImplementation((
      _source?: string,
      _keyword?: string,
      _page?: number,
      _limit?: number,
      sort?: 'popular' | 'name',
    ) => sort === 'name' ? nameRequest.promise : popularRequest.promise)

    const { result } = renderHook(() => useTagPanel('nh', true))
    act(() => result.current.setExpanded(true))
    await waitFor(() => expect(mockGetTagList).toHaveBeenCalledTimes(1))

    act(() => result.current.setSort('name'))
    await waitFor(() => expect(mockGetTagList).toHaveBeenCalledTimes(2))

    await act(async () => {
      nameRequest.resolve({ tags: [{ tag: 'alpha', count: 1 }], total: 1 })
      await nameRequest.promise
    })
    await waitFor(() => expect(result.current.tags.map(item => item.tag)).toEqual(['alpha']))

    await act(async () => {
      popularRequest.resolve({ tags: [{ tag: 'zeta', count: 99 }], total: 1 })
      await popularRequest.promise
    })
    expect(result.current.tags.map(item => item.tag)).toEqual(['alpha'])
  })

  it('切换来源后忽略旧来源响应并使用默认 popular', async () => {
    const hcomicRequest = deferred<{ tags: Array<{ tag: string; count: number }>; total: number }>()
    const nhRequest = deferred<{ tags: Array<{ tag: string; count: number }>; total: number }>()
    mockGetTagList.mockImplementation((source?: string) => (
      source === 'nh' ? nhRequest.promise : hcomicRequest.promise
    ))

    const { result, rerender } = renderHook(
      ({ source }) => useTagPanel(source, true),
      { initialProps: { source: 'hcomic' } },
    )
    act(() => result.current.setExpanded(true))
    await waitFor(() => expect(mockGetTagList).toHaveBeenCalledTimes(1))

    rerender({ source: 'nh' })
    await waitFor(() => expect(mockGetTagList).toHaveBeenCalledWith(
      'nh', undefined, undefined, undefined, 'popular',
    ))

    await act(async () => {
      nhRequest.resolve({ tags: [{ tag: 'nh-tag', count: 1 }], total: 1 })
      await nhRequest.promise
    })
    await waitFor(() => expect(result.current.tags.map(item => item.tag)).toEqual(['nh-tag']))

    await act(async () => {
      hcomicRequest.resolve({ tags: [{ tag: 'stale-tag', count: 100 }], total: 1 })
      await hcomicRequest.promise
    })
    expect(result.current.tags.map(item => item.tag)).toEqual(['nh-tag'])
    expect(result.current.sort).toBe('popular')
  })
})
