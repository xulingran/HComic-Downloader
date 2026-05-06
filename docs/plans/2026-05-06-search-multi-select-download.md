# Search Multi-Select & Download Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add batch selection mode and download functionality to the search results page, referencing the Python GUI design.

**Architecture:** Extend ComicCard with selection/download props. Add a toolbar to SearchPage for batch controls. Update the IPC chain (frontend → Electron main → Python) to pass full comic data on download.

**Tech Stack:** React 18, TypeScript, Zustand, Tailwind CSS, Electron IPC, Python stdin/stdout bridge

---

### Task 1: Update Python backend — handle_download accepts comic data

**Files:**
- Modify: `python/ipc_server.py:68-71`

**Step 1: Modify handle_download to accept and store comic_data**

Change the method signature and store comic info in the task:

```python
def handle_download(self, comic_id: str, comic_data: dict = None) -> Dict:
    task_id = str(uuid.uuid4())[:8]
    self.download_tasks[task_id] = {
        "status": "pending",
        "progress": 0,
        "comic": comic_data or {"id": comic_id, "title": "Unknown", "url": "", "coverUrl": "", "source": ""},
    }
    logger.info(f"Created download task {task_id} for comic {comic_id}")
    return {"taskId": task_id}
```

**Step 2: Update handle_get_downloads to include comic info**

In `handle_get_downloads` (line 131-144), replace the hardcoded empty comic dict with the stored comic data:

```python
"comic": task.get("comic", {"id": "", "title": "Download Task", "url": "", "coverUrl": "", "source": ""}),
```

**Step 3: Commit**

```bash
git add python/ipc_server.py
git commit -m "feat(python): store comic data in download tasks"
```

---

### Task 2: Update Electron IPC — pass comic data through

**Files:**
- Modify: `electron/main.ts:53-55`
- Modify: `src/hooks/useIpc.ts:43-45`

**Step 1: Update main.ts IPC handler**

Change the download handler to forward comicData:

```typescript
ipcMain.handle('python:download', async (_, comicId, comicData) => {
  return bridge.call('download', { comic_id: comicId, comic_data: comicData })
})
```

**Step 2: Update useIpc.ts hook**

Change startDownload to accept ComicInfo:

```typescript
const startDownload = useCallback(async (comicId: string, comicData: ComicInfo) => {
  return invoke('python:download', comicId, comicData)
}, [invoke])
```

Add the import at the top:

```typescript
import { ComicInfo } from '@shared/types'
```

**Step 3: Commit**

```bash
git add electron/main.ts src/hooks/useIpc.ts
git commit -m "feat(ipc): pass comic data through download channel"
```

---

### Task 3: Update ComicCard — add selection state and download button

**Files:**
- Modify: `src/components/common/ComicCard.tsx`

**Step 1: Update ComicCardProps interface**

```typescript
interface ComicCardProps {
  comic: ComicInfo
  onClick?: (comic: ComicInfo) => void
  selected?: boolean
  batchMode?: boolean
  onToggleSelect?: (comic: ComicInfo) => void
  onDownload?: (comic: ComicInfo) => void
}
```

**Step 2: Add selection wrapper component**

Create a wrapper that handles selection border, checkbox overlay, and download button. Both CoverCard and DetailedCard use this wrapper.

The wrapper adds:
- A checkbox circle in top-left when `batchMode` is true (filled accent when selected, outline when not)
- An accent border + shadow when `selected` is true
- A download icon button in top-right when not in batch mode (visible on hover)
- Click handler: `onToggleSelect` in batch mode, `onClick` otherwise

**Step 3: Apply to CoverCard**

Wrap the existing CoverCard content in the selection wrapper div. The wrapper is the outermost element that receives `onClick`/`onToggleSelect`. Inside it, add the checkbox and download button overlays as absolute-positioned elements.

**Step 4: Apply to DetailedCard**

Same wrapper pattern as CoverCard.

**Step 5: Verify with dev server**

Run: `npm run dev`
Expected: ComicCard renders with no visual changes in default (non-batch) mode. Hover shows download button.

**Step 6: Commit**

```bash
git add src/components/common/ComicCard.tsx
git commit -m "feat(ui): add selection state and download button to ComicCard"
```

