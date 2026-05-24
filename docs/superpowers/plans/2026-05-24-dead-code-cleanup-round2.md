# Dead Code & Redundancy Cleanup (Round 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up new dead code, tighten type exports, and extract 5 shared components + 1 hook from duplicated SearchPage/FavouritesPage code.

**Architecture:** Three-phase conservative approach — each phase verified independently before proceeding. Phase 1 removes unused props/types. Phase 2 centralizes types and removes unused exports. Phase 3 extracts shared UI components.

**Tech Stack:** TypeScript, React, Zustand, Tailwind CSS, electron-vite

---

## Phase 1 — New Dead Code Cleanup

### Task 1: Remove `sfwMode` prop from ComicCard

**Files:**
- Modify: `src/components/common/ComicCard.tsx`
- Modify: `src/pages/SearchPage.tsx`
- Modify: `src/pages/FavouritesPage.tsx`

- [ ] **Step 1: Remove `sfwMode` from `ComicCardProps` interface**

In `src/components/common/ComicCard.tsx`, remove line 15 (`sfwMode?: boolean`) from the interface:

```typescript
interface ComicCardProps {
  comic: ComicInfo
  onClick?: (comic: ComicInfo) => void
  selected?: boolean
  batchMode?: boolean
  onToggleSelect?: (comic: ComicInfo) => void
  onDownload?: (comic: ComicInfo) => void
  onOpenReader?: (comic: ComicInfo) => void
  downloadStatus?: 'downloaded' | 'unknown'
}
```

- [ ] **Step 2: Remove `sfwMode` from destructuring in `ComicCard`**

In `src/components/common/ComicCard.tsx` line 19, remove `sfwMode` from the destructuring — the component already reads it from `useSettingsStore` on line 20:

```typescript
export function ComicCard({ comic, onClick, selected, batchMode, onToggleSelect, onDownload, onOpenReader, downloadStatus }: ComicCardProps) {
```

- [ ] **Step 3: Remove `sfwMode` from `CoverCard` and `DetailedCard` internal calls**

In `ComicCard` component (line 24), remove `sfwMode={sfwMode}` from the `<CoverCard>` and `<DetailedCard>` calls:

```typescript
if (cardStyle === 'detailed') {
    return <DetailedCard comic={comic} onClick={onClick} selected={selected} batchMode={batchMode} onToggleSelect={onToggleSelect} onDownload={onDownload} onOpenReader={onOpenReader} downloadStatus={downloadStatus} onOpenDrawer={() => openDrawer(comic)} />
  }
  return <CoverCard comic={comic} onClick={onClick} selected={selected} batchMode={batchMode} onToggleSelect={onToggleSelect} onDownload={onDownload} onOpenReader={onOpenReader} downloadStatus={downloadStatus} onOpenDrawer={() => openDrawer(comic)} />
```

In `CoverCard` and `DetailedCard` signatures, remove `sfwMode` from their props (they read from `useSettingsStore` via the parent already — the store is accessed directly). Update the internal component prop type:

For `CoverCard` (line 29):
```typescript
function CoverCard({ comic, onClick, selected, batchMode, onToggleSelect, onDownload, onOpenReader, downloadStatus, onOpenDrawer }: Omit<ComicCardProps, 'onOpenReader'> & { onOpenDrawer: () => void }) {
  const { coverSrc, retry } = useCoverImage(comic.coverUrl, containerRef)
```

Wait — `CoverCard` and `DetailedCard` currently take `ComicCardProps & { onOpenDrawer }` which includes `sfwMode`. Since `sfwMode` was removed from `ComicCardProps`, it's automatically gone. But `useCoverImage` currently receives `sfwMode` as 3rd arg (line 31). Let me check.

Actually, looking at line 31: `const { coverSrc, retry } = useCoverImage(comic.coverUrl, containerRef, sfwMode)` — `CoverCard` receives `sfwMode` via its props and passes it to `useCoverImage`. Since we're removing it from props, the components need to get `sfwMode` from the store directly.

Update `CoverCard` to read `sfwMode` from the store:

```typescript
function CoverCard({ comic, onClick, selected, batchMode, onToggleSelect, onDownload, onOpenReader, downloadStatus, onOpenDrawer }: ComicCardProps & { onOpenDrawer: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { sfwMode } = useSettingsStore()
  const { coverSrc, retry } = useCoverImage(comic.coverUrl, containerRef, sfwMode)
```

Do the same for `DetailedCard`:

