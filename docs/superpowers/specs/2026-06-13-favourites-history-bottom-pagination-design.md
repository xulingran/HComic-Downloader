# Favourites / History Bottom Pagination Design

## Summary

在收藏页与历史记录页的列表底部各加一组翻页控件，与已有的顶部翻页控件行为一致，复用现有 `PaginationControls` 组件与已有 state/handler，不引入新逻辑。

## Background

- 搜索页 `SearchPage.tsx:647-656` 已有底部分页（`flex justify-center` 包裹 `PaginationControls`）
- 收藏页 `FavouritesPage.tsx:295-302` 仅有顶部分页（无包裹）
- 历史记录页 `HistoryPage.tsx:249-256` 仅有顶部分页（无包裹）
- 长列表滚到底部再回到顶部翻页体验差，需要在底部再放一组

## Design

### 复用面

两个页面的顶部分页已经接好的 props 全部直接复用：

| Prop | FavouritesPage 来源 | HistoryPage 来源 |
|------|---------------------|------------------|
| `currentPage` | 本组件 state | 本组件 state |
| `totalPages` | `pagination.totalPages` | `pagination.totalPages` |
| `onNavigate` | `loadFavourites` | `loadHistory` |
| `onJumpClick` | `() => setShowJumpDialog(true)` | `() => setShowJumpDialog(true)` |

### FavouritesPage.tsx

在第 348 行（卡片网格 `</div>` 之后、`PageJumpDialog` 之前）插入：

```tsx
{!isLoading && !needsLogin && pagination && pagination.totalPages > 1 && (
  <div className="flex justify-center">
    <PaginationControls
      currentPage={currentPage}
      totalPages={pagination.totalPages}
      onNavigate={loadFavourites}
      onJumpClick={() => setShowJumpDialog(true)}
    />
  </div>
)}
```

条件比顶部分页多一个 `!isLoading`（与 SearchPage 底部一致），避免加载过程中底部出现孤立分页条。

### HistoryPage.tsx

在第 276 行（卡片网格 `</div>` 之后、`PageJumpDialog` 之前）插入：

```tsx
{!isLoading && pagination && pagination.totalPages > 1 && (
  <div className="flex justify-center">
    <PaginationControls
      currentPage={currentPage}
      totalPages={pagination.totalPages}
      onNavigate={loadHistory}
      onJumpClick={() => setShowJumpDialog(true)}
    />
  </div>
)}
```

HistoryPage 没有 `needsLogin` 概念，条件与该页顶部分页对齐并加 `!isLoading`。

### 视觉

- `flex justify-center` 让分页居中，与 SearchPage 底部一致
- 顶部分页维持现状（无包裹），不在本次范围内改动

## Scope

- 仅改动 `FavouritesPage.tsx`、`HistoryPage.tsx` 两个文件
- 不抽取共享组件（两个页面 props 来源不同，强行抽象会引入间接层，YAGNI）
- 不改动顶部分页的条件/样式
- 不改动 `PaginationControls` 自身
- 不引入新的 state、handler 或 store 字段

## Testing

- 现有 `PaginationControls` 单元测试覆盖组件本身，无需新增
- 手动验证：收藏页/历史页加载多页数据时，底部翻页与顶部翻页行为等价；点底部"下一页"等价于点顶部"下一页"
- 自动化检查：跑 ESLint、`tsc --noEmit`
