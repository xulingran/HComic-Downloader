# Favourite Tag Recommendation & Search Highlighting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tag recommendation engine from the user's favourites and highlight matching search results in the search page.

**Architecture:** Python backend maintains a SQLite tag index (`favourite_tags.db`) with two tables — one for per-comic tag snapshots and one for aggregated tag counts. Three new IPC methods (`get_favourite_tags`, `sync_favourite_tags`, `remove_favourite_tag`) bridge to the frontend. A settings toggle enables highlighting, and the search page + ComicCard render amber highlights on recommended comics.

**Tech Stack:** Python 3 / SQLite, Electron IPC (JSON-RPC), React + Zustand + TypeScript.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `python/ipc/favourite_tags_mixin.py` | `FavouriteTagsDB` (SQLite) + `FavouriteTagsMixin` (IPC handlers) |
| Create | `tests/test_favourite_tags.py` | Backend unit tests |
| Modify | `python/ipc_server.py` | Add mixin to inheritance, register handlers, init DB |
| Modify | `python/ipc/types.py` | Add `favouriteTagHighlight` to `CONFIG_KEY_MAP` |
| Modify | `config.py` | Add `favourite_tag_highlight: bool` field |
| Modify | `python/ipc/config_mixin.py` | Add `favourite_tag_highlight` to `handle_get_config` raw dict |
| Modify | `python/ipc/search_mixin.py` | Hook incremental tag updates into add/remove/get favourites |
| Modify | `shared/types.ts` | Add IPC channels, method types, HcomicAPI methods, config keys |
| Modify | `electron/main.ts` | Register 3 new IPC handlers with validation |
| Modify | `electron/preload.ts` | Expose 3 new methods on `window.hcomic` |
| Modify | `src/hooks/useIpc.ts` | Add `useFavouriteTags` hook |
| Modify | `src/stores/useSettingsStore.ts` | Add `favouriteTagHighlight` state |
| Create | `src/components/settings/FavouriteTagSettings.tsx` | Settings UI for recommended tags |
| Modify | `src/pages/SettingsPage.tsx` | Add "推荐标签" section, render FavouriteTagSettings |
| Modify | `src/pages/SearchPage.tsx` | Load recommended tags, compute `isRecommended`, pass to ComicCard |
| Modify | `src/components/common/ComicCard.tsx` | Add `isRecommended` / `recommendedTags` props, amber styling |

---

### Task 1: Backend — FavouriteTagsDB (SQLite data layer)

**Files:**
- Create: `python/ipc/favourite_tags_mixin.py` (write `FavouriteTagsDB` class only in this task)
- Create: `tests/test_favourite_tags.py`

- [ ] **Step 1: Write failing tests for FavouriteTagsDB**

Create `tests/test_favourite_tags.py`:

