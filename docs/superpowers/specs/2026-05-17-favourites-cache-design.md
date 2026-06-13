# 收藏夹页面缓存设计

## 概述

在收藏夹页面中，用户切换到其他页面再切换回来时，直接从缓存读取数据，不重新发起网络请求，并保留当前页码。缓存仅在一次会话内有效，程序重启后缓存自动消失，首次打开收藏夹仍从第一页加载。

## 当前问题

- `App.tsx` 使用条件渲染切换页面，`FavouritesPage` 在切页时会完全卸载
- 切回来时重新挂载，`useEffect` 触发 `loadFavourites(1)`，总是从第 1 页重新请求后端数据
- 前端无缓存机制，每次切回都显示 loading 状态

## 方案：Zustand Store 缓存（已选定）

项目已使用 Zustand（`useSettingsStore`），无额外依赖。通过新建一个 `useFavouritesStore` 在内存中缓存收藏夹数据，在组件卸载时 store 数据不丢失，重新挂载时直接读取。

## 状态结构

```ts
interface FavouritesCache {
  comics: ComicInfo[]
  pagination: PaginationInfo | null
  currentPage: number
  downloadedStatus: Record<string, 'downloaded' | 'unknown'>
}
```

## Store 接口

| 字段/方法 | 类型 | 说明 |
|-----------|------|------|
| `comics` | `ComicInfo[]` | 当前页漫画列表 |
| `pagination` | `PaginationInfo \| null` | 分页信息 |
| `currentPage` | `number` | 当前页码 |
| `downloadedStatus` | `Record<string, ...>` | 下载状态映射 |
| `hasCache` | `boolean` (getter) | 是否存在有效缓存（comics.length > 0） |
| `setCache(data)` | action | 写入缓存数据 |
| `clearCache()` | action | 清除所有缓存 |

不使用 `persist`（不持久化到 localStorage），重启程序后缓存自动消失。

## 改动文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/stores/useFavouritesStore.ts` | 新增 | 定义 Zustand store |
| `src/pages/FavouritesPage.tsx` | 修改 | 挂载时检查缓存，翻页后写入缓存 |

## 行为逻辑

### 组件挂载（useEffect）

```
if (store.hasCache):
  直接从 store 读取 comics / pagination / currentPage / downloadedStatus
  设置本地 state，不调用 API
  不显示 loading
else:
  调 loadFavourites(1) — 正常请求流程（显示 loading）
```

### 翻页（loadFavourites 成功后）

```
更新本地 state
调用 store.setCache({ comics, pagination, currentPage, downloadedStatus })
```

### 手动刷新

```
调用 store.clearCache()
清空本地 comics（避免旧数据闪现）
调 loadFavourites(1) — 回到第一页重新加载
```

### 重启程序

Zustand store 无 persist，内存中数据丢失，`hasCache` 为 false。
首次打开收藏夹时走正常加载流程，从第一页开始。

## 边界情况

- **无缓存首次打开** → 正常加载，显示 loading
- **缓存存在 + 切回来** → 直接展示缓存数据，无 loading，无 API 调用
- **手动刷新** → 清缓存 → 回到第 1 页重新加载
- **重启程序** → 缓存自然消失，首次打开从第一页加载
- **跨设备数据变更** → 纯缓存模式，用户需手动刷新才能看到变化
