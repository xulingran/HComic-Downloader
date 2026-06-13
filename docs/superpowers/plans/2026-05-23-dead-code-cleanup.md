# 死代码清理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除所有确认无人使用的死代码、调试残留和冗余导出

**Architecture:** 纯删除操作，不新增任何代码。按依赖关系从叶子节点向上清理：先删不被任何文件引用的独立组件，再删 store/hook 中的死字段，最后清理调试残留。

**Tech Stack:** TypeScript, React, Electron, Vitest

---

## File Structure

### 删除的文件
- `src/components/Header.tsx` — 无源码引用的搜索栏组件
- `src/components/StatusBar.tsx` — 无源码引用的下载状态栏组件
- `src/components/common/LoginExpiredDialog.tsx` — 无任何引用的登录过期弹窗
- `tests/unit/components/Header.test.tsx` — Header 的测试
- `tests/unit/components/StatusBar.test.tsx` — StatusBar 的测试

### 修改的文件
- `src/stores/useComicStore.ts` — 删除 `detailPrefetchGeneration` 和 `bumpDetailPrefetch`
- `src/stores/useDownloadStore.ts` — 删除 `addTask` 方法及 `insertTaskByStatus` 辅助函数（仅 `addTask` 使用）
- `src/hooks/useCoverImage.ts` — 删除 `clearCoverCache` 导出
- `electron/validators.ts` — 删除 `array` 和 `optional` 函数
- `src/pages/SearchPage.tsx` — 删除 `handleComicClick` 及其 `console.log`
- `src/pages/FavouritesPage.tsx` — 删除 `handleComicClick` 及其 `console.log`
- `src/hooks/useComicReader.ts` — 删除 `logPreviewDebug` 函数及调用
- `electron/main.ts` — 删除 `logPreviewDebug` 函数及调用
- `tests/unit/stores/downloadStore.test.ts` — 将 `addTask` 测试改为 `upsertTask` 测试

---

### Task 1: 删除 LoginExpiredDialog

**Files:**
- Delete: `src/components/common/LoginExpiredDialog.tsx`

- [ ] **Step 1: 确认无引用后删除文件**

Run: `grep -r "LoginExpiredDialog" src/ electron/ tests/ --include="*.ts" --include="*.tsx"`
Expected: 无结果（grep 未找到任何引用）

Run: `rm src/components/common/LoginExpiredDialog.tsx`

- [ ] **Step 2: 运行测试确认无回归**

Run: `npx vitest run`
Expected: 全部通过

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore: remove unused LoginExpiredDialog component"
```

---

### Task 2: 删除 Header 组件及测试

**Files:**
- Delete: `src/components/Header.tsx`
- Delete: `tests/unit/components/Header.test.tsx`

- [ ] **Step 1: 确认无源码引用后删除文件**

Run: `grep -r "from.*Header\|import.*Header" src/ --include="*.ts" --include="*.tsx" | grep -v "Header.test"`
Expected: 无结果

Run: `rm src/components/Header.tsx tests/unit/components/Header.test.tsx`

- [ ] **Step 2: 运行测试确认无回归**

Run: `npx vitest run`
Expected: 全部通过

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore: remove unused Header component and test"
```

---

### Task 3: 删除 StatusBar 组件及测试

**Files:**
- Delete: `src/components/StatusBar.tsx`
- Delete: `tests/unit/components/StatusBar.test.tsx`

- [ ] **Step 1: 确认无源码引用后删除文件**

Run: `grep -r "from.*StatusBar\|import.*StatusBar" src/ --include="*.ts" --include="*.tsx" | grep -v "StatusBar.test"`
Expected: 无结果

Run: `rm src/components/StatusBar.tsx tests/unit/components/StatusBar.test.tsx`

- [ ] **Step 2: 运行测试确认无回归**

Run: `npx vitest run`
Expected: 全部通过

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore: remove unused StatusBar component and test"
```

---

### Task 4: 清理 useComicStore 死字段

**Files:**
- Modify: `src/stores/useComicStore.ts`

- [ ] **Step 1: 从 useComicStore.ts 删除 `detailPrefetchGeneration` 和 `bumpDetailPrefetch`**

确认无外部使用：

Run: `grep -r "detailPrefetchGeneration\|bumpDetailPrefetch" src/ --include="*.ts" --include="*.tsx"`
Expected: 仅在 `useComicStore.ts` 自身出现

将 `src/stores/useComicStore.ts` 修改为：

```typescript
import { create } from 'zustand'
import { ComicInfo, PaginationInfo } from '@shared/types'