```python
"""Tests for FavouriteTagsDB (favourite tag index persistence)."""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from python.ipc.favourite_tags_mixin import FavouriteTagsDB


def _make_db(tmp_path):
    return FavouriteTagsDB(str(tmp_path / "ft.db"))


def test_add_comic_and_get_tags(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_comic("c1", "hcomic", ["tag:A", "tag:B", "tag:C"])
    tags = db.get_tags("hcomic")
    assert len(tags) == 3
    assert tags[0]["tag"] == "tag:A"
    assert tags[0]["count"] == 1


def test_add_multiple_comics_aggregates_counts(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_comic("c1", "hcomic", ["tag:A", "tag:B"])
    db.upsert_comic("c2", "hcomic", ["tag:A", "tag:C"])
    tags = db.get_tags("hcomic")
    tag_map = {t["tag"]: t["count"] for t in tags}
    assert tag_map["tag:A"] == 2
    assert tag_map["tag:B"] == 1
    assert tag_map["tag:C"] == 1


def test_remove_comic_decrements_counts(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_comic("c1", "hcomic", ["tag:A", "tag:B"])
    db.upsert_comic("c2", "hcomic", ["tag:A"])
    db.remove_comic("c1", "hcomic")
    tags = db.get_tags("hcomic")
    tag_map = {t["tag"]: t["count"] for t in tags}
    assert tag_map["tag:A"] == 1
    assert tag_map["tag:B"] == 0  # count=0 still present
    # tag:B with count 0 should still exist but be last
    assert tags[-1]["tag"] == "tag:B"


def test_upsert_comic_updates_snapshot(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_comic("c1", "hcomic", ["tag:A"])
    db.upsert_comic("c1", "hcomic", ["tag:B"])
    tags = db.get_tags("hcomic")
    tag_map = {t["tag"]: t["count"] for t in tags}
    # tag:A should be decremented (old snapshot), tag:B incremented (new)
    assert tag_map.get("tag:A", 0) == 0
    assert tag_map["tag:B"] == 1


def test_remove_tag_by_name(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_comic("c1", "hcomic", ["tag:A", "tag:B"])
    db.remove_tag("tag:A", "hcomic")
    tags = db.get_tags("hcomic")
    tag_names = [t["tag"] for t in tags]
    assert "tag:A" not in tag_names
    assert "tag:B" in tag_names


def test_get_tags_sorted_by_count_desc(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_comic("c1", "hcomic", ["rare", "common", "other"])
    db.upsert_comic("c2", "hcomic", ["common", "other"])
    db.upsert_comic("c3", "hcomic", ["common"])
    tags = db.get_tags("hcomic")
    counts = [t["count"] for t in tags]
    assert counts == sorted(counts, reverse=True)


def test_different_sources_isolated(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_comic("c1", "hcomic", ["tag:A"])
    db.upsert_comic("c1", "jmcomic", ["tag:X"])
    hcomic_tags = db.get_tags("hcomic")
    jmcomic_tags = db.get_tags("jmcomic")
    assert len(hcomic_tags) == 1
    assert len(jmcomic_tags) == 1
    assert hcomic_tags[0]["tag"] == "tag:A"
    assert jmcomic_tags[0]["tag"] == "tag:X"


def test_clear_all(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_comic("c1", "hcomic", ["tag:A", "tag:B"])
    db.clear("hcomic")
    tags = db.get_tags("hcomic")
    assert len(tags) == 0


def test_get_tags_empty_db(tmp_path):
    db = _make_db(tmp_path)
    tags = db.get_tags("hcomic")
    assert tags == []


def test_remove_comic_not_exist(tmp_path):
    db = _make_db(tmp_path)
    # Should not raise
    db.remove_comic("nonexistent", "hcomic")
    tags = db.get_tags("hcomic")
    assert tags == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /e/Developing/hcomic_downloader && python -m pytest tests/test_favourite_tags.py -v 2>&1 | head -30`
Expected: `ModuleNotFoundError` or `ImportError` — module doesn't exist yet.

- [ ] **Step 3: Implement FavouriteTagsDB**

Create `python/ipc/favourite_tags_mixin.py` with the `FavouriteTagsDB` class:

```python
"""Favourite tag index mixin for IPCServer."""

from __future__ import annotations

import json
import logging
import os
import sqlite3
from typing import Any

logger = logging.getLogger(__name__)


class FavouriteTagsDB:
    """SQLite-backed favourite tag frequency index."""

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS favourite_tag_index (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tag TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'hcomic',
                count INTEGER NOT NULL DEFAULT 1,
                UNIQUE(tag, source)
            )
        """)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS favourite_tag_comics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                comic_id TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'hcomic',
                tags TEXT NOT NULL DEFAULT '[]',
                UNIQUE(comic_id, source)
            )
        """)
        self._conn.commit()

    def upsert_comic(self, comic_id: str, source: str, tags: list[str]) -> None:
        """Add or update a comic's tag snapshot, adjusting counts incrementally."""
        row = self._conn.execute(
            "SELECT tags FROM favourite_tag_comics WHERE comic_id = ? AND source = ?",
            (comic_id, source),
        ).fetchone()
        old_tags = set(json.loads(row["tags"])) if row else set()
        new_tags = set(tags)

        # Decrement removed tags
        for tag in old_tags - new_tags:
            self._conn.execute(
                "UPDATE favourite_tag_index SET count = count - 1 WHERE tag = ? AND source = ?",
                (tag, source),
            )
            self._conn.execute(
                "DELETE FROM favourite_tag_index WHERE tag = ? AND source = ? AND count <= 0",
                (tag, source),
            )

        # Increment added tags
        for tag in new_tags - old_tags:
            self._conn.execute(
                """INSERT INTO favourite_tag_index (tag, source, count) VALUES (?, ?, 1)
                   ON CONFLICT(tag, source) DO UPDATE SET count = count + 1""",
                (tag, source),
            )

        # Upsert comic snapshot
        self._conn.execute(
            """INSERT INTO favourite_tag_comics (comic_id, source, tags) VALUES (?, ?, ?)
               ON CONFLICT(comic_id, source) DO UPDATE SET tags = excluded.tags""",
            (comic_id, source, json.dumps(sorted(new_tags))),
        )
        self._conn.commit()

    def remove_comic(self, comic_id: str, source: str) -> None:
        """Remove a comic and decrement its tag counts."""
        row = self._conn.execute(
            "SELECT tags FROM favourite_tag_comics WHERE comic_id = ? AND source = ?",
            (comic_id, source),
        ).fetchone()
        if not row:
            return
        old_tags = json.loads(row["tags"])
        for tag in old_tags:
            self._conn.execute(
                "UPDATE favourite_tag_index SET count = count - 1 WHERE tag = ? AND source = ?",
                (tag, source),
            )
        # Clean up zero-count entries
        self._conn.execute(
            "DELETE FROM favourite_tag_index WHERE source = ? AND count <= 0",
            (source,),
        )
        self._conn.execute(
            "DELETE FROM favourite_tag_comics WHERE comic_id = ? AND source = ?",
            (comic_id, source),
        )
        self._conn.commit()

    def remove_tag(self, tag: str, source: str) -> None:
        """Remove a specific tag from the index entirely."""
        self._conn.execute(
            "DELETE FROM favourite_tag_index WHERE tag = ? AND source = ?",
            (tag, source),
        )
        self._conn.commit()

    def get_tags(self, source: str) -> list[dict[str, Any]]:
        """Return all tags for a source sorted by count descending."""
        rows = self._conn.execute(
            "SELECT tag, count FROM favourite_tag_index WHERE source = ? ORDER BY count DESC, tag ASC",
            (source,),
        ).fetchall()
        return [{"tag": r["tag"], "count": r["count"]} for r in rows]

    def clear(self, source: str) -> None:
        """Clear all tag data for a source."""
        self._conn.execute(
            "DELETE FROM favourite_tag_index WHERE source = ?", (source,)
        )
        self._conn.execute(
            "DELETE FROM favourite_tag_comics WHERE source = ?", (source,)
        )
        self._conn.commit()

    def get_comic_tags(self, comic_id: str, source: str) -> list[str]:
        """Get stored tags for a specific comic."""
        row = self._conn.execute(
            "SELECT tags FROM favourite_tag_comics WHERE comic_id = ? AND source = ?",
            (comic_id, source),
        ).fetchone()
        return json.loads(row["tags"]) if row else []
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /e/Developing/hcomic_downloader && python -m pytest tests/test_favourite_tags.py -v`
Expected: All 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add python/ipc/favourite_tags_mixin.py tests/test_favourite_tags.py
git commit -m "feat: add FavouriteTagsDB with SQLite tag frequency index"
```

---

### Task 2: Backend — FavouriteTagsMixin (IPC handlers)

**Files:**
- Modify: `python/ipc/favourite_tags_mixin.py` (append `FavouriteTagsMixin` class)
- Modify: `python/ipc_server.py` (add mixin inheritance, init, handler registration)

- [ ] **Step 1: Add FavouriteTagsMixin to favourite_tags_mixin.py**

Append to `python/ipc/favourite_tags_mixin.py`, after `FavouriteTagsDB`:

```python
class FavouriteTagsMixin:
    """Mixin providing favourite tag recommendation IPC handlers."""

    _favourite_tags_db: FavouriteTagsDB
    parser: Any
    _write_response: Any

    def _init_favourite_tags(self) -> None:
        db_path = os.path.join(
            os.path.expanduser("~"), ".hcomic_downloader", "favourite_tags.db"
        )
        self._favourite_tags_db = FavouriteTagsDB(db_path)

    def handle_get_favourite_tags(self, source: str = "hcomic") -> dict:
        effective_source = source if source in ("hcomic", "jmcomic") else "hcomic"
        tags = self._favourite_tags_db.get_tags(effective_source)
        return {"tags": tags}

    def handle_sync_favourite_tags(self, source: str = "hcomic") -> dict:
        effective_source = source if source in ("hcomic", "jmcomic") else "hcomic"
        self._favourite_tags_db.clear(effective_source)
        synced = 0
        page = 1
        while True:
            try:
                comics, pagination, _needs_login = self.parser.favourites(
                    page=page, raise_errors=True, source=effective_source
                )
            except Exception as e:
                logger.error("sync_favourite_tags page %d error: %s", page, e)
                break
            for comic in comics:
                tags = getattr(comic, "tags", None) or []
                if tags:
                    self._favourite_tags_db.upsert_comic(
                        comic.id, effective_source, tags
                    )
                synced += 1
            if not pagination or page >= pagination.total_pages:
                break
            page += 1
        return {"synced": synced}

    def handle_remove_favourite_tag(self, tag: str, source: str = "hcomic") -> dict:
        effective_source = source if source in ("hcomic", "jmcomic") else "hcomic"
        self._favourite_tags_db.remove_tag(tag, effective_source)
        return {"success": True}
