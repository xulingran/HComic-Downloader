import { describe, it, expect, beforeEach } from 'vitest'
import { useSearchCacheStore } from '@/stores/useSearchCacheStore'
import type { ComicInfo, PaginationInfo } from '@shared/types'

const mockComic: ComicInfo = {
  id: '1',
  title: 'Test Comic',
  url: 'https://example.com/comic/1',
  coverUrl: 'https://example.com/cover.jpg',
  source: 'test'
}

const mockPagination: PaginationInfo = {
  currentPage: 3,
  totalPages: 10,
  totalItems: 100
}

describe('useSearchCacheStore', () => {
  beforeEach(() => {
    useSearchCacheStore.setState({ cache: null, hasCache: false })
  })

  it('应有正确的初始状态', () => {
    const state = useSearchCacheStore.getState()
    expect(state.cache).toBeNull()
    expect(state.hasCache).toBe(false)
  })

  it('应能写入缓存', () => {
    useSearchCacheStore.getState().setCache({
      query: 'test query',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      comics: [mockComic],
      pagination: mockPagination
    })

    const state = useSearchCacheStore.getState()
    expect(state.hasCache).toBe(true)
    expect(state.cache).not.toBeNull()
    expect(state.cache!.query).toBe('test query')
    expect(state.cache!.mode).toBe('keyword')
    expect(state.cache!.source).toBe('hcomic')
    expect(state.cache!.searchTags).toBe('')
    expect(state.cache!.comics).toEqual([mockComic])
    expect(state.cache!.pagination).toEqual(mockPagination)
  })

  it('应能覆盖已有缓存', () => {
    useSearchCacheStore.getState().setCache({
      query: 'first',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      comics: [],
      pagination: null
    })
    useSearchCacheStore.getState().setCache({
      query: 'second',
      mode: 'author',
      source: 'jmcomic',
      searchTags: 'tag1',
      comics: [mockComic],
      pagination: mockPagination
    })

    const state = useSearchCacheStore.getState()
    expect(state.cache!.query).toBe('second')
    expect(state.cache!.mode).toBe('author')
    expect(state.cache!.source).toBe('jmcomic')
    expect(state.cache!.searchTags).toBe('tag1')
    expect(state.cache!.comics).toEqual([mockComic])
    expect(state.cache!.pagination).toEqual(mockPagination)
  })

  it('应能清除缓存', () => {
    useSearchCacheStore.getState().setCache({
      query: 'test',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      comics: [mockComic],
      pagination: mockPagination
    })

    useSearchCacheStore.getState().clearCache()

    const state = useSearchCacheStore.getState()
    expect(state.cache).toBeNull()
    expect(state.hasCache).toBe(false)
  })
})