```typescript
function DetailedCard({ comic, onClick, selected, batchMode, onToggleSelect, onDownload, onOpenReader, downloadStatus, onOpenDrawer }: ComicCardProps & { onOpenDrawer: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { sfwMode } = useSettingsStore()
  const { coverSrc, retry } = useCoverImage(comic.coverUrl, containerRef, sfwMode)
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/common/ComicCard.tsx
git commit -m "refactor: remove redundant sfwMode prop from ComicCard"
```

---

### Task 2: Simplify `TagBlacklist` type to alias

**Files:**
- Modify: `shared/types.ts`

- [ ] **Step 1: Replace `TagBlacklist` interface with type alias**

In `shared/types.ts` line 61, replace:

```typescript
export type TagBlacklist = { hcomic: string[]; moeimg: string[] }
```

with:

```typescript
export type TagBlacklist = AppConfig['tagBlacklist']
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors (type is structurally identical)

- [ ] **Step 3: Commit**

```bash
git add shared/types.ts
git commit -m "refactor: simplify TagBlacklist to AppConfig alias"
```

---

### Task 3: Verify Phase 1

- [ ] **Step 1: Run full TypeScript check**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Run electron-vite build**

Run: `npx electron-vite build`
Expected: Build succeeds

- [ ] **Step 3: Run test suite**

Run: `npx vitest run`
Expected: All tests pass (same count as before)

---

## Phase 2 — Type Dedup + Export Tightening

### Task 4: Move `CardStyle` to `shared/types.ts`

**Files:**
- Modify: `shared/types.ts`
- Modify: `src/stores/useSettingsStore.ts`

- [ ] **Step 1: Add `CardStyle` export to `shared/types.ts`**

Add after line 61 (`TagBlacklist`):

```typescript
export type CardStyle = 'cover' | 'detailed'
```

- [ ] **Step 2: Update `useSettingsStore.ts` to import `CardStyle`**

In `src/stores/useSettingsStore.ts`, replace line 5 (`type CardStyle = 'cover' | 'detailed'`) with an import:

```typescript
import type { TagBlacklist, CardStyle } from '@shared/types'
```

And remove the local `type CardStyle = 'cover' | 'detailed'` line.

Also remove the local `ThemeMode` alias on line 4 if it duplicates the one in `AppConfig`:
- Line 4: `type ThemeMode = 'light' | 'dark' | 'auto'` — this is used only for local state typing. Since `AppConfig['themeMode']` is the same type, keep it local as a convenience alias or import from shared.

Decision: keep `ThemeMode` local since it's only used within this file for the SettingsState interface. Just move `CardStyle` to shared since it's referenced across components.

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add shared/types.ts src/stores/useSettingsStore.ts
git commit -m "refactor: move CardStyle to shared/types.ts"
```

---

### Task 5: Remove unused exports from `shared/types.ts`

**Files:**
- Modify: `shared/types.ts`

The following exported types are used only within `shared/types.ts` itself (in `IPCMethods` and `HcomicAPI` interfaces) but never imported by any external file:

- `DownloadStartResult` (line 164)
- `DownloadResult` (line 169)
- `DownloadConflictResult` (line 173)
- `PreviewUrlsResult` (line 84)
- `PreviewImageResult` (line 87)
- `IpcErrorCode` (line 429)

- [ ] **Step 1: Remove `export` from unused-only-internally types**

Change these from `export interface/type` to `interface/type`:

Line 84:
```typescript
interface PreviewUrlsResult {
```

Line 87:
```typescript
interface PreviewImageResult {
```

Line 164:
```typescript
interface DownloadStartResult {
```

Line 169:
```typescript
type DownloadResult =
```

Line 173:
```typescript
interface DownloadConflictResult {
```

Line 429:
```typescript
type IpcErrorCode = typeof IPC_ERROR_CODES[keyof typeof IPC_ERROR_CODES]
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Verify build**

Run: `npx electron-vite build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add shared/types.ts
git commit -m "refactor: remove unused exports from shared/types.ts"
```

---

### Task 6: Verify Phase 2

- [ ] **Step 1: Run full TypeScript check**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Run electron-vite build**

Run: `npx electron-vite build`
Expected: Build succeeds

- [ ] **Step 3: Run test suite**

Run: `npx vitest run`
Expected: All tests pass

---

## Phase 3 — Shared Component Extraction

### Task 7: Extract `PageJumpDialog` to shared component

**Files:**
- Create: `src/components/common/PageJumpDialog.tsx`
- Modify: `src/pages/SearchPage.tsx`
- Modify: `src/pages/FavouritesPage.tsx`

- [ ] **Step 1: Create `src/components/common/PageJumpDialog.tsx`**

```typescript
import { useState } from 'react'