```

- [ ] **Step 2: Wire FavouriteTagsMixin into IPCServer**

Modify `python/ipc_server.py`:

At the top imports (after `HistoryMixin` import, ~line 27), add:
```python
from ipc.favourite_tags_mixin import FavouriteTagsMixin  # noqa: E402
```

Add `FavouriteTagsMixin` to the `IPCServer` class inheritance list (after `HistoryMixin`, ~line 43):
```python
class IPCServer(
    SearchMixin,
    CoverMixin,
    PreviewMixin,
    DownloadMixin,
    ConfigMixin,
    AuthMixin,
    MigrationMixin,
    HistoryMixin,
    FavouriteTagsMixin,
):
```

In `__init__` (after `self._init_reading_history()`, ~line 138), add:
```python
        # Favourite tags index database
        self._init_favourite_tags()
```

Add handler names to `_HANDLER_NAMES` dict:
```python
        "get_favourite_tags": "handle_get_favourite_tags",
        "sync_favourite_tags": "handle_sync_favourite_tags",
        "remove_favourite_tag": "handle_remove_favourite_tag",
```

- [ ] **Step 3: Verify server starts without errors**

Run: `cd /e/Developing/hcomic_downloader && python -c "from python.ipc_server import IPCServer; print('OK')"` 
Expected: `OK` (may print config warnings — that's fine, should not crash).

- [ ] **Step 4: Commit**

```bash
git add python/ipc/favourite_tags_mixin.py python/ipc_server.py
git commit -m "feat: add FavouriteTagsMixin with get/sync/remove handlers"
```

---

### Task 3: Backend — Config key + incremental update hooks

**Files:**
- Modify: `config.py` (add `favourite_tag_highlight` field)
- Modify: `python/ipc/types.py` (add key mapping)
- Modify: `python/ipc/config_mixin.py` (add to `handle_get_config` raw dict)
- Modify: `python/ipc/search_mixin.py` (hook add/remove/get favourites)

- [ ] **Step 1: Add config field**

In `config.py`, add after the `preview_cache_size_limit_mb` field (~line 57):

```python
    # 推荐标签高亮开关
    favourite_tag_highlight: bool = False
```

- [ ] **Step 2: Add key mapping**

In `python/ipc/types.py`, add to `CONFIG_KEY_MAP` dict:

```python
    "favouriteTagHighlight": "favourite_tag_highlight",
```

- [ ] **Step 3: Add to config getter**

In `python/ipc/config_mixin.py`, add to the `raw` dict in `handle_get_config` (after `jmcomic_domain`):

```python
            "favourite_tag_highlight": getattr(self.config, "favourite_tag_highlight", False),
```

- [ ] **Step 4: Hook incremental tag updates into search_mixin.py**

In `python/ipc/search_mixin.py`, modify `handle_add_to_favourites`. After the `success = self.parser.add_to_favourites(...)` call succeeds (before `return {"success": success}`), add:

```python
        if success:
            self._update_tags_on_favourite_add(comic_id, effective_source)
        return {"success": success}
```

Modify `handle_remove_from_favourites`. After the `success = self.parser.remove_from_favourites(...)` call succeeds (before `return {"success": success}`), add:

```python
        if success:
            self._favourite_tags_db.remove_comic(comic_id, effective_source)
        return {"success": success}
```

Modify `handle_get_favourites`. After the `comics` list is returned successfully (before the return statement, ~line 141), add a call to update tags for the current page's comics:

```python
        self._update_tags_from_favourites_page(comics, effective_source)
```

At the bottom of the `SearchMixin` class, add two helper methods:

```python
    def _update_tags_on_favourite_add(self, comic_id: str, source: str) -> None:
        try:
            comic = self.parser.get_comic_detail(comic_id, source=source)
            if comic and hasattr(comic, "tags") and comic.tags:
                self._favourite_tags_db.upsert_comic(comic_id, source, comic.tags)
        except Exception as e:
            logger.debug("Failed to update tags on favourite add: %s", e)

    def _update_tags_from_favourites_page(self, comics: list, source: str) -> None:
        for comic in comics:
            tags = getattr(comic, "tags", None) or []
            if not tags:
                continue
            existing = self._favourite_tags_db.get_comic_tags(comic.id, source)
            if set(existing) != set(tags):
                self._favourite_tags_db.upsert_comic(comic.id, source, tags)
```

- [ ] **Step 5: Verify all tests still pass**

Run: `cd /e/Developing/hcomic_downloader && python -m pytest tests/ -v --timeout=30 2>&1 | tail -20`
Expected: All existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add config.py python/ipc/types.py python/ipc/config_mixin.py python/ipc/search_mixin.py
git commit -m "feat: add favouriteTagHighlight config key and incremental tag update hooks"
```

