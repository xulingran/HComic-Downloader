import { describe, it, expect, beforeEach } from 'vitest'
import { useFavouritesStore } from '@/stores/useFavouritesStore'
import type { ComicInfo, PaginationInfo } from '@shared/types'

const comic: ComicInfo = {
  id: 'fav-1',
  title: 'Favourite Comic',
  url: 'https://example.com/fav-1',
  coverUrl: '',
  source: 'NH',
}

const pagination: PaginationInfo = {
  currentPage: 2,
  totalPages: 8,
  totalItems: 80,
}

describe('useFavouritesStore', () => {
  beforeEach(() => {
    useFavouritesStore.setState({
      caches: {},
      currentSource: 'hcomic',
      currentPage: 1,
      hasCache: false,
    })
  })

  it('stores and reads pages by source', () => {
    useFavouritesStore.getState().setPage('hcomic', 2, {
      comics: [comic],
      pagination,
      currentPage: 2,
      downloadedStatus: { 'hcomic_NH_fav-1': 'downloaded' },
    })

    const page = useFavouritesStore.getState().getPage('hcomic', 2)
    expect(page?.comics).toEqual([comic])
    expect(page?.downloadedStatus['hcomic_NH_fav-1']).toBe('downloaded')
    expect(useFavouritesStore.getState().hasPage('hcomic', 2)).toBe(true)
    expect(useFavouritesStore.getState().hasPage('hcomic', 3)).toBe(false)
  })

  it('keeps source caches isolated', () => {
    useFavouritesStore.getState().setPage('hcomic', 1, {
      comics: [comic],
      pagination: { ...pagination, currentPage: 1 },
      currentPage: 1,
      downloadedStatus: {},
    })

    expect(useFavouritesStore.getState().getPage('jmcomic', 1)).toBeUndefined()
  })

  it('clears one source cache', () => {
    useFavouritesStore.getState().setPage('hcomic', 1, {
      comics: [comic],
      pagination: { ...pagination, currentPage: 1 },
      currentPage: 1,
      downloadedStatus: {},
    })
    useFavouritesStore.getState().setPage('jmcomic', 1, {
      comics: [comic],
      pagination: { ...pagination, currentPage: 1 },
      currentPage: 1,
      downloadedStatus: {},
    })

    useFavouritesStore.getState().clearCache('hcomic')

    expect(useFavouritesStore.getState().getPage('hcomic', 1)).toBeUndefined()
    expect(useFavouritesStore.getState().getPage('jmcomic', 1)).toBeDefined()
  })
})
