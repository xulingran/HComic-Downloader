# 阅读历史记录功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 添加阅读历史记录功能，记录用户在阅读器中实际翻页阅读过的漫画，支持查看列表、继续阅读、删除记录和清空历史。

**Architecture:** 后端新增 HistoryMixin 使用 SQLite 存储历史记录，通过 JSON-RPC IPC 暴露 4 个方法。前端新增 HistoryPage 页面和 useHistoryStore 状态管理，在阅读器翻页时通过 debounce 策略触发记录。完整 IPC 管道为：React 组件 → preload → Electron main → Python IPC server → HistoryMixin → SQLite。

**Tech Stack:** Python 3 / SQLite (后端), React + TypeScript + Zustand (前端), Electron IPC (通信)

---

## 文件结构

| 操作 | 文件路径 | 职责 |
|------|----------|------|
| 创建 | `python/ipc/history_mixin.py` | 后端 HistoryMixin，SQLite 建表 + CRUD |
| 创建 | `src/stores/useHistoryStore.ts` | 前端 Zustand store，缓存历史列表 |
| 创建 | `src/pages/HistoryPage.tsx` | 历史记录页面组件 |
| 修改 | `shared/types.ts` | 添加 HistoryItem 类型、IPC 方法定义、通道常量 |
| 修改 | `python/ipc_server.py` | 注册 HistoryMixin、添加路由 |
| 修改 | `electron/main.ts` | 添加历史记录 IPC handler 注册 |
| 修改 | `electron/preload.ts` | 暴露历史记录 API 到 window.hcomic |
| 修改 | `src/hooks/useIpc.ts` | 添加 useHistory hook |
| 修改 | `src/components/Sidebar.tsx` | 添加历史记录导航项 |
| 修改 | `src/App.tsx` | 添加 history 路由 |
| 修改 | `src/components/ComicReaderModal.tsx` | 翻页时 debounce 记录历史 |
| 修改 | `src/stores/useReaderStore.ts` | 支持初始页码参数（继续阅读） |

---

### Task 1: 添加共享类型定义

**Files:**
- Modify: `shared/types.ts`

- [ ] **Step 1: 添加 HistoryItem 接口和 IPC 类型定义**

在 `shared/types.ts` 中 `DownloadTask` 接口之后添加：

```typescript
export interface HistoryItem {
  id: number
  comicId: string
  title: string
  coverUrl: string
  source: string
  sourceUrl: string
  lastPage: number
  totalPages: number
  lastReadAt: string
  createdAt: string
}
```

在 `IPCMethods` 接口中（`clear_all_cache` 方法之后）添加：

```typescript
  get_history: {
    params: { page?: number }
    result: { items: HistoryItem[]; pagination: PaginationInfo }
  }
  add_history: {
    params: { comic_id: string; title: string; cover_url: string; source: string; source_url: string; last_page: number; total_pages: number }
    result: { success: boolean }
  }
  delete_history: {
    params: { comic_id: string; source: string }
    result: { success: boolean }
  }
  clear_history: {
    params: Record<string, never>
    result: { success: boolean }
  }
```

在 `PYTHON_IPC_CHANNEL_MAP` 中添加：

```typescript
  'python:get-history': 'get_history',
  'python:add-history': 'add_history',
  'python:delete-history': 'delete_history',
  'python:clear-history': 'clear_history',
```

在 `IPC_CHANNELS` 常量中添加：

```typescript
  GET_HISTORY: 'python:get-history',
  ADD_HISTORY: 'python:add-history',
  DELETE_HISTORY: 'python:delete-history',
  CLEAR_HISTORY: 'python:clear-history',
```

在 `HcomicAPI` 接口中（`clearAllCache` 方法之后）添加：

