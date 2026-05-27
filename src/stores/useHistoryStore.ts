import { create } from 'zustand'
import type { HistoryItem, PaginationInfo } from '@shared/types'

interface HistoryCache {
  items: HistoryItem[]
  pagination: PaginationInfo | null
  currentPage: number
}

interface HistoryStoreState extends HistoryCache {
  hasCache: boolean
  setCache: (data: HistoryCache) => void
  clearCache: () => void
}

export const useHistoryStore = create<HistoryStoreState>((set) => ({
  items: [],
  pagination: null,
  currentPage: 1,
  hasCache: false,
  setCache: (data) =>
    set({
      ...data,
      hasCache: data.items.length > 0,
    }),
  clearCache: () =>
    set({
      items: [],
      pagination: null,
      currentPage: 1,
      hasCache: false,
    }),
}))
