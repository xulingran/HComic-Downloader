import { create } from 'zustand'
import { ComicInfo } from '@shared/types'

interface ReaderState {
  readerComic: ComicInfo | null
  initialPage: number | null
  initialChapterId: string | null
  openReader: (comic: ComicInfo, initialPage?: number, initialChapterId?: string) => void
  closeReader: () => void
}

export const useReaderStore = create<ReaderState>((set) => ({
  readerComic: null,
  initialPage: null,
  initialChapterId: null,
  openReader: (comic, initialPage, initialChapterId) =>
    set({ readerComic: comic, initialPage: initialPage ?? null, initialChapterId: initialChapterId ?? null }),
  closeReader: () => set({ readerComic: null, initialPage: null, initialChapterId: null }),
}))
