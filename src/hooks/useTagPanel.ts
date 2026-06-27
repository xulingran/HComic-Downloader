import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import type { TagListSort } from '@shared/types'
import { useTagList, useFavouriteTags } from './useIpc'

export interface TagItem {
  tag: string
  count: number
}

/** Merge tag list catalog with favourite tags, deduplicating and summing counts. */
function mergeTagSources(listTags: TagItem[], favTags: TagItem[], sort: TagListSort): TagItem[] {
  const merged = new Map<string, number>()
  for (const t of listTags) {
    merged.set(t.tag, t.count)
  }
  for (const t of favTags) {
    merged.set(t.tag, (merged.get(t.tag) ?? 0) + t.count)
  }
  const result = Array.from(merged, ([tag, count]) => ({ tag, count }))
  return result.sort(sort === 'name'
    ? (a, b) => a.tag.localeCompare(b.tag)
    : (a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

const EMPTY_TAGS = { tags: [] as TagItem[], total: 0 }

export interface UseTagPanelResult {
  tags: TagItem[]
  filteredTags: TagItem[]
  loading: boolean
  refreshing: boolean
  keyword: string
  setKeyword: (kw: string) => void
  sort: TagListSort
  setSort: (sort: TagListSort) => void
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
  const [sortState, setSortState] = useState<{ source: string; value: TagListSort }>({
    source,
    value: 'popular',
  })
  const sort = sortState.source === source ? sortState.value : 'popular'
  const setSort = useCallback((value: TagListSort) => {
    setSortState({ source, value })
  }, [source])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const { getTagList, refreshTagList } = useTagList()
  const { getFavouriteTags } = useFavouriteTags()
  // Track previous source for reset detection
  const prevSourceRef = useRef(source)
  const loadedKeyRef = useRef<string | null>(null)
  const requestVersionRef = useRef(0)
  const refreshRunRef = useRef(0)

  // Load tags when panel is first expanded (or source changes)
  useEffect(() => {
    if (!expanded || !enabled) return
    // Reset state when source changes
    const sourceChanged = prevSourceRef.current !== source
    if (sourceChanged) {
      setTags([])
      setSelectedTags([])
      setKeyword('')
      loadedKeyRef.current = null
      prevSourceRef.current = source
    }
    const requestedSort = sort
    const loadKey = `${source}:${requestedSort}`
    if (loadedKeyRef.current === loadKey) return
    loadedKeyRef.current = loadKey
    const requestVersion = ++requestVersionRef.current
    setLoading(true)
    Promise.all([
      getTagList(source, undefined, undefined, undefined, requestedSort).catch(() => EMPTY_TAGS),
      getFavouriteTags(source).catch(() => EMPTY_TAGS),
    ]).then(([listResult, favResult]) => {
      if (requestVersion === requestVersionRef.current) {
        setTags(mergeTagSources(listResult.tags, favResult.tags, requestedSort))
      }
    }).finally(() => {
      if (requestVersion === requestVersionRef.current) {
        setLoading(false)
      }
    })
    return () => {
      if (requestVersion === requestVersionRef.current) {
        requestVersionRef.current += 1
      }
    }
  }, [expanded, source, enabled, sort, getTagList, getFavouriteTags])

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
    const refreshRun = ++refreshRunRef.current
    const requestVersion = ++requestVersionRef.current
    setLoading(false)
    setRefreshing(true)
    try {
      await refreshTagList(source)
      const [listResult, favResult] = await Promise.all([
        getTagList(source, undefined, undefined, undefined, sort).catch(() => EMPTY_TAGS),
        getFavouriteTags(source).catch(() => EMPTY_TAGS),
      ])
      if (requestVersion === requestVersionRef.current) {
        setTags(mergeTagSources(listResult.tags, favResult.tags, sort))
      }
    } catch {
      // Silently handle refresh errors
    } finally {
      if (refreshRun === refreshRunRef.current) {
        setRefreshing(false)
      }
    }
  }, [source, sort, refreshTagList, getTagList, getFavouriteTags])

  return {
    tags,
    filteredTags,
    loading,
    refreshing,
    keyword,
    setKeyword,
    sort,
    setSort,
    selectedTags,
    setSelectedTags,
    toggleTag,
    clearAll,
    refresh,
    expanded,
    setExpanded,
  }
}
