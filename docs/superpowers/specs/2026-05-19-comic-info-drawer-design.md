# 漫画信息抽屉（ComicInfoDrawer）设计

## 概述

在点击漫画卡片标题时，从右侧滑出抽屉面板，展示漫画的完整文本信息（标题、作者、标签等）。用户可选中复制标题，也可点击作者或标签直接跳转搜索页执行对应搜索。该功能不受 SFW 模式限制，不加载任何图片。

## 涉及文件

| 操作 | 文件 |
|------|------|
| 新建 | `src/stores/useDrawerStore.ts` |
| 新建 | `src/components/ComicInfoDrawer.tsx` |
| 修改 | `src/components/common/ComicCard.tsx` |
| 修改 | `src/App.tsx` |
| 修改 | `src/pages/SearchPage.tsx` |

## 1. Drawer Store（useDrawerStore）

Zustand store，管理抽屉状态和待执行搜索。

### State

```typescript
drawerComic: ComicInfo | null    // 当前展示的漫画，null 表示关闭
pendingSearch: { query: string; mode: string } | null  // 待执行的搜索
```

### Actions

```typescript
openDrawer(comic: ComicInfo)      // 设置 drawerComic，打开抽屉
closeDrawer()                     // 置空 drawerComic，关闭抽屉
setPendingSearch(query: string, mode: string)  // 设置待执行搜索
clearPendingSearch()              // 清除待执行搜索
```

## 2. ComicInfoDrawer 组件

右侧固定定位抽屉面板，宽度约 320px，带 CSS transition 滑入/滑出动画。

### 布局结构

- **头部**：「漫画详情」标题 + 关闭按钮（✕）
- **标题**：完整标题文本，`user-select: text`，可选中复制
- **作者**：accent 色高亮，hover 时显示下划线，点击 → `setPendingSearch(author, 'author')` + 关闭抽屉 + 跳转搜索页
- **来源/页数**：纯文本（如 `nhentai · 42 页`）
- **标签列表**：所有标签以 pill 形式展示，accent 色背景，hover 时高亮，点击 → `setPendingSearch(tag, 'tag')` + 同上跳转逻辑

### 交互

- 左侧半透明遮罩层，点击关闭抽屉
- 无图片加载（纯文本信息展示）
- 不受 SFW 模式影响

### Props

无需 props，通过 useDrawerStore 读取状态。

## 3. ComicCard 变更

CoverCard 和 DetailedCard 中的标题点击行为统一变更：

**之前**：
- SFW 模式：展开/收起标题
- 非 SFW 模式：打开阅读器

**之后**：
- 所有模式：打开抽屉（`openDrawer(comic)`）

`titleExpanded` 状态和 `onToggleTitle` 回调可以移除，因为抽屉完整展示了标题信息。

## 4. 搜索跳转数据流

用户点击抽屉中的作者或标签时：

1. `ComicInfoDrawer` 调用 `setPendingSearch(query, mode)` + `closeDrawer()`
2. App.tsx 监听 `pendingSearch` 变化，非 null 时执行 `setActivePage('search')`
3. SearchPage 用 `useEffect` 监听 `pendingSearch`：有值时填充 query、设置 mode、执行搜索，然后调用 `clearPendingSearch()`
4. 如果用户已在搜索页，监听机制同样生效（不仅限于 mount 时）

## 5. 不涉及的变更

- SFW 逻辑不变 — 抽屉始终可打开，不涉及封面图
- 阅读器入口不变 — 点击封面区域仍然打开阅读器
- ComicCard 的其他功能（下载按钮、批量选择、下载状态指示器）保持不变
- DetailedCard 中已有的标签展示保持原样，抽屉是独立的额外入口
