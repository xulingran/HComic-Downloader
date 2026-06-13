# 收藏夹页面缓存实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为收藏夹页面添加 Zustand 缓存，切换页面再回来时直接使用缓存数据并保留当前页码，重启程序后缓存自动清空。

**Architecture:** 新增 `useFavouritesStore`（Zustand store）在内存中缓存收藏夹数据，FavouritesPage 挂载时检查缓存决定是否发起请求。翻页成功后同步写入 store，手动刷新时清空缓存。

**Tech Stack:** Zustand, React, TypeScript

**涉及文件：**
- 新增 `src/stores/useFavouritesStore.ts`
- 修改 `src/pages/FavouritesPage.tsx`

---

### Task 1: 新增 Zustand Store — useFavouritesStore

**文件：**
- 创建：`src/stores/useFavouritesStore.ts`

- [ ] **Step 1: 创建 useFavouritesStore**

参照项目中已有的 `useSettingsStore` 模式，新建 store，定义缓存状态和 actions。

```ts
import { create } from 'zustand'
import type { ComicInfo, PaginationInfo } from '@shared/types'

interface FavouritesCache {
  comics: ComicInfo[]
  pagination: PaginationInfo | null
  currentPage: number
  downloadedStatus: Record<string, 'downloaded' | 'unknown'>
}

interface FavouritesStoreState extends FavouritesCache {
  hasCache: boolean
  setCache: (data: FavouritesCache) => void
  clearCache: () => void
}

export const useFavouritesStore = create<FavouritesStoreState>((set) => ({
  comics: [],
  pagination: null,
  currentPage: 1,
  downloadedStatus: {},
  hasCache: false,
  setCache: (data) =>
    set({
      ...data,
      hasCache: data.comics.length > 0,
    }),
  clearCache: () =>
    set({
      comics: [],
      pagination: null,
      currentPage: 1,
      downloadedStatus: {},
      hasCache: false,
    }),
}))
```

- [ ] **Step 2: 提交**

```bash
git add src/stores/useFavouritesStore.ts
git commit -m "feat: add useFavouritesStore for favourites page caching"
```

---

### Task 2: 修改 FavouritesPage — 集成缓存逻辑

**文件：**
- 修改：`src/pages/FavouritesPage.tsx`

- [ ] **Step 1: 导入 useFavouritesStore**

在文件顶部添加 store 的导入：

```ts
import { useFavouritesStore } from '../stores/useFavouritesStore'
```

- [ ] **Step 2: 在组件内获取 store**

在 `FavouritesPage` 函数体中新增：

```ts
const cache = useFavouritesStore()
```

- [ ] **Step 3: 修改挂载逻辑 — 有缓存则直接展示**

将原有的 `useEffect` 从：

```ts
useEffect(() => {
  loadFavourites(1)
}, [])
```

改为：

```ts
useEffect(() => {
  if (cache.hasCache) {
    setComics(cache.comics)
    setPagination(cache.pagination)
    setCurrentPage(cache.currentPage)
    setDownloadedStatus(cache.downloadedStatus)
  } else {
    loadFavourites(1)
  }
}, [])
```

- [ ] **Step 4: 翻页成功后写入缓存**

在 `loadFavourites` 函数的 `try` 块末尾，`checkDownloadedStatus` 的 `.then` 之后，添加：

```ts
// 写入缓存
cache.setCache({
  comics: result.comics,
  pagination: result.pagination ?? null,
  currentPage: page,
  downloadedStatus: {},
})
```

并在 `checkDownloadedStatus` 的回调中也更新缓存：

```ts
checkDownloadedStatus(result.comics).then((statusResult) => {
  if (latestPageRef.current !== pageSnapshot) return
  setDownloadedStatus(statusResult.statusMap)
  // 同步更新缓存中的 downloadedStatus
  cache.setCache({
    comics: result.comics,
    pagination: result.pagination ?? null,
    currentPage: page,
    downloadedStatus: statusResult.statusMap,
  })
}).catch(...)
```

完整的 `loadFavourites` 中的 try 块变为：

```ts
try {
  const result = await getFavourites(page)
  setComics(result.comics)
  setPagination(result.pagination ?? null)
  setNeedsLogin(result.needsLogin)
  setCurrentPage(page)

  const pageSnapshot = page
  latestPageRef.current = pageSnapshot
  checkDownloadedStatus(result.comics).then((statusResult) => {
    if (latestPageRef.current !== pageSnapshot) return
    setDownloadedStatus(statusResult.statusMap)
    cache.setCache({
      comics: result.comics,
      pagination: result.pagination ?? null,
      currentPage: page,
      downloadedStatus: statusResult.statusMap,
    })
  }).catch((err) => {
    console.error('Failed to check downloaded status:', err)
    // 即使状态检查失败，也缓存基础数据
    cache.setCache({
      comics: result.comics,
      pagination: result.pagination ?? null,
      currentPage: page,
      downloadedStatus: {},
    })
  })
} catch (err) { ... }
```

- [ ] **Step 5: 修改手动刷新按钮 — 清缓存后重新加载**

将刷新按钮的 `onClick` 从：

```tsx
onClick={() => loadFavourites(currentPage)}
```

改为：

```tsx
onClick={() => {
  cache.clearCache()
  setComics([])
  loadFavourites(1)
}}
```

- [ ] **Step 6: 提交**

```bash
git add src/pages/FavouritesPage.tsx
git commit -m "feat: integrate favourites cache in FavouritesPage"
```
