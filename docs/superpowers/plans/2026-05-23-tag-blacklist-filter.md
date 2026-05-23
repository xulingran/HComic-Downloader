# Tag Blacklist / Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-source tag blacklist filtering to the search page, with toggle, quick-add from drawer (with confirmation), and settings page management.

**Architecture:** New `tagBlacklist` config key (type `{ hcomic: string[], moeimg: string[] }`) persisted via the existing Python config pipeline. Zustand store provides reactive UI state. Pure frontend filtering on SearchPage. No backend search changes.

**Tech Stack:** TypeScript (Electron main/renderer), Python (config backend), React + Zustand (UI), Tailwind CSS (styling)

---

### Task 1: Add `tagBlacklist` to shared types

**Files:**
- Modify: `shared/types.ts:124-128` (ConfigKey)
- Modify: `shared/types.ts:129-145` (ConfigValueMap)
- Modify: `shared/types.ts:452-457` (CONFIG_KEYS)

- [ ] **Step 1: Update ConfigKey, ConfigValueMap, AppConfig, and CONFIG_KEYS**

In `shared/types.ts`, add `tagBlacklist` to the config system. The `AppConfig` interface also needs the field so `getConfig` returns it.

Add to `AppConfig` interface (after line 52, before `proxy?: string`):

```typescript
  tagBlacklist: { hcomic: string[]; moeimg: string[] }
```

Update `ConfigKey` type (line 124-128):

```typescript
export type ConfigKey = 'themeMode' | 'outputFormat' | 'downloadDir' | 'concurrentDownloads'
  | 'timeout' | 'retryTimes' | 'cbzFilenameTemplate' | 'batchDownloadDelay'
  | 'autoRetryMaxAttempts' | 'notifyOnComplete' | 'notifyWhenForeground' | 'defaultSource'
  | 'fontName' | 'fontSize' | 'sfwMode' | 'tagBlacklist'
```

Update `ConfigValueMap` type (line 129-145), add after `sfwMode: boolean`:

```typescript
  tagBlacklist: { hcomic: string[]; moeimg: string[] }
```

Update `CONFIG_KEYS` array (line 452-457):

```typescript
export const CONFIG_KEYS = [
  'themeMode', 'outputFormat', 'downloadDir', 'concurrentDownloads',
  'timeout', 'retryTimes', 'cbzFilenameTemplate', 'batchDownloadDelay',
  'autoRetryMaxAttempts', 'notifyOnComplete', 'notifyWhenForeground', 'defaultSource',
  'fontName', 'fontSize', 'sfwMode', 'tagBlacklist',
] as const
```

Also export a dedicated type for reuse:

```typescript
export type TagBlacklist = { hcomic: string[]; moeimg: string[] }
```

