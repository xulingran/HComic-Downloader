# Random Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在搜索页添加"🎲 随机"按钮，调用 hcomic `/random` 接口获取随机漫画列表。

**Architecture:** 新增独立的 `random` IPC 方法贯穿全栈（Python → Electron IPC → React），与现有 `search` 方法解耦。Python 层新增 `random()` 方法构造 `/random` URL 并复用搜索结果解析逻辑。

**Tech Stack:** Python (parser/search_mixin/ipc_server), TypeScript (shared types, Electron main/preload, React hooks/page)

---

### Task 1: Python — HComicParser.random() + MultiSourceParser.random()

**Files:**
- Modify: `parser.py:341-355` (HComicParser — 新增 `_build_random_url` 和 `random` 方法)
- Modify: `parser.py:1112-1114` (MultiSourceParser — 新增 `random` 代理方法)

- [ ] **Step 1: Add `_build_random_url` classmethod to HComicParser (after `_build_search_url` at line ~355)**

```python
    @classmethod
    def _build_random_url(cls) -> str:
        return f"{cls.INDEX}/random?q=&tag="
```

- [ ] **Step 2: Add `random` method to HComicParser (after `search` at line ~133)**

```python
    def random(self) -> tuple[List[ComicInfo], Optional[PaginationInfo]]:
        url = self._build_random_url()
        try:
            return self.parse_search_page(self._request_text(url))
        except (ParserResponseError, ValueError, json.JSONDecodeError, TypeError) as e:
            logger.error("Random failed: %s", e)
            return [], None
```

- [ ] **Step 3: Add `random` method to MultiSourceParser (after `search` at line ~1114)**

```python
    def random(self, source: Optional[str] = None) -> tuple[List[ComicInfo], Optional[PaginationInfo]]:
        src = source or self.current_source
        if src != "hcomic":
            raise ValueError(f"Random is not supported for source: {src}")
        return self.parsers[src].random()
```

- [ ] **Step 4: Verify Python syntax**

Run: `python -c "from parser import MultiSourceParser; print('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add parser.py
git commit -m "feat: add random() to HComicParser and MultiSourceParser"
```

---

### Task 2: Python — SearchMixin.handle_random() + IPCServer routing

**Files:**
- Modify: `python/ipc/search_mixin.py:76-95` (新增 `handle_random` 方法)
- Modify: `python/ipc_server.py:140-173` (handlers dict 新增 `random` 路由)

- [ ] **Step 1: Add `handle_random` to SearchMixin (after `handle_search` at line ~95)**

```python
    def handle_random(self) -> Dict:
        comics, pagination = self.parser.random(source="hcomic")
        return {
            "comics": [self._comic_to_dict(c) for c in comics],
            "pagination": {
                "currentPage": pagination.current_page if pagination else 1,
                "totalPages": pagination.total_pages if pagination else 1,
                "totalItems": pagination.total_items if pagination else 0,
            },
        }
```

- [ ] **Step 2: Register `random` in IPCServer.handle_request handlers dict (line ~141)**

Add entry after `"search": self.handle_search,`:

```python
            "random": self.handle_random,
```

- [ ] **Step 3: Verify Python syntax**

Run: `python -c "from ipc_server import IPCServer; print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add python/ipc/search_mixin.py python/ipc_server.py
git commit -m "feat: add handle_random to SearchMixin and IPCServer routing"
```

---

### Task 3: Shared Types — random IPC method type definitions

**Files:**
- Modify: `shared/types.ts` (IPCMethods, PYTHON_IPC_CHANNEL_MAP, IPC_CHANNELS, HcomicAPI)

- [ ] **Step 1: Add `random` to `IPCMethods` interface (after `search` entry at line ~192)**

```typescript
  random: {
    params: Record<string, never>
    result: SearchResult
  }
```

- [ ] **Step 2: Add channel mapping to `PYTHON_IPC_CHANNEL_MAP` (after `'python:search'` at line ~327)**

```typescript
  'python:random': 'random',
```

- [ ] **Step 3: Add channel constant to `IPC_CHANNELS` (after `SEARCH` at line ~435)**

```typescript
  RANDOM: 'python:random',
```

- [ ] **Step 4: Add `random` to `HcomicAPI` interface (after `search` at line ~376)**

```typescript
  random(): Promise<SearchResult>
```

