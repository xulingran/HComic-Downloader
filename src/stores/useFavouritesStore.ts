import { create } from 'zustand'
import type { ComicInfo, PaginationInfo } from '@shared/types'

export interface FavouritesPageCache {
  comics: ComicInfo[]
  pagination: PaginationInfo | null
  currentPage: number
  downloadedStatus: Record<string, 'downloaded' | 'unknown'>
}

interface SourceFavouritesCache {
  pages: Record<number, FavouritesPageCache>
}

interface FavouritesStoreState {
  caches: Record<string, SourceFavouritesCache>
  currentSource: string
  currentPage: number
  hasCache: boolean
  setPage: (source: string, page: number, data: FavouritesPageCache) => void
  getPage: (source: string, page: number) => FavouritesPageCache | undefined
  hasPage: (source: string, page: number) => boolean
  clearCache: (source?: string) => void
  setCurrentSource: (source: string) => void
}

export const useFavouritesStore = create<FavouritesStoreState>((set, get) => ({
  caches: {},
  currentSource: 'hcomic',
  currentPage: 1,
  hasCache: false,
  setPage: (source, page, data) => {
    const caches = get().caches
    const sourceCache = caches[source] ?? { pages: {} }
    set({
      caches: {
        ...caches,
        [source]: {
          pages: {
            ...sourceCache.pages,
            [page]: data,
          },
        },
      },
      currentSource: source,
      currentPage: page,
      hasCache: true,
    })
  },
  getPage: (source, page) => get().caches[source]?.pages[page],
  hasPage: (source, page) => Boolean(get().caches[source]?.pages[page]),
  clearCache: (source) => {
    if (!source) {
      set({ caches: {}, currentPage: 1, hasCache: false })
      return
    }
    const caches = { ...get().caches }
    delete caches[source]
    set({
      caches,
      currentPage: source === get().currentSource ? 1 : get().currentPage,
      hasCache: Object.keys(caches).length > 0,
    })
  },
  setCurrentSource: (source) => {
    set({
      currentSource: source,
      currentPage: 1,
      hasCache: Boolean(get().caches[source]),
    })
  },
}))
