# Search Multi-Select & Download Design

## Problem

The Electron frontend search page lacks multi-select and download functionality. Users can search for comics but cannot select multiple results or initiate downloads. These features exist only in the Python GUI version.

## Approach

Add a batch selection toolbar to SearchPage and modify ComicCard to support selection state, following the Python GUI's interaction pattern.

## Design

### 1. SearchPage Toolbar

Added between the search bar and the results grid:

- **Batch mode checkbox**: toggles between normal and batch selection mode
- **Select all / Clear buttons**: quick operations for all comics on current page
- **Batch download(N)**: shows selected count, downloads all selected comics sequentially

In non-batch mode, each card shows a small download icon button (visible on hover) for single-comic download.

State managed within SearchPage via `useState`:
- `batchMode: boolean`
- `selectedIds: Set<string>`

### 2. ComicCard Changes

New props:
- `selected?: boolean` — selection state
- `batchMode?: boolean` — whether batch mode is active
- `onToggleSelect?: (comic: ComicInfo) => void` — toggle selection callback
- `onDownload?: (comic: ComicInfo) => void` — download callback (non-batch mode)

**Batch mode visuals:**
- Checkbox in top-left corner (accent color when selected)
- Selected state: accent border + elevated shadow
- Clicking entire card triggers `onToggleSelect`

**Non-batch mode:**
- Download icon button in top-right corner (shown on hover)
- Clicking card body triggers `onClick`

Both CoverCard and DetailedCard variants apply the same selection styling.

### 3. Backend & IPC Changes

**Python `handle_download`:** Accept `comic_data` dict alongside `comic_id`, store it in the task record.

**Electron `main.ts`:** Pass both `comicId` and `comicData` through the IPC channel.

**`useIpc.ts`:** `startDownload` accepts `(comicId, comicData: ComicInfo)`.

**Batch download flow:** Iterate over `selectedIds`, find matching comics from the search results, call `startDownload` for each.

## Files to Modify

- `src/pages/SearchPage.tsx` — toolbar, batch state, download logic
- `src/components/common/ComicCard.tsx` — selection UI, download button
- `src/hooks/useIpc.ts` — startDownload signature
- `electron/main.ts` — IPC handler params
- `python/ipc_server.py` — handle_download params
