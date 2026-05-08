import { create } from 'zustand'
import { ComicInfo, PaginationInfo } from '@shared/types'

interface ComicState {
  comics: ComicInfo[]
  pagination: PaginationInfo | null
  isLoading: boolean
  error: string | null
  detailPrefetchGeneration: number
  setComics: (comics: ComicInfo[]) => void
  setPagination: (pagination: PaginationInfo) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  bumpDetailPrefetch: () => void
}

export const useComicStore = create<ComicState>((set) => ({
  comics: [],
  pagination: null,
  isLoading: false,
  error: null,
  detailPrefetchGeneration: 0,
  setComics: (comics) => set({ comics }),
  setPagination: (pagination) => set({ pagination }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  bumpDetailPrefetch: () => set((s) => ({ detailPrefetchGeneration: s.detailPrefetchGeneration + 1 })),
}))
