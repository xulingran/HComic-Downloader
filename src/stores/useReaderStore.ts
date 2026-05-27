import { create } from 'zustand'
import { ComicInfo } from '@shared/types'

interface ReaderState {
  readerComic: ComicInfo | null
  initialPage: number | null
  openReader: (comic: ComicInfo, initialPage?: number) => void
  closeReader: () => void
}

export const useReaderStore = create<ReaderState>((set) => ({
  readerComic: null,
  initialPage: null,
  openReader: (comic, initialPage) => set({ readerComic: comic, initialPage: initialPage ?? null }),
  closeReader: () => set({ readerComic: null, initialPage: null }),
}))
