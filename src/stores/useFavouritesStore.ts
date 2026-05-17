import { create } from 'zustand'
import type { ComicInfo, PaginationInfo } from '@shared/types'

interface FavouritesCache {
  comics: ComicInfo[]
  pagination: PaginationInfo | null
  currentPage: number
  downloadedStatus: Record<string, 'downloaded' | 'unknown'>
}

interface FavouritesStoreState extends FavouritesCache {
  hasCache: boolean
  setCache: (data: FavouritesCache) => void
  clearCache: () => void
}

export const useFavouritesStore = create<FavouritesStoreState>((set) => ({
  comics: [],
  pagination: null,
  currentPage: 1,
  downloadedStatus: {},
  hasCache: false,
  setCache: (data) =>
    set({
      ...data,
      hasCache: data.comics.length > 0,
    }),
  clearCache: () =>
    set({
      comics: [],
      pagination: null,
      currentPage: 1,
      downloadedStatus: {},
      hasCache: false,
    }),
}))