```typescript
  getHistory(page?: number): Promise<{ items: HistoryItem[]; pagination: PaginationInfo }>
  addHistory(comicId: string, title: string, coverUrl: string, source: string, sourceUrl: string, lastPage: number, totalPages: number): Promise<{ success: boolean }>
  deleteHistory(comicId: string, source: string): Promise<{ success: boolean }>
  clearHistory(): Promise<{ success: boolean }>
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: 可能出现新增类型未使用的警告，但不应有类型定义本身的错误

- [ ] **Step 3: 提交**

```bash
git add shared/types.ts
git commit -m "feat: add HistoryItem types and IPC definitions for reading history"
```

---

### Task 2: 后端 HistoryMixin 实现

**Files:**
- Create: `python/ipc/history_mixin.py`
- Modify: `python/ipc_server.py`

- [ ] **Step 1: 创建 history_mixin.py**

创建 `python/ipc/history_mixin.py`，内容如下：

```python
"""Reading history mixin for IPCServer."""

from __future__ import annotations

import logging
import os
import sqlite3
from collections.abc import Callable
from datetime import datetime, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

_HISTORY_PAGE_SIZE = 20


class HistoryMixin:
    """Mixin providing reading history handler methods."""

    _reading_history_db: ReadingHistoryDB

    def _init_reading_history(self) -> None:
        db_path = os.path.join(
            os.path.expanduser("~"), ".hcomic_downloader", "reading_history.db"
        )
        self._reading_history_db = ReadingHistoryDB(db_path)

    def handle_get_history(self, page: int = 1) -> dict:
        effective_page = max(1, page)
        items, total = self._reading_history_db.get_history(
            page=effective_page, page_size=_HISTORY_PAGE_SIZE
        )
        total_pages = max(1, (total + _HISTORY_PAGE_SIZE - 1) // _HISTORY_PAGE_SIZE)
        return {
            "items": items,
            "pagination": {
                "currentPage": effective_page,
                "totalPages": total_pages,
                "totalItems": total,
            },
        }

    def handle_add_history(
        self,
        comic_id: str,
        title: str,
        cover_url: str = "",
        source: str = "",
        source_url: str = "",
        last_page: int = 0,
        total_pages: int = 0,
    ) -> dict:
        self._reading_history_db.upsert(
            comic_id=comic_id,
            title=title,
            cover_url=cover_url,
            source=source,
            source_url=source_url,
            last_page=last_page,
            total_pages=total_pages,
        )
        return {"success": True}

    def handle_delete_history(self, comic_id: str, source: str) -> dict:
        self._reading_history_db.delete(comic_id=comic_id, source=source)
        return {"success": True}

    def handle_clear_history(self) -> dict:
        self._reading_history_db.clear()
        return {"success": True}


class ReadingHistoryDB:
    """SQLite-backed reading history storage."""

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("""
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
            )
        """)
        self._conn.commit()

    def upsert(
        self,
        comic_id: str,
        title: str,
        cover_url: str,
        source: str,
        source_url: str,
        last_page: int,
        total_pages: int,
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self._conn.execute(
            """
            INSERT INTO reading_history (comic_id, title, cover_url, source, source_url, last_page, total_pages, last_read_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(comic_id, source) DO UPDATE SET
                title = excluded.title,
                cover_url = excluded.cover_url,
                source_url = excluded.source_url,
                last_page = excluded.last_page,
                total_pages = excluded.total_pages,
                last_read_at = excluded.last_read_at
            """,
            (comic_id, title, cover_url, source, source_url, last_page, total_pages, now, now),
        )
        self._conn.commit()

    def get_history(self, page: int = 1, page_size: int = 20) -> tuple[list[dict], int]:
        offset = (page - 1) * page_size
        total = self._conn.execute("SELECT COUNT(*) FROM reading_history").fetchone()[0]
        rows = self._conn.execute(
            """
            SELECT id, comic_id, title, cover_url, source, source_url,
                   last_page, total_pages, last_read_at, created_at
            FROM reading_history
            ORDER BY last_read_at DESC
            LIMIT ? OFFSET ?
            """,
            (page_size, offset),
        ).fetchall()
        items = []
        for row in rows:
            items.append({
                "id": row["id"],
                "comicId": row["comic_id"],
                "title": row["title"],
                "coverUrl": row["cover_url"] or "",
                "source": row["source"],
                "sourceUrl": row["source_url"] or "",
                "lastPage": row["last_page"],
                "totalPages": row["total_pages"],
                "lastReadAt": row["last_read_at"],
                "createdAt": row["created_at"],
            })
        return items, total

    def delete(self, comic_id: str, source: str) -> None:
        self._conn.execute(
            "DELETE FROM reading_history WHERE comic_id = ? AND source = ?",
            (comic_id, source),
        )
        self._conn.commit()

    def clear(self) -> None:
        self._conn.execute("DELETE FROM reading_history")
        self._conn.commit()
```

- [ ] **Step 2: 注册 HistoryMixin 到 IPCServer**

在 `python/ipc_server.py` 中：

1. 在 import 区添加：
```python
from ipc.history_mixin import HistoryMixin  # noqa: E402
```

2. 修改 `IPCServer` 类声明，添加 `HistoryMixin`：
```python
class IPCServer(SearchMixin, CoverMixin, PreviewMixin, DownloadMixin, ConfigMixin, AuthMixin, MigrationMixin, HistoryMixin):
```

3. 在 `IPCServer.__init__` 方法中（`self._init_migration()` 之后）添加：
```python
        # Reading history database
        self._init_reading_history()
```

4. 在 `handle_request` 方法的 `handlers` 字典中添加：
```python
            "get_history": self.handle_get_history,
            "add_history": self.handle_add_history,
            "delete_history": self.handle_delete_history,
            "clear_history": self.handle_clear_history,
```

- [ ] **Step 3: 提交**

```bash
git add python/ipc/history_mixin.py python/ipc_server.py
git commit -m "feat: add HistoryMixin with SQLite-backed reading history storage"
```

---

### Task 3: Electron IPC 桥接

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: 在 main.ts 中添加历史记录 IPC handlers**

在 `electron/main.ts` 中添加新的注册函数：

```typescript
function registerHistoryHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.GET_HISTORY, async (_, page?: unknown) => {
    const p = page ?? 1
    assert(and(number(), integer(), range(1, 1000)), p, 'history page')
    return bridge.call('get_history', { page: p })
  })

  ipcMain.handle(IPC_CHANNELS.ADD_HISTORY, async (_, comicId: unknown, title: unknown, coverUrl: unknown, source: unknown, sourceUrl: unknown, lastPage: unknown, totalPages: unknown) => {
    assert(comicIdValidator, comicId, 'add_history comicId')
    assert(and(string(), length(1, 256)), title, 'add_history title')
    assert(and(string(), maxLength(2048)), coverUrl, 'add_history coverUrl')
    assert(and(string(), length(1, 64), noControlChars()), source, 'add_history source')
    assert(and(string(), maxLength(2048)), sourceUrl, 'add_history sourceUrl')
    assert(and(number(), integer(), minValue(0)), lastPage, 'add_history lastPage')
    assert(and(number(), integer(), minValue(0)), totalPages, 'add_history totalPages')
    return bridge.call('add_history', {
      comic_id: comicId,
      title,
      cover_url: coverUrl,
      source,
      source_url: sourceUrl,
      last_page: lastPage,
      total_pages: totalPages,
    })
  })

  ipcMain.handle(IPC_CHANNELS.DELETE_HISTORY, async (_, comicId: unknown, source: unknown) => {
    assert(comicIdValidator, comicId, 'delete_history comicId')
    assert(and(string(), length(1, 64), noControlChars()), source, 'delete_history source')
    return bridge.call('delete_history', { comic_id: comicId, source })
  })

  ipcMain.handle(IPC_CHANNELS.CLEAR_HISTORY, async () => {
    return bridge.call('clear_history')
  })
}
```

在 `registerIPCHandlers` 函数中添加调用：
```typescript
  registerHistoryHandlers(bridge)