---

### Task 4: Shared types + IPC bridge

**Files:**
- Modify: `shared/types.ts` (add channels, method types, HcomicAPI, config keys)
- Modify: `electron/main.ts` (register 3 new IPC handlers)
- Modify: `electron/preload.ts` (expose 3 new methods)

- [ ] **Step 1: Update shared/types.ts**

Add to `IPCMethods` interface (after `clear_history`):

```typescript
  get_favourite_tags: {
    params: { source?: string }
    result: { tags: Array<{tag: string; count: number}> }
  }
  sync_favourite_tags: {
    params: { source?: string }
    result: { synced: number }
  }
  remove_favourite_tag: {
    params: { tag: string; source?: string }
    result: { success: boolean }
  }
```

Add to `PYTHON_IPC_CHANNEL_MAP`:

```typescript
  'python:get-favourite-tags': 'get_favourite_tags',
  'python:sync-favourite-tags': 'sync_favourite_tags',
  'python:remove-favourite-tag': 'remove_favourite_tag',
```

Add to `HcomicAPI` interface (after `clearHistory`):

```typescript
  getFavouriteTags(source?: string): Promise<{ tags: Array<{tag: string; count: number}> }>
  syncFavouriteTags(source?: string): Promise<{ synced: number }>
  removeFavouriteTag(tag: string, source?: string): Promise<{ success: boolean }>
```

Add to `IPC_CHANNELS`:

```typescript
  GET_FAVOURITE_TAGS: 'python:get-favourite-tags',
  SYNC_FAVOURITE_TAGS: 'python:sync-favourite-tags',
  REMOVE_FAVOURITE_TAG: 'python:remove-favourite-tag',
```

Add `'favouriteTagHighlight'` to `ConfigKey` union type.

Add `favouriteTagHighlight: boolean` to `ConfigValueMap`.

Add `'favouriteTagHighlight'` to `CONFIG_KEYS` array.

Add `favouriteTagHighlight?: boolean` to `AppConfig` interface.

- [ ] **Step 2: Register IPC handlers in electron/main.ts**

Add a new function `registerFavouriteTagHandlers` (after `registerHistoryHandlers`, ~line 913):

```typescript
function registerFavouriteTagHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.GET_FAVOURITE_TAGS, async (_, source?: unknown) => {
    const params: Record<string, unknown> = {}
    if (source !== undefined && source !== null) {
      assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), source, 'get_favourite_tags source')
      params.source = source
    }
    return bridge.call('get_favourite_tags', params)
  })

  ipcMain.handle(IPC_CHANNELS.SYNC_FAVOURITE_TAGS, async (_, source?: unknown) => {
    const params: Record<string, unknown> = {}
    if (source !== undefined && source !== null) {
      assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), source, 'sync_favourite_tags source')
      params.source = source
    }
    return bridge.call('sync_favourite_tags', params)
  })

  ipcMain.handle(IPC_CHANNELS.REMOVE_FAVOURITE_TAG, async (_, tag: unknown, source?: unknown) => {
    assert(and(string(), length(1, 64), noControlChars()), tag, 'remove_favourite_tag tag')
    const params: Record<string, unknown> = { tag }
    if (source !== undefined && source !== null) {
      assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), source, 'remove_favourite_tag source')
      params.source = source
    }
    return bridge.call('remove_favourite_tag', params)
  })
}
```

Add `registerFavouriteTagHandlers(bridge)` to `registerIPCHandlers()` function.

Add `favouriteTagHighlight: boolean()` to `CONFIG_VALIDATORS` in main.ts.

- [ ] **Step 3: Expose methods in electron/preload.ts**

Add three methods to the `contextBridge.exposeInMainWorld('hcomic', {...})` object (after `clearHistory`):

