import { create } from 'zustand'
import type {
  LibraryAssetSummary,
  LibraryQuery,
  LibraryScanState,
  LibraryStats,
  LibrarySort,
  LibraryFormat,
  LibraryHealthStatus,
} from '@shared/types'

interface LibraryState {
  // 分页结果
  items: LibraryAssetSummary[]
  currentPage: number
  totalPages: number
  totalItems: number
  isLoading: boolean
  error: string | null

  // 查询条件
  query: string
  sourceSite: string
  format: LibraryFormat | ''
  healthStatus: LibraryHealthStatus | ''
  sort: LibrarySort

  // 布局
  viewMode: 'grid' | 'list'

  // 扫描状态
  scanState: LibraryScanState | null

  // 统计
  stats: LibraryStats | null

  // 会话内滚动位置
  scrollPosition: number

  // 请求竞态取消
  requestId: number

  // Actions
  setItems: (items: LibraryAssetSummary[], pagination: { currentPage: number; totalPages: number; totalItems: number }) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setQuery: (query: Partial<Pick<LibraryState, 'query' | 'sourceSite' | 'format' | 'healthStatus' | 'sort'>>) => void
  setViewMode: (mode: 'grid' | 'list') => void
  setScanState: (state: LibraryScanState) => void
  setStats: (stats: LibraryStats | null) => void
  setScrollPosition: (pos: number) => void
  nextRequestId: () => number
  getCurrentQuery: () => LibraryQuery
  reset: () => void
}

const initialQuery = {
  query: '',
  sourceSite: '',
  format: '' as LibraryFormat | '',
  healthStatus: '' as LibraryHealthStatus | '',
  sort: 'recent_added' as LibrarySort,
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  items: [],
  currentPage: 1,
  totalPages: 0,
  totalItems: 0,
  isLoading: false,
  error: null,
  ...initialQuery,
  viewMode: 'grid',
  scanState: null,
  stats: null,
  scrollPosition: 0,
  requestId: 0,

  setItems: (items, pagination) => set({
    items,
    currentPage: pagination.currentPage,
    totalPages: pagination.totalPages,
    totalItems: pagination.totalItems,
    isLoading: false,
    error: null,
  }),

  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error, isLoading: false }),

  setQuery: (query) => set({
    ...query,
    currentPage: 1, // 查询条件变化时回到第一页
  }),

  setViewMode: (mode) => set({ viewMode: mode }),
  setScanState: (state) => set({ scanState: state }),
  setStats: (stats) => set({ stats }),
  setScrollPosition: (pos) => set({ scrollPosition: pos }),

  nextRequestId: () => {
    const id = get().requestId + 1
    set({ requestId: id })
    return id
  },

  getCurrentQuery: () => {
    const s = get()
    return {
      page: s.currentPage,
      pageSize: 50,
      query: s.query || undefined,
      sourceSite: s.sourceSite || undefined,
      format: s.format || undefined,
      healthStatus: s.healthStatus || undefined,
      sort: s.sort,
    }
  },

  reset: () => set({
    items: [],
    currentPage: 1,
    totalPages: 0,
    totalItems: 0,
    isLoading: false,
    error: null,
    ...initialQuery,
    scrollPosition: 0,
  }),
}))