```

- [ ] **Step 2: 在 preload.ts 中暴露历史记录 API**

在 `electron/preload.ts` 的 `contextBridge.exposeInMainWorld('hcomic', { ... })` 中（`clearAllCache` 之后）添加：

```typescript
  getHistory: (page?: unknown) => {
    const p = page ?? 1
    validatePage(p)
    return ipcRenderer.invoke(IPC_CHANNELS.GET_HISTORY, p)
  },

  addHistory: (comicId: unknown, title: unknown, coverUrl: unknown, source: unknown, sourceUrl: unknown, lastPage: unknown, totalPages: unknown) => {
    if (typeof comicId !== 'string' || comicId.length === 0 || comicId.length > 256) throw new Error('Invalid comicId')
    if (typeof title !== 'string' || title.length === 0 || title.length > 256) throw new Error('Invalid title')
    if (typeof coverUrl !== 'string' || coverUrl.length > 2048) throw new Error('Invalid coverUrl')
    if (typeof source !== 'string' || source.length === 0 || source.length > 64) throw new Error('Invalid source')
    if (typeof sourceUrl !== 'string' || sourceUrl.length > 2048) throw new Error('Invalid sourceUrl')
    if (typeof lastPage !== 'number' || !Number.isInteger(lastPage) || lastPage < 0) throw new Error('Invalid lastPage')
    if (typeof totalPages !== 'number' || !Number.isInteger(totalPages) || totalPages < 0) throw new Error('Invalid totalPages')
    return ipcRenderer.invoke(IPC_CHANNELS.ADD_HISTORY, comicId, title, coverUrl, source, sourceUrl, lastPage, totalPages)
  },

  deleteHistory: (comicId: unknown, source: unknown) => {
    if (typeof comicId !== 'string' || comicId.length === 0 || comicId.length > 256) throw new Error('Invalid comicId')
    if (typeof source !== 'string' || source.length === 0 || source.length > 64) throw new Error('Invalid source')
    return ipcRenderer.invoke(IPC_CHANNELS.DELETE_HISTORY, comicId, source)
  },

  clearHistory: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_HISTORY),