```typescript
  getFavouriteTags: (source?: unknown) => {
    if (source !== undefined && source !== null && typeof source !== 'string') throw new Error('Invalid source')
    return ipcRenderer.invoke(IPC_CHANNELS.GET_FAVOURITE_TAGS, source ?? undefined)
  },

  syncFavouriteTags: (source?: unknown) => {
    if (source !== undefined && source !== null && typeof source !== 'string') throw new Error('Invalid source')
    return ipcRenderer.invoke(IPC_CHANNELS.SYNC_FAVOURITE_TAGS, source ?? undefined)
  },

  removeFavouriteTag: (tag: unknown, source?: unknown) => {
    if (typeof tag !== 'string' || tag.length === 0 || tag.length > 64) throw new Error('Invalid tag')
    if (source !== undefined && source !== null && typeof source !== 'string') throw new Error('Invalid source')
    return ipcRenderer.invoke(IPC_CHANNELS.REMOVE_FAVOURITE_TAG, tag, source ?? undefined)
  },
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /e/Developing/hcomic_downloader && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors (or only pre-existing errors, not related to new code).

- [ ] **Step 5: Commit**

```bash
git add shared/types.ts electron/main.ts electron/preload.ts
git commit -m "feat: add IPC bridge for favourite tag recommendation APIs"
```

---

### Task 5: Frontend — useFavouriteTags hook + Settings store

**Files:**
- Modify: `src/hooks/useIpc.ts` (add `useFavouriteTags` hook)
- Modify: `src/stores/useSettingsStore.ts` (add `favouriteTagHighlight` state)

- [ ] **Step 1: Add useFavouriteTags hook to src/hooks/useIpc.ts**

Append at the end of the file:

```typescript
export function useFavouriteTags() {
  const { invoke } = useIpc()

  const getFavouriteTags = useCallback(async (source?: string) => {
    return invoke(() => window.hcomic!.getFavouriteTags(source))
  }, [invoke])

  const syncFavouriteTags = useCallback(async (source?: string) => {
    return invoke(() => window.hcomic!.syncFavouriteTags(source))
  }, [invoke])

  const removeFavouriteTag = useCallback(async (tag: string, source?: string) => {
    return invoke(() => window.hcomic!.removeFavouriteTag(tag, source))
  }, [invoke])

  return { getFavouriteTags, syncFavouriteTags, removeFavouriteTag }
}
```

- [ ] **Step 2: Add favouriteTagHighlight to useSettingsStore**

In `src/stores/useSettingsStore.ts`, add to `SettingsState` interface:

```typescript
  favouriteTagHighlight: boolean
  setFavouriteTagHighlight: (enabled: boolean) => void
```

Add to the store default state:

```typescript
  favouriteTagHighlight: false,
  setFavouriteTagHighlight: (enabled) => set({ favouriteTagHighlight: enabled }),
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /e/Developing/hcomic_downloader && npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useIpc.ts src/stores/useSettingsStore.ts
git commit -m "feat: add useFavouriteTags hook and favouriteTagHighlight setting"
```

---

### Task 6: Frontend — FavouriteTagSettings component + SettingsPage integration

**Files:**
- Create: `src/components/settings/FavouriteTagSettings.tsx`
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: Create FavouriteTagSettings component**

Create `src/components/settings/FavouriteTagSettings.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { useFavouriteTags } from '../../hooks/useIpc'
import { useSettingsStore } from '../../stores/useSettingsStore'

interface TagItem {
  tag: string
  count: number
}

export function FavouriteTagSettings() {
  const { favouriteTagHighlight, setFavouriteTagHighlight } = useSettingsStore()
  const { getFavouriteTags, syncFavouriteTags, removeFavouriteTag } = useFavouriteTags()
  const [tags, setTags] = useState<TagItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncedCount, setSyncedCount] = useState<number | null>(null)
  const [confirmTag, setConfirmTag] = useState<string | null>(null)

  const loadTags = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await getFavouriteTags('hcomic')
      setTags(result.tags)
    } catch {
      setTags([])
    } finally {
      setIsLoading(false)
    }
  }, [getFavouriteTags])

  useEffect(() => {
    loadTags()
  }, [loadTags])

  const handleSync = async () => {
    setIsSyncing(true)
    setSyncedCount(null)
    try {
      const result = await syncFavouriteTags('hcomic')
      setSyncedCount(result.synced)
      await loadTags()
    } catch {
      setSyncedCount(null)
    } finally {
      setIsSyncing(false)
    }
  }

  const handleRemoveTag = async (tag: string) => {
    try {
      await removeFavouriteTag(tag, 'hcomic')
      setTags(prev => prev.filter(t => t.tag !== tag))
    } catch {}
    setConfirmTag(null)
  }

  const handleToggle = () => {
    setFavouriteTagHighlight(!favouriteTagHighlight)
  }

  return (
    <div id="section-favourite-tags" className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-6">
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
        <h3 className="text-base font-medium text-[var(--text-primary)]">推荐标签</h3>
        <button
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            favouriteTagHighlight ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              favouriteTagHighlight ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <p className="text-sm text-[var(--text-secondary)]">
        基于收藏夹中的漫画标签，推荐你可能感兴趣的内容。开启后，搜索结果中包含推荐标签的漫画会被高亮显示。
      </p>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm
                     disabled:opacity-50 hover:bg-[var(--accent-hover)] transition-colors"
        >
          {isSyncing ? '同步中...' : '从收藏夹同步标签'}
        </button>
        {syncedCount !== null && (
          <span className="text-sm text-[var(--text-secondary)]">
            已同步 {syncedCount} 本漫画
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-[var(--text-secondary)] py-4 text-center">加载中...</p>
      ) : tags.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)] py-4 text-center">请先同步收藏夹数据以生成推荐标签</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map(({ tag, count }) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full
                         bg-amber-500/10 text-amber-600 text-sm"
            >
              {tag}
              <span className="text-xs opacity-60">({count})</span>
              <button
                onClick={() => setConfirmTag(tag)}
                className="w-4 h-4 rounded-full text-[10px] flex items-center justify-center
                           text-amber-600/60 hover:text-[var(--error)] hover:bg-[var(--error)]/10 transition-colors"
                title="移除"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {confirmTag !== null && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={() => setConfirmTag(null)}>
          <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium text-[var(--text-primary)] mb-4">
              移除推荐标签「{confirmTag}」？
            </h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              该标签将从推荐列表中移除，不影响收藏夹数据。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmTag(null)}
                className="px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)]"
              >
                取消
              </button>
              <button
                onClick={() => handleRemoveTag(confirmTag)}
                className="px-4 py-2 rounded-lg bg-[var(--error)] text-white hover:bg-[var(--error)]/80"
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

