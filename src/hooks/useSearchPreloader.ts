import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { SearchResult } from '@shared/types'
import { usePaginatedPreloader, type PreloadReason } from './usePaginatedPreloader'
import {
  createSearchContextKey,
  useSearchCacheStore,
  type SearchPageCache,
} from '../stores/useSearchCacheStore'

/**
 * 预加载搜索页的 IPC 函数签名（与 useIpc().search 对齐）。
 * 抽为独立类型以便集成测试用 deferred mock 替换，而不必引入完整 useIpc 依赖。
 */
export type SearchFn = (
  query: string,
  mode: string,
  page: number,
  source?: string,
  tag?: string,
) => Promise<SearchResult>

/**
 * 把预加载中转结果搬运到持久缓存（useSearchCacheStore）的注入点。
 * 搜索主流程的主动写入与缓存恢复仍由 SearchPage 直接操作 store，
 * 此函数作为 hook 与外部的唯一搬运契约（setCurrent=false 表示不切换当前页）。
 */
export type CacheSearchPageFn = (
  contextKey: string,
  page: number,
  data: SearchPageCache,
  setCurrent?: boolean,
) => void

interface UseSearchPreloaderArgs {
  /** 搜索上下文四元组；hook 内部用 ref 同步，避免 preloadSearchPage 读到陈旧闭包值。 */
  query: string
  mode: string
  source: string
  searchTags: string
  /** 唯一外部依赖：真实 IPC 边界（生产）/ deferred mock（集成测试）。 */
  searchFn: SearchFn
  /** 决定预加载是否触发及候选页范围。 */
  currentPage: number
  totalPages: number
  /** needsLogin / isLoading 等抑制条件归并为此开关。 */
  enabled: boolean
  /** 中转 → 持久缓存的搬运注入点（来自 SearchPage 的 cacheSearchPage wrapper）。 */
  cacheSearchPage: CacheSearchPageFn
}

interface UseSearchPreloaderResult {
  /** hook 内部计算的 contextKey；与 SearchPage 的 searchContextKey 输入相同，输出必然一致。 */
  contextKey: string
  /** 查持久缓存是否已有某页（供 usePaginatedPreloader 的 hasPage 使用）。 */
  hasPage: (page: number) => boolean
  /**
   * 查中转缓存（preloadedPagesRef）是否已有某页的预加载结果。
   *
   * 与 hasPage（查持久层）的区别：hasPreloaded 查的是 IPC 已返回、尚未 commit 的中转数据。
   * 若 signal.aborted 检查生效，迟到结果不会写入中转，hasPreloaded 返回 false；
   * 若该检查失效，迟到结果会脏写中转，hasPreloaded 返回 true。
   * 这使集成测试能直接守护 signal.aborted 检查，而非依赖更外层的 commit-gate。
   */
  hasPreloaded: (page: number, contextKey: string) => boolean
  /**
   * 消费预加载中转结果：把 preloadedPagesRef 中对应条目搬到持久缓存。
   * 若对应条目不存在（迟到结果被 signal.aborted 丢弃、或已被 clear），则静默返回。
   * 这是中转 → 持久层的唯一搬运路径。
   */
  consumePreloaded: (page: number, contextKey: string) => void
}

/**
 * 搜索页预加载链路的独立可挂载单元。
 *
 * 承载切源中断机制的最后一道闸：preloadSearchPage 在 IPC await 之后、写 preloadedPagesRef
 * 之前检查 signal.aborted。这一行是 commit 2a1d3b2 的核心修复，由本 hook 的集成测试守护。
 *
 * 边界（S1 薄包装）：内化 preloadedPagesRef + preloadSearchPage + consumePreloaded + clear
 * effect + hasPage + usePaginatedPreloader 装配。不内化 searchContextKey 的外部计算、
 * useSearchCacheStore 的直接读写、cacheSearchPage wrapper——它们由 SearchPage 持有，
 * 因 9 处非预加载用途共享同一 store。
 */