```

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: 无新增错误

- [ ] **Step 4: 提交**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "feat: bridge reading history IPC through Electron main and preload"
```

---

### Task 4: 前端 Store 和 Hook

**Files:**
- Create: `src/stores/useHistoryStore.ts`
- Modify: `src/hooks/useIpc.ts`

- [ ] **Step 1: 创建 useHistoryStore.ts**

创建 `src/stores/useHistoryStore.ts`：

```typescript
import { create } from 'zustand'
import type { HistoryItem, PaginationInfo } from '@shared/types'

interface HistoryCache {
  items: HistoryItem[]
  pagination: PaginationInfo | null
  currentPage: number
}

interface HistoryStoreState extends HistoryCache {
  hasCache: boolean
  setCache: (data: HistoryCache) => void
  clearCache: () => void
}

export const useHistoryStore = create<HistoryStoreState>((set) => ({
  items: [],
  pagination: null,
  currentPage: 1,
  hasCache: false,
  setCache: (data) =>
    set({
      ...data,
      hasCache: data.items.length > 0,
    }),
  clearCache: () =>
    set({
      items: [],
      pagination: null,
      currentPage: 1,
      hasCache: false,
    }),
}))
```

- [ ] **Step 2: 在 useIpc.ts 中添加 useHistory hook**

在 `src/hooks/useIpc.ts` 末尾添加：

```typescript
export function useHistory() {
  const { invoke } = useIpc()

  const getHistory = useCallback(async (page: number = 1) => {
    return invoke(() => window.hcomic!.getHistory(page))
  }, [invoke])

  const addHistory = useCallback(async (comicId: string, title: string, coverUrl: string, source: string, sourceUrl: string, lastPage: number, totalPages: number) => {
    return invoke(() => window.hcomic!.addHistory(comicId, title, coverUrl, source, sourceUrl, lastPage, totalPages))
  }, [invoke])

  const deleteHistory = useCallback(async (comicId: string, source: string) => {
    return invoke(() => window.hcomic!.deleteHistory(comicId, source))
  }, [invoke])

  const clearHistory = useCallback(async () => {
    return invoke(() => window.hcomic!.clearHistory())
  }, [invoke])

  return { getHistory, addHistory, deleteHistory, clearHistory }
}
```

- [ ] **Step 3: 提交**

```bash
git add src/stores/useHistoryStore.ts src/hooks/useIpc.ts
git commit -m "feat: add useHistoryStore and useHistory hook for reading history"
```

---

### Task 5: 导航和路由集成

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: 修改 Sidebar.tsx 添加历史记录导航项**

