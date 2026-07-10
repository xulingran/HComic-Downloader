import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { AnimatePresence, LayoutGroup } from 'framer-motion'
import { useComicStore } from '../stores/useComicStore'
import { useSearch, useRandom, useConfig, useDownloadProgress, useAuth, useTagListProgress } from '../hooks/useIpc'
import { useDownloadHelper, useChapterProbe } from '../hooks/useDownloadHelper'
import { useBatchDownload, getComicKey } from '../hooks/useBatchDownload'
import { ComicCard } from '../components/common/ComicCard'
import { AnimatedCardWrapper } from '../components/common/AnimatedCardWrapper'
import { Skeleton } from '../components/common/Skeleton'
import { LoadingOverlay } from '../components/common/LoadingOverlay'
import { ChapterDownloadDialog } from '../components/ChapterDownloadDialog'
import { PageJumpDialog } from '../components/common/PageJumpDialog'
import { PaginationControls } from '../components/common/PaginationControls'
import { ErrorDisplay } from '../components/common/ErrorDisplay'
import { EmptyState } from '../components/common/EmptyState'
import { SearchBar } from '../components/SearchBar'
import { BikaCategoryGrid } from '../components/BikaCategoryGrid'
import { NhEntryGrid } from '../components/NhEntryGrid'
import { TagDialog } from '../components/TagDialog'
import { AlbumNameDialog } from '../components/common/AlbumNameDialog'
import { pickAlbumDefaultName } from '../utils/titleSimilarity'
import { PROGRESS_BADGE_STATUSES } from '@shared/types'
import type { ComicInfo, PaginationInfo, SearchResult, SearchSection } from '@shared/types'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useSearchHistory } from '../hooks/useSearchHistory'
import { useDrawerStore } from '../stores/useDrawerStore'
import { useReaderStore } from '../stores/useReaderStore'
import { useSearchCacheStore, createSearchContextKey, type SearchPageCache } from '../stores/useSearchCacheStore'
import { useSearchPreloader } from '../hooks/useSearchPreloader'
import { useDownloadStore } from '../stores/useDownloadStore'
import { sourceSupportsRandom, sourceSupportsTagRecommendation, sourceSupportsTagList, normalizeSourceKey } from '../utils/source'
import type { DownloadProgressData } from '../hooks/useIpc'
import { requiresAuth, isAuthError } from '../utils/auth'
import { sourceLabel } from '../utils/source'
import { useTagPanel } from '../hooks/useTagPanel'


interface SearchPageProps {
  onNavigateToSettings?: () => void
}

// 尚无已加载搜索结果时的容器占位 key。loadedContextKey 为 null 时使用，
// 确保结果容器始终拥有稳定 key（不随实时输入 query 抖动）。
const INITIAL_GRID_KEY = 'initial'