- [ ] **Step 5: Update IPC channel consistency test to include `random`**

In `tests/unit/main/ipc-channel-consistency.test.ts`, add `'random'` to the `ipcMethodKeys` array (after `'search'` at line ~39):

```typescript
      'search', 'random', 'download', 'check_download_conflict', 'get_favourites',
```

- [ ] **Step 6: Run the consistency test**

Run: `npx vitest run tests/unit/main/ipc-channel-consistency.test.ts`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add shared/types.ts tests/unit/main/ipc-channel-consistency.test.ts
git commit -m "feat: add random IPC method type definitions"
```

---

### Task 4: Electron — preload and main handler for random

**Files:**
- Modify: `electron/preload.ts` (新增 `random` 方法)
- Modify: `electron/main.ts:564-577` (新增 `python:random` handler)

- [ ] **Step 1: Add `random` to preload (after `search` at line ~28)**

```typescript
  random: () => ipcRenderer.invoke(IPC_CHANNELS.RANDOM),
```

- [ ] **Step 2: Add `python:random` handler in main.ts (after the SEARCH handler block ending at line ~577)**

```typescript
  ipcMain.handle(IPC_CHANNELS.RANDOM, async () => {
    return bridge.call('random', {})
  })
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add electron/preload.ts electron/main.ts
git commit -m "feat: add random IPC channel in preload and main"
```

---

### Task 5: React — useRandom hook + SearchPage button

**Files:**
- Modify: `src/hooks/useIpc.ts` (新增 `useRandom` hook)
- Modify: `src/pages/SearchPage.tsx:253-260` (搜索按钮左侧添加随机按钮)

- [ ] **Step 1: Add `useRandom` hook to useIpc.ts (after `useSearch` at line ~35)**

```typescript
export function useRandom() {
  const { invoke } = useIpc()

  const random = useCallback(async () => {
    return invoke(() => window.hcomic!.random())
  }, [invoke])

  return { random }
}
```

- [ ] **Step 2: Import `useRandom` in SearchPage.tsx**

Change the import at line 3:
```typescript
import { useSearch, useRandom, useConfig } from '../hooks/useIpc'
```

- [ ] **Step 3: Call `useRandom` hook in SearchPage component (after `const { search } = useSearch()` at line ~37)**

```typescript
  const { random } = useRandom()
```

- [ ] **Step 4: Add `handleRandom` function in SearchPage (after `handleSearch` at line ~184)**

```typescript
  const handleRandom = async () => {
    clearSelection()
    setQuery('')
    setSearchTags('')
    setShowHistory(false)

    const gen = ++searchGenRef.current
    setLoading(true)
    setError(null)

    try {
      const result = await random()
      if (gen !== searchGenRef.current) return
      setComics(result.comics)
      setPagination(result.pagination)
    } catch (err) {
      if (gen !== searchGenRef.current) return
      setError(err instanceof Error ? err.message : 'Random failed')
    } finally {
      if (gen === searchGenRef.current) {
        setLoading(false)
      }
    }
  }
```

- [ ] **Step 5: Add random button in SearchPage JSX (before the search button at line ~253)**

Insert between the input `</div>` closing tag and the search `<button>`:

```tsx
          {source === 'hcomic' && (
            <button
              onClick={handleRandom}
              disabled={isLoading}
              className="px-4 py-2 rounded-lg border border-[var(--border)]
                         text-[var(--text-primary)] bg-[var(--bg-secondary)]
                         hover:bg-[var(--bg-primary)] disabled:opacity-50 transition-colors"
            >
              🎲 随机
            </button>
          )}
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useIpc.ts src/pages/SearchPage.tsx
git commit -m "feat: add random button to search page (hcomic only)"
```

---

### Task 6: Smoke test — verify full flow

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Start the app and verify manually**

Run: `npm run dev`
Verify:
1. HComic 源下搜索按钮左侧出现"🎲 随机"按钮
2. 点击随机按钮 → 搜索框和 tag 清空 → 显示随机漫画列表
3. 切换到 Moeimg 源 → 随机按钮消失
4. 切换回 HComic → 随机按钮重新出现
5. 搜索后仍可点击随机按钮重新获取随机结果

- [ ] **Step 3: Final commit if any adjustments needed**

```bash
git add -A
git commit -m "fix: address smoke test findings for random button"
```