- [ ] **Step 2: Integrate into SettingsPage**

In `src/pages/SettingsPage.tsx`:

Add import at the top:
```typescript
import { FavouriteTagSettings } from '../components/settings/FavouriteTagSettings'
```

Add to `SECTIONS` array (after the `tag-filter` entry):
```typescript
    { id: 'favourite-tags', label: '推荐标签', icon: '⭐' },
```

Add the component render (after the `section-tag-filter` div, before `section-auth`):
```tsx
      <div id="section-favourite-tags">
        <FavouriteTagSettings />
      </div>
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /e/Developing/hcomic_downloader && npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/FavouriteTagSettings.tsx src/pages/SettingsPage.tsx
git commit -m "feat: add FavouriteTagSettings component and integrate into settings page"
```

---

### Task 7: Frontend — Search page highlighting + ComicCard extension

**Files:**
- Modify: `src/pages/SearchPage.tsx` (load tags, compute `isRecommended`, pass to ComicCard)
- Modify: `src/components/common/ComicCard.tsx` (add `isRecommended` / `recommendedTags` props, amber styling)

- [ ] **Step 1: Update SearchPage.tsx — load tags and compute isRecommended**

Add import at top of `SearchPage.tsx`:
```typescript
import { useFavouriteTags } from '../hooks/useIpc'
```

Inside the `SearchPage` function, add after other hooks (after `const searchCache = useSearchCacheStore()`):

```typescript
  const { favouriteTagHighlight } = useSettingsStore()
  const { getFavouriteTags } = useFavouriteTags()
  const [favTags, setFavTags] = useState<Array<{tag: string; count: number}>>([])
```

Add a `useEffect` to load favourite tags when highlighting is enabled and source is hcomic:

```typescript
  useEffect(() => {
    if (!favouriteTagHighlight || source !== 'hcomic') {
      setFavTags([])
      return
    }
    getFavouriteTags('hcomic').then(result => setFavTags(result.tags)).catch(() => setFavTags([]))
  }, [favouriteTagHighlight, source, getFavouriteTags])
```

Add `recommendedTags` memo (before `filteredComics`):

```typescript
  const recommendedTags = useMemo(() => {
    if (!favouriteTagHighlight || source !== 'hcomic') return new Set<string>()
    return new Set(favTags.map(t => t.tag.toLowerCase()))
  }, [favouriteTagHighlight, source, favTags])
```

Modify `filteredComics` useMemo to add `isRecommended`:

```typescript
  const filteredComics = useMemo(() => {
    const key = effectiveSourceKey(source)
    const blocked = new Set(tagBlacklist[key].map(t => t.toLowerCase()))
    const hasBlockedTags = blocked.size > 0
    return comics.map(c => {
      const isBlocked = filterEnabled && hasBlockedTags && (c.tags?.some(t => blocked.has(t.toLowerCase())) ?? false)
      const isRecommended = !isBlocked && recommendedTags.size > 0 && (c.tags?.some(t => recommendedTags.has(t.toLowerCase())) ?? false)
      return { comic: c, isBlocked, isRecommended }
    })
  }, [comics, filterEnabled, tagBlacklist, source, recommendedTags])
```