在 `src/components/Sidebar.tsx` 的 `menuItems` 数组中，在 `favourites` 和 `settings` 之间插入：

```typescript
const menuItems = [
  { id: 'search', label: '搜索', icon: '🔍' },
  { id: 'downloads', label: '下载管理', icon: '📥' },
  { id: 'favourites', label: '收藏夹', icon: '⭐' },
  { id: 'history', label: '历史记录', icon: '📖' },
  { id: 'settings', label: '设置', icon: '⚙️' }
]
```

- [ ] **Step 2: 修改 App.tsx 添加路由**

在 `src/App.tsx` 中：

1. 在文件顶部 import 区添加：
```typescript
import { HistoryPage } from './pages/HistoryPage'
```

2. 在 `renderPage` 函数的 switch 中，`favourites` 和 `settings` case 之间添加：
```typescript
      case 'history':
        return <HistoryPage />
```

- [ ] **Step 3: 提交**

```bash
git add src/components/Sidebar.tsx src/App.tsx
git commit -m "feat: add history page navigation and route"
```

---

### Task 6: 历史记录页面组件

**Files:**
- Create: `src/pages/HistoryPage.tsx`

- [ ] **Step 1: 创建 HistoryPage.tsx**

创建 `src/pages/HistoryPage.tsx`：

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import { useHistory } from '../hooks/useIpc'
import { ComicCard } from '../components/common/ComicCard'
import { PaginationControls } from '../components/common/PaginationControls'
import { PageJumpDialog } from '../components/common/PageJumpDialog'
import { ErrorDisplay } from '../components/common/ErrorDisplay'
import { EmptyState } from '../components/common/EmptyState'
import { HistoryItem, PaginationInfo } from '@shared/types'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useHistoryStore } from '../stores/useHistoryStore'
import { useReaderStore } from '../stores/useReaderStore'