interface PageJumpDialogProps {
  totalPages: number
  onJump: (page: number) => void
  onClose: () => void
}

export function PageJumpDialog({ totalPages, onJump, onClose }: PageJumpDialogProps) {
  const [jumpPage, setJumpPage] = useState('')
  const handleJump = () => {
    const page = parseInt(jumpPage, 10)
    if (page >= 1 && page <= totalPages) {
      onJump(page)
    }
  }
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4">跳转到指定页</h3>
        <input
          type="number"
          value={jumpPage}
          onChange={(e) => setJumpPage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleJump() }}
          min={1}
          max={totalPages}
          placeholder={`1 - ${totalPages}`}
          className="w-full px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                     text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)]"
          >
            取消
          </button>
          <button
            onClick={handleJump}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white"
          >
            跳转
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update `FavouritesPage.tsx` — remove local `PageJumpDialog` definition**

Remove lines 15-64 (the local `PageJumpDialog` function). Add import:

```typescript
import { PageJumpDialog } from '../components/common/PageJumpDialog'
```

The existing usage at line 331-336 remains unchanged (same props interface).

- [ ] **Step 3: Update `SearchPage.tsx` — replace inline dialog with component**

Add import:
```typescript
import { PageJumpDialog } from '../components/common/PageJumpDialog'
```

Replace the inline jump dialog (lines 392-438) with:
```typescript
{showJumpDialog && (
  <PageJumpDialog
    totalPages={pagination?.totalPages || 1}
    onJump={(page) => { handleSearch(page); setShowJumpDialog(false) }}
    onClose={() => setShowJumpDialog(false)}
  />
)}
```

Remove the `jumpPage` state (line 29: `const [jumpPage, setJumpPage] = useState('')`) — no longer needed since the dialog manages its own state. Also remove the `setJumpPage(String(pagination.currentPage))` call in the pagination span onClick (line 333) — just keep `setShowJumpDialog(true)`:

```typescript
onClick={() => setShowJumpDialog(true)}
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add src/components/common/PageJumpDialog.tsx src/pages/SearchPage.tsx src/pages/FavouritesPage.tsx
git commit -m "refactor: extract PageJumpDialog to shared component"
```

---

### Task 8: Extract `PaginationControls` to shared component

**Files:**
- Create: `src/components/common/PaginationControls.tsx`
- Modify: `src/pages/SearchPage.tsx`
- Modify: `src/pages/FavouritesPage.tsx`

- [ ] **Step 1: Create `src/components/common/PaginationControls.tsx`**

```typescript
interface PaginationControlsProps {
  currentPage: number
  totalPages: number
  onNavigate: (page: number) => void
  onJumpClick: () => void
}

export function PaginationControls({ currentPage, totalPages, onNavigate, onJumpClick }: PaginationControlsProps) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => onNavigate(currentPage - 1)}
        disabled={currentPage <= 1}
        className="px-2 py-0.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border)]
                   disabled:opacity-50"
      >
        上一页
      </button>
      <span
        onClick={onJumpClick}
        className="px-2 py-0.5 text-xs text-[var(--accent)] cursor-pointer hover:underline"
        title="点击跳转到指定页"
      >
        {currentPage} / {totalPages}
      </span>
      <button
        onClick={() => onNavigate(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className="px-2 py-0.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border)]
                   disabled:opacity-50"
      >
        下一页
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Update `SearchPage.tsx`**

Add import:
```typescript
import { PaginationControls } from '../components/common/PaginationControls'
```

Replace the pagination block (lines 321-350) with:
```typescript
{pagination && pagination.totalPages > 1 && (
  <PaginationControls
    currentPage={pagination.currentPage}
    totalPages={pagination.totalPages}
    onNavigate={handleSearch}
    onJumpClick={() => setShowJumpDialog(true)}
  />
)}
```

- [ ] **Step 3: Update `FavouritesPage.tsx`**

Add import:
```typescript
import { PaginationControls } from '../components/common/PaginationControls'
```

Replace the pagination block (lines 258-284) with:
```typescript
{!needsLogin && pagination && pagination.totalPages > 1 && (
  <PaginationControls
    currentPage={currentPage}
    totalPages={pagination.totalPages}
    onNavigate={loadFavourites}
    onJumpClick={() => setShowJumpDialog(true)}
  />
)}
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add src/components/common/PaginationControls.tsx src/pages/SearchPage.tsx src/pages/FavouritesPage.tsx
git commit -m "refactor: extract PaginationControls to shared component"
```

---

### Task 9: Extract `BatchControls` to shared component

**Files:**
- Create: `src/components/common/BatchControls.tsx`
- Modify: `src/pages/SearchPage.tsx`
- Modify: `src/pages/FavouritesPage.tsx`

- [ ] **Step 1: Create `src/components/common/BatchControls.tsx`**

```typescript
interface BatchControlsProps {
  batchMode: boolean
  selectedCount: number
  onToggleBatchMode: (enabled: boolean) => void
  onSelectAll: () => void
  onClearSelection: () => void
  onBatchDownload: () => void
}

