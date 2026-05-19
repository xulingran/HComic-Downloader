import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSearch } from '@/hooks/useIpc'
import { createMockHcomic } from '../../__mocks__/ipc'

describe('useSearch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as any).hcomic
  })

  it('应返回 search 函数', () => {
    createMockHcomic()
    const { result } = renderHook(() => useSearch())
    expect(result.current.search).toBeDefined()
    expect(typeof result.current.search).toBe('function')
  })

  it('应调用 window.hcomic.search', async () => {
    const searchResult = {
      comics: [{ id: '1', title: 'Comic', url: '', coverUrl: '', source: 'test' }],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 1 }
    }
    const hcomic = createMockHcomic({ search: vi.fn().mockResolvedValue(searchResult) })

    const { result } = renderHook(() => useSearch())
    const response = await result.current.search('test query', 'keyword', 1)

    expect(hcomic.search).toHaveBeenCalledWith('test query', 'keyword', 1, undefined, undefined)
    expect(response).toEqual(searchResult)
  })

  it('应支持翻页', async () => {
    const hcomic = createMockHcomic({ search: vi.fn().mockResolvedValue({}) })

    const { result } = renderHook(() => useSearch())
    await result.current.search('test', 'keyword', 3)

    expect(hcomic.search).toHaveBeenCalledWith('test', 'keyword', 3, undefined, undefined)
  })

  it('应传递空查询和不同的搜索模式', async () => {
    const hcomic = createMockHcomic({
      search: vi.fn().mockResolvedValue({ comics: [], pagination: { currentPage: 1, totalPages: 0, totalItems: 0 } })
    })

    const { result } = renderHook(() => useSearch())
    await result.current.search('', 'tag', 1)

    expect(hcomic.search).toHaveBeenCalledWith('', 'tag', 1, undefined, undefined)
  })
})
