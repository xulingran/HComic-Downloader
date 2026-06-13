# 列表分页预载 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为搜索、收藏夹和阅读历史等用户可翻页列表增加前后各两页的后台预载，并在缓存命中时先显示缓存再后台刷新。

**Architecture:** 新增 `usePaginatedPreloader` 负责通用分页预载调度；搜索、收藏夹、阅读历史各自扩展现有 Zustand store 为多页缓存。页面层负责业务加载、缓存命中展示、后台刷新和预载写入，`PaginationControls` 保持纯展示组件。

**Tech Stack:** React 18、TypeScript、Zustand、Vitest、@testing-library/react、Electron preload IPC hooks。

---

## File Structure

- Create: `src/hooks/usePaginatedPreloader.ts`
  - 通用分页预载 hook，包含候选页计算、去重、并发限制、上下文隔离。
- Create: `tests/unit/hooks/usePaginatedPreloader.test.tsx`
  - 覆盖页码计算、去重、并发限制、上下文切换、失败静默。
- Modify: `src/stores/useSearchCacheStore.ts`
  - 从单页搜索缓存扩展为按搜索上下文和页码保存多页。
- Modify: `tests/unit/stores/searchCacheStore.test.ts`
  - 更新搜索缓存 store 测试，覆盖上下文隔离和页缓存读取。
- Modify: `src/stores/useFavouritesStore.ts`
  - 从每来源单页缓存扩展为每来源多页缓存。
- Create: `tests/unit/stores/favouritesStore.test.ts`
  - 覆盖收藏夹多页缓存、来源隔离、清理行为。
- Modify: `src/stores/useHistoryStore.ts`
  - 从单页历史缓存扩展为多页缓存。
- Create: `tests/unit/stores/historyStore.test.ts`
  - 覆盖历史多页缓存和整体清理。
- Modify: `src/pages/SearchPage.tsx`
  - 接入搜索多页缓存、缓存命中后台刷新、搜索页预载。
- Modify: `tests/unit/pages/SearchPage.test.tsx`
  - 更新 mock store API，新增缓存命中和预载请求断言。
- Modify: `src/pages/FavouritesPage.tsx`
  - 接入收藏夹多页缓存、缓存命中后台刷新、收藏夹预载。
- Modify: `tests/unit/pages/FavouritesPage.test.tsx`
  - 更新 mock store API，新增缓存命中和预载请求断言。
- Modify: `src/pages/HistoryPage.tsx`
  - 接入历史多页缓存、缓存命中后台刷新、历史页预载。
- Modify: `tests/unit/pages/HistoryPage.test.tsx`
  - 更新 mock store API，新增缓存命中和预载请求断言。

---

### Task 1: Add generic paginated preloader hook

**Files:**
- Create: `src/hooks/usePaginatedPreloader.ts`
- Create: `tests/unit/hooks/usePaginatedPreloader.test.tsx`

- [ ] **Step 1: Write the failing hook tests**

Create `tests/unit/hooks/usePaginatedPreloader.test.tsx` with:

```tsx
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPreloadCandidates, usePaginatedPreloader } from '@/hooks/usePaginatedPreloader'

describe('getPreloadCandidates', () => {
  it('returns nearby pages in priority order for middle pages', () => {
    expect(getPreloadCandidates(5, 10)).toEqual([6, 4, 7, 3])
  })

  it('skips pages below 1 near the beginning', () => {
    expect(getPreloadCandidates(1, 10)).toEqual([2, 3])
    expect(getPreloadCandidates(2, 10)).toEqual([3, 1, 4])
  })

  it('skips pages above totalPages near the end', () => {
    expect(getPreloadCandidates(10, 10)).toEqual([9, 8])
    expect(getPreloadCandidates(9, 10)).toEqual([10, 8, 7])
  })
})

describe('usePaginatedPreloader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preloads uncached nearby pages only', async () => {
    const loadPage = vi.fn().mockResolvedValue(undefined)
    const hasPage = vi.fn((page: number) => page === 4)

    renderHook(() => usePaginatedPreloader({
      currentPage: 5,
      totalPages: 10,
      contextKey: 'search:hcomic:keyword:test:',
      enabled: true,
      hasPage,
      loadPage,
    }))

    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(3))
    expect(loadPage).toHaveBeenNthCalledWith(1, 6, 'preload')
    expect(loadPage).toHaveBeenNthCalledWith(2, 7, 'preload')
    expect(loadPage).toHaveBeenNthCalledWith(3, 3, 'preload')
  })

  it('does not preload when disabled', async () => {
    const loadPage = vi.fn().mockResolvedValue(undefined)

    renderHook(() => usePaginatedPreloader({
      currentPage: 5,
      totalPages: 10,
      contextKey: 'history',
      enabled: false,
      hasPage: () => false,
      loadPage,
    }))

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(loadPage).not.toHaveBeenCalled()
  })

  it('limits concurrent preload requests to two', async () => {
    let active = 0
    let maxActive = 0
    const loadPage = vi.fn(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 10))
      active -= 1
    })

    renderHook(() => usePaginatedPreloader({
      currentPage: 5,
      totalPages: 10,
      contextKey: 'favourites:hcomic',
      enabled: true,
      hasPage: () => false,
      loadPage,
      concurrency: 2,
    }))

    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(4))
    await waitFor(() => expect(active).toBe(0))
    expect(maxActive).toBeLessThanOrEqual(2)
  })

  it('does not report preload errors to page state by default', async () => {
    const loadPage = vi.fn().mockRejectedValue(new Error('network failed'))

    renderHook(() => usePaginatedPreloader({
      currentPage: 1,
      totalPages: 3,
      contextKey: 'history',
      enabled: true,
      hasPage: () => false,
      loadPage,
    }))

    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2))
  })

  it('starts a new generation when context changes', async () => {
    const calls: string[] = []
    const loadPage = vi.fn(async (page: number) => {
      calls.push(String(page))
    })

    const { rerender } = renderHook(
      ({ contextKey }) => usePaginatedPreloader({
        currentPage: 5,
        totalPages: 10,
        contextKey,
        enabled: true,
        hasPage: () => false,
        loadPage,
      }),
      { initialProps: { contextKey: 'search:first' } },
    )

    await waitFor(() => expect(loadPage).toHaveBeenCalled())
    loadPage.mockClear()
    rerender({ contextKey: 'search:second' })

    await waitFor(() => expect(loadPage).toHaveBeenCalled())
    expect(calls.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run hook tests to verify they fail**

Run:

```bash
npm test -- tests/unit/hooks/usePaginatedPreloader.test.tsx
```

Expected: FAIL because `src/hooks/usePaginatedPreloader.ts` does not exist.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/usePaginatedPreloader.ts` with:

```ts
import { useEffect, useRef } from 'react'

export type PreloadReason = 'preload'

interface UsePaginatedPreloaderArgs {
  currentPage: number
  totalPages: number
  contextKey: string
  enabled: boolean
  hasPage: (page: number) => boolean
  loadPage: (page: number, reason: PreloadReason) => Promise<void>
  onPreloadError?: (page: number, error: unknown) => void
  concurrency?: number
}

export function getPreloadCandidates(currentPage: number, totalPages: number): number[] {
  const candidates = [currentPage + 1, currentPage - 1, currentPage + 2, currentPage - 2]
  return candidates.filter((page) => page >= 1 && page <= totalPages)
}

export function usePaginatedPreloader({
  currentPage,
  totalPages,
  contextKey,
  enabled,
  hasPage,
  loadPage,
  onPreloadError,
  concurrency = 2,
}: UsePaginatedPreloaderArgs) {
  const inFlightRef = useRef(new Set<string>())
  const generationRef = useRef(0)

  useEffect(() => {
    generationRef.current += 1
    inFlightRef.current.clear()
  }, [contextKey])

  useEffect(() => {
    if (!enabled || totalPages <= 1) return

    let cancelled = false
    const generation = generationRef.current
    const queue = getPreloadCandidates(currentPage, totalPages).filter((page) => {
      const requestKey = `${contextKey}:${page}`
      return !hasPage(page) && !inFlightRef.current.has(requestKey)
    })

    if (queue.length === 0) return

    const workerCount = Math.min(concurrency, queue.length)

    const runWorker = async () => {
      while (!cancelled && queue.length > 0 && generation === generationRef.current) {
        const page = queue.shift()
        if (page == null) return
        const requestKey = `${contextKey}:${page}`
        if (hasPage(page) || inFlightRef.current.has(requestKey)) continue

        inFlightRef.current.add(requestKey)
        try {
          await loadPage(page, 'preload')
        } catch (error) {
          onPreloadError?.(page, error)
        } finally {
          inFlightRef.current.delete(requestKey)
        }
      }
    }

    const workers = Array.from({ length: workerCount }, () => runWorker())
    void Promise.all(workers)

    return () => {
      cancelled = true
    }
  }, [currentPage, totalPages, contextKey, enabled, hasPage, loadPage, onPreloadError, concurrency])
}
```

- [ ] **Step 4: Run hook tests to verify they pass**

Run:

```bash
npm test -- tests/unit/hooks/usePaginatedPreloader.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit hook work**

```bash
git add src/hooks/usePaginatedPreloader.ts tests/unit/hooks/usePaginatedPreloader.test.tsx
git commit -m "feat: add paginated preload hook"
```

---

### Task 2: Extend search cache store for multi-page contexts

**Files:**
- Modify: `src/stores/useSearchCacheStore.ts`
- Modify: `tests/unit/stores/searchCacheStore.test.ts`

- [ ] **Step 1: Replace search cache store tests with multi-page coverage**

Replace `tests/unit/stores/searchCacheStore.test.ts` with:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useSearchCacheStore, createSearchContextKey } from '@/stores/useSearchCacheStore'
import type { ComicInfo, PaginationInfo } from '@shared/types'

const mockComic: ComicInfo = {
  id: '1',
  title: 'Test Comic',
  url: 'https://example.com/comic/1',
  coverUrl: 'https://example.com/cover.jpg',
  source: 'test',
}

const mockPagination: PaginationInfo = {
  currentPage: 3,
  totalPages: 10,
  totalItems: 100,
}

describe('useSearchCacheStore', () => {
  beforeEach(() => {
    useSearchCacheStore.setState({
      contexts: {},
      currentContextKey: null,
      currentPage: 1,
      hasCache: false,
    })
  })

  it('creates stable context keys', () => {
    expect(createSearchContextKey({ query: 'abc', mode: 'keyword', source: 'hcomic', searchTags: '' }))
      .toBe('hcomic\u001fkeyword\u001fabc\u001f')
  })

  it('stores and reads a page in a search context', () => {
    const key = createSearchContextKey({ query: 'test', mode: 'keyword', source: 'hcomic', searchTags: '' })

    useSearchCacheStore.getState().setPage(key, 3, {
      query: 'test',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      comics: [mockComic],
      pagination: mockPagination,
    })

    const state = useSearchCacheStore.getState()
    expect(state.hasCache).toBe(true)
    expect(state.currentContextKey).toBe(key)
    expect(state.currentPage).toBe(3)
    expect(state.getPage(key, 3)?.comics).toEqual([mockComic])
    expect(state.hasPage(key, 3)).toBe(true)
    expect(state.hasPage(key, 4)).toBe(false)
  })

  it('keeps pages isolated by context', () => {
    const firstKey = createSearchContextKey({ query: 'first', mode: 'keyword', source: 'hcomic', searchTags: '' })
    const secondKey = createSearchContextKey({ query: 'first', mode: 'keyword', source: 'jmcomic', searchTags: '' })

    useSearchCacheStore.getState().setPage(firstKey, 1, {
      query: 'first',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      comics: [mockComic],
      pagination: { ...mockPagination, currentPage: 1 },
    })

    expect(useSearchCacheStore.getState().getPage(secondKey, 1)).toBeUndefined()
  })

  it('clears one context without clearing others', () => {
    const firstKey = createSearchContextKey({ query: 'first', mode: 'keyword', source: 'hcomic', searchTags: '' })
    const secondKey = createSearchContextKey({ query: 'second', mode: 'keyword', source: 'hcomic', searchTags: '' })

    useSearchCacheStore.getState().setPage(firstKey, 1, {
      query: 'first',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      comics: [mockComic],
      pagination: { ...mockPagination, currentPage: 1 },
    })
    useSearchCacheStore.getState().setPage(secondKey, 1, {
      query: 'second',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      comics: [mockComic],
      pagination: { ...mockPagination, currentPage: 1 },
    })

    useSearchCacheStore.getState().clearContext(firstKey)

    expect(useSearchCacheStore.getState().getPage(firstKey, 1)).toBeUndefined()
    expect(useSearchCacheStore.getState().getPage(secondKey, 1)).toBeDefined()
  })

  it('clears all search cache', () => {
    const key = createSearchContextKey({ query: 'test', mode: 'keyword', source: 'hcomic', searchTags: '' })
    useSearchCacheStore.getState().setPage(key, 1, {
      query: 'test',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      comics: [mockComic],
      pagination: { ...mockPagination, currentPage: 1 },
    })

    useSearchCacheStore.getState().clearCache()

    const state = useSearchCacheStore.getState()
    expect(state.contexts).toEqual({})
    expect(state.currentContextKey).toBeNull()
    expect(state.hasCache).toBe(false)
  })
})
```

