import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ComicInfo, PaginationInfo, SearchResult } from '@shared/types'
import { useSearchCacheStore, createSearchContextKey, type SearchPageCache } from '@/stores/useSearchCacheStore'
import { useSearchPreloader, type SearchFn } from '@/hooks/useSearchPreloader'

/**
 * 集成测试：守护 useSearchPreloader 中 preloadSearchPage 的 signal.aborted 检查（commit 2a1d3b2）。
 *
 * 这是 usePaginatedPreloader.test.tsx 抓不到的 Layer 3 缺口：那里 loadPage 是 vi.fn()，
 * 完全跳过 preloadSearchPage 的真实实现。删掉 signal.aborted 检查这一行，所有 hook 层测试
 * 仍全绿，但本测试必须失败。
 *
 * 组合：真实 useSearchPreloader（含真实 usePaginatedPreloader + 真实 preloadSearchPage）
 *       + 真实 useSearchCacheStore（Zustand，jsdom 可跑）
 *       + mock searchFn（用 deferred 控制 IPC resolve 时机）
 */

const mockComic: ComicInfo = {
  id: 'c1',
  title: 'Test Comic',
  author: '',
  pages: 0,
  category: '',
  tags: [],
  groups: [],
  publish_date: '',
  cover_hash: '',
  comic_source: 'hcomic',
  cover_url: '',
}

const mockPagination: PaginationInfo = {
  currentPage: 1,
  totalPages: 5,
  totalItems: 50,
}

/** 可控 resolve 的 deferred，挂起 IPC 请求直到测试显式 resolve。 */
interface DeferredRequest {
  resolve: (result: SearchResult) => void
  promise: Promise<SearchResult>
}

function createDeferred(): DeferredRequest {
  let resolve!: (result: SearchResult) => void
  const promise = new Promise<SearchResult>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { resolve, promise }
}

interface HookProps {
  query: string
  mode: string
  source: string
  searchTags: string
  currentPage: number
  totalPages: number
  enabled: boolean
  searchFn: SearchFn
  cacheSearchPage: (contextKey: string, page: number, data: SearchPageCache, setCurrent?: boolean) => void
}

/**
 * 渲染真实 useSearchPreloader。所有可变参数走 props，使 rerender 能精确切换 contextKey。
 * cacheSearchPage 用真实 store 作为搬运目标，让测试可断言持久层状态。
 */
function renderSearchPreloader(initialProps: HookProps) {
  return renderHook((props: HookProps) => useSearchPreloader(props), { initialProps })
}

function makeCacheSearchPage() {
  return vi.fn(
    (contextKey: string, page: number, data: SearchPageCache, setCurrent: boolean = false) => {
      useSearchCacheStore.getState().setPage(contextKey, page, data, setCurrent)
    },
  )
}

