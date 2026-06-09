import { describe, it, expect, beforeEach } from 'vitest'
import { useHistoryStore } from '@/stores/useHistoryStore'
import type { HistoryItem, PaginationInfo } from '@shared/types'

const item: HistoryItem = {
  id: 1,
  comicId: 'comic-1',
  title: 'History Comic',
  coverUrl: '',
  source: 'NH',
  sourceSite: 'hcomic',
  mediaId: 'media-1',
  sourceUrl: 'https://example.com/comic-1',
  lastPage: 1,
  totalPages: 10,
  lastReadAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
}

const pagination: PaginationInfo = {
  currentPage: 2,
  totalPages: 5,
  totalItems: 50,
}

describe('useHistoryStore', () => {
  beforeEach(() => {
    useHistoryStore.setState({
      pages: {},
      currentPage: 1,
      hasCache: false,
    })
  })

  it('stores and reads history pages', () => {
    useHistoryStore.getState().setPage(2, {
      items: [item],
      pagination,
      currentPage: 2,
    })

    expect(useHistoryStore.getState().getPage(2)?.items).toEqual([item])
    expect(useHistoryStore.getState().hasPage(2)).toBe(true)
    expect(useHistoryStore.getState().hasPage(3)).toBe(false)
  })

  it('clears all history pages', () => {
    useHistoryStore.getState().setPage(2, {
      items: [item],
      pagination,
      currentPage: 2,
    })

    useHistoryStore.getState().clearCache()

    expect(useHistoryStore.getState().pages).toEqual({})
    expect(useHistoryStore.getState().hasCache).toBe(false)
    expect(useHistoryStore.getState().currentPage).toBe(1)
  })
})