- [ ] **Step 2: Run search cache store tests to verify they fail**

Run:

```bash
npm test -- tests/unit/stores/searchCacheStore.test.ts
```

Expected: FAIL because `createSearchContextKey`, `setPage`, `getPage`, `hasPage`, and `clearContext` are not implemented.

- [ ] **Step 3: Replace search cache store implementation**

Replace `src/stores/useSearchCacheStore.ts` with:

```ts
import { create } from 'zustand'
import type { ComicInfo, PaginationInfo } from '@shared/types'

export interface SearchPageCache {
  query: string
  mode: string
  source: string
  searchTags: string
  comics: ComicInfo[]
  pagination: PaginationInfo | null
}

export interface SearchContextCache {
  pages: Record<number, SearchPageCache>
}

interface SearchContextInput {
  query: string
  mode: string
  source: string
  searchTags: string
}

interface SearchCacheStoreState {
  contexts: Record<string, SearchContextCache>
  currentContextKey: string | null
  currentPage: number
  hasCache: boolean
  setPage: (contextKey: string, page: number, data: SearchPageCache) => void
  getPage: (contextKey: string, page: number) => SearchPageCache | undefined
  hasPage: (contextKey: string, page: number) => boolean
  clearContext: (contextKey: string) => void
  clearCache: () => void
}

export function createSearchContextKey({ query, mode, source, searchTags }: SearchContextInput): string {
  return [source, mode, query.trim(), searchTags].join('\u001f')
}

export const useSearchCacheStore = create<SearchCacheStoreState>((set, get) => ({
  contexts: {},
  currentContextKey: null,
  currentPage: 1,
  hasCache: false,
  setPage: (contextKey, page, data) => {
    const contexts = get().contexts
    const context = contexts[contextKey] ?? { pages: {} }
    set({
      contexts: {
        ...contexts,
        [contextKey]: {
          pages: {
            ...context.pages,
            [page]: data,
          },
        },
      },
      currentContextKey: contextKey,
      currentPage: page,
      hasCache: true,
    })
  },
  getPage: (contextKey, page) => get().contexts[contextKey]?.pages[page],
  hasPage: (contextKey, page) => Boolean(get().contexts[contextKey]?.pages[page]),
  clearContext: (contextKey) => {
    const contexts = { ...get().contexts }
    delete contexts[contextKey]
    const currentContextKey = get().currentContextKey === contextKey ? null : get().currentContextKey
    set({
      contexts,
      currentContextKey,
      currentPage: currentContextKey ? get().currentPage : 1,
      hasCache: Object.keys(contexts).length > 0,
    })
  },
  clearCache: () => set({
    contexts: {},
    currentContextKey: null,
    currentPage: 1,
    hasCache: false,
  }),
}))
```

- [ ] **Step 4: Run search cache store tests to verify they pass**

Run:

```bash
npm test -- tests/unit/stores/searchCacheStore.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit search cache store work**

```bash
git add src/stores/useSearchCacheStore.ts tests/unit/stores/searchCacheStore.test.ts
git commit -m "feat: cache search pages by context"
```

---

### Task 3: Extend favourites and history stores for multi-page caching

**Files:**
- Modify: `src/stores/useFavouritesStore.ts`
- Create: `tests/unit/stores/favouritesStore.test.ts`
- Modify: `src/stores/useHistoryStore.ts`
- Create: `tests/unit/stores/historyStore.test.ts`

- [ ] **Step 1: Write failing favourites store tests**

Create `tests/unit/stores/favouritesStore.test.ts` with:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useFavouritesStore } from '@/stores/useFavouritesStore'
import type { ComicInfo, PaginationInfo } from '@shared/types'

const comic: ComicInfo = {
  id: 'fav-1',
  title: 'Favourite Comic',
  url: 'https://example.com/fav-1',
  coverUrl: '',
  source: 'NH',
}

const pagination: PaginationInfo = {
  currentPage: 2,
  totalPages: 8,
  totalItems: 80,
}

describe('useFavouritesStore', () => {
  beforeEach(() => {
    useFavouritesStore.setState({
      caches: {},
      currentSource: 'hcomic',
      currentPage: 1,
      hasCache: false,
    })
  })

  it('stores and reads pages by source', () => {
    useFavouritesStore.getState().setPage('hcomic', 2, {
      comics: [comic],
      pagination,
      currentPage: 2,
      downloadedStatus: { hcomic_NH_fav-1: 'downloaded' },
    })

    const page = useFavouritesStore.getState().getPage('hcomic', 2)
    expect(page?.comics).toEqual([comic])
    expect(page?.downloadedStatus.hcomic_NH_fav-1).toBe('downloaded')
    expect(useFavouritesStore.getState().hasPage('hcomic', 2)).toBe(true)
    expect(useFavouritesStore.getState().hasPage('hcomic', 3)).toBe(false)
  })

  it('keeps source caches isolated', () => {
    useFavouritesStore.getState().setPage('hcomic', 1, {
      comics: [comic],
      pagination: { ...pagination, currentPage: 1 },
      currentPage: 1,
      downloadedStatus: {},
    })

    expect(useFavouritesStore.getState().getPage('jmcomic', 1)).toBeUndefined()
  })

  it('clears one source cache', () => {
    useFavouritesStore.getState().setPage('hcomic', 1, {
      comics: [comic],
      pagination: { ...pagination, currentPage: 1 },
      currentPage: 1,
      downloadedStatus: {},
    })
    useFavouritesStore.getState().setPage('jmcomic', 1, {
      comics: [comic],
      pagination: { ...pagination, currentPage: 1 },
      currentPage: 1,
      downloadedStatus: {},
    })

    useFavouritesStore.getState().clearCache('hcomic')

    expect(useFavouritesStore.getState().getPage('hcomic', 1)).toBeUndefined()
    expect(useFavouritesStore.getState().getPage('jmcomic', 1)).toBeDefined()
  })
})
```