Pass `isRecommended` and `recommendedTags` to ComicCard in the render. Update the ComicCard rendering in the grid:

```tsx
              <ComicCard
                key={getComicKey(comic)}
                comic={comic}
                onOpenReader={handleOpenReader}
                batchMode={batchMode}
                selected={selectedIds.has(getComicKey(comic))}
                onToggleSelect={toggleSelect}
                onDownload={handleDownload}
                isRecommended={isRecommended}
                recommendedTags={recommendedTags}
              />
```

- [ ] **Step 2: Update ComicCard.tsx — add props and amber styling**

In `src/components/common/ComicCard.tsx`:

Add to `ComicCardProps` interface:
```typescript
  isRecommended?: boolean
  recommendedTags?: Set<string>
```

Update the `ComicCard` component to forward the new props to both CoverCard and DetailedCard:
```tsx
export function ComicCard({ comic, onClick, selected, batchMode, onToggleSelect, onDownload, onOpenReader, downloadStatus, isRecommended, recommendedTags }: ComicCardProps) {
  const { cardStyle } = useSettingsStore()
  const { openDrawer } = useDrawerStore()

  if (cardStyle === 'detailed') {
    return <DetailedCard comic={comic} onClick={onClick} selected={selected} batchMode={batchMode} onToggleSelect={onToggleSelect} onDownload={onDownload} onOpenReader={onOpenReader} downloadStatus={downloadStatus} onOpenDrawer={() => openDrawer(comic)} isRecommended={isRecommended} recommendedTags={recommendedTags} />
  }
  return <CoverCard comic={comic} onClick={onClick} selected={selected} batchMode={batchMode} onToggleSelect={onToggleSelect} onDownload={onDownload} onOpenReader={onOpenReader} downloadStatus={downloadStatus} onOpenDrawer={() => openDrawer(comic)} isRecommended={isRecommended} recommendedTags={recommendedTags} />
}
```

Update CoverCard — add props and styling. The `CoverCard` function signature becomes:

```tsx
function CoverCard({ comic, onClick, selected, batchMode, onToggleSelect, onDownload, onOpenReader, downloadStatus, onOpenDrawer, isRecommended, recommendedTags }: ComicCardProps & { onOpenDrawer: () => void }) {
```

Modify the outer div className to include amber border/background when recommended:

```tsx
      className={`bg-[var(--bg-primary)] rounded-xl shadow-sm hover:shadow-md transition-all duration-200
                 cursor-pointer overflow-hidden group relative
                 ${selected ? 'ring-2 ring-[var(--accent)] shadow-[var(--accent)]/20 shadow-lg' : ''}
                 ${isRecommended ? 'border-l-2 border-l-amber-400/70' : ''}`}
```

Update DetailedCard similarly. The function signature becomes:

```tsx
function DetailedCard({ comic, onClick, selected, batchMode, onToggleSelect, onDownload, onOpenReader, downloadStatus, onOpenDrawer, isRecommended, recommendedTags }: ComicCardProps & { onOpenDrawer: () => void }) {
```

Modify the outer div className:

```tsx
      className={`flex items-center px-4 py-2.5 cursor-pointer transition-colors duration-150
                  border-b border-[var(--border)] hover:bg-[var(--bg-secondary)]
                  ${selected ? 'border-l-2 border-l-[var(--accent)] bg-[var(--accent)]/5' : ''}
                  ${isRecommended && !selected ? 'border-l-2 border-l-amber-400/70' : ''}`}
```

Update tag rendering in DetailedCard to highlight recommended tags:

```tsx
            {(showAllTags ? comic.tags : comic.tags.slice(0, 3)).map((tag, i) => {
              const isRecTag = recommendedTags && recommendedTags.has(tag.toLowerCase())
              return (
                <span
                  key={i}
                  className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    isRecTag
                      ? 'bg-amber-500/15 text-amber-600'
                      : 'bg-[var(--accent)]/10 text-[var(--accent)]'
                  }`}
                >
                  {tag}
                </span>
              )
            })}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /e/Developing/hcomic_downloader && npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/SearchPage.tsx src/components/common/ComicCard.tsx
git commit -m "feat: add recommended tag highlighting to search page and comic cards"
```

---

### Task 8: Integration test — end-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Run all backend tests**

Run: `cd /e/Developing/hcomic_downloader && python -m pytest tests/ -v --timeout=30 2>&1 | tail -30`
Expected: All tests pass.

- [ ] **Step 2: Run TypeScript compilation**

Run: `cd /e/Developing/hcomic_downloader && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix: integration fixups for favourite tag recommendation feature"
```