Place this type definition right after the `AppConfig` interface.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add shared/types.ts
git commit -m "feat(tag-blacklist): add tagBlacklist to shared config types"
```

---

### Task 2: Add tagBlacklist validator to Electron main

**Files:**
- Modify: `electron/validators.ts`
- Modify: `electron/main.ts:168-184` (CONFIG_VALIDATORS)

- [ ] **Step 1: Add tagBlacklist validator function**

In `electron/validators.ts`, add a new validator function before the `assert` helper section (before line 184). This validates that the value is an object with `hcomic` and `moeimg` keys, each an array of non-empty strings max length 64, case-insensitive deduplicated:

```typescript
export function tagBlacklist(): Validator<{ hcomic: string[]; moeimg: string[] }> {
  return (value): value is { hcomic: string[]; moeimg: string[] } => {
    if (typeof value !== 'object' || value === null) {
      throw new ValidationError('tagBlacklist must be an object')
    }
    const obj = value as Record<string, unknown>
    for (const key of ['hcomic', 'moeimg']) {
      const arr = obj[key]
      if (!Array.isArray(arr)) {
        throw new ValidationError(`tagBlacklist.${key} must be an array`)
      }
      if (arr.length > 500) {
        throw new ValidationError(`tagBlacklist.${key} must not exceed 500 items`)
      }
      const seen = new Set<string>()
      for (const item of arr) {
        if (typeof item !== 'string' || item.length === 0 || item.length > 64) {
          throw new ValidationError(`tagBlacklist.${key} items must be non-empty strings, max 64 chars`)
        }
        const lower = item.toLowerCase()
        if (seen.has(lower)) {
          throw new ValidationError(`tagBlacklist.${key} contains duplicate: ${item}`)
        }
        seen.add(lower)
      }
    }
    return true
  }
}
```

- [ ] **Step 2: Add tagBlacklist to CONFIG_VALIDATORS in main.ts**

In `electron/main.ts`, update the import from `./validators` to include `tagBlacklist`:

Change line 12:
```typescript
import {
```
Add `tagBlacklist as tagBlacklistValidator,` to the import list.

Then add to `CONFIG_VALIDATORS` (line 168-184), after the `sfwMode` entry:

```typescript
  tagBlacklist: tagBlacklistValidator(),
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add electron/validators.ts electron/main.ts
git commit -m "feat(tag-blacklist): add tagBlacklist validator to Electron main"
```

---

### Task 3: Add tagBlacklist to Python backend config

**Files:**
- Modify: `config.py:15-49` (Config dataclass fields)
- Modify: `python/ipc/types.py:15-32` (CONFIG_KEY_MAP)
- Modify: `python/ipc/config_mixin.py:51-77` (handle_get_config)

- [ ] **Step 1: Add field to Config dataclass**

In `config.py`, add a new field to the `Config` dataclass (after `sfw_mode` on line 49):

```python
    tag_blacklist: dict[str, dict[str, list[str]]] = field(default_factory=lambda: {"hcomic": [], "moeimg": []})
```

- [ ] **Step 2: Add key mapping to CONFIG_KEY_MAP**

In `python/ipc/types.py`, add to `CONFIG_KEY_MAP` dict (after `'sfwMode': 'sfw_mode'` on line 30):

```python
    'tagBlacklist': 'tag_blacklist',
```

- [ ] **Step 3: Add tagBlacklist to handle_get_config output**

In `python/ipc/config_mixin.py`, in `handle_get_config` method, add after the `sfw_mode` line (line 68):

```python
            'tag_blacklist': getattr(self.config, 'tag_blacklist', {"hcomic": [], "moeimg": []}),
```

- [ ] **Step 4: Verify Python config loads correctly**

Run: `python -c "from config import Config; c = Config(); print(c.tag_blacklist)"`
Expected: `{'hcomic': [], 'moeimg': []}`

- [ ] **Step 5: Commit**

```bash
git add config.py python/ipc/types.py python/ipc/config_mixin.py
git commit -m "feat(tag-blacklist): add tag_blacklist to Python config backend"
```

---

### Task 4: Extend useSettingsStore with tagBlacklist state and actions

**Files:**
- Modify: `src/stores/useSettingsStore.ts`

- [ ] **Step 1: Write the store test**

Create test file `tests/unit/renderer/useSettingsStore.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSettingsStore } from '../../../src/stores/useSettingsStore'

