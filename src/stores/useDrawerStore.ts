import { create } from 'zustand'
import { ComicInfo, SearchMode } from '@shared/types'

interface PendingSearch {
  query: string
  mode: SearchMode
  append?: boolean
}

// 历史记录断点续读上下文：从历史页打开抽屉时注入，
// 让抽屉的"开始阅读"入口能区分"继续阅读"与"从头开始"。
export interface ResumeInfo {
  lastPage: number
  lastChapterId?: string
}

interface DrawerState {
  drawerComic: ComicInfo | null
  pendingSearch: PendingSearch | null
  resumeInfo: ResumeInfo | null
  isOpen: boolean
  openDrawer: (comic: ComicInfo, resumeInfo?: ResumeInfo | null) => void
  closeDrawer: () => void
  setPendingSearch: (query: string, mode: SearchMode, append?: boolean) => void
  clearPendingSearch: () => void
}

export const useDrawerStore = create<DrawerState>((set) => ({
  drawerComic: null,
  pendingSearch: null,
  resumeInfo: null,
  isOpen: false,
  openDrawer: (comic, resumeInfo = null) => set({ drawerComic: comic, isOpen: true, resumeInfo }),
  closeDrawer: () => set({ isOpen: false, resumeInfo: null }),
  setPendingSearch: (query, mode, append = false) => set({ pendingSearch: { query, mode, append } }),
  clearPendingSearch: () => set({ pendingSearch: null }),
}))
