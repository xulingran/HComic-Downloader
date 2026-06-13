# 阅读历史记录页面设计

## 概述

为 hcomic_downloader 添加阅读历史记录功能，记录用户在阅读器中实际翻页阅读过的漫画，支持查看历史列表、继续阅读、删除记录和清空历史。

## 背景

现有应用有搜索、下载、收藏、设置四个页面。用户需要一个历史记录页面来追踪阅读进度，方便回到之前看过的漫画继续阅读。

## 方案选择

选择**方案 A：在阅读器组件中直接记录**。在阅读器翻页时通过 IPC 调用后端记录历史，后端新建 HistoryMixin 用 SQLite 存储。与现有收藏功能（FavouritesPage + useFavouritesStore + 后端 handle_get_favourites）架构模式完全对称。

## 数据模型

### SQLite 表结构

```sql
CREATE TABLE IF NOT EXISTS reading_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comic_id TEXT NOT NULL,
    title TEXT NOT NULL,
    cover_url TEXT,
    source TEXT NOT NULL,
    source_url TEXT,
    last_page INTEGER DEFAULT 0,
    total_pages INTEGER DEFAULT 0,
    last_read_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(comic_id, source)
);
```

同一漫画重复阅读时执行 UPSERT，更新 `title`、`cover_url`、`source_url`、`last_page`、`total_pages` 和 `last_read_at`，不产生重复行。

## 后端设计

### IPC 接口（HistoryMixin）

| 方法 | 说明 |
|------|------|
| `handle_get_history` | 获取历史列表，支持分页，按 `last_read_at` 倒序 |
| `handle_add_history` | 添加/更新一条历史记录（UPSERT） |
| `handle_delete_history` | 删除单条历史记录（按 comic_id + source） |
| `handle_clear_history` | 清空全部历史 |

## 前端设计

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/stores/useHistoryStore.ts` | Zustand store，管理历史列表状态和缓存 |
| `src/pages/HistoryPage.tsx` | 历史记录页面组件 |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `src/components/ReaderPage.tsx` | 翻页时触发 IPC 记录历史（加 debounce） |
| `src/components/ComicReaderModal.tsx` | 翻页时触发 IPC 记录历史（如有翻页逻辑） |
| `src/components/Sidebar.tsx` | 添加"历史记录"导航项 |
| `src/App.tsx` | 添加 `history` 路由分支 |
| `shared/types.ts` | 添加 `HistoryItem` 类型定义和 IPC 方法类型 |
| `python/ipc/` 相应文件 | 注册 HistoryMixin 和 IPC 处理器 |

### useHistoryStore

与 `useFavouritesStore` 对称设计：缓存历史列表，提供 `fetchHistory`、`deleteHistory`、`clearHistory` 方法，支持分页加载。

### HistoryPage 布局

参考现有 `FavouritesPage` 的布局风格，使用 `ComicCard` 组件展示。每张卡片额外显示：

- 阅读进度（如"第12页/共30页"）
- 最后阅读时间（相对时间格式，如"2小时前"）
- 点击卡片触发"继续阅读"功能

页面顶部有"清空历史"按钮，每张卡片支持"删除记录"操作。

## 记录触发策略

在阅读器组件翻页时，使用 debounce 策略：翻页后 2 秒内无新翻页操作才触发 IPC 记录。快速翻页时只在最终停留页面记录一次。关闭阅读器时如有未保存进度，立即触发一次保存。

## 边界情况与错误处理

- **空状态**：历史为空时显示 EmptyState 组件，提示用户去搜索页发现漫画
- **清空确认**：点击"清空历史"时弹出确认对话框，防止误操作
- **数据一致性**：后端 UPSERT 保证无重复记录，漫画元数据变化时自动更新
- **继续阅读**：打开阅读器并自动跳转到 `last_page`，需要阅读器组件支持初始页码参数
