---
title: Dead Code & Redundancy Cleanup (Round 2)
date: 2026-05-24
status: approved
---

# Dead Code & Redundancy Cleanup — Round 2

Previous cleanup: 2026-05-23, ~300 lines removed (Approach A only).
This round: new dead code + deferred Approach B (type dedup) + Approach C (shared component extraction).

## Execution Strategy

Conservative, 3 phases. Each phase verified independently (TS compile + build + tests) before proceeding.

---

## Phase 1 — New Dead Code Cleanup

### 1.1 Remove `ComicCardProps.sfwMode` prop
- `ComicCard` reads `sfwMode` from `useSettingsStore` internally; the prop is redundant
- Remove from `ComicCardProps` interface and all call sites (SearchPage, FavouritesPage)

### 1.2 Remove `ComicInfo.mediaId` field
- Defined in `shared/types.ts` but unused in business logic
- Python parser may return it — no change needed on Python side (duck-typed)

### 1.3 `TagBlacklist` type alias
- Replace duplicate interface definition with:
  ```typescript
  export type TagBlacklist = AppConfig['tagBlacklist']
  ```

### 1.4 Python unused imports
- Clean up any unused imports in `python/ipc_server.py`

### Verification
- TypeScript compilation passes
- electron-vite build passes
- Python no import errors
- Full test suite passes

---

## Phase 2 — Type Dedup + Export Tightening

### 2.1 Assessment
Frontend (`shared/types.ts`) and backend (`config.py`, `theme_manager.py`, `models.py`) define the same enum values in different languages. This duplication is **architecturally unavoidable** — each language needs its own definitions. The real value is tightening what's exported.

### 2.2 Move `CardStyle` to `shared/types.ts`
- Currently defined locally in `useSettingsStore.ts`
- Move to `shared/types.ts` for discoverability; `useSettingsStore.ts` imports from there

### 2.3 Audit and remove unused exports in `shared/types.ts`
- Grep each exported name across the project
- Remove any export with zero references

### Verification
- TypeScript compilation passes
- electron-vite build passes
- Full test suite passes

---

## Phase 3 — Shared Component Extraction (Deep)

Extract 5 components + 1 hook from duplicated code in SearchPage and FavouritesPage.

### 3.1 Components to extract

#### `src/components/common/PageJumpDialog.tsx`
- Based on the already-extracted version in FavouritesPage
- Props: `totalPages: number`, `onJump: (page: number) => void`, `onClose: () => void`
- Replace inline implementation in SearchPage

#### `src/components/common/PaginationControls.tsx`
- Props: `currentPage: number`, `totalPages: number`, `onNavigate: (page: number) => void`, `onJumpClick: () => void`
- Replaces duplicated pagination nav in both pages

#### `src/components/common/BatchControls.tsx`
- Props: `comics: ComicInfo[]`, `enabled: boolean`, `batchMode: boolean`, `selectedCount: number`, `onSelectAll: () => void`, `onClearSelection: () => void`, `onToggleBatchMode: (enabled: boolean) => void`, `onBatchDownload: () => void`
- `enabled` controls visibility (e.g. `!needsLogin` in FavouritesPage)
- Replaces identical batch operation bar in both pages

#### `src/components/common/ErrorDisplay.tsx`
- Props: `message: string | null`
- Replaces identical error display in both pages

#### `src/components/common/EmptyState.tsx`
- Props: `message: string`
- Replaces similar empty states with different messages

### 3.2 Hook: `src/hooks/useBatchDownload.ts`
- Combines `useBatchSelect` usage pattern with download dispatch logic
- Returns `handleBatchDownload` and delegates to `useDownloadHelper` or `useDownloadStore`
- Reduces duplicated handler logic in both pages

### 3.3 Implementation order
1. Extract each component one at a time
2. After each extraction: TS compile + build + tests
3. After all extractions: full UI visual verification (no layout regressions)

### Verification
- Per-component: TypeScript compilation + build + tests
- Final: full test suite + visual comparison of SearchPage and FavouritesPage