function formatRelativeTime(isoString: string): string {
  const now = Date.now()
  const then = new Date(isoString).getTime()
  const diffMs = now - then
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}个月前`
  return `${Math.floor(months / 12)}年前`
}

function historyItemToComicInfo(item: HistoryItem) {
  return {
    id: item.comicId,
    title: item.title,
    url: item.sourceUrl,
    coverUrl: item.coverUrl,
    source: item.source,
    pages: item.totalPages || undefined,
  }
}

export function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pagination, setPagination] = useState<PaginationInfo | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [showJumpDialog, setShowJumpDialog] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const { getHistory, deleteHistory, clearHistory } = useHistory()
  const { cardStyle } = useSettingsStore()
  const cache = useHistoryStore()
  const { openReader } = useReaderStore()
  const latestPageRef = useRef(1)
  const mountedRef = useRef(true)

  const loadHistory = useCallback(async (page: number = 1) => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await getHistory(page)
      setItems(result.items)
      setPagination(result.pagination ?? null)
      setCurrentPage(page)
      latestPageRef.current = page
      cache.setCache({
        items: result.items,
        pagination: result.pagination ?? null,
        currentPage: page,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载历史记录失败')
    } finally {
      setIsLoading(false)
    }
  }, [getHistory, cache.setCache])

  useEffect(() => {
    mountedRef.current = true
    if (cache.hasCache) {
      setItems(cache.items)
      setPagination(cache.pagination)
      setCurrentPage(cache.currentPage)
    } else {
      loadHistory(1)
    }
    return () => { mountedRef.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleOpenReader = (item: HistoryItem) => {
    openReader(historyItemToComicInfo(item))
  }

  const handleDelete = async (item: HistoryItem) => {
    try {
      await deleteHistory(item.comicId, item.source)
      cache.clearCache()
      loadHistory(currentPage)
    } catch (err) {
      console.error('Failed to delete history item:', err)
    }
  }

  const handleClearAll = async () => {
    try {
      await clearHistory()
      setShowClearConfirm(false)
      cache.clearCache()
      setItems([])
      setPagination(null)
      loadHistory(1)
    } catch (err) {
      console.error('Failed to clear history:', err)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-[var(--text-secondary)]">加载中...</div>
      </div>
    )
  }

  if (error) {
    return <ErrorDisplay message={error} />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            历史记录
          </h2>
          <button
            onClick={() => {
              cache.clearCache()
              setItems([])
              loadHistory(1)
            }}
            className="px-3 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border)]
                       rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
          >
            刷新
          </button>
          {items.length > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="px-3 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border)]
                         rounded-lg hover:bg-red-50 hover:border-red-300 hover:text-red-600
                         dark:hover:bg-red-950 dark:hover:border-red-800 transition-colors
                         text-[var(--text-secondary)]"
            >
              清空历史
            </button>
          )}
        </div>
        {pagination && pagination.totalPages > 1 && (
          <PaginationControls
            currentPage={currentPage}
            totalPages={pagination.totalPages}
            onNavigate={loadHistory}
            onJumpClick={() => setShowJumpDialog(true)}
          />
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState message="还没有阅读记录，去搜索页发现感兴趣的漫画吧" />
      ) : (
        <>
          <div className={cardStyle === 'detailed'
            ? 'flex flex-col bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden'
            : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4'
          }>
            {items.map((item) => (
              <HistoryCard
                key={`${item.comicId}-${item.source}`}
                item={item}
                cardStyle={cardStyle}
                onOpen={() => handleOpenReader(item)}
                onDelete={() => handleDelete(item)}
              />
            ))}
          </div>
        </>
      )}

      {showJumpDialog && pagination && (
        <PageJumpDialog
          totalPages={pagination.totalPages || 1}
          onJump={(page) => { loadHistory(page); setShowJumpDialog(false) }}
          onClose={() => setShowJumpDialog(false)}
        />
      )}

      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-[var(--bg-primary)] rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-[var(--text-primary)] mb-2">确认清空</h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">确定要清空所有阅读历史记录吗？此操作不可撤销。</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)]
                           hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleClearAll}
                className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                清空
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function HistoryCard({ item, cardStyle, onOpen, onDelete }: {
  item: HistoryItem
  cardStyle: 'cover' | 'detailed'
  onOpen: () => void
  onDelete: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const comic = historyItemToComicInfo(item)

  if (cardStyle === 'detailed') {
    return (
      <div
        className="flex items-center px-4 py-2.5 cursor-pointer transition-colors duration-150
                    border-b border-[var(--border)] hover:bg-[var(--bg-secondary)] group"
        onClick={onOpen}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-[var(--text-primary)] truncate" title={item.title}>
            {item.title}
          </h3>
          <div className="text-xs text-[var(--text-secondary)] mt-0.5">
            {item.totalPages > 0 && <span>第{item.lastPage}/{item.totalPages}页</span>}
            {item.totalPages > 0 && <span className="mx-1.5">·</span>}
            <span>{formatRelativeTime(item.lastReadAt)}</span>
          </div>
        </div>
        {hovered && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="flex-shrink-0 ml-2 px-2 py-1 text-xs rounded bg-red-500/10 text-red-500
                       hover:bg-red-500/20 transition-colors"
          >
            删除
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      className="bg-[var(--bg-primary)] rounded-xl shadow-sm hover:shadow-md transition-all duration-200
                 cursor-pointer overflow-hidden group relative"
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="absolute top-2 left-2 z-10 w-8 h-8 rounded-full bg-black/50 text-white
                     flex items-center justify-center hover:bg-red-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      )}
      <ComicCard
        comic={comic}
        onOpenReader={onOpen}
      />
      <div className="px-2 pb-2 -mt-1">
        <div className="text-xs text-[var(--text-secondary)]">
          {item.totalPages > 0 && <span>第{item.lastPage}/{item.totalPages}页</span>}
          {item.totalPages > 0 && <span className="mx-1">·</span>}
          <span>{formatRelativeTime(item.lastReadAt)}</span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 提交**

```bash
git add src/pages/HistoryPage.tsx
git commit -m "feat: add HistoryPage component with list, delete, and clear"
```

---

### Task 7: 阅读器集成 - 记录历史

**Files:**
- Modify: `src/stores/useReaderStore.ts`
- Modify: `src/components/ComicReaderModal.tsx`

- [ ] **Step 1: 扩展 useReaderStore 支持初始页码**

修改 `src/stores/useReaderStore.ts`，支持传入初始页码：

```typescript
import { create } from 'zustand'
import { ComicInfo } from '@shared/types'

