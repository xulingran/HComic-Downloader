import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useTagList, useFavouriteTags } from './useIpc'

export interface TagItem {
  tag: string
  count: number
}

/** Merge tag list catalog with favourite tags, deduplicating and summing counts. */
export function mergeTagSources(listTags: TagItem[], favTags: TagItem[]): TagItem[] {
  const merged = new Map<string, number>()
  for (const t of listTags) {
    merged.set(t.tag, t.count)
  }
  for (const t of favTags) {
    merged.set(t.tag, (merged.get(t.tag) ?? 0) + t.count)
  }
  return Array.from(merged, ([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

const EMPTY_TAGS = { tags: [] as TagItem[], total: 0 }

export interface UseTagPanelResult {
  tags: TagItem[]
  filteredTags: TagItem[]
  loading: boolean
  refreshing: boolean
  keyword: string
  setKeyword: (kw: string) => void
  selectedTags: string[]
  setSelectedTags: (tags: string[]) => void
  toggleTag: (tag: string) => string[]
  clearAll: () => void
  refresh: () => Promise<void>
  expanded: boolean
  setExpanded: (v: boolean) => void
}

/**
 * Manages tag panel state: loading, filtering, selection.
 * @param source Current comic source key
 * @param enabled Whether tag list is supported for this source
 */
export function useTagPanel(source: string, enabled: boolean): UseTagPanelResult {
  const [expanded, setExpanded] = useState(false)
  const [tags, setTags] = useState<TagItem[]>([])
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const { getTagList, refreshTagList } = useTagList()
  const { getFavouriteTags } = useFavouriteTags()
  // Track previous source for reset detection
  const prevSourceRef = useRef(source)
  const loadedSourceRef = useRef<string | null>(null)

  // Load tags when panel is first expanded (or source changes)
  useEffect(() => {
    if (!expanded || !enabled) return
    // Reset state when source changes
    if (prevSourceRef.current !== source) {
      setTags([])
      setSelectedTags([])
      setKeyword('')
      loadedSourceRef.current = null
      prevSourceRef.current = source
    }
    if (loadedSourceRef.current === source) return
    loadedSourceRef.current = source
    setLoading(true)
    Promise.all([
      getTagList(source).catch(() => EMPTY_TAGS),
      getFavouriteTags(source).catch(() => EMPTY_TAGS),
    ]).then(([listResult, favResult]) => {
      setTags(mergeTagSources(listResult.tags, favResult.tags))
    }).finally(() => {
      setLoading(false)
    })
  }, [expanded, source, enabled, getTagList, getFavouriteTags])

  const filteredTags = useMemo(() => {
    if (!keyword.trim()) return tags
    const kw = keyword.trim().toLowerCase()
    return tags.filter(t => t.tag.toLowerCase().includes(kw))
  }, [tags, keyword])

  const toggleTag = useCallback((tag: string): string[] => {
    const next = selectedTags.includes(tag)
      ? selectedTags.filter(t => t !== tag)
      : [...selectedTags, tag]
    setSelectedTags(next)
    return next
  }, [selectedTags])

  const clearAll = useCallback(() => {
    setSelectedTags([])
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refreshTagList(source)
      const [listResult, favResult] = await Promise.all([
        getTagList(source).catch(() => EMPTY_TAGS),
        getFavouriteTags(source).catch(() => EMPTY_TAGS),
      ])
      setTags(mergeTagSources(listResult.tags, favResult.tags))
    } catch {
      // Silently handle refresh errors
    } finally {
      setRefreshing(false)
    }
  }, [source, refreshTagList, getTagList, getFavouriteTags])

  return {
    tags,
    filteredTags,
    loading,
    refreshing,
    keyword,
    setKeyword,
    selectedTags,
    setSelectedTags,
    toggleTag,
    clearAll,
    refresh,
    expanded,
    setExpanded,
  }
}
