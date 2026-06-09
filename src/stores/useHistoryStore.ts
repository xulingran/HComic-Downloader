import { create } from 'zustand'
import type { HistoryItem, PaginationInfo } from '@shared/types'

export interface HistoryPageCache {
  items: HistoryItem[]
  pagination: PaginationInfo | null
  currentPage: number
}

interface HistoryStoreState {
  pages: Record<number, HistoryPageCache>
  currentPage: number
  hasCache: boolean
  setPage: (page: number, data: HistoryPageCache) => void
  getPage: (page: number) => HistoryPageCache | undefined
  hasPage: (page: number) => boolean
  clearCache: () => void
}

export const useHistoryStore = create<HistoryStoreState>((set, get) => ({
  pages: {},
  currentPage: 1,
  hasCache: false,
  setPage: (page, data) => set({
    pages: {
      ...get().pages,
      [page]: data,
    },
    currentPage: page,
    hasCache: true,
  }),
  getPage: (page) => get().pages[page],
  hasPage: (page) => Boolean(get().pages[page]),
  clearCache: () => set({
    pages: {},
    currentPage: 1,
    hasCache: false,
  }),
}))