export function BatchControls({ batchMode, selectedCount, onToggleBatchMode, onSelectAll, onClearSelection, onBatchDownload }: BatchControlsProps) {
  return (
    <>
      <span className="text-[var(--border)]">|</span>
      <label className="flex items-center gap-1.5 text-xs text-[var(--text-primary)] cursor-pointer">
        <input
          type="checkbox"
          checked={batchMode}
          onChange={(e) => {
            onToggleBatchMode(e.target.checked)
            if (!e.target.checked) onClearSelection()
          }}
          className="rounded"
        />
        批量选择
      </label>
      {batchMode && (
        <>
          <button onClick={onSelectAll} className="px-2 py-0.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border)] hover:bg-[var(--bg-tertiary)]">
            全选
          </button>
          <button onClick={onClearSelection} className="px-2 py-0.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border)] hover:bg-[var(--bg-tertiary)]">
            取消
          </button>
          <button
            onClick={onBatchDownload}
            disabled={selectedCount === 0}
            className="px-2 py-0.5 text-xs rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            批量下载({selectedCount})
          </button>
        </>
      )}
    </>
  )
}
```

- [ ] **Step 2: Update `SearchPage.tsx`**

Add import:
```typescript
import { BatchControls } from '../components/common/BatchControls'
```

Replace the batch controls block (lines 286-319) with:
```typescript
{comics.length > 0 && (
  <BatchControls
    batchMode={batchMode}
    selectedCount={selectedIds.size}
    onToggleBatchMode={setBatchMode}
    onSelectAll={() => selectAll(comics)}
    onClearSelection={clearSelection}
    onBatchDownload={handleBatchDownload}
  />
)}
```

- [ ] **Step 3: Update `FavouritesPage.tsx`**

Add import:
```typescript
import { BatchControls } from '../components/common/BatchControls'
```

Replace the batch controls block (lines 223-256) with:
```typescript
{!needsLogin && comics.length > 0 && (
  <BatchControls
    batchMode={batchMode}
    selectedCount={selectedIds.size}
    onToggleBatchMode={setBatchMode}
    onSelectAll={() => selectAll(comics)}
    onClearSelection={clearSelection}
    onBatchDownload={handleBatchDownload}
  />
)}
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add src/components/common/BatchControls.tsx src/pages/SearchPage.tsx src/pages/FavouritesPage.tsx
git commit -m "refactor: extract BatchControls to shared component"
```

---

### Task 10: Extract `ErrorDisplay` and `EmptyState` to shared components

**Files:**
- Create: `src/components/common/ErrorDisplay.tsx`
- Create: `src/components/common/EmptyState.tsx`
- Modify: `src/pages/SearchPage.tsx`
- Modify: `src/pages/FavouritesPage.tsx`

- [ ] **Step 1: Create `src/components/common/ErrorDisplay.tsx`**

```typescript
interface ErrorDisplayProps {
  message: string | null
}