interface ComicState {
  comics: ComicInfo[]
  pagination: PaginationInfo | null
  isLoading: boolean
  error: string | null
  setComics: (comics: ComicInfo[]) => void
  setPagination: (pagination: PaginationInfo) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useComicStore = create<ComicState>((set) => ({
  comics: [],
  pagination: null,
  isLoading: false,
  error: null,
  setComics: (comics) => set({ comics }),
  setPagination: (pagination) => set({ pagination }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
}))
```

- [ ] **Step 2: 运行测试确认无回归**

Run: `npx vitest run`
Expected: 全部通过

- [ ] **Step 3: 提交**

```bash
git add src/stores/useComicStore.ts
git commit -m "chore: remove unused detailPrefetchGeneration from comicStore"
```

---

### Task 5: 清理 useDownloadStore 的 addTask 及辅助函数

**Files:**
- Modify: `src/stores/useDownloadStore.ts`
- Modify: `tests/unit/stores/downloadStore.test.ts`

- [ ] **Step 1: 确认源码中 addTask 无调用**

Run: `grep -r "addTask" src/ --include="*.ts" --include="*.tsx"`
Expected: 仅在 `useDownloadStore.ts` 定义中出现

- [ ] **Step 2: 修改 useDownloadStore.ts，删除 `addTask`、`insertTaskByStatus` 及接口声明**

将 `src/stores/useDownloadStore.ts` 修改为：

```typescript
import { create } from 'zustand'
import { DownloadTask } from '@shared/types'

interface DownloadState {
  tasks: DownloadTask[]
  isGloballyPaused: boolean
  setTasks: (tasks: DownloadTask[]) => void
  upsertTask: (task: DownloadTask) => void
  updateTask: (id: string, updates: Partial<DownloadTask>) => void
  removeTask: (id: string) => void
  setGlobalPaused: (paused: boolean) => void
}

function insertTaskByStatus(tasks: DownloadTask[], newTask: DownloadTask): DownloadTask[] {
  const isCompleted = (status: string) => status === 'completed' || status === 'cancelled'

  let lastIncompleteIndex = -1
  for (let i = tasks.length - 1; i >= 0; i--) {
    if (!isCompleted(tasks[i].status)) {
      lastIncompleteIndex = i
      break
    }
  }

  const insertAt = lastIncompleteIndex + 1
  const result = [...tasks]
  result.splice(insertAt, 0, newTask)
  return result
}

export const useDownloadStore = create<DownloadState>((set) => ({
  tasks: [],
  isGloballyPaused: false,
  setTasks: (tasks) => set({ tasks }),
  upsertTask: (task) =>
    set((state) => {
      const exists = state.tasks.some((t) => t.id === task.id)
      return exists
        ? { tasks: state.tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t)) }
        : { tasks: insertTaskByStatus(state.tasks, task) }
    }),
  updateTask: (id, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t))
    })),
  removeTask: (id) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id)
    })),
  setGlobalPaused: (paused) => set({ isGloballyPaused: paused }),
}))
```

注意：`insertTaskByStatus` 必须保留，因为 `upsertTask` 在新增场景下调用了它。

- [ ] **Step 3: 更新 downloadStore.test.ts，将 addTask 测试改为 upsertTask**

将 `tests/unit/stores/downloadStore.test.ts` 修改为：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useDownloadStore } from '@/stores/useDownloadStore'
import type { DownloadTask } from '@shared/types'

const mockTask: DownloadTask = {
  id: 'task-1',
  comic: {
    id: '1',
    title: 'Test Comic',
    url: 'https://example.com/comic/1',
    coverUrl: 'https://example.com/cover.jpg',
    source: 'test'
  },
  status: 'downloading',
  progress: 50,
  totalPages: 10,
  downloadedPages: 5
}

describe('useDownloadStore', () => {
  beforeEach(() => {
    useDownloadStore.setState({ tasks: [] })
  })

  it('应有空的初始任务列表', () => {
    expect(useDownloadStore.getState().tasks).toEqual([])
  })

  it('应能设置所有任务', () => {
    useDownloadStore.getState().setTasks([mockTask])
    expect(useDownloadStore.getState().tasks).toEqual([mockTask])
  })

  it('应能通过 upsertTask 添加新任务', () => {
    useDownloadStore.getState().upsertTask(mockTask)
    expect(useDownloadStore.getState().tasks).toHaveLength(1)
    expect(useDownloadStore.getState().tasks[0].id).toBe('task-1')
  })

  it('upsertTask 应能更新已存在的任务', () => {
    useDownloadStore.getState().upsertTask(mockTask)
    useDownloadStore.getState().upsertTask({ ...mockTask, progress: 80, downloadedPages: 8 })
    const tasks = useDownloadStore.getState().tasks
    expect(tasks).toHaveLength(1)
    expect(tasks[0].progress).toBe(80)
    expect(tasks[0].downloadedPages).toBe(8)
  })

  it('应能更新指定任务', () => {
    useDownloadStore.getState().upsertTask(mockTask)
    useDownloadStore.getState().updateTask('task-1', { progress: 80, downloadedPages: 8 })
    const task = useDownloadStore.getState().tasks[0]
    expect(task.progress).toBe(80)
    expect(task.downloadedPages).toBe(8)
  })

  it('更新不存在的任务应无效果', () => {
    useDownloadStore.getState().upsertTask(mockTask)
    useDownloadStore.getState().updateTask('non-existent', { progress: 100 })
    expect(useDownloadStore.getState().tasks[0].progress).toBe(50)
  })

  it('应能移除任务', () => {
    useDownloadStore.getState().upsertTask(mockTask)
    useDownloadStore.getState().removeTask('task-1')
    expect(useDownloadStore.getState().tasks).toHaveLength(0)
  })

  it('移除不存在的任务应无效果', () => {
    useDownloadStore.getState().upsertTask(mockTask)
    useDownloadStore.getState().removeTask('non-existent')
    expect(useDownloadStore.getState().tasks).toHaveLength(1)
  })

  it('应能更新任务状态为 completed', () => {
    useDownloadStore.getState().upsertTask(mockTask)
    useDownloadStore.getState().updateTask('task-1', { status: 'completed', progress: 100 })
    expect(useDownloadStore.getState().tasks[0].status).toBe('completed')
  })

  it('应能更新任务状态为 failed', () => {
    useDownloadStore.getState().upsertTask(mockTask)
    useDownloadStore.getState().updateTask('task-1', { status: 'failed', error: 'Network timeout' })
    const task = useDownloadStore.getState().tasks[0]
    expect(task.status).toBe('failed')
    expect(task.error).toBe('Network timeout')
  })
})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/unit/stores/downloadStore.test.ts`
Expected: 全部通过