export function SearchPage({ onNavigateToSettings }: SearchPageProps) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('keyword')
  const [source, setSource] = useState('hcomic')
  const [searchTags, setSearchTags] = useState('')
  // NH「仅显示中文」筛选：运行期状态、默认关闭、不持久化（add-nh-chinese-language-filter spec）。
  // 非 NH 来源不应用该筛选——effectiveNhLanguageFilter 仅在 source === 'nh' 时非空。
  const [nhLanguageFilter, setNhLanguageFilter] = useState<'chinese' | undefined>(undefined)
  const [showJumpDialog, setShowJumpDialog] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showAlbumDialog, setShowAlbumDialog] = useState(false)
  const [albumDefaultName, setAlbumDefaultName] = useState('')
  const [chapterDialogComic, setChapterDialogComic] = useState<ComicInfo | null>(null)
  const [showTagDialog, setShowTagDialog] = useState(false)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [viewingCategory, setViewingCategory] = useState(false)
  // viewingNhEntry 真实语义：true = 用户在 NH 入口子功能结果里（NhEntryGrid 网格隐藏，
  // 因为渲染条件是 !viewingNhEntry）；false = 入口页本体（网格显示）。命名与字面相反，
  // 属历史包袱，本变更不重命名以控制改动面。
  const [viewingNhEntry, setViewingNhEntry] = useState(false)
  // showBackToNhEntry 与 viewingNhEntry 解耦：专责控制「返回 NH 入口」按钮显隐（true=显示）。
  // 当前实现两者在所有路径取值相同（镜像同步），拆分价值在语义自释义 + 防御未来回归
  // （viewingNhEntry 名实不符曾导致 handleSearch 误重置按钮）。详见
  // openspec/changes/fix-nh-back-button-persist/design.md 决策 1。
  const [showBackToNhEntry, setShowBackToNhEntry] = useState(false)
  // 加载遮罩强度：light=翻页（旧结果可读），strong=换来源/新查询（旧结果几乎不可辨认）。
  // 由 withLoading 据 keepExisting 派生，handleSourceChange 认证窗口显式标注为 strong。
  // 文案统一「加载中...」（避免与 SearchBar 按钮「搜索中...」撞车），仅靠模糊+不透明度区分。
  const [overlayIntensity, setOverlayIntensity] = useState<'light' | 'strong' | null>(null)
  const { comics, pagination, isLoading, error, setComics, setPagination, setLoading, setError } = useComicStore()
  const { search } = useSearch()
  const { random } = useRandom()
  const { probeChaptersBeforeDownload } = useChapterProbe()
  const { downloadWithConflictCheck, downloadChapters } = useDownloadHelper()
  const { getConfig } = useConfig()
  const { verifyAuth } = useAuth()
  const verifySourceAuth = useCallback(async (src: string): Promise<boolean> => {
    if (!requiresAuth(src)) return true
    try {
      const result = await verifyAuth(src)
      if (!result.valid) {
        // JM 站点人机验证阻断 verifyAuth 时，不能据此判定 Cookie 失效——
        // 收藏夹此时仍可经挑战恢复获取数据，搜索也应放行让挑战恢复机制处理。
        // 否则搜索页会误显示"登录信息已过期"，而收藏夹却正常工作。
        const msg = result.message || ''
        if (src === 'jm' && msg.includes('人机验证')) {
          return true
        }
      }
      return result.valid
    } catch {
      return false
    }
  }, [verifyAuth])
  const {
    batchMode,
    setBatchMode,
    selectedIds,
    toggleSelect,
    selectAll,
    clearSelection,
    handleBatchDownload,
    handleBatchDownloadAsAlbum,
    selectedComics,
  } = useBatchDownload(comics)
  const { cardStyle, tagBlacklist, myTags, filterEnabled, setFilterEnabled } = useSettingsStore()
  const { pendingSearch, clearPendingSearch } = useDrawerStore()
  // clearPendingSearch also used by handleRandom below
  const { openReader } = useReaderStore()
  const { history, add: addHistory, remove: removeHistory, clear: clearHistory } = useSearchHistory()
  const { favouriteTagHighlight, favouriteTagMinMatches } = useSettingsStore()
  const { progress: tagListProgress } = useTagListProgress(source)
  const searchCache = useSearchCacheStore()
  const [sections, setSections] = useState<SearchSection[]>(() => {
    const contextKey = searchCache.currentContextKey
    return (contextKey ? searchCache.getPage(contextKey, searchCache.currentPage)?.sections : undefined) ?? []
  })
  const searchCacheRef = useRef(searchCache)
  searchCacheRef.current = searchCache // eslint-disable-line react-hooks/refs
  const { progress: downloadProgress } = useDownloadProgress()
  const tasks = useDownloadStore((s) => s.tasks)

  // Tag panel hook (manages tags, selection, filtering, loading)
  const tagPanel = useTagPanel(source, sourceSupportsTagList(source))

  const activeDownloadMap = useMemo(() => {
    const map = new Map<string, DownloadProgressData>()
    for (const t of tasks) {
      if (PROGRESS_BADGE_STATUSES.has(t.status)) {
        const p = downloadProgress[t.id]
        if (p) map.set(t.comic.id, p)
      }
    }
    return map
  }, [tasks, downloadProgress])

  const searchGenRef = useRef(0)
  // 记录当前 comics 所属的搜索上下文（query/mode/source/searchTags 的 key）。
  // 用于区分「翻页」（同一 context 换页 → 保留旧结果 + 遮罩）与「新查询」（换 context → 清空 + 骨架）。
  // 同时作为结果容器 gridContainerKey 的来源：仅在搜索真正完成时更新，按键修改未提交的 query 时不变，
  // 避免结果列表整体 remount 引发卡片进出场动画重放（闪烁）。
  const [loadedContextKey, setLoadedContextKey] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const historyDropdownRef = useRef<HTMLDivElement>(null)
  const queryRef = useRef(query)
  queryRef.current = query // eslint-disable-line react-hooks/refs
  const searchTagsRef = useRef(searchTags)
  searchTagsRef.current = searchTags // eslint-disable-line react-hooks/refs
  const modeRef = useRef(mode)
  modeRef.current = mode // eslint-disable-line react-hooks/refs
  const sourceRef = useRef(source)
  sourceRef.current = source // eslint-disable-line react-hooks/refs
  const nhLanguageFilterRef = useRef(nhLanguageFilter)
  nhLanguageFilterRef.current = nhLanguageFilter // eslint-disable-line react-hooks/refs

  // 仅 NH 应用筛选；切换到其他来源时该值为 undefined，确保请求不携带 languageFilter
  const effectiveNhLanguageFilter = source === 'nh' ? nhLanguageFilter : undefined

  // 列表容器 key：派生自「已加载的搜索上下文」（loadedContextKey）+ 当前页码，而非实时输入 query。
  // 仅在真正完成一次搜索后（applySearchResult / handleSearch / pendingSearch effect 等）才变化，
  // 因此用户在搜索栏打字/删除修改未提交的 query 时 key 不变，避免结果列表整体 remount 引发
  // 卡片进出场动画重放（闪烁）。翻页 / 新搜索 / 换来源 / 换 mode 等整页全量替换时 key 仍按预期变化
  // → 整页重挂载，规避 framer-motion `layout` 在 popLayout 全量替换下的 mount 测量竞态（封面从左上角飞入）。
  // cardStyle 切换时 key 不变 → layout 位置过渡照常生效。
  const gridContainerKey = `${loadedContextKey ?? INITIAL_GRID_KEY}:${pagination?.currentPage ?? 1}`

  const cacheSearchPage = useCallback((contextKey: string, page: number, data: SearchPageCache, setCurrent: boolean = true) => {
    searchCacheRef.current.setPage(contextKey, page, data, setCurrent)
  }, [])

  const applySearchResult = useCallback((result: {
    comics: ComicInfo[]
    pagination: PaginationInfo | null
    sections?: SearchSection[]
  }) => {
    setComics(result.comics)
    setPagination(result.pagination)
    setSections(result.sections ?? [])
  }, [setComics, setPagination])

  const clearSearchResult = useCallback(() => {
    setComics([])
    setPagination(null)
    setSections([])
  }, [setComics, setPagination])

  useEffect(() => {
    const cachedContextKey = searchCacheRef.current.currentContextKey
    const cached = cachedContextKey
      ? searchCacheRef.current.getPage(cachedContextKey, searchCacheRef.current.currentPage)
      : undefined
    if (cached) {
      setQuery(cached.query)
      setMode(cached.mode)
      setSource(cached.source)
      setSearchTags(cached.searchTags)
      // 恢复筛选状态：仅 NH 缓存可能携带 languageFilter（其他来源落盘时该字段为空）
      setNhLanguageFilter(cached.source === 'nh' && cached.languageFilter === 'chinese' ? 'chinese' : undefined)
      if (cached.searchTags) {
        const restored = cached.searchTags.split(',').filter(Boolean)
        tagPanel.setSelectedTags(restored)
      }
      applySearchResult(cached)
      // viewingCategory / viewingNhEntry 是本组件局部 state，挂载时会丢失；
      // 这里依据已恢复的 mode/source 同步推导，避免用户从入口页搜索切走再切回后无法返回入口页。
      setViewingCategory(cached.mode === 'category' && cached.source === 'bika')
      // 选项 B（产品确认）：恢复 NH 缓存时，无论 mode 是否 keyword，都视为「在 NH 入口体系内」——
      // viewingNhEntry=true（网格隐藏，保留搜索结果），showBackToNhEntry=true（按钮显示，一键回入口）。
      // 旧逻辑 `cached.mode !== 'keyword'` 会让 keyword 搜索恢复时网格错误重现、按钮消失。
      setViewingNhEntry(cached.source === 'nh')
      setShowBackToNhEntry(cached.source === 'nh')
      return
    }

    let cancelled = false
    let mountedSource = source
    const gen = ++searchGenRef.current
    setLoading(true)
    // 挂载初始化属于新查询语义：若 store 残留旧结果（如从详情页返回），按 strong 档显示遮罩。
    setOverlayIntensity('strong')

    getConfig().then(result => {
      if (cancelled) return
      mountedSource = result.config.defaultSource || source
      sourceRef.current = mountedSource
      if (result.config.defaultSource) {
        setSource(result.config.defaultSource)
      }
      if (mountedSource === 'nh') {
        setQuery('')
        queryRef.current = ''
        setMode('keyword')
        modeRef.current = 'keyword'
        setSearchTags('')
        searchTagsRef.current = ''
        setViewingCategory(false)
        setViewingNhEntry(false)
        setNeedsLogin(false)
        clearSearchResult()
        setError(null)
        return undefined
      }
      if (requiresAuth(mountedSource)) {
        return verifySourceAuth(mountedSource).then(isValid => {
          if (cancelled || gen !== searchGenRef.current) return undefined
          if (!isValid) {
            setNeedsLogin(true)
            return undefined
          }
          // mount effect 仅对非 NH 来源走到此分支（NH 在上方 early-return），
          // 故 languageFilter 必为 undefined；保持 7 参数形式与其他 search 调用对齐。
          return search('', mode, 1, mountedSource, undefined, undefined, undefined)
        })
      }
      return search('', mode, 1, mountedSource, undefined, undefined, undefined)
    }).then(result => {
      if (cancelled || gen !== searchGenRef.current) return
      if (result) {
        applySearchResult(result)
        if (result.sections?.length) {
          const contextKey = createSearchContextKey({
            query: '',
            mode,
            source: mountedSource,
            searchTags: '',
          })
          setLoadedContextKey(contextKey)
          cacheSearchPage(contextKey, 1, {
            query: '',
            mode,
            source: mountedSource,
            searchTags: '',
            comics: result.comics,
            pagination: result.pagination,
            sections: result.sections,
          })
        }
      }
    }).catch(err => {
      if (cancelled || gen !== searchGenRef.current) return
      const msg = err instanceof Error ? err.message : 'Search failed'
      if (isAuthError(err) && requiresAuth(mountedSource)) {
        setNeedsLogin(true)
        return
      }
      setError(msg)
    }).finally(() => {
      if (!cancelled && gen === searchGenRef.current) {
        setLoading(false)
        setOverlayIntensity(null)
      }
    })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!showHistory) return
    const handler = (e: MouseEvent) => {
      if (historyDropdownRef.current?.contains(e.target as Node)) return
      if (inputRef.current?.contains(e.target as Node)) return
      setShowHistory(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showHistory])

  useEffect(() => {
    if (!pendingSearch) return
    const { query: searchQuery, mode: searchMode, append } = pendingSearch

    let finalQuery = queryRef.current
    let finalTags = searchTagsRef.current

    if (append && searchMode === 'tag') {
      const existing = finalTags ? finalTags.split(',') : []
      const deduped = [...new Set([...existing, searchQuery])]
      finalTags = deduped.join(',')
      // Sync selectedTags state
      tagPanel.setSelectedTags(deduped)
    } else if (append) {
      finalQuery = [finalQuery, searchQuery].filter(Boolean).join(' ')
    } else {
      finalQuery = searchQuery
      finalTags = ''
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMode(searchMode)
    }

    setQuery(finalQuery)
    setSearchTags(finalTags)
    clearPendingSearch()

    if (finalQuery.trim() || finalTags) {
      addHistory(finalTags ? `${finalQuery} [${finalTags}]` : finalQuery.trim())
    }
    clearSelection()

    const gen = ++searchGenRef.current
    setLoading(true)
    setError(null)
    // 抽屉/侧栏触发的搜索属于新查询，清空旧结果以触发骨架渲染
    clearSearchResult()
    setLoadedContextKey(null)

    search(
      finalQuery,
      searchMode === 'tag' && !finalQuery ? 'tag' : searchMode,
      1,
      source,
      finalTags,
      true,
      effectiveNhLanguageFilter,
    ).then(result => {
      if (gen !== searchGenRef.current) return
      applySearchResult(result)
      const finalMode = searchMode === 'tag' && !finalQuery ? 'tag' : searchMode
      const contextKey = createSearchContextKey({
        query: finalQuery,
        mode: finalMode,
        source,
        searchTags: finalTags,
        languageFilter: effectiveNhLanguageFilter,
      })
      setLoadedContextKey(contextKey)
      cacheSearchPage(contextKey, result.pagination?.currentPage ?? 1, {
        query: finalQuery,
        mode: finalMode,
        source,
        searchTags: finalTags,
        languageFilter: effectiveNhLanguageFilter,
        comics: result.comics,
        pagination: result.pagination ?? null,
        sections: result.sections,
      })
    }).catch(err => {
      if (gen !== searchGenRef.current) return
      setError(err instanceof Error ? err.message : 'Search failed')
    }).finally(() => {
      if (gen === searchGenRef.current) setLoading(false)
    })
  }, [pendingSearch, clearPendingSearch, source, search, addHistory, clearSelection, setLoading, setError, setQuery, setMode, tagPanel, cacheSearchPage, applySearchResult, clearSearchResult, effectiveNhLanguageFilter])

  // 推荐高亮数据源：用户主动确认的 my_tags（取代旧版被动反推的 favourite_tag_index）。
  // favourite_tag_index 降级为设置页「检测标签」候选池，仅供展示，不再直接驱动高亮。
  const recommendedTags = useMemo(() => {
    if (!favouriteTagHighlight || !sourceSupportsTagRecommendation(source)) return new Set<string>()
    const key = normalizeSourceKey(source)
    return new Set(myTags[key].map(t => t.toLowerCase()))
  }, [favouriteTagHighlight, source, myTags])

  const filteredComics = useMemo(() => {
    const key = normalizeSourceKey(source)
    const blocked = new Set(tagBlacklist[key].map(t => t.toLowerCase()))
    const hasBlockedTags = blocked.size > 0
    return comics.map(c => {
      const isBlocked = filterEnabled && hasBlockedTags && (c.tags?.some(t => blocked.has(t.toLowerCase())) ?? false)
      const matchCount = c.tags?.filter(t => recommendedTags.has(t.toLowerCase())).length ?? 0
      const isRecommended = !isBlocked && recommendedTags.size > 0 && matchCount >= favouriteTagMinMatches
      return { comic: c, isBlocked, isRecommended }
    })
  }, [comics, filterEnabled, tagBlacklist, source, recommendedTags, favouriteTagMinMatches])

  const blockedCount = useMemo(() => filteredComics.filter(f => f.isBlocked).length, [filteredComics])

  const visibleSections = useMemo(() => {
    const comicsById = new Map(filteredComics.map(item => [item.comic.id, item]))
    return sections.map(section => ({
      ...section,
      items: section.comicIds.flatMap(id => {
        const item = comicsById.get(id)
        return item ? [item] : []
      }),
    })).filter(section => section.items.length > 0)
  }, [filteredComics, sections])

  const withLoading = useCallback(async (
    fn: () => Promise<SearchResult>,
    opts: { keepExisting?: boolean; cacheResult?: boolean } = {},
  ) => {
    const gen = ++searchGenRef.current
    setLoading(true)
    setError(null)
    // 遮罩强度：keepExisting=true（翻页）→ light（旧结果可读）；否则 → strong（旧结果将被整页替换）。
    setOverlayIntensity(opts.keepExisting ? 'light' : 'strong')
    // 新查询默认清空当前结果 → 触发骨架渲染（filteredComics.length === 0）。
    // 翻页（keepExisting=true）保留旧结果 → 触发遮罩渲染（filteredComics.length > 0 && isLoading）。
    if (!opts.keepExisting) {
      clearSearchResult()
      setLoadedContextKey(null)
    }
    try {
      const result = await fn()
      if (gen !== searchGenRef.current) return
      setNeedsLogin(false)
      applySearchResult(result)
      if (opts.cacheResult === false) {
        setLoadedContextKey(null)
        return
      }
      const languageFilter = sourceRef.current === 'nh' ? nhLanguageFilterRef.current : undefined
      const contextKey = createSearchContextKey({
        query: queryRef.current,
        mode: modeRef.current,
        source: sourceRef.current,
        searchTags: searchTagsRef.current,
        languageFilter,
      })
      setLoadedContextKey(contextKey)
      cacheSearchPage(contextKey, result.pagination?.currentPage ?? 1, {
        query: queryRef.current,
        mode: modeRef.current,
        source: sourceRef.current,
        searchTags: searchTagsRef.current,
        languageFilter,
        comics: result.comics,
        pagination: result.pagination ?? null,
        sections: result.sections,
      })
    } catch (err) {
      if (gen !== searchGenRef.current) return
      const msg = err instanceof Error ? err.message : 'Request failed'
      if (isAuthError(err) && requiresAuth(sourceRef.current)) {
        setNeedsLogin(true)
        return
      }
      setError(msg)
    } finally {
      if (gen === searchGenRef.current) {
        setLoading(false)
        setOverlayIntensity(null)
      }
    }
  }, [setLoading, setError, cacheSearchPage, applySearchResult, clearSearchResult])

  const handleSearch = useCallback(async (page: number = 1) => {
    if (requiresAuth(source) && needsLogin) return
    clearSelection()
    setShowHistory(false)
    if (query.trim()) {
      addHistory(searchTags ? `${query} [${searchTags}]` : query.trim())
    }
    // 关键修复（fix-nh-back-button-persist）：原此处根据 mode 强行重算 viewingNhEntry，
    // 导致 keyword 搜索把按钮隐藏、入口子功能内的网格语义被破坏。删除后，
    // 关键词搜索、翻页等操作不再触碰 viewingNhEntry / showBackToNhEntry —— 按钮可见性
    // 由进入/退出入口体系的显式动作（handleNh* / handleBackToNhEntry / handleSourceChange /
    // handleRandom）决定。详见 design.md 决策 1 写入规则表。

    // 语言筛选读 ref 而非闭包 effectiveNhLanguageFilter：toggle handler 在同一事件里
    // setNhLanguageFilter 后立即调 handleSearch(1)，闭包值尚未更新，ref 已同步最新值。
    const currentLanguageFilter = sourceRef.current === 'nh' ? nhLanguageFilterRef.current : undefined
    const contextKey = createSearchContextKey({ query, mode, source, searchTags, languageFilter: currentLanguageFilter })
    const cachedPage = searchCacheRef.current.getPage(contextKey, page)
    if (cachedPage) {
      const gen = ++searchGenRef.current
      applySearchResult(cachedPage)
      setError(null)
      setLoadedContextKey(contextKey)
      search(query, mode, page, source, searchTags || undefined, false, currentLanguageFilter).then((result) => {
        if (gen !== searchGenRef.current) return
        applySearchResult(result)
        cacheSearchPage(contextKey, page, {
          query,
          mode,
          source,
          searchTags,
          languageFilter: currentLanguageFilter,
          comics: result.comics,
          pagination: result.pagination ?? null,
          sections: result.sections,
        })
      }).catch((err) => { console.debug('Background search refresh failed:', err) })
      return
    }

    // 区分新查询与翻页：当前 comics 属于同一搜索上下文（仅页码不同）→ 翻页，保留旧结果 + 遮罩；
    // 否则 → 新查询，清空 + 骨架。读取 loadedContextKey state（非 ref）：handleSearch 已依赖
    // query/mode/searchTags 等每次按键都变的 state，本就在按键时重建，多载入 loadedContextKey（仅搜索
    // 完成时变）不增加重建频率，且保证拿到最新值用于翻页/新查询判定。
    const isPaging = loadedContextKey === contextKey
    await withLoading(
      () => search(query, mode, page, source, searchTags || undefined, true, currentLanguageFilter),
      { keepExisting: isPaging },
    )
  }, [source, needsLogin, query, mode, searchTags, loadedContextKey, clearSelection, addHistory, withLoading, search, setError, cacheSearchPage, applySearchResult])

  const handleRandom = async () => {
    if (requiresAuth(source) && needsLogin) return
    clearSelection()
    clearPendingSearch()
    setQuery('')
    setSearchTags('')
    tagPanel.clearAll()
    setShowHistory(false)
    setViewingCategory(false)
    setViewingNhEntry(false)
    setShowBackToNhEntry(false)
    await withLoading(() => random(source), { cacheResult: false })
  }

  const handleBikaCategory = useCallback(async (categoryTitle: string) => {
    clearSelection()
    clearPendingSearch()
    setSearchTags('')
    tagPanel.clearAll()
    setShowHistory(false)
    setMode('category')
    setQuery(categoryTitle)
    queryRef.current = categoryTitle
    modeRef.current = 'category'
    setViewingCategory(true)
    setViewingNhEntry(false)
    await withLoading(() => search(categoryTitle, 'category', 1, 'bika'))
  }, [clearSelection, clearPendingSearch, tagPanel, withLoading, search])

  const handleBackToCategories = useCallback(() => {
    clearSelection()
    setQuery('')
    queryRef.current = ''
    setMode('keyword')
    modeRef.current = 'keyword'
    setViewingCategory(false)
    clearSearchResult()
    setError(null)
  }, [clearSelection, clearSearchResult, setError])

  const handleNhLatest = useCallback(async () => {
    clearSelection()
    clearPendingSearch()
    setSearchTags('')
    searchTagsRef.current = ''
    tagPanel.clearAll()
    setShowHistory(false)
    setMode('keyword')
    modeRef.current = 'keyword'
    setQuery('')
    queryRef.current = ''
    setViewingNhEntry(true)
    setShowBackToNhEntry(true)
    await withLoading(() => search('', 'keyword', 1, 'nh', undefined, undefined, nhLanguageFilterRef.current))
  }, [clearSelection, clearPendingSearch, tagPanel, withLoading, search])

  const handleNhPopular = useCallback(async () => {
    clearSelection()
    clearPendingSearch()
    setSearchTags('')
    searchTagsRef.current = ''
    tagPanel.clearAll()
    setShowHistory(false)
    setMode('ranking')
    modeRef.current = 'ranking'
    setQuery('popular-today')
    queryRef.current = 'popular-today'
    setViewingNhEntry(true)
    setShowBackToNhEntry(true)
    await withLoading(() => search('popular-today', 'ranking', 1, 'nh', undefined, undefined, nhLanguageFilterRef.current))
  }, [clearSelection, clearPendingSearch, tagPanel, withLoading, search])

  const handleNhRankingChange = useCallback(async (sortValue: string) => {
    setQuery(sortValue)
    queryRef.current = sortValue
    setSearchTags('')
    searchTagsRef.current = ''
    setShowBackToNhEntry(true)
    await withLoading(() => search(sortValue, 'ranking', 1, 'nh', undefined, undefined, nhLanguageFilterRef.current))
  }, [withLoading, search])

  const handleNhEntryTag = useCallback(async (tag: string) => {
    clearSelection()
    clearPendingSearch()
    tagPanel.setSelectedTags([tag])
    setSearchTags(tag)
    searchTagsRef.current = tag
    setShowHistory(false)
    setMode('tag')
    modeRef.current = 'tag'
    setQuery(tag)
    queryRef.current = tag
    setViewingNhEntry(true)
    setShowBackToNhEntry(true)
    await withLoading(() => search(tag, 'tag', 1, 'nh', undefined, undefined, nhLanguageFilterRef.current))
  }, [clearSelection, clearPendingSearch, tagPanel, withLoading, search])

  const handleBackToNhEntry = useCallback(() => {
    clearSelection()
    setQuery('')
    queryRef.current = ''
    setSearchTags('')
    searchTagsRef.current = ''
    tagPanel.clearAll()
    setMode('keyword')
    modeRef.current = 'keyword'
    setViewingNhEntry(false)
    setShowBackToNhEntry(false)
    clearSearchResult()
    setError(null)
  }, [clearSelection, tagPanel, clearSearchResult, setError])

  // NH「仅显示中文」开关（add-nh-chinese-language-filter spec）。
  // 入口页本体（!viewingNhEntry 即网格显示中）：只更新状态不请求，下一次显式入口动作才应用筛选。
  // 已有结果（viewingNhEntry=true 或 comics 非空）：清除批量选择并从第 1 页重新搜索。
  const handleNhLanguageFilterToggle = useCallback((next: boolean) => {
    const nextFilter = next ? ('chinese' as const) : undefined
    setNhLanguageFilter(nextFilter)
    nhLanguageFilterRef.current = nextFilter
    // 入口页本体：无可见结果，遵循「禁止自动内容请求」的入口页契约
    if (!viewingNhEntry && comics.length === 0) return
    clearSelection()
    // 复用 handleSearch 的「新查询 vs 翻页」判定：切换筛选会生成新 contextKey（因 languageFilter
    // 参与 key），因此 isPaging=false，触发清空 + 骨架。直接调 handleSearch(1) 即可。
    handleSearch(1)
  }, [viewingNhEntry, comics.length, clearSelection, handleSearch])

  const handleSourceChange = async (newSource: string) => {
    setSource(newSource)
    sourceRef.current = newSource
    setSearchTags('')
    searchTagsRef.current = ''
    tagPanel.clearAll()
    clearSelection()
    setShowHistory(false)
    setNeedsLogin(false)
    setViewingCategory(false)
    setViewingNhEntry(false)
    setShowBackToNhEntry(false)
    if (newSource === 'nh') {
      setQuery('')
      queryRef.current = ''
      setMode('keyword')
      modeRef.current = 'keyword'
      clearSearchResult()
      setError(null)
      setLoading(false)
      setOverlayIntensity(null)
      return
    }
    if (newSource === 'jm') {
      setMode('keyword')
      modeRef.current = 'keyword'
    }
    if (newSource === 'copymanga' && mode === 'ranking') {
      setQuery('hot')
      queryRef.current = 'hot'
    } else if (newSource === 'bika' && mode === 'ranking') {
      setQuery('H24')
      queryRef.current = 'H24'
    } else {
      setQuery('')
      queryRef.current = ''
    }
    if (requiresAuth(newSource)) {
      setLoading(true)
      // 认证校验窗口：旧结果仍在，按"整页替换前奏"标注为 strong（重模糊）。
      setOverlayIntensity('strong')
      const isValid = await verifySourceAuth(newSource)
      if (sourceRef.current !== newSource) return
      setLoading(false)
      setOverlayIntensity(null)
      if (!isValid) {
        setNeedsLogin(true)
        return
      }
      if (newSource === 'jm') {
        withLoading(() => search('', 'keyword', 1, 'jm', undefined, true, undefined))
      } else {
        withLoading(() => random(newSource))
      }
    } else if (newSource === 'bika') {
      clearSearchResult()
    } else {
      withLoading(() => search('', mode, 1, newSource, undefined, undefined, undefined))
    }
  }

  // 打开弹窗时才提取默认名（而非 useMemo 预算）：保证日志在"即将展示给用户"
  // 的诊断点输出，且能拿到 selectedComics() 跨页缓存的最新数据。
  const handleBatchDownloadAsAlbumClick = useCallback(() => {
    const titles = selectedComics().map(c => c.title)
    setAlbumDefaultName(pickAlbumDefaultName(titles, selectedIds.size))
    setShowAlbumDialog(true)
  }, [selectedComics, selectedIds.size])

  const handleAlbumNameConfirm = useCallback(async (albumName: string) => {
    setShowAlbumDialog(false)
    await handleBatchDownloadAsAlbum(albumName)
  }, [handleBatchDownloadAsAlbum])

  const handleAlbumNameCancel = useCallback(() => {
    setShowAlbumDialog(false)
  }, [])

  const handleOpenReader = (comic: ComicInfo) => {
    openReader(comic)
  }

  const handleDownload = async (comic: ComicInfo) => {
    const enriched = await probeChaptersBeforeDownload(comic)
    if (enriched) {
      setChapterDialogComic(enriched)
      return
    }
    await downloadWithConflictCheck(comic)
  }

  const renderComicItem = (
    { comic, isBlocked, isRecommended }: (typeof filteredComics)[number],
    index: number,
    keyPrefix: string = '',
  ) => (
    <AnimatedCardWrapper key={`${keyPrefix}${getComicKey(comic)}`} index={index}>
      {isBlocked ? (
        <BlockedPlaceholder comic={comic} cardStyle={cardStyle} />
      ) : (
        <ComicCard
          comic={comic}
          onOpenReader={handleOpenReader}
          batchMode={batchMode}
          selected={selectedIds.has(getComicKey(comic))}
          onToggleSelect={toggleSelect}
          onDownload={handleDownload}
          isRecommended={isRecommended}
          recommendedTags={recommendedTags}
          activeDownload={activeDownloadMap.get(comic.id)}
          onTagClick={sourceSupportsTagList(source) ? handleToggleTag : undefined}
        />
      )}
    </AnimatedCardWrapper>
  )

  // 预加载链路已抽到 useSearchPreloader：preloadSearchPage（含 signal.aborted 检查）、
  // consumePreloaded（中转 → 持久层搬运）、hasPage、usePaginatedPreloader 装配均在 hook 内。
  // signal.aborted 检查这一行由 useSearchPreloader.test.tsx 集成测试守护（commit 2a1d3b2）。
  // cacheSearchPage 作为搬运注入点传入；contextKey 由各搜索流程内部 createSearchContextKey 局部计算。
  useSearchPreloader({
    query,
    mode,
    source,
    searchTags,
    languageFilter: effectiveNhLanguageFilter,
    searchFn: search,
    currentPage: pagination?.currentPage ?? 1,
    totalPages: pagination?.totalPages ?? 1,
    enabled: !needsLogin && !isLoading && Boolean(pagination && pagination.totalPages > 1),
    sfwMode: useSettingsStore((s) => s.sfwMode),
    cacheSearchPage,
  })

  const isLoadingRef = useRef(isLoading)
  isLoadingRef.current = isLoading // eslint-disable-line react-hooks/refs

  // Tag toggle: update selected tags + immediately trigger search
  const handleToggleTag = useCallback((tag: string) => {
    const newSelectedTags = tagPanel.toggleTag(tag)
    const newSearchTags = newSelectedTags.join(',')
    setSearchTags(newSearchTags)
    searchTagsRef.current = newSearchTags
    const isNhTagSearch = sourceRef.current === 'nh'
    if (isNhTagSearch) {
      setQuery('')
      queryRef.current = ''
      setMode('tag')
      modeRef.current = 'tag'
    }
    // Trigger search immediately with the NEW tags value (skip if already loading)
    if (!isLoadingRef.current) {
      clearSelection()
      setViewingNhEntry(isNhTagSearch)
      setShowBackToNhEntry(isNhTagSearch)
      withLoading(() => search(
        isNhTagSearch ? '' : queryRef.current,
        isNhTagSearch ? 'tag' : modeRef.current,
        1,
        sourceRef.current,
        newSearchTags || undefined,
        // 用户主动切换标签触发的搜索，JM 来源遇挑战时应能触发恢复
        true,
        // 语言筛选仅对 NH 生效（add-nh-chinese-language-filter spec）：切换到非 NH 来源时
        // nhLanguageFilterRef 仍保留状态以便切回 NH 恢复，但此处必须加来源守卫，
        // 否则非 NH 标签搜索会携带残留筛选触发主进程跨来源拒绝。
        sourceRef.current === 'nh' ? nhLanguageFilterRef.current : undefined,
      ))
    }
  }, [tagPanel, withLoading, search, clearSelection])

  const handleClearAllTags = useCallback(() => {
    tagPanel.clearAll()
    setSearchTags('')
    searchTagsRef.current = ''
    const isNhTagSearch = sourceRef.current === 'nh'
    if (isNhTagSearch) {
      setQuery('')
      queryRef.current = ''
      setMode('tag')
      modeRef.current = 'tag'
    }
    // Trigger search immediately with cleared tags (skip if already loading)
    if (!isLoadingRef.current) {
      clearSelection()
      setViewingNhEntry(isNhTagSearch)
      setShowBackToNhEntry(isNhTagSearch)
      withLoading(() => search(
        isNhTagSearch ? '' : queryRef.current,
        isNhTagSearch ? 'tag' : modeRef.current,
        1,
        sourceRef.current,
        undefined,
        // 用户主动清除标签触发的搜索，JM 来源遇挑战时应能触发恢复（与 handleToggleTag 一致）
        true,
        // 语言筛选来源守卫同 handleToggleTag
        sourceRef.current === 'nh' ? nhLanguageFilterRef.current : undefined,
      ))
    }
  }, [tagPanel, withLoading, search, clearSelection])

  return (
    <div className="space-y-3">
      <SearchBar
        source={source}
        onSourceChange={handleSourceChange}
        mode={mode}
        onModeChange={(newMode: string) => {
          setMode(newMode)
          if (newMode === 'ranking' && source === 'copymanga' && !query) {
            setQuery('hot')
            queryRef.current = 'hot'
          }
          if (newMode === 'ranking' && source === 'bika' && !query) {
            setQuery('H24')
            queryRef.current = 'H24'
          }
          if (newMode === 'ranking' && source === 'nh' && !query) {
            setQuery('popular-today')
            queryRef.current = 'popular-today'
          }
        }}
        query={query}
        onQueryChange={setQuery}
        isLoading={isLoading}
        onSearch={() => handleSearch()}
        onRandom={handleRandom}
        showRandom={sourceSupportsRandom(source)}
        showHistory={showHistory}
        onShowHistoryChange={setShowHistory}
        history={history}
        onClearHistory={clearHistory}
        onRemoveHistory={removeHistory}
        onSelectHistory={setQuery}
        inputRef={inputRef}
        historyDropdownRef={historyDropdownRef}
        hasFilterEnabled={filterEnabled}
        onFilterToggle={() => setFilterEnabled(!filterEnabled)}
        hasBlacklistedTags={tagBlacklist[normalizeSourceKey(source)].length > 0}
        nhLanguageFilter={nhLanguageFilter}
        onNhLanguageFilterChange={handleNhLanguageFilterToggle}
        pagination={pagination}
        blockedCount={blockedCount}
        hasComics={comics.length > 0}
        batchMode={batchMode}
        selectedCount={selectedIds.size}
        onToggleBatchMode={setBatchMode}
        onSelectAll={() => selectAll(comics)}
        onClearSelection={clearSelection}
        onBatchDownload={handleBatchDownload}
        onBatchDownloadAsAlbum={handleBatchDownloadAsAlbumClick}
        onPageJump={() => setShowJumpDialog(true)}
        onPageNavigate={handleSearch}
        // Tag panel
        showTagPanel={sourceSupportsTagList(source)}
        onTagPanelToggle={() => {
          tagPanel.setExpanded(true)
          setShowTagDialog(true)
        }}
        selectedTags={tagPanel.selectedTags}
        onNhRankingChange={handleNhRankingChange}
      />

      {/* Tag dialog */}
      <TagDialog
        open={showTagDialog}
        onClose={() => setShowTagDialog(false)}
        loading={tagPanel.loading}
        refreshing={tagPanel.refreshing}
        filteredTags={tagPanel.filteredTags}
        selectedTags={tagPanel.selectedTags}
        tagKeyword={tagPanel.keyword}
        onTagKeywordChange={tagPanel.setKeyword}
        sort={tagPanel.sort}
        onSortChange={tagPanel.setSort}
        onToggleTag={handleToggleTag}
        onClearAllTags={handleClearAllTags}
        onRefreshTags={tagPanel.refresh}
        refreshProgress={tagListProgress}
      />

      <ErrorDisplay message={error} onRetry={error ? () => handleSearch() : undefined} />

      {!isLoading && needsLogin && requiresAuth(source) && (
        <div className="text-center py-12">
          <div className="text-[var(--text-secondary)] mb-4">{sourceLabel(source)} 登录信息已过期或未配置，请前往设置页面重新登录</div>
          {onNavigateToSettings && (
            <button
              onClick={onNavigateToSettings}
              className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 transition-colors text-sm"
            >
              前往设置
            </button>
          )}
        </div>
      )}

      {viewingCategory && source === 'bika' && !isLoading && (
        <button
          onClick={handleBackToCategories}
          className="flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回分类
        </button>
      )}

      {showBackToNhEntry && source === 'nh' && !isLoading && (
        <button
          onClick={handleBackToNhEntry}
          className="flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回 NH 入口
        </button>
      )}

      {/* 变更 5：搜索中且无结果时显示骨架网格，替代空白等待 */}
      {isLoading && !needsLogin && filteredComics.length === 0 && (
        <div className={cardStyle === 'detailed'
          ? 'flex flex-col bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden'
          : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3'
        }>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-[var(--bg-primary)] rounded-xl overflow-hidden">
              <Skeleton variant="rect" className="aspect-[6/7] w-full" />
              <div className="p-2 space-y-1.5">
                <Skeleton variant="text" className="h-3 w-3/4" />
                <Skeleton variant="text" className="h-2.5 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!needsLogin && filteredComics.length > 0 && (
        <div className="relative">
          <LayoutGroup>
            <AnimatePresence mode="popLayout">
              {visibleSections.length > 0 ? (
                <div key={`${gridContainerKey}:sections`} data-grid-key={`${gridContainerKey}:sections`} className="space-y-6">
                  {visibleSections.map((section, sectionIndex) => (
                    <section key={`${sectionIndex}:${section.title}`} aria-labelledby={`jm-section-${sectionIndex}`}>
                      <h2 id={`jm-section-${sectionIndex}`} className="mb-3 text-base font-semibold text-[var(--text-primary)]">
                        {section.title}
                      </h2>
                      <div className={cardStyle === 'detailed'
                        ? 'flex flex-col bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden'
                        : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3'
                      }>
                        {section.items.map((item, index) => renderComicItem(item, index, `${sectionIndex}:`))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div key={gridContainerKey} data-grid-key={gridContainerKey} className={cardStyle === 'detailed'
                  ? 'flex flex-col bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden'
                  : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3'
                }>
                  {filteredComics.map((item, index) => renderComicItem(item, index))}
                </div>
              )}
            </AnimatePresence>
          </LayoutGroup>

          {/* 加载遮罩：保留旧结果，仅在 isLoading 且仍有旧结果时显示。
              强度由 overlayIntensity 决定：light=翻页（旧结果基本不可辨认），strong=换来源/新查询（几乎完全遮蔽）。
              统一 LoadingOverlay 组件：spinner + 辅助文案「加载中...」（与 SearchBar 按钮「搜索中...」区分）。 */}
          {isLoading && overlayIntensity && (
            <LoadingOverlay intensity={overlayIntensity} />
          )}
        </div>
      )}

      {!isLoading && !needsLogin && pagination && pagination.totalPages > 1 && (
        <div className="flex justify-center">
          <PaginationControls
            currentPage={pagination.currentPage}
            totalPages={pagination.totalPages}
            onNavigate={handleSearch}
            onJumpClick={() => setShowJumpDialog(true)}
          />
        </div>
      )}

      {/* ── Album name dialog ── */}
      <AlbumNameDialog
        isOpen={showAlbumDialog}
        defaultName={albumDefaultName}
        comicCount={selectedIds.size}
        onConfirm={handleAlbumNameConfirm}
        onCancel={handleAlbumNameCancel}
      />

      {/* ── Page jump dialog ── */}
      {showJumpDialog && (
        <PageJumpDialog
          totalPages={pagination?.totalPages || 1}
          onJump={(page) => { handleSearch(page); setShowJumpDialog(false) }}
          onClose={() => setShowJumpDialog(false)}
        />
      )}

      {/* ── Chapter download dialog ── */}
      {chapterDialogComic && (
        <ChapterDownloadDialog
          chapters={chapterDialogComic.chapters ?? []}
          open={chapterDialogComic !== null}
          onConfirm={(ids) => {
            const comic = chapterDialogComic
            setChapterDialogComic(null)
            if (comic) downloadChapters(comic, ids)
          }}
          onCancel={() => setChapterDialogComic(null)}
        />
      )}

      {!isLoading && !needsLogin && source === 'bika' && comics.length === 0 && !viewingCategory && !error && (
        <BikaCategoryGrid onSelectCategory={handleBikaCategory} />
      )}

      {!isLoading && !needsLogin && source === 'nh' && comics.length === 0 && !viewingNhEntry && !error && (
        <NhEntryGrid onLatest={handleNhLatest} onPopular={handleNhPopular} onSelectTag={handleNhEntryTag} />
      )}

      {!isLoading && !needsLogin && comics.length === 0 && !(
        (source === 'bika' && !viewingCategory && !error)
        || (source === 'nh' && !viewingNhEntry && !error)
      ) && <EmptyState message="暂无搜索结果" />}

      {!isLoading && !needsLogin && comics.length > 0 && blockedCount === comics.length && <EmptyState message="所有结果均已被标签过滤" />}
    </div>
  )
}

function BlockedPlaceholder({ comic, cardStyle }: { comic: ComicInfo; cardStyle: string }) {
  const { openDrawer } = useDrawerStore()

  if (cardStyle === 'detailed') {
    return (
      <div className="flex items-center px-4 py-2.5 border-b border-[var(--border)] opacity-50">
        <div className="w-14 h-14 bg-[var(--bg-secondary)] flex-shrink-0 rounded-md flex items-center justify-center text-[var(--text-secondary)]">
          🚫
        </div>
        <div className="flex-1 min-w-0 ml-3">
          <h3
            onClick={(e) => { e.stopPropagation(); openDrawer(comic) }}
            className="text-sm font-medium text-[var(--text-secondary)] cursor-pointer line-through truncate"
            title={comic.title}
          >
            {comic.title}
          </h3>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden opacity-50">
      <div className="aspect-[6/7] bg-[var(--bg-secondary)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-1 text-[var(--text-secondary)]">
          <span className="text-2xl">🚫</span>
          <span className="text-xs">已屏蔽</span>
        </div>
      </div>
      {/* 内容区结构（padding / 标题 min-h / 作者占位行）必须与 CoverCard 对齐，
          否则屏蔽卡片会比同行正常卡片矮一行，破坏网格行对齐。
          占位行仅占高度，不渲染作者文字（屏蔽卡片是简化占位符）。 */}
      <div className="p-2">
        <h3
          onClick={(e) => { e.stopPropagation(); openDrawer(comic) }}
          className="text-sm font-medium text-[var(--text-secondary)] cursor-pointer line-clamp-2 min-h-[2.5rem] line-through"
          title={comic.title}
        >
          {comic.title}
        </h3>
        <p className="text-xs text-[var(--text-secondary)] mt-0.5 h-4 truncate select-none">
          {'\u00A0'}
        </p>
      </div>
    </div>
  )
}