export function ErrorDisplay({ message }: ErrorDisplayProps) {
  if (!message) return null
  return (
    <div className="p-4 bg-[var(--error)]/10 text-[var(--error)] rounded-lg">
      {message}
    </div>
  )
}
```

- [ ] **Step 2: Create `src/components/common/EmptyState.tsx`**

```typescript
interface EmptyStateProps {
  message: string
}

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <div className="text-center text-[var(--text-secondary)] py-12">
      {message}
    </div>
  )
}
```

- [ ] **Step 3: Update `SearchPage.tsx`**

Add imports:
```typescript
import { ErrorDisplay } from '../components/common/ErrorDisplay'
import { EmptyState } from '../components/common/EmptyState'
```

Replace the error block (lines 354-358) with:
```typescript
<ErrorDisplay message={error} />
```

Replace the empty states (lines 440-450) with:
```typescript
{!isLoading && comics.length === 0 && <EmptyState message="暂无搜索结果" />}
{!isLoading && comics.length > 0 && blockedCount === comics.length && <EmptyState message="所有结果均已被标签过滤" />}
```

- [ ] **Step 4: Update `FavouritesPage.tsx`**

Add imports:
```typescript
import { ErrorDisplay } from '../components/common/ErrorDisplay'
import { EmptyState } from '../components/common/EmptyState'
```

Replace the early-return error display (lines 197-203) with:
```typescript
if (error) {
  return <ErrorDisplay message={error} />
}
```

Replace the empty state (lines 301-304) with:
```typescript
{comics.length === 0 && <EmptyState message="暂无收藏" />}
```

- [ ] **Step 5: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/components/common/ErrorDisplay.tsx src/components/common/EmptyState.tsx src/pages/SearchPage.tsx src/pages/FavouritesPage.tsx
git commit -m "refactor: extract ErrorDisplay and EmptyState to shared components"
```

---

### Task 11: Extract `useBatchDownload` hook

**Files:**
- Create: `src/hooks/useBatchDownload.ts`
- Modify: `src/pages/SearchPage.tsx`
- Modify: `src/pages/FavouritesPage.tsx`

- [ ] **Step 1: Create `src/hooks/useBatchDownload.ts`**

```typescript
import { ComicInfo } from '@shared/types'
import { useDownloadHelper } from './useDownloadHelper'
import { useBatchSelect, getComicKey } from './useBatchSelect'

export function useBatchDownload(comics: ComicInfo[]) {
  const { downloadWithConflictCheck } = useDownloadHelper()
  const batch = useBatchSelect()

  const handleBatchDownload = async () => {
    const comicsToDownload = Array.from(batch.selectedIds)
      .map(key => comics.find(c => getComicKey(c) === key))
      .filter((c): c is ComicInfo => c !== undefined)
    await Promise.allSettled(comicsToDownload.map(comic => downloadWithConflictCheck(comic)))
    batch.exitBatchMode()
  }

  return {
    ...batch,
    handleBatchDownload,
  }
}
```

- [ ] **Step 2: Update `SearchPage.tsx`**

Replace imports and usage. Remove `useBatchSelect` import and `useDownloadHelper` import (if no longer needed directly — check if `handleDownload` still needs it).

Keep `useDownloadHelper` import for `handleDownload`. Remove `useBatchSelect` import and replace with `useBatchDownload`:

```typescript
import { useBatchDownload } from '../hooks/useBatchDownload'
```

Replace lines 36-44 (useBatchSelect destructuring) and lines 190-196 (handleBatchDownload) with:

```typescript
const {
  batchMode,
  setBatchMode,
  selectedIds,
  toggleSelect,
  selectAll,
  clearSelection,
  handleBatchDownload,
} = useBatchDownload(comics)
```

Note: `exitBatchMode` is no longer needed separately since `handleBatchDownload` calls it internally.

- [ ] **Step 3: Update `FavouritesPage.tsx`**

Same pattern — replace `useBatchSelect` with `useBatchDownload`:

```typescript
import { useBatchDownload } from '../hooks/useBatchDownload'
```

Replace lines 75-83 (useBatchSelect) and lines 181-187 (handleBatchDownload) with:

```typescript
const {
  batchMode,
  setBatchMode,
  selectedIds,
  toggleSelect,
  selectAll,
  clearSelection,
  handleBatchDownload,
} = useBatchDownload(comics)
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useBatchDownload.ts src/pages/SearchPage.tsx src/pages/FavouritesPage.tsx
git commit -m "refactor: extract useBatchDownload hook"
```

---

### Task 12: Final verification — Phase 3 + full project

- [ ] **Step 1: Run full TypeScript check**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Run electron-vite build**

Run: `npx electron-vite build`
Expected: Build succeeds

- [ ] **Step 3: Run test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Visual verification**

Start the dev server (`npx electron-vite dev`) and verify:
- SearchPage: pagination, batch select, page jump dialog, error display, empty state
- FavouritesPage: same functionality
- No visual regressions

- [ ] **Step 5: Final commit with consolidated notes (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address Phase 3 verification findings"
```
