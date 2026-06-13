# 搜索页状态缓存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搜索页切换到其他页面再切回来时，完全恢复上次的状态（关键词、模式、来源、标签、页数、结果列表）。

**Architecture:** 新建 Zustand store `useSearchCacheStore` 缓存搜索页完整快照。SearchPage 挂载时检查缓存，有则恢复，无则走原有首次加载。所有搜索入口成功后写入缓存。模式与收藏页的 `useFavouritesStore` 对称。

**Tech Stack:** React, TypeScript, Zustand, Vitest

---

### Task 1: 创建 useSearchCacheStore

**Files:**
- Create: `src/stores/useSearchCacheStore.ts`
- Create: `tests/unit/stores/searchCacheStore.test.ts`

- [ ] **Step 1: 写 store 测试**

```typescript
// tests/unit/stores/searchCacheStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useSearchCacheStore } from '@/stores/useSearchCacheStore'
import type { ComicInfo, PaginationInfo } from '@shared/types'

const mockComic: ComicInfo = {
  id: '1',
  title: 'Test Comic',
  url: 'https://example.com/comic/1',
  coverUrl: 'https://example.com/cover.jpg',
  source: 'test'
}

const mockPagination: PaginationInfo = {
  currentPage: 3,
  totalPages: 10,
  totalItems: 100
}

describe('useSearchCacheStore', () => {
  beforeEach(() => {
    useSearchCacheStore.setState({ cache: null, hasCache: false })
  })

  it('应有正确的初始状态', () => {
    const state = useSearchCacheStore.getState()
    expect(state.cache).toBeNull()
    expect(state.hasCache).toBe(false)
  })

  it('应能写入缓存', () => {
    useSearchCacheStore.getState().setCache({
      query: 'test query',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      comics: [mockComic],
      pagination: mockPagination
    })

    const state = useSearchCacheStore.getState()
    expect(state.hasCache).toBe(true)
    expect(state.cache).not.toBeNull()
    expect(state.cache!.query).toBe('test query')
    expect(state.cache!.mode).toBe('keyword')
    expect(state.cache!.source).toBe('hcomic')
    expect(state.cache!.searchTags).toBe('')
    expect(state.cache!.comics).toEqual([mockComic])
    expect(state.cache!.pagination).toEqual(mockPagination)
  })

  it('应能覆盖已有缓存', () => {
    useSearchCacheStore.getState().setCache({
      query: 'first',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      comics: [],
      pagination: null
    })
    useSearchCacheStore.getState().setCache({
      query: 'second',
      mode: 'author',
      source: 'jmcomic',
      searchTags: 'tag1',
      comics: [mockComic],
      pagination: mockPagination
    })

    const state = useSearchCacheStore.getState()
    expect(state.cache!.query).toBe('second')
    expect(state.cache!.mode).toBe('author')
    expect(state.cache!.source).toBe('jmcomic')
    expect(state.cache!.searchTags).toBe('tag1')
    expect(state.cache!.comics).toEqual([mockComic])
    expect(state.cache!.pagination).toEqual(mockPagination)
  })

  it('应能清除缓存', () => {
    useSearchCacheStore.getState().setCache({
      query: 'test',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      comics: [mockComic],
      pagination: mockPagination
    })

    useSearchCacheStore.getState().clearCache()

    const state = useSearchCacheStore.getState()
    expect(state.cache).toBeNull()
    expect(state.hasCache).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/stores/searchCacheStore.test.ts`
Expected: FAIL — module `@/stores/useSearchCacheStore` not found

- [ ] **Step 3: 实现 store**

```typescript
// src/stores/useSearchCacheStore.ts
import { create } from 'zustand'
import type { ComicInfo, PaginationInfo } from '@shared/types'

export interface SearchCache {
  query: string
  mode: string
  source: string
  searchTags: string
  comics: ComicInfo[]
  pagination: PaginationInfo | null
}

interface SearchCacheStoreState {
  cache: SearchCache | null
  hasCache: boolean
  setCache: (data: SearchCache) => void
  clearCache: () => void
}

export const useSearchCacheStore = create<SearchCacheStoreState>((set) => ({
  cache: null,
  hasCache: false,
  setCache: (data) => set({ cache: data, hasCache: true }),
  clearCache: () => set({ cache: null, hasCache: false }),
}))
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/unit/stores/searchCacheStore.test.ts`
Expected: PASS — all 4 tests pass