describe('useSettingsStore — tagBlacklist', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      tagBlacklist: { hcomic: [], moeimg: [] },
      filterEnabled: true,
    })
  })

  it('adds a tag to the correct source', () => {
    const { addTag } = useSettingsStore.getState()
    addTag('hcomic', 'NTR')
    const { tagBlacklist } = useSettingsStore.getState()
    expect(tagBlacklist.hcomic).toEqual(['NTR'])
    expect(tagBlacklist.moeimg).toEqual([])
  })

  it('trims whitespace when adding', () => {
    const { addTag } = useSettingsStore.getState()
    addTag('hcomic', '  NTR  ')
    expect(useSettingsStore.getState().tagBlacklist.hcomic).toEqual(['NTR'])
  })

  it('ignores empty string', () => {
    const { addTag } = useSettingsStore.getState()
    addTag('hcomic', '   ')
    expect(useSettingsStore.getState().tagBlacklist.hcomic).toEqual([])
  })

  it('deduplicates case-insensitively', () => {
    const { addTag } = useSettingsStore.getState()
    addTag('hcomic', 'NTR')
    addTag('hcomic', 'ntr')
    expect(useSettingsStore.getState().tagBlacklist.hcomic).toEqual(['NTR'])
  })

  it('removes a tag case-insensitively', () => {
    useSettingsStore.setState({ tagBlacklist: { hcomic: ['NTR', 'rape'], moeimg: [] } })
    const { removeTag } = useSettingsStore.getState()
    removeTag('hcomic', 'ntr')
    expect(useSettingsStore.getState().tagBlacklist.hcomic).toEqual(['rape'])
  })

  it('removing non-existent tag is a no-op', () => {
    useSettingsStore.setState({ tagBlacklist: { hcomic: ['NTR'], moeimg: [] } })
    const { removeTag } = useSettingsStore.getState()
    removeTag('hcomic', 'xyz')
    expect(useSettingsStore.getState().tagBlacklist.hcomic).toEqual(['NTR'])
  })

  it('setTagBlacklist replaces entire blacklist', () => {
    const { setTagBlacklist } = useSettingsStore.getState()
    setTagBlacklist({ hcomic: ['a', 'b'], moeimg: ['c'] })
    expect(useSettingsStore.getState().tagBlacklist).toEqual({ hcomic: ['a', 'b'], moeimg: ['c'] })
  })

  it('setFilterEnabled toggles filter state', () => {
    expect(useSettingsStore.getState().filterEnabled).toBe(true)
    const { setFilterEnabled } = useSettingsStore.getState()
    setFilterEnabled(false)
    expect(useSettingsStore.getState().filterEnabled).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/renderer/useSettingsStore.test.ts`
Expected: FAIL — `tagBlacklist`, `filterEnabled`, `addTag`, `removeTag`, `setTagBlacklist`, `setFilterEnabled` not in store.

- [ ] **Step 3: Extend the store**

Replace the entire contents of `src/stores/useSettingsStore.ts`:

```typescript
import { create } from 'zustand'
import type { TagBlacklist } from '@shared/types'

type ThemeMode = 'light' | 'dark' | 'auto'
type CardStyle = 'cover' | 'detailed'

interface SettingsState {
  themeMode: ThemeMode
  cardStyle: CardStyle
  sfwMode: boolean
  sfwToastDismissed: boolean
  tagBlacklist: TagBlacklist
  filterEnabled: boolean
  setThemeMode: (mode: ThemeMode) => void
  setCardStyle: (style: CardStyle) => void
  setSfwMode: (enabled: boolean) => void
  dismissSfwToast: () => void
  addTag: (source: string, tag: string) => void
  removeTag: (source: string, tag: string) => void
  setTagBlacklist: (blacklist: TagBlacklist) => void
  setFilterEnabled: (enabled: boolean) => void
}

const DEFAULT_TAG_BLACKLIST: TagBlacklist = { hcomic: [], moeimg: [] }

export const useSettingsStore = create<SettingsState>((set) => ({
  themeMode: 'auto',
  cardStyle: 'cover',
  sfwMode: true,
  sfwToastDismissed: false,
  tagBlacklist: { ...DEFAULT_TAG_BLACKLIST },
  filterEnabled: true,
  setThemeMode: (mode) => set({ themeMode: mode }),
  setCardStyle: (style) => set({ cardStyle: style }),
  setSfwMode: (enabled) => set({ sfwMode: enabled }),
  dismissSfwToast: () => set({ sfwToastDismissed: true }),
  addTag: (source, tag) => {
    const trimmed = tag.trim()
    if (!trimmed) return
    set((state) => {
      const key = (source === 'moeimg' ? 'moeimg' : 'hcomic') as keyof TagBlacklist
      const list = state.tagBlacklist[key]
      if (list.some(t => t.toLowerCase() === trimmed.toLowerCase())) return state
      return {
        tagBlacklist: {
          ...state.tagBlacklist,
          [key]: [...list, trimmed],
        },
      }
    })
  },
  removeTag: (source, tag) => {
    set((state) => {
      const key = (source === 'moeimg' ? 'moeimg' : 'hcomic') as keyof TagBlacklist
      const lower = tag.toLowerCase()
      return {
        tagBlacklist: {
          ...state.tagBlacklist,
          [key]: state.tagBlacklist[key].filter(t => t.toLowerCase() !== lower),
        },
      }
    })
  },
  setTagBlacklist: (blacklist) => set({ tagBlacklist: blacklist }),
  setFilterEnabled: (enabled) => set({ filterEnabled: enabled }),
}))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/renderer/useSettingsStore.test.ts`
Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/useSettingsStore.ts tests/unit/renderer/useSettingsStore.test.ts
git commit -m "feat(tag-blacklist): add tagBlacklist state and actions to useSettingsStore"
```

---

### Task 5: Load tagBlacklist from config on App startup

**Files:**
- Modify: `src/App.tsx:24-43` (getConfig effect)

- [ ] **Step 1: Add tagBlacklist loading to App.tsx**

In `src/App.tsx`, update the destructured imports from `useSettingsStore` (line 17-18) to include the new actions:

Change:
```typescript
  const {
    sfwToastDismissed,
    setThemeMode, setSfwMode, dismissSfwToast
  } = useSettingsStore()
```
To:
```typescript
  const {
    sfwToastDismissed,
    setThemeMode, setSfwMode, dismissSfwToast,
    setTagBlacklist,
  } = useSettingsStore()
```

Then in the `getConfig().then()` callback (around line 30), after the `setSfwMode(true)` block, add tagBlacklist loading:

```typescript
        // Load tag blacklist from config
        const rawBlacklist = result.config?.tagBlacklist
        if (rawBlacklist && typeof rawBlacklist === 'object') {
          const normalized: { hcomic: string[]; moeimg: string[] } = {
            hcomic: Array.isArray(rawBlacklist.hcomic) ? rawBlacklist.hcomic : [],
            moeimg: Array.isArray(rawBlacklist.moeimg) ? rawBlacklist.moeimg : [],
          }
          setTagBlacklist(normalized)
        }
```

Also add `setTagBlacklist` to the useEffect dependency array.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(tag-blacklist): load tagBlacklist from config on app startup"
```

---

### Task 6: Wire store changes to setConfig persistence

**Files:**
- Modify: `src/stores/useSettingsStore.ts`

- [ ] **Step 1: Add config persistence to addTag and removeTag**

The store actions need to persist `tagBlacklist` changes via `setConfig`. Since the store should not directly import IPC (it runs in renderer), we use a subscriber pattern. Add a `subscribeToBlacklistChanges` function that the App component calls to wire things up.

Add to the bottom of `src/stores/useSettingsStore.ts`:

```typescript
/** Subscribe to tagBlacklist changes and persist via setConfig. */
export function subscribeToBlacklistChanges(setConfig: (key: 'tagBlacklist', value: TagBlacklist) => Promise<unknown>) {
  return useSettingsStore.subscribe(
    (state) => state.tagBlacklist,
    (tagBlacklist) => {
      setConfig('tagBlacklist', tagBlacklist).catch(() => {})
    },
  )
}
```

Import `TagBlacklist` from shared/types at the top (already done in Task 4).

- [ ] **Step 2: Subscribe in App.tsx**

In `src/App.tsx`, import the subscriber:

```typescript
import { useSettingsStore, subscribeToBlacklistChanges } from './stores/useSettingsStore'
```

In the App component, inside the `getConfig().then()` callback (after the tagBlacklist loading), subscribe:

```typescript
subscribeToBlacklistChanges(setConfig)
```

Note: this will subscribe on each config load. To avoid multiple subscriptions, guard with a ref:

Add a ref: `const subscribedRef = useRef(false)`

Then in the useEffect:
```typescript
if (!subscribedRef.current) {
  subscribedRef.current = true
  subscribeToBlacklistChanges(setConfig)
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/stores/useSettingsStore.ts src/App.tsx
git commit -m "feat(tag-blacklist): persist tagBlacklist changes via setConfig"
```

---

### Task 7: Add filter toggle and filtering logic to SearchPage

**Files:**
- Modify: `src/pages/SearchPage.tsx`

- [ ] **Step 1: Add filter toggle and useMemo filtering**

In `src/pages/SearchPage.tsx`, add imports:

```typescript
import { useMemo } from 'react'
```

(If `useMemo` is not already imported — check line 1, it currently has `useState, useEffect, useRef`.)

Update the `useSettingsStore` destructuring (line 45) to include:

```typescript
  const { cardStyle, tagBlacklist, filterEnabled, setFilterEnabled } = useSettingsStore()
```

Add the `filteredComics` memo after the existing state/hooks, before `handleSearch`:

```typescript
  const filteredComics = useMemo(() => {
    if (!filterEnabled) return comics
    const key = (source === 'moeimg' ? 'moeimg' : 'hcomic') as 'hcomic' | 'moeimg'
    const blocked = new Set(tagBlacklist[key].map(t => t.toLowerCase()))
    if (blocked.size === 0) return comics
    return comics.filter(c => !c.tags?.some(t => blocked.has(t.toLowerCase())))
  }, [comics, filterEnabled, tagBlacklist, source])
```

- [ ] **Step 2: Add filter toggle button and notice to JSX**

Replace the search button area (around line 241-249) to add the filter toggle next to the search button:

Find the search button:
```tsx
          <button
            onClick={() => handleSearch()}
            disabled={isLoading}
            className="px-6 py-2 bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)]
                       disabled:opacity-50 transition-colors"
          >
            {isLoading ? '搜索中...' : '搜索'}
          </button>
```

Replace with:
```tsx
          <button
            onClick={() => handleSearch()}
            disabled={isLoading}
            className="px-6 py-2 bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)]
                       disabled:opacity-50 transition-colors"
          >
            {isLoading ? '搜索中...' : '搜索'}
          </button>
          {(() => {
            const key = (source === 'moeimg' ? 'moeimg' : 'hcomic') as 'hcomic' | 'moeimg'
            return tagBlacklist[key].length > 0
          })() && (
            <button
              onClick={() => setFilterEnabled(!filterEnabled)}
              className={`px-3 py-2 rounded-lg text-sm transition-colors border ${
                filterEnabled
                  ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10'
                  : 'border-[var(--border)] text-[var(--text-secondary)] bg-[var(--bg-secondary)]'
              }`}
              title={filterEnabled ? '点击显示被过滤的结果' : '点击启用标签过滤'}
            >
              🚫 过滤
            </button>
          )}
```

Add the filter notice right before the comics grid (before `{comics.length > 0 && (`). Find this block around line 331:

```tsx
      {comics.length > 0 && (
```

Before it, add:

```tsx
      {filterEnabled && filteredComics.length < comics.length && (
        <div className="text-sm text-[var(--text-secondary)]">
          已过滤 {comics.length - filteredComics.length} 条结果
        </div>
      )}
```

Then replace `comics.map` in the grid (line 337) with `filteredComics.map`:

```tsx
          {filteredComics.map((comic) => (
```

And replace `comics.length > 0` on line 331 with `filteredComics.length > 0`:

```tsx
      {filteredComics.length > 0 && (
```

Also update the empty state at the bottom. Find `{!isLoading && comics.length === 0 &&` (around line 401) and change to:

```tsx
      {!isLoading && filteredComics.length === 0 && comics.length === 0 && (
```

This ensures the "no results" message only shows when there truly are no results, not when they were all filtered out. For the all-filtered case, add another message:

```tsx
      {!isLoading && comics.length > 0 && filteredComics.length === 0 && (
        <div className="text-center text-[var(--text-secondary)] py-12">
          所有结果均已被标签过滤
        </div>
      )}
```

- [ ] **Step 3: Verify TypeScript compiles and visually check**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/SearchPage.tsx
git commit -m "feat(tag-blacklist): add filter toggle and filtering logic to SearchPage"
```

---

### Task 8: Add tag block/unblock to ComicInfoDrawer

**Files:**
- Modify: `src/components/ComicInfoDrawer.tsx`

- [ ] **Step 1: Add block icon and confirmation dialog to tag buttons**

In `src/components/ComicInfoDrawer.tsx`, add imports:

```typescript
import { useSettingsStore } from '../stores/useSettingsStore'
```

Add state for the confirmation dialog:

```typescript
  const [confirmTag, setConfirmTag] = useState<{ tag: string; action: 'block' | 'unblock' } | null>(null)
  const { tagBlacklist, addTag, removeTag } = useSettingsStore()
  const comicSource = drawerComic?.source || 'hcomic'
```

Check if a tag is blacklisted:

```typescript
  const isTagBlocked = (tag: string) => {
    const key = (comicSource === 'moeimg' ? 'moeimg' : 'hcomic') as 'hcomic' | 'moeimg'
    return tagBlacklist[key].some(t => t.toLowerCase() === tag.toLowerCase())
  }
```

Replace the tags section JSX (lines 102-119) with the new version that includes block icons and dialog:

```tsx
          {drawerComic?.tags && drawerComic.tags.length > 0 && (
            <div>
              <span className="text-xs text-[var(--text-secondary)]">标签</span>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {drawerComic.tags.map((tag, i) => {
                  const blocked = isTagBlocked(tag)
                  return (
                    <span key={i} className="relative group">
                      <button
                        onClick={() => handleSearch(tag, 'tag', true)}
                        className={`text-xs px-2.5 py-1 rounded-full cursor-pointer transition-colors ${
                          blocked
                            ? 'bg-[var(--error)]/10 text-[var(--error)] line-through opacity-60'
                            : 'bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20'
                        }`}
                      >
                        {tag}
                      </button>
                      <button
                        onClick={() => setConfirmTag({ tag, action: blocked ? 'unblock' : 'block' })}
                        className={`absolute -top-1 -right-1 w-4 h-4 rounded-full text-[10px] flex items-center justify-center
                                   opacity-0 group-hover:opacity-100 transition-opacity
                                   ${blocked
                                     ? 'bg-[var(--accent)] text-white'
                                     : 'bg-[var(--error)] text-white'
                                   }`}
                        title={blocked ? '取消屏蔽' : '屏蔽标签'}
                      >
                        {blocked ? '✓' : '×'}
                      </button>
                    </span>
                  )
                })}
              </div>
            </div>
          )}
```

Add the confirmation dialog, after the drawer's main div but inside the component's return:

```tsx
      {confirmTag && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center" onClick={() => setConfirmTag(null)}>
          <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium text-[var(--text-primary)] mb-4">
              {confirmTag.action === 'block'
                ? `屏蔽标签「${confirmTag.tag}」？`
                : `取消屏蔽标签「${confirmTag.tag}」？`
              }
            </h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              {confirmTag.action === 'block'
                ? '包含该标签的漫画将从搜索结果中隐藏。'
                : '包含该标签的漫画将恢复显示在搜索结果中。'
              }
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmTag(null)}
                className="px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)]"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (confirmTag.action === 'block') {
                    addTag(comicSource, confirmTag.tag)
                  } else {
                    removeTag(comicSource, confirmTag.tag)
                  }
                  setConfirmTag(null)
                }}
                className={`px-4 py-2 rounded-lg text-white ${
                  confirmTag.action === 'block'
                    ? 'bg-[var(--error)] hover:bg-[var(--error)]/80'
                    : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'
                }`}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ComicInfoDrawer.tsx
git commit -m "feat(tag-blacklist): add tag block/unblock to ComicInfoDrawer with confirmation"
```

---

### Task 9: Add TagFilterSettings component to settings page

**Files:**
- Create: `src/components/settings/TagFilterSettings.tsx`
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: Create TagFilterSettings component**

Create `src/components/settings/TagFilterSettings.tsx`:

```typescriptx
import { useState } from 'react'
import type { TagBlacklist } from '@shared/types'

interface TagFilterSettingsProps {
  tagBlacklist: TagBlacklist
  addTag: (source: string, tag: string) => void
  removeTag: (source: string, tag: string) => void
}

const SOURCES = [
  { key: 'hcomic' as const, label: 'HComic' },
  { key: 'moeimg' as const, label: 'Moeimg' },
]

export function TagFilterSettings({ tagBlacklist, addTag, removeTag }: TagFilterSettingsProps) {
  const [activeSource, setActiveSource] = useState<'hcomic' | 'moeimg'>('hcomic')
  const [inputValue, setInputValue] = useState('')
  const [confirmTag, setConfirmTag] = useState<string | null>(null)

  const tags = tagBlacklist[activeSource]

  const handleAdd = () => {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    addTag(activeSource, trimmed)
    setInputValue('')
  }

  const handleRemove = (tag: string) => {
    removeTag(activeSource, tag)
    setConfirmTag(null)
  }

  return (
    <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-6">
      <h3 className="text-base font-medium text-[var(--text-primary)] border-b border-[var(--border)] pb-3">
        标签过滤
      </h3>

      <div>
        <div className="flex gap-3 mb-4">
          {SOURCES.map((s) => (
            <button
              key={s.key}
              onClick={() => setActiveSource(s.key)}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                activeSource === s.key
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]'
              }`}
            >
              {s.label}
              {tagBlacklist[s.key].length > 0 && (
                <span className="ml-1.5 text-xs opacity-80">({tagBlacklist[s.key].length})</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
            placeholder="输入标签名..."
            className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                       text-[var(--text-primary)] text-sm placeholder-[var(--text-secondary)]
                       focus:outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={handleAdd}
            disabled={!inputValue.trim()}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm
                       disabled:opacity-50 hover:bg-[var(--accent-hover)] transition-colors"
          >
            添加
          </button>
        </div>

        {tags.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)] py-4 text-center">暂无屏蔽标签</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full
                           bg-[var(--bg-secondary)] text-sm text-[var(--text-primary)]"
              >
                {tag}
                <button
                  onClick={() => setConfirmTag(tag)}
                  className="w-4 h-4 rounded-full text-[10px] flex items-center justify-center
                             text-[var(--text-secondary)] hover:text-[var(--error)] hover:bg-[var(--error)]/10 transition-colors"
                  title="移除"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {confirmTag !== null && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={() => setConfirmTag(null)}>
          <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium text-[var(--text-primary)] mb-4">
              移除屏蔽标签「{confirmTag}」？
            </h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              包含该标签的漫画将恢复显示在搜索结果中。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmTag(null)}
                className="px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)]"
              >
                取消
              </button>
              <button
                onClick={() => handleRemove(confirmTag)}
                className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add TagFilterSettings to SettingsPage**

In `src/pages/SettingsPage.tsx`, add the import:

```typescript
import { TagFilterSettings } from '../components/settings/TagFilterSettings'
```

Update the `useSettingsStore` destructuring (line 38) to include the new fields:

```typescript
  const { themeMode, cardStyle, sfwMode, setThemeMode, setCardStyle, setSfwMode, tagBlacklist, addTag, removeTag } = useSettingsStore()
```

Add `<TagFilterSettings>` in the JSX, between the "来源" section and `<AuthSettings>` (between lines 351 and 353):

```tsx
      <TagFilterSettings
        tagBlacklist={tagBlacklist}
        addTag={addTag}
        removeTag={removeTag}
      />
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/TagFilterSettings.tsx src/pages/SettingsPage.tsx
git commit -m "feat(tag-blacklist): add TagFilterSettings component to settings page"
```

---

### Task 10: Integration test and final verification

**Files:**
- No new files

- [ ] **Step 1: Run full TypeScript type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run all existing tests**

Run: `npx vitest run`
Expected: All tests pass (existing tests should not be affected).

- [ ] **Step 3: Run Python config tests**

Run: `python -m pytest tests/test_config.py -v`
Expected: All tests pass.

- [ ] **Step 4: Manual smoke test with `npm run dev`**

Start the dev server with `npm run dev` and verify:
1. Settings page shows "标签过滤" section with HComic/Moeimg tabs
2. Adding a tag in settings works, tag appears as a pill
3. Removing a tag with confirmation dialog works
4. Search page shows "🚫 过滤" button when blacklist has tags
5. Comics with blacklisted tags are hidden when filter is on
6. Toggling filter shows/hides filtered comics
7. "已过滤 N 条结果" notice appears when comics are filtered
8. ComicInfoDrawer shows block icon on hover for tags
9. Clicking block icon shows confirmation dialog
10. Blocking a tag from drawer immediately filters comics
11. App restart preserves the blacklist (check config file)