- [ ] **Step 2: Write failing history store tests**

Create `tests/unit/stores/historyStore.test.ts` with:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useHistoryStore } from '@/stores/useHistoryStore'
import type { HistoryItem, PaginationInfo } from '@shared/types'

const item: HistoryItem = {
  id: 1,
  comicId: 'comic-1',
  title: 'History Comic',
  coverUrl: '',
  source: 'NH',
  sourceSite: 'hcomic',
  mediaId: 'media-1',
  sourceUrl: 'https://example.com/comic-1',
  lastPage: 1,
  totalPages: 10,
  lastReadAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
}

const pagination: PaginationInfo = {
  currentPage: 2,
  totalPages: 5,
  totalItems: 50,
}

describe('useHistoryStore', () => {
  beforeEach(() => {
    useHistoryStore.setState({
      pages: {},
      currentPage: 1,
      hasCache: false,
    })
  })

  it('stores and reads history pages', () => {
    useHistoryStore.getState().setPage(2, {
      items: [item],
      pagination,
      currentPage: 2,
    })

    expect(useHistoryStore.getState().getPage(2)?.items).toEqual([item])
    expect(useHistoryStore.getState().hasPage(2)).toBe(true)
    expect(useHistoryStore.getState().hasPage(3)).toBe(false)
  })

  it('clears all history pages', () => {
    useHistoryStore.getState().setPage(2, {
      items: [item],
      pagination,
      currentPage: 2,
    })

    useHistoryStore.getState().clearCache()

    expect(useHistoryStore.getState().pages).toEqual({})
    expect(useHistoryStore.getState().hasCache).toBe(false)
    expect(useHistoryStore.getState().currentPage).toBe(1)
  })
})
```

- [ ] **Step 3: Run store tests to verify they fail**

Run:

```bash
npm test -- tests/unit/stores/favouritesStore.test.ts tests/unit/stores/historyStore.test.ts
```

Expected: FAIL because the multi-page store APIs are not implemented.

- [ ] **Step 4: Replace favourites store implementation**

Replace `src/stores/useFavouritesStore.ts` with:

```ts
import { create } from 'zustand'
import type { ComicInfo, PaginationInfo } from '@shared/types'

export interface FavouritesPageCache {
  comics: ComicInfo[]
  pagination: PaginationInfo | null
  currentPage: number
  downloadedStatus: Record<string, 'downloaded' | 'unknown'>
}

interface SourceFavouritesCache {
  pages: Record<number, FavouritesPageCache>
}

interface FavouritesStoreState {
  caches: Record<string, SourceFavouritesCache>
  currentSource: string
  currentPage: number
  hasCache: boolean
  setPage: (source: string, page: number, data: FavouritesPageCache) => void
  getPage: (source: string, page: number) => FavouritesPageCache | undefined
  hasPage: (source: string, page: number) => boolean
  clearCache: (source?: string) => void
  setCurrentSource: (source: string) => void
}

export const useFavouritesStore = create<FavouritesStoreState>((set, get) => ({
  caches: {},
  currentSource: 'hcomic',
  currentPage: 1,
  hasCache: false,
  setPage: (source, page, data) => {
    const caches = get().caches
    const sourceCache = caches[source] ?? { pages: {} }
    set({
      caches: {
        ...caches,
        [source]: {
          pages: {
            ...sourceCache.pages,
            [page]: data,
          },
        },
      },
      currentSource: source,
      currentPage: page,
      hasCache: true,
    })
  },
  getPage: (source, page) => get().caches[source]?.pages[page],
  hasPage: (source, page) => Boolean(get().caches[source]?.pages[page]),
  clearCache: (source) => {
    if (!source) {
      set({ caches: {}, currentPage: 1, hasCache: false })
      return
    }
    const caches = { ...get().caches }
    delete caches[source]
    set({
      caches,
      currentPage: source === get().currentSource ? 1 : get().currentPage,
      hasCache: Object.keys(caches).length > 0,
    })
  },
  setCurrentSource: (source) => {
    set({
      currentSource: source,
      currentPage: 1,
      hasCache: Boolean(get().caches[source]),
    })
  },
}))
```

- [ ] **Step 5: Replace history store implementation**

Replace `src/stores/useHistoryStore.ts` with:

```ts
import { create } from 'zustand'
import type { HistoryItem, PaginationInfo } from '@shared/types'

export interface HistoryPageCache {
  items: HistoryItem[]
  pagination: PaginationInfo | null
  currentPage: number
}

interface HistoryStoreState {
  pages: Record<number, HistoryPageCache>
  currentPage: number
  hasCache: boolean
  setPage: (page: number, data: HistoryPageCache) => void
  getPage: (page: number) => HistoryPageCache | undefined
  hasPage: (page: number) => boolean
  clearCache: () => void
}

export const useHistoryStore = create<HistoryStoreState>((set, get) => ({
  pages: {},
  currentPage: 1,
  hasCache: false,
  setPage: (page, data) => set({
    pages: {
      ...get().pages,
      [page]: data,
    },
    currentPage: page,
    hasCache: true,
  }),
  getPage: (page) => get().pages[page],
  hasPage: (page) => Boolean(get().pages[page]),
  clearCache: () => set({
    pages: {},
    currentPage: 1,
    hasCache: false,
  }),
}))
```

- [ ] **Step 6: Run store tests to verify they pass**

Run:

```bash
npm test -- tests/unit/stores/favouritesStore.test.ts tests/unit/stores/historyStore.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit store work**