- [ ] **Step 5: 运行全量测试**

Run: `npx vitest run`
Expected: 全部通过

- [ ] **Step 6: 提交**

```bash
git add src/stores/useDownloadStore.ts tests/unit/stores/downloadStore.test.ts
git commit -m "chore: remove unused addTask from downloadStore, update tests to use upsertTask"
```

---

### Task 6: 清理 useCoverImage 的 clearCoverCache

**Files:**
- Modify: `src/hooks/useCoverImage.ts`

- [ ] **Step 1: 删除 clearCoverCache 函数**

确认无引用：

Run: `grep -r "clearCoverCache" src/ tests/ --include="*.ts" --include="*.tsx"`
Expected: 仅在 `useCoverImage.ts` 定义中出现

从 `src/hooks/useCoverImage.ts` 中删除以下代码（第 7-10 行）：

```typescript
/** 清除封面缓存（供测试使用） */
export function clearCoverCache(): void {
  coverCache.clear()
}
```

- [ ] **Step 2: 运行测试确认无回归**

Run: `npx vitest run`
Expected: 全部通过

- [ ] **Step 3: 提交**

```bash
git add src/hooks/useCoverImage.ts
git commit -m "chore: remove unused clearCoverCache export"
```

---

### Task 7: 清理 validators.ts 死导出

**Files:**
- Modify: `electron/validators.ts`

- [ ] **Step 1: 确认 array 和 optional 无外部使用**

Run: `grep -r "\barray\b\|\boptional\b" electron/main.ts`
Expected: 无匹配（main.ts 的 import 列表中不包含 `array` 和 `optional`）

从 `electron/validators.ts` 中删除以下代码：

1. 删除 `array` 函数（第 195-205 行）：