interface ReaderState {
  readerComic: ComicInfo | null
  initialPage: number | null
  openReader: (comic: ComicInfo, initialPage?: number) => void
  closeReader: () => void
}

export const useReaderStore = create<ReaderState>((set) => ({
  readerComic: null,
  initialPage: null,
  openReader: (comic, initialPage) => set({ readerComic: comic, initialPage: initialPage ?? null }),
  closeReader: () => set({ readerComic: null, initialPage: null }),
}))
```

- [ ] **Step 2: 在 ComicReaderModal 中添加历史记录逻辑**

在 `src/components/ComicReaderModal.tsx` 中：

1. 在文件顶部 import 区添加：
```typescript
import { useHistory } from '../hooks/useIpc'
import { useHistoryStore } from '../stores/useHistoryStore'
```

2. 在 `ComicReaderModal` 函数组件内部，在现有 hooks 之后添加：
```typescript
  const { addHistory } = useHistory()
  const historyStore = useHistoryStore()
  const lastRecordedPageRef = useRef<number>(0)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const recordHistory = useCallback((page: number) => {
    if (!comic || page === lastRecordedPageRef.current) return
    lastRecordedPageRef.current = page
    addHistory(
      comic.id,
      comic.title,
      comic.coverUrl,
      comic.source,
      comic.url,
      page,
      totalPages,
    ).catch((err) => {
      console.error('Failed to record history:', err)
    }).finally(() => {
      historyStore.clearCache()
    })
  }, [comic, totalPages, addHistory, historyStore])
```

3. 添加 debounce 效果（在现有 useEffect 之后）：
```typescript
  // Debounced history recording on page change
  useEffect(() => {
    if (!open || !comic || loadingState !== 'loaded' || currentPage <= 0) return
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(() => {
      recordHistory(currentPage)
    }, 2000)
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [open, comic?.id, currentPage, loadingState, recordHistory])
```

4. 修改 reset 和 clearCache 的 useEffect（当 modal 关闭时立即保存进度）：
在现有的 `useEffect` 中（处理 `open && comic` 的那个），在 `else` 分支中的 `reset()` 之前添加立即保存逻辑：
```typescript
  useEffect(() => {
    if (open && comic) {
      fetchUrls(comic)
    } else {
      // Modal closing — save current page immediately if needed
      if (comic && currentPage > 0 && currentPage !== lastRecordedPageRef.current) {
        addHistory(
          comic.id,
          comic.title,
          comic.coverUrl,
          comic.source,
          comic.url,
          currentPage,
          totalPages,
        ).catch(() => {})
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      lastRecordedPageRef.current = 0
      reset()
      clearCache()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, comic?.id, fetchUrls, reset, clearCache])
```

- [ ] **Step 3: 提交**

```bash
git add src/stores/useReaderStore.ts src/components/ComicReaderModal.tsx
git commit -m "feat: integrate reading history recording in ComicReaderModal with debounce"
```

---

### Task 8: 验证与集成测试

**Files:**
- All modified files

- [ ] **Step 1: 运行 TypeScript 编译检查**

Run: `npx tsc --noEmit 2>&1`
Expected: 无错误

- [ ] **Step 2: 运行 lint 检查**

Run: `npm run lint 2>&1 | head -40`
Expected: 无新增 lint 错误

- [ ] **Step 3: 运行现有测试**

Run: `npx vitest run 2>&1 | tail -20`
Expected: 所有现有测试通过

- [ ] **Step 4: 手动冒烟测试（需要 Electron 环境）**

启动应用后验证：
1. 侧边栏出现"历史记录"图标
2. 点击进入历史记录页面，显示空状态
3. 打开一个漫画并在阅读器中翻页
4. 等待 2 秒后关闭阅读器
5. 返回历史记录页面，看到刚才阅读的漫画
6. 点击漫画可以继续阅读
7. 删除单条记录和清空历史功能正常

- [ ] **Step 5: 最终提交**

```bash
git add -A
git commit -m "feat: complete reading history feature integration"
```
