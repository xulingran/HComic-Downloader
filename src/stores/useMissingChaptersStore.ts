import { create } from 'zustand'
import type { DuplicateGroup } from '@/utils/titleSimilarity'

/**
 * 查缺补漏检测结果 store。
 *
 * 存在意义：检测结果（同系列组）从组件 local state 提升到全局 store，
 * 让用户点击「搜索此系列」跳转到搜索页后，再返回工具箱时检测结果不丢失。
 *
 * 背景：App.tsx 用 switch(activePage) 做页面切换，切页时 ToolboxPage 整个
 * 卸载，组件 local state 全部归零。若不持久化，用户每次搜索后回来都要
 * 重新拉取收藏夹（几十秒）并重新聚类，体验不可接受。
 *
 * 按 source 隔离：用户在 hcomic 检测后切到 jmcomic 检测，两来源结果互不
 * 覆盖；切回 hcomic 时直接显示缓存结果。
 */
interface MissingChaptersResult {
  /** 同系列组列表（来自 findDuplicateGroups） */
  groups: DuplicateGroup[]
  /** 本次检测分析的漫画总数 */
  totalFetched: number
  /** 拉取失败的页数 */
  skippedPages: number
}

interface MissingChaptersStoreState {
  /** 按来源隔离的检测结果 */
  results: Record<string, MissingChaptersResult>
  /** 设置某来源的检测结果（覆盖式） */
  setResult: (source: string, result: MissingChaptersResult) => void
  /** 清除某来源的检测结果 */
  clearResult: (source: string) => void
  /** 清除所有来源的检测结果 */
  clearAll: () => void
}

export const useMissingChaptersStore = create<MissingChaptersStoreState>((set) => ({
  results: {},
  setResult: (source, result) =>
    set((state) => ({
      results: { ...state.results, [source]: result },
    })),
  clearResult: (source) =>
    set((state) => {
      const next = { ...state.results }
      delete next[source]
      return { results: next }
    }),
  clearAll: () => set({ results: {} }),
}))
