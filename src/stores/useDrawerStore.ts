import { create } from 'zustand'
import { ComicInfo, SearchMode } from '@shared/types'

interface PendingSearch {
  query: string
  mode: SearchMode
  append?: boolean
}

interface DrawerState {
  drawerComic: ComicInfo | null
  pendingSearch: PendingSearch | null
  isOpen: boolean
  openDrawer: (comic: ComicInfo) => void
  closeDrawer: () => void
  setPendingSearch: (query: string, mode: SearchMode, append?: boolean) => void
  clearPendingSearch: () => void
}

export const useDrawerStore = create<DrawerState>((set) => ({
  drawerComic: null,
  pendingSearch: null,
  isOpen: false,
  openDrawer: (comic) => set({ drawerComic: comic, isOpen: true }),
  closeDrawer: () => set({ isOpen: false }),
  setPendingSearch: (query, mode, append = false) => set({ pendingSearch: { query, mode, append } }),
  clearPendingSearch: () => set({ pendingSearch: null }),
}))