- [ ] **Step 5: 提交**

```bash
git add src/stores/useSearchCacheStore.ts tests/unit/stores/searchCacheStore.test.ts
git commit -m "feat: add useSearchCacheStore for search page state persistence"
```

---

### Task 2: SearchPage 挂载时从缓存恢复

**Files:**
- Modify: `src/pages/SearchPage.tsx:1,57-122` (imports + initial useEffect)
- Modify: `tests/unit/pages/SearchPage.test.tsx` (add mock + cache restore test)

- [ ] **Step 1: 添加缓存恢复测试**

在 `tests/unit/pages/SearchPage.test.tsx` 中添加 mock 和测试。在现有 `vi.mock` 块之后新增：

```typescript
const { mockSearchCacheStore } = vi.hoisted(() => {
  const store = {
    cache: null as SearchCache | null,
    hasCache: false,
    setCache: vi.fn(),
    clearCache: vi.fn()
  }
  return { mockSearchCacheStore: store }
})

vi.mock('@/stores/useSearchCacheStore', () => ({
  useSearchCacheStore: vi.fn(() => mockSearchCacheStore)
}))
```

需要在文件顶部 import 中加入 `SearchCache` 类型的引用（从 `@shared/types` 已有 ComicInfo / PaginationInfo，这里直接用内联结构）。

在 describe 块中 beforeEach 内加入重置：

```typescript
mockSearchCacheStore.cache = null
mockSearchCacheStore.hasCache = false
```

新增测试：

```typescript
it('restores state from cache on mount without calling search', async () => {
  const cachedComics: ComicInfo[] = [
    { id: '1', title: 'Cached Comic', url: 'https://example.com/1', coverUrl: '', source: 'test' }
  ]
  mockSearchCacheStore.cache = {
    query: 'cached query',
    mode: 'author',
    source: 'jmcomic',
    searchTags: 'tag1',
    comics: cachedComics,
    pagination: { currentPage: 3, totalPages: 5, totalItems: 50 }
  }
  mockSearchCacheStore.hasCache = true
  mockStoreState.comics = cachedComics
  mockStoreState.pagination = { currentPage: 3, totalPages: 5, totalItems: 50 }

  render(<SearchPage />)

  // Should show cached comics without calling search
  expect(mockSearch).not.toHaveBeenCalled()
  expect(screen.getByText('Cached Comic')).toBeInTheDocument()
  expect(screen.getByDisplayValue('cached query')).toBeInTheDocument()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/pages/SearchPage.test.tsx`
Expected: FAIL — test expects cache restore behavior that doesn't exist yet

- [ ] **Step 3: 修改 SearchPage 挂载逻辑**

在 `src/pages/SearchPage.tsx` 顶部添加 import：

```typescript
import { useSearchCacheStore } from '../stores/useSearchCacheStore'
```

在 SearchPage 函数组件中，添加 store 引用（约第 65 行附近，紧跟 `useComicStore` 解构之后）：

```typescript
const searchCache = useSearchCacheStore()
```

修改初始 `useEffect`（当前在第 93-122 行），将整个逻辑替换为：

```typescript
useEffect(() => {
  // 检查搜索缓存：有则恢复，无则首次加载
  const cached = searchCache.cache
  if (cached) {
    setQuery(cached.query)
    setMode(cached.mode)
    setSource(cached.source)
    setSearchTags(cached.searchTags)
    setComics(cached.comics)
    if (cached.pagination) setPagination(cached.pagination)
    return
  }

  let cancelled = false
  const gen = ++searchGenRef.current
  setLoading(true)

  getConfig().then(result => {
    if (cancelled) return
    const resolvedSource = result.config.defaultSource || source
    if (result.config.defaultSource) {
      setSource(result.config.defaultSource)
    }
    return search('', mode, 1, resolvedSource)
  }).then(result => {
    if (cancelled || gen !== searchGenRef.current) return
    if (result) {
      setComics(result.comics)
      setPagination(result.pagination)
    }
  }).catch(err => {
    if (cancelled || gen !== searchGenRef.current) return
    setError(err instanceof Error ? err.message : 'Search failed')
  }).finally(() => {
    if (!cancelled && gen === searchGenRef.current) {
      setLoading(false)
    }
  })

  return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```