```bash
git add src/stores/useFavouritesStore.ts src/stores/useHistoryStore.ts tests/unit/stores/favouritesStore.test.ts tests/unit/stores/historyStore.test.ts
git commit -m "feat: cache paginated favourites and history"
```

---

### Task 4: Wire preloading into SearchPage

**Files:**
- Modify: `src/pages/SearchPage.tsx`
- Modify: `tests/unit/pages/SearchPage.test.tsx`

- [ ] **Step 1: Update SearchPage mocks and add behaviour tests**

In `tests/unit/pages/SearchPage.test.tsx`, update the hoisted search cache mock to include the new API:

```ts
const { mockSearchCacheStore } = vi.hoisted(() => {
  const store = {
    contexts: {} as Record<string, unknown>,
    currentContextKey: null as string | null,
    currentPage: 1,
    hasCache: false,
    setPage: vi.fn(),
    getPage: vi.fn(),
    hasPage: vi.fn().mockReturnValue(false),
    clearContext: vi.fn(),
    clearCache: vi.fn(),
  }
  return { mockSearchCacheStore: store }
})
```

Add these tests near the pagination tests:

```tsx
it('shows cached search page immediately and refreshes it in background', async () => {
  mockStoreState.comics = [
    { id: '1', title: 'Page 1 Comic', url: 'https://example.com/1', coverUrl: '', source: 'test' },
  ]
  mockStoreState.pagination = { currentPage: 1, totalPages: 3, totalItems: 30 }
  mockSearchCacheStore.getPage.mockReturnValue({
    query: '',
    mode: 'keyword',
    source: 'hcomic',
    searchTags: '',
    comics: [{ id: '2', title: 'Cached Page 2 Comic', url: 'https://example.com/2', coverUrl: '', source: 'test' }],
    pagination: { currentPage: 2, totalPages: 3, totalItems: 30 },
  })
  mockSearch.mockResolvedValue({
    comics: [{ id: '2fresh', title: 'Fresh Page 2 Comic', url: 'https://example.com/2fresh', coverUrl: '', source: 'test' }],
    pagination: { currentPage: 2, totalPages: 3, totalItems: 30 },
  })

  render(<SearchPage />)

  await userEvent.click(screen.getByText('下一页'))

  expect(mockStoreState.setComics).toHaveBeenCalledWith([
    { id: '2', title: 'Cached Page 2 Comic', url: 'https://example.com/2', coverUrl: '', source: 'test' },
  ])
  expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 2, 'hcomic', undefined)
})

it('preloads nearby search pages after current page is available', async () => {
  mockStoreState.comics = [
    { id: '5', title: 'Page 5 Comic', url: 'https://example.com/5', coverUrl: '', source: 'test' },
  ]
  mockStoreState.pagination = { currentPage: 5, totalPages: 10, totalItems: 100 }
  mockSearch.mockResolvedValue({ comics: [], pagination: { currentPage: 6, totalPages: 10, totalItems: 100 } })

  render(<SearchPage />)

  await screen.findByText('Page 5 Comic')
  await vi.waitFor(() => expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 6, 'hcomic', undefined))
})
```

- [ ] **Step 2: Run SearchPage tests to verify they fail**

Run:

```bash
npm test -- tests/unit/pages/SearchPage.test.tsx
```

Expected: FAIL because `SearchPage` still uses the old cache API and has no preloader integration.

- [ ] **Step 3: Implement SearchPage cache key, cached navigation, and preloading**

Modify `src/pages/SearchPage.tsx` imports:

```ts
import { createSearchContextKey } from '../stores/useSearchCacheStore'
import { usePaginatedPreloader } from '../hooks/usePaginatedPreloader'
```

Add after refs are initialized:

```ts
  const searchContextKey = useMemo(() => createSearchContextKey({
    query,
    mode,
    source,
    searchTags,
  }), [query, mode, source, searchTags])
```

Replace the initial cache restore block with:

```ts
    const cached = searchCacheRef.current.getPage(searchContextKey, searchCacheRef.current.currentPage)
    if (cached) {
      setQuery(cached.query)
      setMode(cached.mode)
      setSource(cached.source)
      setSearchTags(cached.searchTags)
      if (cached.searchTags) {
        const restored = cached.searchTags.split(',').filter(Boolean)
        tagPanel.setSelectedTags(restored)
      }
      setComics(cached.comics)
      if (cached.pagination) setPagination(cached.pagination)
      return
    }
```

In every place that currently calls `searchCacheRef.current.setCache({ ... })`, replace it with:

```ts
      const contextKey = createSearchContextKey({
        query: finalQuery,
        mode: searchMode === 'tag' && !finalQuery ? 'tag' : searchMode,
        source,
        searchTags: finalTags,
      })
      searchCacheRef.current.setPage(contextKey, result.pagination?.currentPage ?? 1, {
        query: finalQuery,
        mode: searchMode === 'tag' && !finalQuery ? 'tag' : searchMode,
        source,
        searchTags: finalTags,
        comics: result.comics,
        pagination: result.pagination ?? null,
      })
```

For the `withLoading` block, use the current refs:

```ts
      const contextKey = createSearchContextKey({
        query: queryRef.current,
        mode: modeRef.current,
        source: sourceRef.current,
        searchTags: searchTagsRef.current,
      })
      searchCacheRef.current.setPage(contextKey, result.pagination?.currentPage ?? 1, {
        query: queryRef.current,
        mode: modeRef.current,
        source: sourceRef.current,
        searchTags: searchTagsRef.current,
        comics: result.comics,
        pagination: result.pagination ?? null,
      })
```

Update `handleSearch` to show cached pages first and still refresh:

```ts
  const handleSearch = useCallback(async (page: number = 1) => {
    if (requiresAuth(source) && needsLogin) return
    clearSelection()
    setShowHistory(false)
    if (query.trim()) {
      addHistory(searchTags ? `${query} [${searchTags}]` : query.trim())
    }

    const contextKey = createSearchContextKey({ query, mode, source, searchTags })
    const cachedPage = searchCacheRef.current.getPage(contextKey, page)
    if (cachedPage) {
      setComics(cachedPage.comics)
      if (cachedPage.pagination) setPagination(cachedPage.pagination)
      setError(null)
      search(query, mode, page, source, searchTags || undefined).then((result) => {
        setComics(result.comics)
        setPagination(result.pagination)
        searchCacheRef.current.setPage(contextKey, page, {
          query,
          mode,
          source,
          searchTags,
          comics: result.comics,
          pagination: result.pagination ?? null,
        })
      }).catch((err) => {
        console.debug('Background search refresh failed:', err)
      })
      return
    }

    await withLoading(() => search(query, mode, page, source, searchTags || undefined))
  }, [source, needsLogin, query, mode, searchTags, clearSelection, addHistory, withLoading, search, setComics, setPagination, setError])
```

Add the preloader near other hooks:

```ts
  const preloadSearchPage = useCallback(async (page: number) => {
    const result = await search(queryRef.current, modeRef.current, page, sourceRef.current, searchTagsRef.current || undefined)
    const contextKey = createSearchContextKey({
      query: queryRef.current,
      mode: modeRef.current,
      source: sourceRef.current,
      searchTags: searchTagsRef.current,
    })
    searchCacheRef.current.setPage(contextKey, page, {
      query: queryRef.current,
      mode: modeRef.current,
      source: sourceRef.current,
      searchTags: searchTagsRef.current,
      comics: result.comics,
      pagination: result.pagination ?? null,
    })
  }, [search])

  usePaginatedPreloader({
    currentPage: pagination?.currentPage ?? 1,
    totalPages: pagination?.totalPages ?? 1,
    contextKey: searchContextKey,
    enabled: !needsLogin && !isLoading && Boolean(pagination && pagination.totalPages > 1),
    hasPage: (page) => searchCacheRef.current.hasPage(searchContextKey, page),
    loadPage: preloadSearchPage,
  })
```

- [ ] **Step 4: Run SearchPage tests to verify they pass**

Run:

```bash
npm test -- tests/unit/pages/SearchPage.test.tsx tests/unit/stores/searchCacheStore.test.ts tests/unit/hooks/usePaginatedPreloader.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit SearchPage work**

```bash
git add src/pages/SearchPage.tsx tests/unit/pages/SearchPage.test.tsx
git commit -m "feat: preload search result pages"
```

---

### Task 5: Wire preloading into FavouritesPage

**Files:**
- Modify: `src/pages/FavouritesPage.tsx`
- Modify: `tests/unit/pages/FavouritesPage.test.tsx`

- [ ] **Step 1: Update FavouritesPage mock store and add tests**

In `tests/unit/pages/FavouritesPage.test.tsx`, replace the `useFavouritesStore` mock with a hoisted mock store:

```ts
const { mockFavouritesStore } = vi.hoisted(() => ({
  mockFavouritesStore: {
    caches: {},
    currentSource: 'hcomic',
    currentPage: 1,
    hasCache: false,
    setPage: vi.fn(),
    getPage: vi.fn(),
    hasPage: vi.fn().mockReturnValue(false),
    clearCache: vi.fn(),
    setCurrentSource: vi.fn(),
  },
}))

vi.mock('@/stores/useFavouritesStore', () => ({
  useFavouritesStore: vi.fn().mockReturnValue(mockFavouritesStore),
}))
```

Add tests:

```tsx
it('shows cached favourites page immediately and refreshes it in background', async () => {
  mockFavouritesStore.getPage.mockReturnValue({
    comics: [{ id: '2', title: 'Cached Favourite', url: 'https://example.com/2', coverUrl: '', source: 'test' }],
    pagination: { currentPage: 2, totalPages: 3, totalItems: 30 },
    currentPage: 2,
    downloadedStatus: {},
  })
  mockGetFavourites.mockResolvedValue({
    comics: [{ id: '2fresh', title: 'Fresh Favourite', url: 'https://example.com/2fresh', coverUrl: '', source: 'test' }],
    pagination: { currentPage: 2, totalPages: 3, totalItems: 30 },
    needsLogin: false,
  })

  render(<FavouritesPage />)

  await userEvent.click(await screen.findByText('下一页'))

  expect(await screen.findByText('Cached Favourite')).toBeInTheDocument()
  expect(mockGetFavourites).toHaveBeenCalledWith(2, 'hcomic')
})

it('preloads nearby favourites pages after current page is loaded', async () => {
  mockGetFavourites.mockResolvedValue({
    comics: [{ id: '5', title: 'Current Favourite', url: 'https://example.com/5', coverUrl: '', source: 'test' }],
    pagination: { currentPage: 5, totalPages: 10, totalItems: 100 },
    needsLogin: false,
  })

  render(<FavouritesPage />)

  await screen.findByText('Current Favourite')
  await vi.waitFor(() => expect(mockGetFavourites).toHaveBeenCalledWith(6, 'hcomic'))
})
```

- [ ] **Step 2: Run FavouritesPage tests to verify they fail**

Run:

```bash
npm test -- tests/unit/pages/FavouritesPage.test.tsx
```

Expected: FAIL because the page still uses the old cache API and has no preloader integration.

- [ ] **Step 3: Implement cached navigation and preloading in FavouritesPage**

Modify imports:

```ts
import { usePaginatedPreloader } from '../hooks/usePaginatedPreloader'
```

Update state initialization to read from page cache:

```ts
  const initialCache = cache.getPage(source, cache.currentPage)
  const [comics, setComics] = useState<ComicInfo[]>(initialCache?.comics ?? [])
  const [pagination, setPagination] = useState<PaginationInfo | null>(initialCache?.pagination ?? null)
  const [currentPage, setCurrentPage] = useState(initialCache?.currentPage ?? 1)
  const [downloadedStatus, setDownloadedStatus] = useState<Record<string, 'downloaded' | 'unknown'>>(initialCache?.downloadedStatus ?? {})
```

Extract a page cache writer inside the component:

```ts
  const cacheFavouritesPage = useCallback((effectiveSource: string, page: number, result: { comics: ComicInfo[]; pagination?: PaginationInfo; needsLogin?: boolean }, statusMap: Record<string, 'downloaded' | 'unknown'> = {}) => {
    cache.setPage(effectiveSource, page, {
      comics: result.comics,
      pagination: result.pagination ?? null,
      currentPage: page,
      downloadedStatus: statusMap,
    })
  }, [cache])
