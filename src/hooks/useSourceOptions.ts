import { useMemo } from 'react'
import { COMIC_SOURCES, SEARCH_MODES, SOURCE_LABELS } from '@shared/types'

interface Option {
  value: string
  label: string
}

const SEARCH_MODE_LABELS: Record<string, string> = {
  keyword: '关键词',
  author: '作者',
  tag: 'Tag',
  ranking: '排行',
}

const RANKING_OPTIONS_LIST = [
  '日更新', '周更新', '月更新', '总更新',
  '日点击', '周点击', '月点击', '总点击',
  '日评分', '周评分', '月评分', '总评分',
  '日收藏', '周收藏', '月收藏', '总收藏',
]

const COPYMANGA_CATEGORY_OPTIONS = [
  { value: 'hot', label: '热门更新' },
  { value: 'popular', label: '人气排行' },
  { value: 'recommend', label: '漫画推荐' },
  { value: 'newest', label: '全新上架' },
]

/** 返回带标签的来源列表 */
export function useSources(): Option[] {
  return useMemo(() =>
    COMIC_SOURCES.map(s => ({ value: s, label: SOURCE_LABELS[s] })),
  [])
}

/** 返回带标签的搜索模式列表 */
export function useSearchModes(): Option[] {
  return useMemo(() =>
    SEARCH_MODES.map(m => ({ value: m, label: SEARCH_MODE_LABELS[m] ?? m })),
  [])
}

/** 返回带标签的排行选项列表 */
export function useRankingOptions(): Option[] {
  return useMemo(() =>
    RANKING_OPTIONS_LIST.map(r => ({ value: r, label: r })),
  [])
}

/** 返回拷贝漫画分类选项列表 */
export function useCopymangaCategories(): Option[] {
  return useMemo(() => COPYMANGA_CATEGORY_OPTIONS, [])
}