- [ ] **Step 4: 运行 SearchPage 测试确认通过**

Run: `npx vitest run tests/unit/pages/SearchPage.test.tsx`
Expected: PASS — 包括新增的缓存恢复测试

- [ ] **Step 5: 提交**

```bash
git add src/pages/SearchPage.tsx tests/unit/pages/SearchPage.test.tsx
git commit -m "feat: restore search page state from cache on mount"
```

---

### Task 3: 搜索成功后写入缓存

**Files:**
- Modify: `src/pages/SearchPage.tsx` (handleSearch, handleRandom, pendingSearch effect, withLoading)

- [ ] **Step 1: 在 withLoading 中添加缓存写入**

`withLoading` 是所有搜索操作的公共路径（`SearchPage.tsx` 第 192-207 行）。在 `setComics` 和 `setPagination` 之后、try 块末尾添加缓存写入。

修改 `withLoading` 函数为：

```typescript
const withLoading = async (fn: () => Promise<{ comics: ComicInfo[]; pagination: PaginationInfo | null }>) => {
  const gen = ++searchGenRef.current
  setLoading(true)
  setError(null)
  try {
    const result = await fn()
    if (gen !== searchGenRef.current) return
    setComics(result.comics)
    if (result.pagination) setPagination(result.pagination)
    searchCache.setCache({
      query: queryRef.current,
      mode,
      source,
      searchTags: searchTagsRef.current,
      comics: result.comics,
      pagination: result.pagination ?? null,
    })
  } catch (err) {
    if (gen !== searchGenRef.current) return
    setError(err instanceof Error ? err.message : 'Request failed')
  } finally {
    if (gen === searchGenRef.current) setLoading(false)
  }
}
```

注意：这里使用 `queryRef.current` 和 `searchTagsRef.current`（已有 ref 跟踪最新值），以及 `mode` 和 `source` 的闭包值。由于 `withLoading` 是在事件处理器中调用的，`mode` 和 `source` 会捕获调用时的值。但 `queryRef.current` / `searchTagsRef.current` 通过 ref 始终获取最新值——这与现有 `pendingSearch` effect 中使用 ref 的模式一致。

- [ ] **Step 2: 在 pendingSearch effect 中添加缓存写入**

pendingSearch effect（第 135-178 行）有自己的搜索逻辑，不走 `withLoading`。在 `search(...)` 成功后添加缓存写入。

在第 169-170 行（`setComics` 和 `setPagination` 之后）插入：

```typescript
searchCache.setCache({
  query: finalQuery,
  mode: searchMode === 'tag' && !finalQuery ? 'tag' : searchMode,
  source,
  searchTags: finalTags,
  comics: result.comics,
  pagination: result.pagination ?? null,
})
```

同时需要将 `searchCache` 加入此 effect 的依赖数组中（在现有依赖数组末尾添加 `searchCache.setCache`）。实际上 `searchCache` 来自 Zustand store，`setCache` 引用稳定，不需要加依赖——保持 eslint-disable 注释即可。

- [ ] **Step 3: 运行全部搜索相关测试**

Run: `npx vitest run tests/unit/pages/SearchPage.test.tsx tests/unit/stores/searchCacheStore.test.ts`
Expected: PASS — all tests pass

- [ ] **Step 4: 提交**

```bash
git add src/pages/SearchPage.tsx
git commit -m "feat: write search state to cache after successful search"
```

---

### Task 4: 验证与清理

**Files:**
- All modified files

- [ ] **Step 1: 运行完整测试套件**

Run: `npx vitest run`
Expected: PASS — all tests pass, no regressions

- [ ] **Step 2: 手动验证**

启动应用后执行以下操作：
1. 在搜索页搜索一个关键词，翻到第 2 页或更后
2. 切换到收藏夹页面
3. 切回搜索页 — 应看到之前的关键词、来源、页数和结果列表都恢复了
4. 再切到下载页，再切回搜索页 — 状态依然保留
5. 使用 pendingSearch（从抽屉点击 tag 搜索）— 应清除旧缓存，执行新搜索，切页后新搜索结果被缓存

- [ ] **Step 3: 提交（如有遗漏修复）**

```bash
git add -A
git commit -m "fix: address review findings from search cache verification"
```
