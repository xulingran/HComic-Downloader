import { create } from 'zustand'
import { ComicInfo } from '@shared/types'

interface ReaderState {
  readerComic: ComicInfo | null
  open: boolean
  sessionId: number
  closingSessionId: number | null
  initialPage: number | null
  initialChapterId: string | null
  openReader: (comic: ComicInfo, initialPage?: number, initialChapterId?: string) => void
  closeReader: () => void
  finalizeClose: (sessionId: number | null) => void
}

export const useReaderStore = create<ReaderState>((set) => ({
  readerComic: null,
  open: false,
  sessionId: 0,
  closingSessionId: null,
  initialPage: null,
  initialChapterId: null,
  openReader: (comic, initialPage, initialChapterId) =>
    set((state) => ({
      readerComic: comic,
      open: true,
      sessionId: state.sessionId + 1,
      closingSessionId: null,
      initialPage: initialPage ?? null,
      initialChapterId: initialChapterId ?? null,
    })),
  closeReader: () =>
    set((state) => state.open
      ? { open: false, closingSessionId: state.sessionId }
      : state),
  finalizeClose: (sessionId) =>
    set((state) => (
      sessionId !== null
      && !state.open
      && state.closingSessionId === sessionId
      && state.sessionId === sessionId
    ) ? {
        readerComic: null,
        initialPage: null,
        initialChapterId: null,
        closingSessionId: null,
      } : state),
}))