```

Update `loadFavourites` to use cached page first unless called for preload:

```ts
  const loadFavourites = useCallback(async (page: number = 1, selectedSource?: string, reason: 'user' | 'preload' = 'user') => {
    const effectiveSource = selectedSource || source
    const cachedPage = cache.getPage(effectiveSource, page)

    if (reason === 'user' && cachedPage) {
      setComics(cachedPage.comics)
      setPagination(cachedPage.pagination)
      setCurrentPage(page)
      setDownloadedStatus(cachedPage.downloadedStatus)
      getFavourites(page, effectiveSource).then((result) => {
        checkDownloadedStatus(result.comics).then((statusResult) => {
          setComics(result.comics)
          setPagination(result.pagination ?? null)
          setNeedsLogin(result.needsLogin)
          setDownloadedStatus(statusResult.statusMap)
          cacheFavouritesPage(effectiveSource, page, result, statusResult.statusMap)
        }).catch(() => {
          setComics(result.comics)
          setPagination(result.pagination ?? null)
          setNeedsLogin(result.needsLogin)
          cacheFavouritesPage(effectiveSource, page, result)
        })
      }).catch((err) => {
        console.debug('Background favourites refresh failed:', err)
      })
      return
    }

    if (reason === 'user') {
      setIsLoading(true)
      setError(null)
      setNeedsLogin(false)
    }

    try {
      const result = await getFavourites(page, effectiveSource)
      const statusResult = await checkDownloadedStatus(result.comics).catch(() => ({ statusMap: {} }))
      cacheFavouritesPage(effectiveSource, page, result, statusResult.statusMap)
      if (reason === 'user') {
        setComics(result.comics)
        setPagination(result.pagination ?? null)
        setNeedsLogin(result.needsLogin)
        setCurrentPage(page)
        latestPageRef.current = page
        setDownloadedStatus(statusResult.statusMap)
      }
    } catch (err) {
      if (reason === 'preload') return
      const msg = err instanceof Error ? err.message : 'Failed to load favourites'
      if (isAuthError(err)) {
        setNeedsLogin(true)
      } else {
        setError(msg)
      }
    } finally {
      if (reason === 'user') setIsLoading(false)
    }
  }, [getFavourites, checkDownloadedStatus, cache, cacheFavouritesPage, source])
```

In source change handling, replace old `cache.caches[newSource]` access with:

```ts
              cache.setCurrentSource(newSource)
              const cachedData = cache.getPage(newSource, cache.currentPage)
              if (cachedData) {
                setComics(cachedData.comics)
                setPagination(cachedData.pagination)
                setCurrentPage(cachedData.currentPage)
                setDownloadedStatus(cachedData.downloadedStatus)
              } else {
                setComics([])
                loadFavourites(1, newSource)
              }
```

Add preloader near the render block:

```ts
  const preloadFavouritesPage = useCallback(async (page: number) => {
    await loadFavourites(page, source, 'preload')
  }, [loadFavourites, source])

  usePaginatedPreloader({
    currentPage,
    totalPages: pagination?.totalPages ?? 1,
    contextKey: `favourites:${source}`,
    enabled: !needsLogin && !isLoading && Boolean(pagination && pagination.totalPages > 1),
    hasPage: (page) => cache.hasPage(source, page),
    loadPage: preloadFavouritesPage,
  })
```

- [ ] **Step 4: Run FavouritesPage tests to verify they pass**

Run:

```bash
npm test -- tests/unit/pages/FavouritesPage.test.tsx tests/unit/stores/favouritesStore.test.ts tests/unit/hooks/usePaginatedPreloader.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit FavouritesPage work**

```bash
git add src/pages/FavouritesPage.tsx tests/unit/pages/FavouritesPage.test.tsx
git commit -m "feat: preload favourite pages"
```

---

### Task 6: Wire preloading into HistoryPage

**Files:**
- Modify: `src/pages/HistoryPage.tsx`
- Modify: `tests/unit/pages/HistoryPage.test.tsx`

- [ ] **Step 1: Update HistoryPage mock store and add tests**

In `tests/unit/pages/HistoryPage.test.tsx`, replace the `useHistoryStore` mock with a hoisted mock store:

```ts
const { mockHistoryStore } = vi.hoisted(() => ({
  mockHistoryStore: {
    pages: {},
    currentPage: 1,
    hasCache: false,
    setPage: vi.fn(),
    getPage: vi.fn(),
    hasPage: vi.fn().mockReturnValue(false),
    clearCache: vi.fn(),
  },
}))

vi.mock('@/stores/useHistoryStore', () => ({
  useHistoryStore: vi.fn().mockReturnValue(mockHistoryStore),
}))
```

Add tests:

```tsx
it('shows cached history page immediately and refreshes it in background', async () => {
  mockHistoryStore.getPage.mockReturnValue({
    items: [makeHistoryItem({ id: 2, comicId: 'cached', title: 'Cached History' })],
    pagination: { currentPage: 2, totalPages: 3, totalItems: 30 },
    currentPage: 2,
  })
  mockGetHistory.mockResolvedValue({
    items: [makeHistoryItem({ id: 3, comicId: 'fresh', title: 'Fresh History' })],
    pagination: { currentPage: 2, totalPages: 3, totalItems: 30 },
  })

  render(<HistoryPage />)

  await userEvent.click(await screen.findByText('下一页'))

  expect(await screen.findByText('Cached History')).toBeInTheDocument()
  expect(mockGetHistory).toHaveBeenCalledWith(2)
})

it('preloads nearby history pages after current page is loaded', async () => {
  mockGetHistory.mockResolvedValue({
    items: [makeHistoryItem({ id: 5, comicId: 'current', title: 'Current History' })],
    pagination: { currentPage: 5, totalPages: 10, totalItems: 100 },
  })

  render(<HistoryPage />)

  await screen.findByText('Current History')
  await vi.waitFor(() => expect(mockGetHistory).toHaveBeenCalledWith(6))
})
```

Also add `import userEvent from '@testing-library/user-event'` at the top.

- [ ] **Step 2: Run HistoryPage tests to verify they fail**

Run:

```bash
npm test -- tests/unit/pages/HistoryPage.test.tsx
```

Expected: FAIL because the page still uses the old cache API and has no preloader integration.

- [ ] **Step 3: Implement cached navigation and preloading in HistoryPage**

Modify imports:

```ts
import { usePaginatedPreloader } from '../hooks/usePaginatedPreloader'
```

Update state initialization:

```ts
  const initialCache = cache.getPage(cache.currentPage)
  const [items, setItems] = useState<HistoryItem[]>(initialCache?.items ?? [])
  const [pagination, setPagination] = useState<PaginationInfo | null>(initialCache?.pagination ?? null)
  const [currentPage, setCurrentPage] = useState(initialCache?.currentPage ?? 1)
```

Replace `loadHistory` with:

```ts
  const loadHistory = useCallback(async (page: number = 1, reason: 'user' | 'preload' = 'user') => {
    const cachedPage = cache.getPage(page)

    if (reason === 'user' && cachedPage) {
      setItems(cachedPage.items)
      setPagination(cachedPage.pagination)
      setCurrentPage(page)
      setError(null)
      getHistory(page).then((result) => {
        setItems(result.items)
        setPagination(result.pagination ?? null)
        setCurrentPage(page)
        latestPageRef.current = page
        cache.setPage(page, {
          items: result.items,
          pagination: result.pagination ?? null,
          currentPage: page,
        })
      }).catch((err) => {
        console.debug('Background history refresh failed:', err)
      })
      return
    }

    if (reason === 'user') {
      setIsLoading(true)
      setError(null)
    }

    try {
      const result = await getHistory(page)
      cache.setPage(page, {
        items: result.items,
        pagination: result.pagination ?? null,
        currentPage: page,
      })
      if (reason === 'user') {
        setItems(result.items)
        setPagination(result.pagination ?? null)
        setCurrentPage(page)
        latestPageRef.current = page
      }
    } catch (err) {
      if (reason === 'preload') return
      setError(err instanceof Error ? err.message : '加载历史记录失败')
    } finally {
      if (reason === 'user') setIsLoading(false)
    }
  }, [getHistory, cache])
```

Update mount effect to use the page cache:

```ts
    if (!cache.getPage(cache.currentPage)) {
      loadHistory(1)
    }
```

Add preloader before early return checks:

```ts
  const preloadHistoryPage = useCallback(async (page: number) => {
    await loadHistory(page, 'preload')
  }, [loadHistory])

  usePaginatedPreloader({
    currentPage,
    totalPages: pagination?.totalPages ?? 1,
    contextKey: 'history',
    enabled: !isLoading && Boolean(pagination && pagination.totalPages > 1),
    hasPage: (page) => cache.hasPage(page),
    loadPage: preloadHistoryPage,
  })
```

Keep existing `cache.clearCache()` calls in delete, clear-all, and refresh paths so stale records do not return from preloaded pages.

- [ ] **Step 4: Run HistoryPage tests to verify they pass**

Run:

```bash
npm test -- tests/unit/pages/HistoryPage.test.tsx tests/unit/stores/historyStore.test.ts tests/unit/hooks/usePaginatedPreloader.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit HistoryPage work**

```bash
git add src/pages/HistoryPage.tsx tests/unit/pages/HistoryPage.test.tsx
git commit -m "feat: preload reading history pages"
```

---

### Task 7: Full verification and cleanup

**Files:**
- Modify if needed: files touched in Tasks 1-6

- [ ] **Step 1: Run focused test suite**

Run:

```bash
npm test -- tests/unit/hooks/usePaginatedPreloader.test.tsx tests/unit/stores/searchCacheStore.test.ts tests/unit/stores/favouritesStore.test.ts tests/unit/stores/historyStore.test.ts tests/unit/pages/SearchPage.test.tsx tests/unit/pages/FavouritesPage.test.tsx tests/unit/pages/HistoryPage.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full unit test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Inspect changed files**

Run:

```bash
git status --short && git diff --stat
```

Expected: only planned files are modified, and no generated build artifacts are staged.

- [ ] **Step 6: Final commit if verification required fixes**

If Step 1-5 required follow-up edits, commit them:

```bash
git add src/hooks/usePaginatedPreloader.ts src/stores/useSearchCacheStore.ts src/stores/useFavouritesStore.ts src/stores/useHistoryStore.ts src/pages/SearchPage.tsx src/pages/FavouritesPage.tsx src/pages/HistoryPage.tsx tests/unit/hooks/usePaginatedPreloader.test.tsx tests/unit/stores/searchCacheStore.test.ts tests/unit/stores/favouritesStore.test.ts tests/unit/stores/historyStore.test.ts tests/unit/pages/SearchPage.test.tsx tests/unit/pages/FavouritesPage.test.tsx tests/unit/pages/HistoryPage.test.tsx
git commit -m "test: verify paginated preload integration"
```

Expected: commit succeeds only when there are verification fixes to commit.

---

## Self-Review

### Spec coverage

- 前后各两页预载：Task 1 implements candidate calculation and scheduler; Tasks 4-6 connect it to SearchPage, FavouritesPage, and HistoryPage.
- 缓存命中先显示再后台刷新：Tasks 4-6 implement page-level cached navigation.
- 预载失败静默：Task 1 hook catches errors; Tasks 5-6 also keep preload failures out of page error state.
- 搜索、收藏夹、历史多页缓存：Tasks 2-3 implement the store APIs and tests.
- 阅读器图片页预载不变：No tasks modify `ComicReaderModal`, `ReaderPage`, or `usePreloadManager`.
- `PaginationControls` 保持展示职责：No tasks modify `src/components/common/PaginationControls.tsx`.

### Placeholder scan

The plan contains no deferred implementation markers. Every code-changing task lists concrete file paths, test code, implementation code or precise replacement snippets, commands, and expected results.

### Type consistency

- `usePaginatedPreloader` uses `loadPage(page, 'preload')` consistently across SearchPage, FavouritesPage, and HistoryPage.
- Search cache APIs are `setPage`, `getPage`, `hasPage`, `clearContext`, and `clearCache` in both store and page tasks.
- Favourites and History store APIs use the same `setPage`, `getPage`, `hasPage`, and `clearCache` naming.
