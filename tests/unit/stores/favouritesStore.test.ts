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

  it('does not clobber currentPage/currentSource when preloading (setCurrent=false)', () => {
    // 用户主动加载第 3 页
    useFavouritesStore.getState().setPage('hcomic', 3, {
      comics: [comic],
      pagination: { ...pagination, currentPage: 3 },
      currentPage: 3,
      downloadedStatus: {},
    })
    expect(useFavouritesStore.getState().currentPage).toBe(3)

    // 预加载第 4 页 —— 不应改变 currentSource/currentPage，但应写入缓存
    useFavouritesStore.getState().setPage('hcomic', 4, {
      comics: [comic],
      pagination: { ...pagination, currentPage: 4 },
      currentPage: 4,
      downloadedStatus: {},
    }, false)

    expect(useFavouritesStore.getState().currentPage).toBe(3)
    expect(useFavouritesStore.getState().currentSource).toBe('hcomic')
    expect(useFavouritesStore.getState().getPage('hcomic', 4)).toBeDefined()
  })
})
