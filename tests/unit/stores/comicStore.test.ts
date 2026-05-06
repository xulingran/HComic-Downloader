import { describe, it, expect, beforeEach } from 'vitest'
import { useComicStore } from '@/stores/useComicStore'
import type { ComicInfo, PaginationInfo } from '@shared/types'

const mockComic: ComicInfo = {
  id: '1',
  title: 'Test Comic',
  url: 'https://example.com/comic/1',
  coverUrl: 'https://example.com/cover.jpg',
  source: 'test'
}

const mockPagination: PaginationInfo = {
  currentPage: 1,
  totalPages: 5,
  totalItems: 50
}

describe('useComicStore', () => {
  beforeEach(() => {
    useComicStore.setState({
      comics: [],
      pagination: null,
      isLoading: false,
      error: null
    })
  })

  it('应有正确的初始状态', () => {
    const state = useComicStore.getState()
    expect(state.comics).toEqual([])
    expect(state.pagination).toBeNull()
    expect(state.isLoading).toBe(false)
    expect(state.error).toBeNull()
  })

  it('应能设置 comics', () => {
    useComicStore.getState().setComics([mockComic])
    expect(useComicStore.getState().comics).toEqual([mockComic])
  })

  it('应能设置 pagination', () => {
    useComicStore.getState().setPagination(mockPagination)
    expect(useComicStore.getState().pagination).toEqual(mockPagination)
  })

  it('应能设置 loading 状态', () => {
    useComicStore.getState().setLoading(true)
    expect(useComicStore.getState().isLoading).toBe(true)
  })

  it('应能设置 error', () => {
    useComicStore.getState().setError('Something went wrong')
    expect(useComicStore.getState().error).toBe('Something went wrong')
  })

  it('应能清除 error', () => {
    useComicStore.getState().setError('error')
    useComicStore.getState().setError(null)
    expect(useComicStore.getState().error).toBeNull()
  })
})
