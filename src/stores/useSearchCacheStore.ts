import { create } from 'zustand'
import type { ComicInfo, PaginationInfo } from '@shared/types'

export interface SearchCache {
  query: string
  mode: string
  source: string
  searchTags: string
  comics: ComicInfo[]
  pagination: PaginationInfo | null
}

interface SearchCacheStoreState {
  cache: SearchCache | null
  hasCache: boolean
  setCache: (data: SearchCache) => void
  clearCache: () => void
}

export const useSearchCacheStore = create<SearchCacheStoreState>((set) => ({
  cache: null,
  hasCache: false,
  setCache: (data) => set({ cache: data, hasCache: true }),
  clearCache: () => set({ cache: null, hasCache: false }),
}))