export function useSearchPreloader({
  query,
  mode,
  source,
  searchTags,
  searchFn,
  currentPage,
  totalPages,
  enabled,
  cacheSearchPage,
}: UseSearchPreloaderArgs): UseSearchPreloaderResult {
  // 4 个上下文 ref：渲染期同步，供 preloadSearchPage 在异步 await 之后读到最新值。
  // 这组 ref 与 SearchPage 外部的同名 ref 独立但同源（都来自组件 state），渲染结束时必然一致。
  const queryRef = useRef(query)
  queryRef.current = query // eslint-disable-line react-hooks/refs
  const modeRef = useRef(mode)
  modeRef.current = mode // eslint-disable-line react-hooks/refs
  const sourceRef = useRef(source)
  sourceRef.current = source // eslint-disable-line react-hooks/refs
  const searchTagsRef = useRef(searchTags)
  searchTagsRef.current = searchTags // eslint-disable-line react-hooks/refs

  // 预加载临时中转缓存：preloadSearchPage 写入，consumePreloaded 读取并搬运到持久层。
  const preloadedPagesRef = useRef(new Map<string, SearchPageCache>())

  const contextKey = useMemo(
    () => createSearchContextKey({ query, mode, source, searchTags }),
    [query, mode, source, searchTags],
  )

  // 持久缓存读取：hasPage / getPage 经 store ref 调用，避免闭包陈旧。
  const searchCache = useSearchCacheStore()
  const searchCacheRef = useRef(searchCache)
  searchCacheRef.current = searchCache // eslint-disable-line react-hooks/refs

  const preloadSearchPage = useCallback(
    async (page: number, _reason: PreloadReason, signal: AbortSignal) => {
      const pageContextKey = createSearchContextKey({
        query: queryRef.current,
        mode: modeRef.current,
        source: sourceRef.current,
        searchTags: searchTagsRef.current,
      })
      const result = await searchFn(
        queryRef.current,
        modeRef.current,
        page,
        sourceRef.current,
        searchTagsRef.current || undefined,
      )
      // 切换来源/查询词/模式/标签后旧 contextKey 的迟到结果必须丢弃，避免脏写。
      // 这一行是切源中断机制的最后一道闸（commit 2a1d3b2），由本 hook 的集成测试守护。
      if (signal.aborted) return
      preloadedPagesRef.current.set(`${pageContextKey}:${page}`, {
        query: queryRef.current,
        mode: modeRef.current,
        source: sourceRef.current,
        searchTags: searchTagsRef.current,
        comics: result.comics,
        pagination: result.pagination ?? null,
      })
    },
    [searchFn],
  )

  const consumePreloaded = useCallback(
    (page: number, pageContextKey: string) => {
      const requestKey = `${pageContextKey}:${page}`
      const cached = preloadedPagesRef.current.get(requestKey)
      if (!cached) return
      preloadedPagesRef.current.delete(requestKey)
      cacheSearchPage(pageContextKey, page, cached, false)
    },
    [cacheSearchPage],
  )

  // contextKey 变化时清空中转缓存，防止旧 contextKey 的残留数据被新 contextKey 的 commit 误搬运。
  // 注意：usePaginatedPreloader 内部也会在 contextKey 变化时 abort + clear inFlight，这里是其补充。
  useEffect(() => {
    preloadedPagesRef.current.clear()
  }, [contextKey])

  const hasPage = useCallback(
    (page: number) => searchCacheRef.current.hasPage(contextKey, page),
    [contextKey],
  )

  const hasPreloaded = useCallback(
    (page: number, pageContextKey: string) =>
      preloadedPagesRef.current.has(`${pageContextKey}:${page}`),
    [],
  )

  usePaginatedPreloader({
    currentPage,
    totalPages,
    contextKey,
    enabled,
    hasPage,
    loadPage: preloadSearchPage,
    commitPage: consumePreloaded,
  })

  return { contextKey, hasPage, hasPreloaded, consumePreloaded }
}
