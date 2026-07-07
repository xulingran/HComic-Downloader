import { describe, it, expect, beforeEach } from 'vitest'
import { useSearchCacheStore, createSearchContextKey } from '@/stores/useSearchCacheStore'
import type { ComicInfo, PaginationInfo, SearchSection } from '@shared/types'

const mockComic: ComicInfo = {
  id: '1',
  title: 'Test Comic',
  url: 'https://example.com/comic/1',
  coverUrl: 'https://example.com/cover.jpg',
  source: 'test',
}

const mockPagination: PaginationInfo = {
  currentPage: 3,
  totalPages: 10,
  totalItems: 100,
}

const mockSections: SearchSection[] = [{ title: '最新漫画', comicIds: ['1'] }]

describe('useSearchCacheStore', () => {
  beforeEach(() => {
    useSearchCacheStore.setState({
      contexts: {},
      currentContextKey: null,
      currentPage: 1,
      hasCache: false,
    })
  })

  it('creates stable context keys', () => {
    // 末尾的 languageFilter 段缺省为空字符串，仍参与 key（add-nh-chinese-language-filter spec）
    expect(createSearchContextKey({ query: 'abc', mode: 'keyword', source: 'hcomic', searchTags: '' }))
      .toBe('hcomic\u001fkeyword\u001fabc\u001f\u001f')
  })

  it('isolates cached pages by languageFilter for the same query', () => {
    // 同一 NH 查询的「仅中文」开关开/关应生成不同 contextKey，避免脏读
    const unfiltered = createSearchContextKey({
      query: 'sample', mode: 'keyword', source: 'nh', searchTags: '',
    })
    const chineseOnly = createSearchContextKey({
      query: 'sample', mode: 'keyword', source: 'nh', searchTags: '', languageFilter: 'chinese',
    })
    expect(unfiltered).not.toBe(chineseOnly)

    useSearchCacheStore.getState().setPage(unfiltered, 1, {
      query: 'sample', mode: 'keyword', source: 'nh', searchTags: '',
      comics: [mockComic], pagination: { ...mockPagination, currentPage: 1 },
    })
    useSearchCacheStore.getState().setPage(chineseOnly, 1, {
      query: 'sample', mode: 'keyword', source: 'nh', searchTags: '', languageFilter: 'chinese',
      comics: [mockComic], pagination: { ...mockPagination, currentPage: 1 },
    })

    // 两种状态互不覆盖：清除一种不影响另一种
    useSearchCacheStore.getState().clearContext(unfiltered)
    expect(useSearchCacheStore.getState().getPage(unfiltered, 1)).toBeUndefined()
    expect(useSearchCacheStore.getState().getPage(chineseOnly, 1)).toBeDefined()
  })

  it('stores and reads a page in a search context', () => {
    const key = createSearchContextKey({ query: 'test', mode: 'keyword', source: 'hcomic', searchTags: '' })

    useSearchCacheStore.getState().setPage(key, 3, {
      query: 'test',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      comics: [mockComic],
      pagination: mockPagination,
      sections: mockSections,
    })

    const state = useSearchCacheStore.getState()
    expect(state.hasCache).toBe(true)
    expect(state.currentContextKey).toBe(key)
    expect(state.currentPage).toBe(3)
    expect(state.getPage(key, 3)?.comics).toEqual([mockComic])
    expect(state.getPage(key, 3)?.sections).toEqual(mockSections)
    expect(state.hasPage(key, 3)).toBe(true)
    expect(state.hasPage(key, 4)).toBe(false)
  })

  it('keeps pages isolated by context', () => {
    const firstKey = createSearchContextKey({ query: 'first', mode: 'keyword', source: 'hcomic', searchTags: '' })
    const secondKey = createSearchContextKey({ query: 'first', mode: 'keyword', source: 'jm', searchTags: '' })

    useSearchCacheStore.getState().setPage(firstKey, 1, {
      query: 'first',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      comics: [mockComic],
      pagination: { ...mockPagination, currentPage: 1 },
    })

    expect(useSearchCacheStore.getState().getPage(secondKey, 1)).toBeUndefined()
  })

  it('clears one context without clearing others', () => {
    const firstKey = createSearchContextKey({ query: 'first', mode: 'keyword', source: 'hcomic', searchTags: '' })
    const secondKey = createSearchContextKey({ query: 'second', mode: 'keyword', source: 'hcomic', searchTags: '' })

    useSearchCacheStore.getState().setPage(firstKey, 1, {
      query: 'first',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      comics: [mockComic],
      pagination: { ...mockPagination, currentPage: 1 },
    })
    useSearchCacheStore.getState().setPage(secondKey, 1, {
      query: 'second',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      comics: [mockComic],
      pagination: { ...mockPagination, currentPage: 1 },
    })

    useSearchCacheStore.getState().clearContext(firstKey)

    expect(useSearchCacheStore.getState().getPage(firstKey, 1)).toBeUndefined()
    expect(useSearchCacheStore.getState().getPage(secondKey, 1)).toBeDefined()
  })

  it('clears all search cache', () => {
    const key = createSearchContextKey({ query: 'test', mode: 'keyword', source: 'hcomic', searchTags: '' })
    useSearchCacheStore.getState().setPage(key, 1, {
      query: 'test',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      comics: [mockComic],
      pagination: { ...mockPagination, currentPage: 1 },
    })

    useSearchCacheStore.getState().clearCache()

    const state = useSearchCacheStore.getState()
    expect(state.contexts).toEqual({})
    expect(state.currentContextKey).toBeNull()
    expect(state.hasCache).toBe(false)
  })

  it('does not clobber currentPage/currentContextKey when preloading (setCurrent=false)', () => {
    const key = createSearchContextKey({ query: 'test', mode: 'keyword', source: 'hcomic', searchTags: '' })

    // 用户主动加载第 3 页 —— 应设置 currentContextKey/currentPage
    useSearchCacheStore.getState().setPage(key, 3, {
      query: 'test',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      comics: [mockComic],
      pagination: { ...mockPagination, currentPage: 3 },
    })
    expect(useSearchCacheStore.getState().currentPage).toBe(3)
    expect(useSearchCacheStore.getState().currentContextKey).toBe(key)

    // 预加载第 4 页 —— 不应改变 currentContextKey/currentPage，但应写入缓存
    useSearchCacheStore.getState().setPage(key, 4, {
      query: 'test',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      comics: [mockComic],
      pagination: { ...mockPagination, currentPage: 4 },
    }, false)

    expect(useSearchCacheStore.getState().currentPage).toBe(3)
    expect(useSearchCacheStore.getState().currentContextKey).toBe(key)
    expect(useSearchCacheStore.getState().getPage(key, 4)).toBeDefined()
    expect(useSearchCacheStore.getState().hasCache).toBe(true)
  })
})