```typescript
export function array(maxLength?: number): Validator<unknown[]> {
  return (value): value is unknown[] => {
    if (!Array.isArray(value)) {
      throw new ValidationError(`Expected array, got ${typeof value}`)
    }
    if (maxLength !== undefined && value.length > maxLength) {
      throw new ValidationError(`Array length must be at most ${maxLength}, got ${value.length}`)
    }
    return true
  }
}
```

2. 删除 `optional` 函数（第 145-152 行）：

```typescript
export function optional<T>(
  v: Validator<T>,
): Validator<T | undefined | null> {
  return (value): value is T | undefined | null => {
    if (value === undefined || value === null) return true
    return v(value)
  }
}
```

注意：不要误删 `minLength`、`pattern`、`maxLength` 等——它们被 `length()` 和 `absolutePath()` 内部使用。

- [ ] **Step 2: 运行测试确认无回归**

Run: `npx vitest run`
Expected: 全部通过

- [ ] **Step 3: 提交**

```bash
git add electron/validators.ts
git commit -m "chore: remove unused array and optional validators"
```

---

### Task 8: 清理 SearchPage 和 FavouritesPage 的 handleComicClick

**Files:**
- Modify: `src/pages/SearchPage.tsx`
- Modify: `src/pages/FavouritesPage.tsx`

- [ ] **Step 1: 清理 SearchPage.tsx**

删除 `handleComicClick` 函数（约第 166-168 行）：

```typescript
const handleComicClick = (comic: ComicInfo) => {
  console.log('Comic clicked:', comic)
}
```

将 ComicCard 的 `onClick` prop 从 `handleComicClick` 改为 `undefined`（删除 `onClick={handleComicClick}` 行）。ComicCard 内部使用 `onClick?.(comic)` 可选链，传 undefined 不影响行为。

- [ ] **Step 2: 清理 FavouritesPage.tsx**

删除 `handleComicClick` 函数（约第 173-174 行）：

```typescript
const handleComicClick = (comic: ComicInfo) => {
  console.log('Comic clicked:', comic)
}
```

同样删除 ComicCard 的 `onClick={handleComicClick}` 行。

- [ ] **Step 3: 运行测试确认无回归**

Run: `npx vitest run`
Expected: 全部通过

- [ ] **Step 4: 提交**

```bash
git add src/pages/SearchPage.tsx src/pages/FavouritesPage.tsx
git commit -m "chore: remove debug-only handleComicClick console.log calls"
```

---

### Task 9: 清理 useComicReader 的 logPreviewDebug

**Files:**
- Modify: `src/hooks/useComicReader.ts`

- [ ] **Step 1: 删除 logPreviewDebug 函数及其调用**

从 `src/hooks/useComicReader.ts` 中：

1. 删除类型定义（第 17 行）和函数（第 19-23 行）：

```typescript
type ImportMetaWithEnv = ImportMeta & { env?: { DEV?: boolean } }

function logPreviewDebug(message: string, details: Record<string, unknown>) {
  if ((import.meta as ImportMetaWithEnv).env?.DEV) {
    console.log(message, details)
  }
}
```

2. 删除 `fetchUrls` 内的两处 `logPreviewDebug` 调用（约第 35-41 行和第 44-48 行）：

```typescript
logPreviewDebug('[preview] fetchUrls start', { ... })
logPreviewDebug('[preview] fetchUrls success', { ... })
```

3. 保留 `console.error('[preview] fetchUrls failed', err)` — 这是错误日志，有价值。

- [ ] **Step 2: 运行测试确认无回归**

Run: `npx vitest run`
Expected: 全部通过

- [ ] **Step 3: 提交**

```bash
git add src/hooks/useComicReader.ts
git commit -m "chore: remove dev-only logPreviewDebug from useComicReader"
```

---

### Task 10: 清理 electron/main.ts 的 logPreviewDebug

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: 找到并删除 logPreviewDebug 函数及调用**

在 `electron/main.ts` 中搜索 `logPreviewDebug`，删除函数定义及所有调用点。保留 `console.error` 调用。

- [ ] **Step 2: 运行测试确认无回归**

Run: `npx vitest run`
Expected: 全部通过

- [ ] **Step 3: 提交**

```bash
git add electron/main.ts
git commit -m "chore: remove dev-only logPreviewDebug from electron main"
```

---

### Task 11: 最终验证

- [ ] **Step 1: 运行全量测试**

Run: `npx vitest run`
Expected: 全部通过

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 验证构建**

Run: `npx electron-vite build`
Expected: 构建成功
