---
title: 搜索页状态缓存
date: 2026-05-31
status: approved
---

# 搜索页状态缓存设计

## 目标

搜索页切换到其他页面再切回来时，完全恢复上次的状态（搜索关键词、模式、来源、标签、页数、结果列表），而不是重新加载第 1 页。

## 现状

- 搜索页 (`SearchPage`) 的 query、mode、source、searchTags 是组件内 `useState`
- 切换页面时组件卸载，所有本地状态丢失
- 重新挂载时 `useEffect` 始终加载第 1 页热门漫画
- 收藏页已有类似机制：`useFavouritesStore` 缓存完整状态，切回时从缓存恢复

## 方案

新建 Zustand 缓存 store，与收藏页的 `useFavouritesStore` 对称。

### 新文件：`src/stores/useSearchCacheStore.ts`

```typescript
interface SearchCache {
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
```

- 只缓存最近一次搜索，不需要按来源分桶
- `cache` 为 `null` 表示无缓存（首次使用或被清除）

### 修改文件：`src/pages/SearchPage.tsx`

**与 useComicStore 的分工：**

| Store | 职责 |
|---|---|
| `useComicStore` | 瞬时 UI 状态：comics, pagination, isLoading, error |
| `useSearchCacheStore` | 跨卸载持久化快照：query, mode, source, tags, comics, pagination |

**挂载逻辑：**

```
挂载时：
├─ 有缓存 → 从 cache 恢复本地 state (query, mode, source, searchTags)
│          → setComics / setPagination 写入 useComicStore
│          → 跳过网络请求
└─ 无缓存 → 走原有首次加载逻辑（读 defaultSource 配置，加载第 1 页）
```

**搜索成功后：**

```
搜索请求完成：
├─ useComicStore.setComics / setPagination  ← 现有逻辑不变
└─ useSearchCacheStore.setCache(...)         ← 新增：写入快照
```

涉及的搜索入口：
- `handleSearch` — 用户手动搜索
- `handleRandom` — 随机推荐
- `pendingSearch` effect — 从抽屉跳转的搜索

**渲染代码不改**，SearchPage 仍然从 `useComicStore` 读取 comics/pagination/isLoading/error。

## 不涉及

- 不改 useComicStore 本身
- 不改 App.tsx 的页面切换逻辑
- 不改收藏页现有行为