describe('useSearchPreloader — signal.aborted 检查的集成守护', () => {
  beforeEach(() => {
    // 重置真实 store，避免跨用例污染（沿用 searchCacheStore.test.ts 的隔离模式）。
    useSearchCacheStore.setState({
      contexts: {},
      currentContextKey: null,
      currentPage: 1,
      hasCache: false,
    })
  })

  it('迟到结果不写入中转缓存：contextKey 切换后旧请求 resolve 时 signal.aborted 生效', async () => {
    // 来源 A 的第 2 页预加载请求挂起（currentPage=1 → 候选页 [2,3]，concurrency=2 先抓 2）。
    const deferredPage2 = createDeferred()
    const searchFn = vi.fn(async (...args: Parameters<SearchFn>) => {
      const page = args[2]
      if (page === 2) return deferredPage2.promise
      return { comics: [mockComic], pagination: { ...mockPagination, currentPage: page } }
    })
    const cacheSearchPage = makeCacheSearchPage()

    const { result, rerender } = renderSearchPreloader({
      query: 'test',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      currentPage: 1,
      totalPages: 5,
      enabled: true,
      searchFn,
      cacheSearchPage,
    })

    // 等来源 A 的第 2 页预加载请求发出（在 IPC await 中挂起）。
    await waitFor(() => expect(searchFn).toHaveBeenCalledWith('test', 'keyword', 2, 'hcomic', undefined))

    const contextKeyA = result.current.contextKey

    // 切换到来源 B：contextKey 变化触发 usePaginatedPreloader abort 旧 signal。
    rerender({
      query: 'test',
      mode: 'keyword',
      source: 'nh',
      searchTags: '',
      currentPage: 1,
      totalPages: 5,
      enabled: true,
      searchFn,
      cacheSearchPage,
    })
    // 让 abort effect 提交。
    await act(async () => {
      await Promise.resolve()
    })

    // 来源 A 的迟到请求现在 resolve——此时 signal 已 aborted，preloadSearchPage 必须丢弃结果。
    await act(async () => {
      deferredPage2.resolve({ comics: [mockComic], pagination: { ...mockPagination, currentPage: 2 } })
      await deferredPage2.promise.catch(() => undefined)
      // 让微任务队列排空（abort 检查后的 return 在微任务里）。
      await Promise.resolve()
    })

    // 不变量 1（核心）：直接观察中转缓存 preloadedPagesRef——signal.aborted 检查生效时，
    // 迟到结果禁止写入中转。用 hasPreloaded 绕过 commit-gate（usePaginatedPreloader 的
    // generation 检查会拦截自动 commit，使 store 层断言无法区分"ref 没脏"与"ref 脏了但没搬运"）。
    expect(result.current.hasPreloaded(2, contextKeyA)).toBe(false)

    // contextKey 已正确切换到来源 B。
    const contextKeyB = createSearchContextKey({ query: 'test', mode: 'keyword', source: 'nh', searchTags: '' })
    expect(result.current.contextKey).toBe(contextKeyB)
  })

  it('迟到结果不污染持久缓存：searchCacheStore 不含旧 contextKey 的预加载页', async () => {
    const deferredPage2 = createDeferred()
    const searchFn = vi.fn(async (...args: Parameters<SearchFn>) => {
      const page = args[2]
      if (page === 2) return deferredPage2.promise
      return { comics: [mockComic], pagination: { ...mockPagination, currentPage: page } }
    })
    const cacheSearchPage = makeCacheSearchPage()

    const { result, rerender } = renderSearchPreloader({
      query: 'test',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      currentPage: 1,
      totalPages: 5,
      enabled: true,
      searchFn,
      cacheSearchPage,
    })

    await waitFor(() => expect(searchFn).toHaveBeenCalledWith('test', 'keyword', 2, 'hcomic', undefined))

    const contextKeyA = result.current.contextKey

    // 切换到来源 B。
    rerender({
      query: 'test',
      mode: 'keyword',
      source: 'nh',
      searchTags: '',
      currentPage: 1,
      totalPages: 5,
      enabled: true,
      searchFn,
      cacheSearchPage,
    })

    await act(async () => {
      deferredPage2.resolve({ comics: [mockComic], pagination: { ...mockPagination, currentPage: 2 } })
      await deferredPage2.promise.catch(() => undefined)
      await Promise.resolve()
    })

    // 不变量 2：持久缓存存储中来源 A 的 contextKey 下没有第 2 页。
    // 注：此场景下 commit-gate 也会拦截自动搬运，但若 signal.aborted 失效，
    // 中转层会被脏写（由不变量 1 守护）；持久层是用户感知的最终落点，作为补充断言。
    expect(useSearchCacheStore.getState().hasPage(contextKeyA, 2)).toBe(false)
  })

  it('contextKey 切换时中转缓存被清空：旧 contextKey 的未中断预加载残留被清除', async () => {
    // 来源 A 的第 2 页用 deferred 挂起，先写入 preloadedPagesRef 前控制时机。
    // 此场景验证：正常预加载（未中断）写入中转 → 切换 contextKey → 中转被 clear。
    const deferredPage2 = createDeferred()
    const searchFn = vi.fn(async (...args: Parameters<SearchFn>) => {
      const page = args[2]
      if (page === 2) return deferredPage2.promise
      return { comics: [mockComic], pagination: { ...mockPagination, currentPage: page } }
    })
    const cacheSearchPage = makeCacheSearchPage()

    const { result, rerender } = renderSearchPreloader({
      query: 'test',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      currentPage: 1,
      totalPages: 5,
      enabled: true,
      searchFn,
      cacheSearchPage,
    })

    await waitFor(() => expect(searchFn).toHaveBeenCalledWith('test', 'keyword', 2, 'hcomic', undefined))

    const contextKeyA = result.current.contextKey

    // 切换到来源 B（此时 page 2 仍在 deferred 中挂起，未写入中转缓存）。
    rerender({
      query: 'test',
      mode: 'keyword',
      source: 'nh',
      searchTags: '',
      currentPage: 1,
      totalPages: 5,
      enabled: true,
      searchFn,
      cacheSearchPage,
    })
    await act(async () => {
      await Promise.resolve()
    })

    // 来源 A 的迟到请求 resolve——signal 已 aborted，preloadSearchPage 丢弃结果（不写入中转）。
    await act(async () => {
      deferredPage2.resolve({ comics: [mockComic], pagination: { ...mockPagination, currentPage: 2 } })
      await deferredPage2.promise.catch(() => undefined)
      await Promise.resolve()
    })

    // 不变量 3：中转缓存无 A 的 page 2 条目——双重保护（signal.aborted 丢弃 + contextKey 切换 clear）。
    // 用 hasPreloaded 直接观察中转层，搬运出口 consumePreloaded 因此无操作。
    expect(result.current.hasPreloaded(2, contextKeyA)).toBe(false)
    act(() => {
      result.current.consumePreloaded(2, contextKeyA)
    })
    const callsToA2 = cacheSearchPage.mock.calls.filter(
      (callArgs) => callArgs[0] === contextKeyA && callArgs[1] === 2,
    )
    expect(callsToA2).toHaveLength(0)
    expect(useSearchCacheStore.getState().hasPage(contextKeyA, 2)).toBe(false)
  })

  it('未切换 contextKey 时预加载正常写入：中断逻辑不误伤正常路径', async () => {
    const searchFn = vi.fn().mockResolvedValue({
      comics: [mockComic],
      pagination: { ...mockPagination, currentPage: 2 },
    })
    const cacheSearchPage = makeCacheSearchPage()

    const { result } = renderSearchPreloader({
      query: 'test',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      currentPage: 1,
      totalPages: 5,
      enabled: true,
      searchFn,
      cacheSearchPage,
    })

    // 来源 A 的第 2 页预加载正常 resolve（contextKey 未切换）。
    await waitFor(() => expect(searchFn).toHaveBeenCalledWith('test', 'keyword', 2, 'hcomic', undefined))

    // 等预加载写入中转缓存 + usePaginatedPreloader 触发 commit（commit 在 resolve 后调度）。
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    const contextKeyA = result.current.contextKey
    // 不变量 4：正常路径下，预加载结果经 commit 搬运到持久层。
    expect(useSearchCacheStore.getState().hasPage(contextKeyA, 2)).toBe(true)
  })
})
