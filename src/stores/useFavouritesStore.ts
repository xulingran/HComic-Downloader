import { create } from 'zustand'
import type { ComicInfo, PaginationInfo } from '@shared/types'

interface FavouritesCache {
  comics: ComicInfo[]
  pagination: PaginationInfo | null
  currentPage: number
  downloadedStatus: Record<string, 'downloaded' | 'unknown'>
}

interface FavouritesStoreState {
  caches: Record<string, FavouritesCache>
  currentSource: string
  hasCache: boolean
  comics: ComicInfo[]
  pagination: PaginationInfo | null
  currentPage: number
  downloadedStatus: Record<string, 'downloaded' | 'unknown'>
  setCache: (data: FavouritesCache, source?: string) => void
  clearCache: (source?: string) => void
  setCurrentSource: (source: string) => void
}

export const useFavouritesStore = create<FavouritesStoreState>((set, get) => ({
  caches: {},
  currentSource: 'hcomic',
  hasCache: false,
  comics: [],
  pagination: null,
  currentPage: 1,
  downloadedStatus: {},
  setCache: (data, source) => {
    const effectiveSource = source || get().currentSource
    const caches = { ...get().caches, [effectiveSource]: data }
    set({
      caches,
      ...data,
      hasCache: data.comics.length > 0,
      currentSource: effectiveSource,
    })
  },
  clearCache: (source) => {
    const effectiveSource = source || get().currentSource
    const caches = { ...get().caches }
    delete caches[effectiveSource]
    if (effectiveSource === get().currentSource) {
      set({
        caches,
        comics: [],
        pagination: null,
        currentPage: 1,
        downloadedStatus: {},
        hasCache: false,
      })
    } else {
      set({ caches })
    }
  },
  setCurrentSource: (source) => {
    const cache = get().caches[source]
    if (cache) {
      set({
        currentSource: source,
        ...cache,
        hasCache: cache.comics.length > 0,
      })
    } else {
      set({
        currentSource: source,
        comics: [],
        pagination: null,
        currentPage: 1,
        downloadedStatus: {},
        hasCache: false,
      })
    }
  },
}))
