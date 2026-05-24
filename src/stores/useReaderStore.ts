import { create } from 'zustand'
import { ComicInfo } from '@shared/types'

interface ReaderState {
  readerComic: ComicInfo | null
  openReader: (comic: ComicInfo) => void
  closeReader: () => void
}

export const useReaderStore = create<ReaderState>((set) => ({
  readerComic: null,
  openReader: (comic) => set({ readerComic: comic }),
  closeReader: () => set({ readerComic: null }),
}))