---

### Task 4: Add SearchPage toolbar and batch logic

**Files:**
- Modify: `src/pages/SearchPage.tsx`

**Step 1: Add state and imports**

Add state variables:
```typescript
const [batchMode, setBatchMode] = useState(false)
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
```

Import `useDownload` from hooks:
```typescript
import { useSearch, useDownload } from '../hooks/useIpc'
```

**Step 2: Add selection handler functions**

```typescript
const toggleSelect = (comic: ComicInfo) => {
  setSelectedIds(prev => {
    const next = new Set(prev)
    if (next.has(comic.id)) next.delete(comic.id)
    else next.add(comic.id)
    return next
  })
}

const selectAll = () => {
  setSelectedIds(new Set(comics.map(c => c.id)))
}

const clearSelection = () => {
  setSelectedIds(new Set())
}
```

**Step 3: Add download handler functions**

```typescript
const { startDownload } = useDownload()

const handleDownload = async (comic: ComicInfo) => {
  try {
    await startDownload(comic.id, comic)
  } catch (err) {
    console.error('Download failed:', err)
  }
}

const handleBatchDownload = async () => {
  for (const id of selectedIds) {
    const comic = comics.find(c => c.id === id)
    if (comic) await handleDownload(comic)
  }
  clearSelection()
  setBatchMode(false)
}
```

**Step 4: Add toolbar JSX**

Insert between the search bar `</div>` and the error `{error && ...}` block:

```tsx
{comics.length > 0 && (
  <div className="flex items-center gap-3 bg-[var(--bg-primary)] rounded-xl p-3 shadow-sm">
    <label className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
      <input
        type="checkbox"
        checked={batchMode}
        onChange={(e) => {
          setBatchMode(e.target.checked)
          if (!e.target.checked) clearSelection()
        }}
        className="rounded"
      />
      批量选择模式
    </label>
    {batchMode && (
      <>
        <button onClick={selectAll} className="px-3 py-1 text-sm rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] hover:bg-[var(--bg-tertiary)]">
          全选
        </button>
        <button onClick={clearSelection} className="px-3 py-1 text-sm rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] hover:bg-[var(--bg-tertiary)]">
          取消
        </button>
        <button
          onClick={handleBatchDownload}
          disabled={selectedIds.size === 0}
          className="px-3 py-1 text-sm rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          批量下载({selectedIds.size})
        </button>
      </>
    )}
  </div>
)}
```

**Step 5: Update ComicCard usage**

Change the comic grid to pass new props:

```tsx
<ComicCard
  key={comic.id}
  comic={comic}
  onClick={handleComicClick}
  batchMode={batchMode}
  selected={selectedIds.has(comic.id)}
  onToggleSelect={toggleSelect}
  onDownload={handleDownload}
/>
```

**Step 6: Clear selection on new search**

In `handleSearch`, add `clearSelection()` at the start:

```typescript
const handleSearch = async (page: number = 1) => {
  if (!query.trim()) return
  clearSelection()
  // ... rest unchanged
}
```

**Step 7: Verify with dev server**

Run: `npm run dev`
Expected:
- Search for comics, results appear
- Toggle batch mode shows checkboxes on cards
- Selecting cards highlights them, count updates in toolbar
- Batch download button shows correct count
- Non-batch mode shows download icon on card hover

**Step 8: Commit**

```bash
git add src/pages/SearchPage.tsx
git commit -m "feat(ui): add batch selection toolbar and download to search page"
```

---

### Task 5: Final integration test

**Step 1: Run dev server and test full flow**

Run: `npm run dev`

Test checklist:
- [ ] Search returns results
- [ ] Non-batch: hover shows download icon, clicking it triggers download
- [ ] Non-batch: clicking card body logs to console
- [ ] Batch mode: clicking cards toggles selection
- [ ] Batch mode: checkbox appears on cards, selected cards have accent border
- [ ] Select all selects all comics
- [ ] Clear deselects all
- [ ] Batch download button shows correct count
- [ ] Batch download clears selection and exits batch mode after download
- [ ] New search clears selection

**Step 2: Commit if any fixes were needed**

```bash
git add -u
git commit -m "fix: integration fixes for search multi-select and download"
```
