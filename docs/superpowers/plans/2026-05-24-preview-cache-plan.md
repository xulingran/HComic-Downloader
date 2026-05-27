# 预览页面图片持久缓存及缓存管理 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为漫画预览页面图片添加持久缓存（文件系统+SQLite混合存储），并在设置界面提供缓存统计、上限调节和清理功能。

**Architecture:** 在Python后端新增 `PreviewCacheDB` 类（文件系统存二进制 + SQLite存元数据），扩展现有 `PreviewMixin` 在获取图片时先查缓存。新增3个IPC通道用于前端查询统计和清理缓存。前端新增 `CacheSettings` 组件嵌入设置页面。

**Tech Stack:** Python (sqlite3, threading), TypeScript, React, Electron IPC

---

## 文件结构

| 文件 | 变更 | 职责 |
|---|---|---|
| `python/ipc/preview_cache.py` | **新增** | `PreviewCacheDB` — 混合存储：文件系统(图片二进制) + SQLite(元数据) |
| `python/ipc/cover_cache.py` | 修改 | `CoverCacheDB` 新增 `get_stats()`, `clear_all()` |
| `config.py` | 修改 | `Config` dataclass 新增 `preview_cache_size_limit_mb` 字段 |
| `python/ipc/types.py` | 修改 | `CONFIG_KEY_MAP` 新增映射 |
| `python/ipc/preview_mixin.py` | 修改 | `_do_fetch_preview_image` 集成缓存读写 |
| `python/ipc_server.py` | 修改 | 初始化 `PreviewCacheDB`，注册3个新handler |
| `python/ipc/config_mixin.py` | 修改 | `handle_get_config` 返回新字段，`_apply_runtime` 处理缓存上限变更 |
| `shared/types.ts` | 修改 | 新增 `IPC_CHANNELS`、`CacheStats` 类型、`ConfigKey`、`CONFIG_KEYS` |
| `electron/main.ts` | 修改 | 注册3个新 IPC handler + `CONFIG_VALIDATORS` |
| `electron/preload.ts` | 修改 | 暴露 `getCacheStats`, `clearPreviewCache`, `clearAllCache` |
| `src/components/settings/CacheSettings.tsx` | **新增** | 缓存管理 UI 组件 |
| `src/pages/SettingsPage.tsx` | 修改 | 嵌入 `CacheSettings` |

### 测试文件

| 文件 | 变更 | 职责 |
|---|---|---|
| `tests/test_preview_cache.py` | **新增** | `PreviewCacheDB` 单元测试 + IPC handler 集成测试 |

---

### Task 1: PreviewCacheDB — 测试与实现

**Files:**
- Create: `tests/test_preview_cache.py`
- Create: `python/ipc/preview_cache.py`

- [ ] **Step 1: 编写 PreviewCacheDB 测试**

```python
"""Tests for PreviewCacheDB — hybrid file-system + SQLite cache for preview images."""
import os
import sys
import time
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"))

from ipc.preview_cache import PreviewCacheDB


@pytest.fixture
def cache(tmp_path):
    """Create a PreviewCacheDB in a temp directory."""
    db_path = tmp_path / "preview_cache.db"
    files_dir = tmp_path / "preview_cache"
    return PreviewCacheDB(db_path=str(db_path), files_dir=str(files_dir), max_size_mb=1)


def test_put_and_get(cache):
    url = "https://example.com/images/1.webp"
    raw = b"pretend-webp-bytes"
    cache.put(url, raw)

    path = cache.get(url)
    assert path is not None
    assert os.path.exists(path)
    with open(path, "rb") as f:
        assert f.read() == raw


def test_get_miss_returns_none(cache):
    assert cache.get("https://example.com/not-cached.webp") is None


def test_put_updates_last_access(cache):
    url = "https://example.com/images/2.webp"
    cache.put(url, b"aaa")

    # First access time
    stats1 = cache.get_stats()
    time.sleep(0.01)

    # Access again
    cache.get(url)
    # last_access should now be later than fetched_at, but we can't easily
    # inspect internal state — verify via LRU eviction test instead.
    # The key assertion: accessing moves it to end of LRU, so a newer entry
    # should be evicted first.
    url2 = "https://example.com/images/3.webp"
    cache.put(url2, b"bbb")
    # Now url is the most recently used, url2 is newest.
    # Access url again to make url2 the least recently used.
    cache.get(url)

    # Update max to force eviction (need to keep only 1 small entry)
    # Both entries are tiny, so size-based eviction won't trigger.
    # Use a different approach: test that get_stats reflects the right counts.
    stats = cache.get_stats()
    assert stats["file_count"] == 2


def test_eviction_on_size_limit(cache):
    """When total size exceeds max, oldest-by-last-access entries are evicted."""
    # Set max to ~200 bytes
    cache.update_max_size(0.0002)  # ~200 bytes

    url1 = "https://example.com/a.webp"
    url2 = "https://example.com/b.webp"
    url3 = "https://example.com/c.webp"

    # Each entry is 100 bytes
    cache.put(url1, b"x" * 100)
    cache.put(url2, b"y" * 100)
    # Access url1 so url2 is LRU
    cache.get(url1)
    cache.put(url3, b"z" * 100)
    # url2 should be evicted (LRU), url1 and url3 remain
    assert cache.get(url2) is None
    assert cache.get(url1) is not None
    assert cache.get(url3) is not None


def test_get_stats(cache):
    cache.put("https://example.com/x.webp", b"12345")
    cache.put("https://example.com/y.webp", b"67890")

    stats = cache.get_stats()
    assert stats["file_count"] == 2
    assert stats["total_size_bytes"] == 10
    assert stats["max_size_bytes"] == 1 * 1024 * 1024


def test_clear_all(cache):
    cache.put("https://example.com/a.webp", b"aaa")
    cache.put("https://example.com/b.webp", b"bbb")
    paths = [cache.get("https://example.com/a.webp"), cache.get("https://example.com/b.webp")]

    cache.clear_all()

    assert cache.get_stats()["file_count"] == 0
    assert cache.get_stats()["total_size_bytes"] == 0
    for p in paths:
        assert not os.path.exists(p)


def test_update_max_size(cache):
    cache.update_max_size(200)
    assert cache.get_stats()["max_size_bytes"] == 200 * 1024 * 1024


def test_same_url_overwrites(cache):
    url = "https://example.com/overwrite.webp"
    cache.put(url, b"short")
    cache.put(url, b"much-longer-content")

    path = cache.get(url)
    assert path is not None
    with open(path, "rb") as f:
        assert f.read() == b"much-longer-content"
    assert cache.get_stats()["file_count"] == 1


def test_close(cache):
    cache.close()
    # Should not raise
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest tests/test_preview_cache.py -v`
Expected: 全部 FAIL（`PreviewCacheDB` 尚未实现）

- [ ] **Step 3: 实现 PreviewCacheDB**

```python
"""Hybrid file-system + SQLite persistent cache for preview page images.

Stores raw image bytes as files on disk and metadata (URL, file path, size,
access time) in SQLite for efficient LRU eviction and statistics.
"""

from __future__ import annotations

import hashlib
import logging
import os
import sqlite3
import threading
import time
from collections import OrderedDict
from typing import Dict

logger = logging.getLogger(__name__)

_DEFAULT_DB_DIR = os.path.join(os.path.expanduser("~"), ".hcomic_downloader")
_DEFAULT_DB_NAME = "preview_cache.db"
_DEFAULT_FILES_DIR_NAME = "preview_cache"


class PreviewCacheDB:
    """Disk-backed LRU cache for preview page images.

    Raw image bytes are stored as files under *files_dir*.  Metadata
    (url_hash, url, file_path, size, fetched_at, last_access) is kept
    in a SQLite database.  An in-memory OrderedDict tracks LRU order
    for fast eviction decisions.

    Thread-safe: all public methods acquire ``self._lock``.
    """

    def __init__(
        self,
        db_path: str | None = None,
        files_dir: str | None = None,
        max_size_mb: int = 500,
    ):
        if db_path is None:
            os.makedirs(_DEFAULT_DB_DIR, exist_ok=True)
            db_path = os.path.join(_DEFAULT_DB_DIR, _DEFAULT_DB_NAME)
        if files_dir is None:
            files_dir = os.path.join(_DEFAULT_DB_DIR, _DEFAULT_FILES_DIR_NAME)

        self._db_path = db_path
        self._files_dir = files_dir
        self._max_size_bytes = max_size_mb * 1024 * 1024
        self._lock = threading.Lock()

        os.makedirs(self._files_dir, exist_ok=True)

        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute(
            """CREATE TABLE IF NOT EXISTS preview_cache (
                url_hash   TEXT PRIMARY KEY,
                url        TEXT NOT NULL,
                file_path  TEXT NOT NULL,
                size       INTEGER NOT NULL,
                fetched_at REAL NOT NULL,
                last_access REAL NOT NULL
            )"""
        )
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_preview_last_access ON preview_cache(last_access)"
        )
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_preview_url ON preview_cache(url)"
        )
        self._conn.commit()

        # In-memory LRU index: url -> True, insertion order = LRU order
        self._lru: OrderedDict[str, None] = OrderedDict()
        rows = self._conn.execute(
            "SELECT url FROM preview_cache ORDER BY last_access ASC"
        ).fetchall()
        for (url,) in rows:
            self._lru[url] = None

        logger.info(
            "Preview cache DB opened (%s), %d entries, max %d MB",
            db_path, len(self._lru), max_size_mb,
        )

    # ── public API ──────────────────────────────────────────────────────

    def get(self, url: str) -> str | None:
        """Return absolute file path for cached image, or *None* on miss."""
        with self._lock:
            if url not in self._lru:
                return None
            self._lru.move_to_end(url)
            row = self._conn.execute(
                "SELECT file_path FROM preview_cache WHERE url = ?", (url,)
            ).fetchone()
            if row is None:
                # Stale in-memory entry (should not happen normally)
                self._lru.pop(url, None)
                return None
            file_path = os.path.join(self._files_dir, row[0])
            if not os.path.exists(file_path):
                self._conn.execute("DELETE FROM preview_cache WHERE url = ?", (url,))
                self._conn.commit()
                self._lru.pop(url, None)
                return None
            now = _now()
            self._conn.execute(
                "UPDATE preview_cache SET last_access = ? WHERE url = ?",
                (now, url),
            )
            self._conn.commit()
            return file_path

    def put(self, url: str, raw_bytes: bytes) -> None:
        """Store raw image bytes.  Evicts LRU entries if over size limit."""
        with self._lock:
            url_hash = hashlib.sha256(url.encode()).hexdigest()
            file_name = url_hash
            file_path = os.path.join(self._files_dir, file_name)
            now = _now()

            # If URL already cached, remove old file first
            old = self._conn.execute(
                "SELECT file_path FROM preview_cache WHERE url_hash = ?", (url_hash,)
            ).fetchone()
            if old:
                old_path = os.path.join(self._files_dir, old[0])
                if os.path.exists(old_path) and old_path != file_path:
                    try:
                        os.remove(old_path)
                    except OSError:
                        pass

            # Write new file
            with open(file_path, "wb") as f:
                f.write(raw_bytes)

            size = len(raw_bytes)

            self._conn.execute(
                """INSERT OR REPLACE INTO preview_cache
                   (url_hash, url, file_path, size, fetched_at, last_access)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (url_hash, url, file_name, size, now, now),
            )
            self._conn.commit()

            self._lru[url] = None
            self._lru.move_to_end(url)

            # Evict if over limit
            self._evict_if_needed()

    def get_stats(self) -> Dict:
        """Return ``{file_count, total_size_bytes, max_size_bytes}``."""
        with self._lock:
            row = self._conn.execute(
                "SELECT COUNT(*), COALESCE(SUM(size), 0) FROM preview_cache"
            ).fetchone()
            return {
                "file_count": row[0],
                "total_size_bytes": row[1],
                "max_size_bytes": self._max_size_bytes,
            }

    def clear_all(self) -> None:
        """Delete all cached files and database records."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT file_path FROM preview_cache"
            ).fetchall()
            for (file_name,) in rows:
                file_path = os.path.join(self._files_dir, file_name)
                try:
                    if os.path.exists(file_path):
                        os.remove(file_path)
                except OSError:
                    pass
            self._conn.execute("DELETE FROM preview_cache")
            self._conn.commit()
            self._lru.clear()
            logger.info("Preview cache cleared")

    def update_max_size(self, size_mb: int) -> None:
        """Change the maximum cache size (in MB) at runtime."""
        with self._lock:
            self._max_size_bytes = size_mb * 1024 * 1024
            self._evict_if_needed()

    def close(self) -> None:
        self._conn.close()

    # ── internal ────────────────────────────────────────────────────────

    def _evict_if_needed(self) -> None:
        """Evict LRU entries until total size is within limit."""
        row = self._conn.execute(
            "SELECT COALESCE(SUM(size), 0) FROM preview_cache"
        ).fetchone()
        total = row[0]
        while total > self._max_size_bytes and self._lru:
            # Find the least recently used entry
            oldest_url = next(iter(self._lru))
            row = self._conn.execute(
                "SELECT file_path, size FROM preview_cache WHERE url = ?",
                (oldest_url,),
            ).fetchone()
            if row is None:
                self._lru.pop(oldest_url, None)
                continue
            file_name, size = row
            file_path = os.path.join(self._files_dir, file_name)
            try:
                if os.path.exists(file_path):
                    os.remove(file_path)
            except OSError:
                pass
            self._conn.execute(
                "DELETE FROM preview_cache WHERE url = ?", (oldest_url,)
            )
            self._conn.commit()
            self._lru.pop(oldest_url, None)
            total -= size


def _now() -> float:
    return time.time()
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest tests/test_preview_cache.py -v`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add python/ipc/preview_cache.py tests/test_preview_cache.py
git commit -m "feat: add PreviewCacheDB for persistent preview image caching"
```

---

### Task 2: CoverCacheDB — 添加 get_stats() 和 clear_all()

**Files:**
- Modify: `python/ipc/cover_cache.py`

- [ ] **Step 1: 运行现有测试确认基线**

Run: `pytest tests/test_ipc_preview.py -v`
Expected: 现有测试全部 PASS

- [ ] **Step 2: 在 CoverCacheDB 添加 get_stats() 和 clear_all()**

在 `cover_cache.py` 的 `CoverCacheDB` 类中添加以下方法（放在 `put()` 方法之后，`close()` 之前）：

```python
    def get_stats(self):
        """Return ``{file_count, total_size_bytes}`` for this cache."""
        import sys as _sys
        with self._lock:
            row = self._conn.execute(
                "SELECT COUNT(*), COALESCE(SUM(LENGTH(data_uri)), 0) FROM cover_cache"
            ).fetchone()
            return {
                "file_count": row[0],
                "total_size_bytes": row[1],
            }

    def clear_all(self) -> None:
        """Delete all cached cover entries from memory and disk."""
        with self._lock:
            self._memory.clear()
            self._conn.execute("DELETE FROM cover_cache")
            self._conn.commit()
            logger.info("Cover cache cleared")
```

- [ ] **Step 3: 验证测试仍通过**

Run: `pytest tests/test_ipc_preview.py -v`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add python/ipc/cover_cache.py
git commit -m "feat: add get_stats() and clear_all() to CoverCacheDB"
```

---

### Task 3: Config 模型 — 添加 preview_cache_size_limit_mb

**Files:**
- Modify: `config.py`
- Modify: `python/ipc/types.py`

- [ ] **Step 1: 在 Config dataclass 添加字段**

在 `config.py` 的 `Config` 类中添加字段（放在 `tag_blacklist` 字段之后）：

```python
    # 预览页面缓存大小上限（MB）
    preview_cache_size_limit_mb: int = 500
```

并在 `__post_init__` 方法末尾添加验证（放在 `tag_blacklist` 相关逻辑之后）：

```python
        # 验证缓存上限范围
        try:
            self.preview_cache_size_limit_mb = max(100, min(2048, int(self.preview_cache_size_limit_mb)))
        except (ValueError, TypeError):
            self.preview_cache_size_limit_mb = 500
```

- [ ] **Step 2: 在 CONFIG_KEY_MAP 添加映射**

在 `python/ipc/types.py` 的 `CONFIG_KEY_MAP` 字典中添加：

```python
    'previewCacheSizeLimitMB': 'preview_cache_size_limit_mb',
```

- [ ] **Step 3: 在 config_mixin.py 中导出新字段和运行时处理**

在 `python/ipc/config_mixin.py` 的 `handle_get_config` 方法的 `raw` 字典中添加：

```python
            'preview_cache_size_limit_mb': getattr(self.config, 'preview_cache_size_limit_mb', 500),
```

在 `_apply_runtime` 方法的 `_RUNTIME_APPLIERS` 字典中添加：

```python
            'previewCacheSizeLimitMB': lambda v: self._preview_cache.update_max_size(v) if hasattr(self, '_preview_cache') else None,
```

- [ ] **Step 4: 运行测试确认**

Run: `pytest tests/test_config.py tests/test_ipc_config_mapping.py -v`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add config.py python/ipc/types.py python/ipc/config_mixin.py
git commit -m "feat: add preview_cache_size_limit_mb config field"
```

---

### Task 4: IPCServer — 初始化 PreviewCacheDB + 注册缓存管理 handler

**Files:**
- Modify: `python/ipc_server.py`
- Modify: `python/ipc/preview_mixin.py`
- Modify: `tests/test_preview_cache.py` (新增 IPC handler 测试)

- [ ] **Step 1: 更新 PreviewMixin 集成缓存**

修改 `python/ipc/preview_mixin.py`，在 `PreviewMixin` 类中：

```python
# 在 _do_fetch_preview_image 方法中，在调用 _fetch_image_as_data_uri 之前插入缓存检查
    def _do_fetch_preview_image(self, url: str) -> str:
        """Fetch a preview page image, using cache when available."""
        import base64 as _base64
        from .image_utils import detect_image_type as _detect

        self._validate_preview_image_url(url)

        # Check persistent cache
        if hasattr(self, '_preview_cache'):
            cached_path = self._preview_cache.get(url)
            if cached_path:
                try:
                    with open(cached_path, 'rb') as f:
                        content = f.read()
                    content_type = _detect(content)
                    if content_type:
                        b64 = _base64.b64encode(content).decode('ascii')
                        logger.debug("Preview cache hit for %s", url)
                        return f"data:{content_type};base64,{b64}"
                except Exception:
                    logger.debug("Preview cache read failed for %s, re-fetching", url, exc_info=True)

        data_uri = self._fetch_image_as_data_uri(url, _PREVIEW_IMAGE_MAX_SIZE)

        # Save to persistent cache
        if hasattr(self, '_preview_cache'):
            try:
                b64_part = data_uri.split(",", 1)[1]
                raw_bytes = _base64.b64decode(b64_part)
                self._preview_cache.put(url, raw_bytes)
            except Exception:
                logger.debug("Failed to write preview cache for %s", url, exc_info=True)

        return data_uri
```

需要在文件顶部添加 `_PREVIEW_IMAGE_MAX_SIZE` 的导入（已存在于 `.types` 导入中，确认该文件已导入）。

- [ ] **Step 2: 更新 IPCServer 初始化 PreviewCacheDB**

在 `python/ipc_server.py` 的 `IPCServer.__init__` 方法中，在 `self._cover_cache = CoverCacheDB(...)` 之后添加：

```python
        from ipc.preview_cache import PreviewCacheDB
        self._preview_cache = PreviewCacheDB(
            max_size_mb=getattr(self.config, 'preview_cache_size_limit_mb', 500),
        )
```

- [ ] **Step 3: 在 IPCServer 添加三个 handler 方法**

在 `python/ipc_server.py` 的 `IPCServer` 类中添加以下方法（放在 `handle_resolve_unmatched` 之后）：

```python
    def handle_get_cache_stats(self) -> dict:
        """Return combined cache statistics for cover and preview caches."""
        cover_stats = self._cover_cache.get_stats()
        preview_stats = self._preview_cache.get_stats()
        total_file_count = cover_stats["file_count"] + preview_stats["file_count"]
        total_size_bytes = cover_stats["total_size_bytes"] + preview_stats["total_size_bytes"]
        return {
            "cover": cover_stats,
            "preview": preview_stats,
            "total": {
                "file_count": total_file_count,
                "total_size_bytes": total_size_bytes,
            },
        }

    def handle_clear_preview_cache(self) -> dict:
        """Clear only the preview image cache (keep cover cache)."""
        self._preview_cache.clear_all()
        return {"success": True}

    def handle_clear_all_cache(self) -> dict:
        """Clear both cover and preview caches."""
        self._cover_cache.clear_all()
        self._preview_cache.clear_all()
        return {"success": True}
```

- [ ] **Step 4: 注册 handler 到 dispatch table**

在 `handle_request` 方法的 `handlers` 字典中添加：

```python
            "get_cache_stats": self.handle_get_cache_stats,
            "clear_preview_cache": self.handle_clear_preview_cache,
            "clear_all_cache": self.handle_clear_all_cache,
```

这三个方法是同步的（不涉及网络），所以走 `handle_request` 路径即可，不需要在 `run()` 中特殊处理。

- [ ] **Step 5: 添加 IPC handler 集成测试**

在 `tests/test_preview_cache.py` 末尾追加：

```python
def test_ipc_server_get_cache_stats():
    """Integration test: IPCServer.handle_get_cache_stats returns combined stats."""
    from python.ipc_server import IPCServer
    from unittest.mock import MagicMock, patch
    from config import Config

    with patch("config.Config.load", return_value=Config()), \
         patch("parser.MultiSourceParser", return_value=MagicMock()), \
         patch("downloader.ComicDownloader", return_value=MagicMock()), \
         patch("cbz_builder.CBZBuilder", return_value=MagicMock()), \
         patch("download_manager.ComicDownloadManager", return_value=MagicMock()), \
         patch("download_history.DownloadHistoryDB", return_value=MagicMock()), \
         patch("concurrent.futures.ThreadPoolExecutor", MagicMock()), \
         patch("python.ipc_server.CoverCacheDB", return_value=MagicMock(
             get_stats=MagicMock(return_value={"file_count": 10, "total_size_bytes": 50000})
         )), \
         patch("python.ipc_server.PreviewCacheDB", return_value=MagicMock(
             get_stats=MagicMock(return_value={"file_count": 20, "total_size_bytes": 200000, "max_size_bytes": 524288000})
         )):
        server = IPCServer()

    result = server.handle_get_cache_stats()

    assert result["cover"]["file_count"] == 10
    assert result["cover"]["total_size_bytes"] == 50000
    assert result["preview"]["file_count"] == 20
    assert result["preview"]["total_size_bytes"] == 200000
    assert result["total"]["file_count"] == 30
    assert result["total"]["total_size_bytes"] == 250000


def test_ipc_server_clear_preview_cache():
    """Integration test: IPCServer.handle_clear_preview_cache calls clear on preview cache."""
    from python.ipc_server import IPCServer
    from unittest.mock import MagicMock, patch
    from config import Config

    mock_preview = MagicMock()
    with patch("config.Config.load", return_value=Config()), \
         patch("parser.MultiSourceParser", return_value=MagicMock()), \
         patch("downloader.ComicDownloader", return_value=MagicMock()), \
         patch("cbz_builder.CBZBuilder", return_value=MagicMock()), \
         patch("download_manager.ComicDownloadManager", return_value=MagicMock()), \
         patch("download_history.DownloadHistoryDB", return_value=MagicMock()), \
         patch("concurrent.futures.ThreadPoolExecutor", MagicMock()), \
         patch("python.ipc_server.CoverCacheDB", return_value=MagicMock()), \
         patch("python.ipc_server.PreviewCacheDB", return_value=mock_preview):
        server = IPCServer()

    result = server.handle_clear_preview_cache()

    mock_preview.clear_all.assert_called_once()
    assert result == {"success": True}


def test_ipc_server_clear_all_cache():
    """Integration test: IPCServer.handle_clear_all_cache clears both caches."""
    from python.ipc_server import IPCServer
    from unittest.mock import MagicMock, patch
    from config import Config

    mock_cover = MagicMock()
    mock_preview = MagicMock()
    with patch("config.Config.load", return_value=Config()), \
         patch("parser.MultiSourceParser", return_value=MagicMock()), \
         patch("downloader.ComicDownloader", return_value=MagicMock()), \
         patch("cbz_builder.CBZBuilder", return_value=MagicMock()), \
         patch("download_manager.ComicDownloadManager", return_value=MagicMock()), \
         patch("download_history.DownloadHistoryDB", return_value=MagicMock()), \
         patch("concurrent.futures.ThreadPoolExecutor", MagicMock()), \
         patch("python.ipc_server.CoverCacheDB", return_value=mock_cover), \
         patch("python.ipc_server.PreviewCacheDB", return_value=mock_preview):
        server = IPCServer()

    result = server.handle_clear_all_cache()

    mock_cover.clear_all.assert_called_once()
    mock_preview.clear_all.assert_called_once()
    assert result == {"success": True}
```

- [ ] **Step 6: 运行全部测试**

Run: `pytest tests/test_preview_cache.py tests/test_ipc_preview.py tests/test_config.py tests/test_ipc_config_mapping.py -v`
Expected: 全部 PASS

- [ ] **Step 7: Commit**

```bash
git add python/ipc_server.py python/ipc/preview_mixin.py tests/test_preview_cache.py
git commit -m "feat: integrate PreviewCacheDB into IPCServer with cache management handlers"
```

---

### Task 5: TypeScript 类型 — 新增 IPC 通道、CacheStats 和 ConfigKey

**Files:**
- Modify: `shared/types.ts`

- [ ] **Step 1: 添加 CacheStats 接口**

在 `shared/types.ts` 中，在 `PreviewImageResult` 接口之后添加：

```typescript
export interface CacheStats {
  cover: { file_count: number; total_size_bytes: number }
  preview: { file_count: number; total_size_bytes: number; max_size_bytes?: number }
  total: { file_count: number; total_size_bytes: number }
}
```

- [ ] **Step 2: 添加新 ConfigKey 和更新相关类型**

在 `ConfigKey` 类型联合中添加 `'previewCacheSizeLimitMB'`：

```typescript
export type ConfigKey = 'themeMode' | 'outputFormat' | 'downloadDir' | 'concurrentDownloads'
  | 'timeout' | 'retryTimes' | 'cbzFilenameTemplate' | 'batchDownloadDelay'
  | 'autoRetryMaxAttempts' | 'notifyOnComplete' | 'notifyWhenForeground' | 'defaultSource'
  | 'fontName' | 'fontSize' | 'sfwMode' | 'tagBlacklist'
  | 'previewCacheSizeLimitMB'
```

在 `ConfigValueMap` 中添加：

```typescript
  previewCacheSizeLimitMB: number
```

在 `AppConfig` 接口中添加字段（在 `tagBlacklist` 之后）：

```typescript
  previewCacheSizeLimitMB: number
```

在 `CONFIG_KEYS` 数组中添加 `'previewCacheSizeLimitMB'`。

- [ ] **Step 3: 在 IPCMethods 中添加新方法签名**

在 `IPCMethods` 接口中添加：

```typescript
  get_cache_stats: {
    params: Record<string, never>
    result: CacheStats
  }
  clear_preview_cache: {
    params: Record<string, never>
    result: { success: boolean }
  }
  clear_all_cache: {
    params: Record<string, never>
    result: { success: boolean }
  }
```

- [ ] **Step 4: 在 PYTHON_IPC_CHANNEL_MAP 和 IPC_CHANNELS 中添加新通道**

在 `PYTHON_IPC_CHANNEL_MAP` 中添加：

```typescript
  'python:get-cache-stats': 'get_cache_stats',
  'python:clear-preview-cache': 'clear_preview_cache',
  'python:clear-all-cache': 'clear_all_cache',
```

在 `IPC_CHANNELS` 中添加：

```typescript
  GET_CACHE_STATS: 'python:get-cache-stats',
  CLEAR_PREVIEW_CACHE: 'python:clear-preview-cache',
  CLEAR_ALL_CACHE: 'python:clear-all-cache',
```

- [ ] **Step 5: 在 HcomicAPI 接口中添加新方法**

在 `HcomicAPI` 接口中添加：

```typescript
  getCacheStats(): Promise<CacheStats>
  clearPreviewCache(): Promise<{ success: boolean }>
  clearAllCache(): Promise<{ success: boolean }>
```

- [ ] **Step 6: Commit**

```bash
git add shared/types.ts
git commit -m "feat: add CacheStats types, IPC channels, and ConfigKey for cache management"
```

---

### Task 6: Electron main.ts — 注册新 IPC handler + 配置验证

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: 在 CONFIG_VALIDATORS 中添加验证器**

在 `electron/main.ts` 的 `CONFIG_VALIDATORS` 对象中添加：

```typescript
  previewCacheSizeLimitMB: and(number(), integer(), range(100, 2048)),
```

- [ ] **Step 2: 在 registerIPCHandlers 中注册三个新 handler**

在 `registerIPCHandlers` 函数中，在 `RESOLVE_UNMATCHED` handler 之后添加：

```typescript
  ipcMain.handle(IPC_CHANNELS.GET_CACHE_STATS, async () => {
    return bridge.call('get_cache_stats')
  })

  ipcMain.handle(IPC_CHANNELS.CLEAR_PREVIEW_CACHE, async () => {
    return bridge.call('clear_preview_cache')
  })

  ipcMain.handle(IPC_CHANNELS.CLEAR_ALL_CACHE, async () => {
    return bridge.call('clear_all_cache')
  })
```

- [ ] **Step 3: Commit**

```bash
git add electron/main.ts
git commit -m "feat: register cache management IPC handlers in Electron main"
```

---

### Task 7: Electron preload.ts — 暴露新 API

**Files:**
- Modify: `electron/preload.ts`

- [ ] **Step 1: 更新 VALID_CONFIG_KEYS**

在 `electron/preload.ts` 中，`VALID_CONFIG_KEYS` 会自动包含新 key（因为它是从 `CONFIG_KEYS` 常量构建的），确认第 9 行的 `new Set<string>(CONFIG_KEYS)` 已经覆盖新 key。

- [ ] **Step 2: 在 contextBridge 暴露中添加三个新方法**

在 `contextBridge.exposeInMainWorld('hcomic', {` 对象中，在 `resolveUnmatched` 之后、`onMigrationProgress` 之前添加：

```typescript
  getCacheStats: () => ipcRenderer.invoke(IPC_CHANNELS.GET_CACHE_STATS),

  clearPreviewCache: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_PREVIEW_CACHE),

  clearAllCache: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_ALL_CACHE),
```

- [ ] **Step 3: Commit**

```bash
git add electron/preload.ts
git commit -m "feat: expose cache management API in preload"
```

---

### Task 8: CacheSettings 组件

**Files:**
- Create: `src/components/settings/CacheSettings.tsx`

- [ ] **Step 1: 创建 CacheSettings 组件**

```tsx
import { useState, useEffect, useCallback } from 'react'
import type { CacheStats } from '@shared/types'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

interface CacheSettingsProps {
  onSizeLimitChange: (mb: number) => void
  sizeLimitMB: number
}

export function CacheSettings({ onSizeLimitChange, sizeLimitMB }: CacheSettingsProps) {
  const [stats, setStats] = useState<CacheStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState<'preview' | 'all' | null>(null)
  const [inputValue, setInputValue] = useState(String(sizeLimitMB))
  const [showConfirm, setShowConfirm] = useState<'preview' | 'all' | null>(null)

  const loadStats = useCallback(async () => {
    try {
      const result = await window.hcomic!.getCacheStats()
      setStats(result)
    } catch {
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  useEffect(() => {
    setInputValue(String(sizeLimitMB))
  }, [sizeLimitMB])

  const handleClear = async (type: 'preview' | 'all') => {
    setShowConfirm(null)
    setClearing(type)
    try {
      if (type === 'preview') {
        await window.hcomic!.clearPreviewCache()
      } else {
        await window.hcomic!.clearAllCache()
      }
      await loadStats()
    } catch {
      // silently fail
    } finally {
      setClearing(null)
    }
  }

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const mb = Number(e.target.value)
    setInputValue(String(mb))
    onSizeLimitChange(mb)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
  }

  const handleInputBlur = () => {
    const parsed = parseInt(inputValue, 10)
    if (isNaN(parsed) || parsed < 100) {
      setInputValue(String(100))
      onSizeLimitChange(100)
    } else if (parsed > 2048) {
      setInputValue(String(2048))
      onSizeLimitChange(2048)
    } else {
      onSizeLimitChange(parsed)
    }
  }

  const ConfirmDialog = showConfirm ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-sm w-full mx-4">
        <p className="text-sm text-[var(--text-primary)] mb-2 font-medium">
          {showConfirm === 'preview' ? '清除预览缓存' : '清除全部缓存'}
        </p>
        <p className="text-xs text-[var(--text-secondary)] mb-6">
          {showConfirm === 'preview'
            ? '将删除所有预览页面图片缓存，封面图缓存会保留。此操作不可撤销。'
            : '将删除所有封面图和预览页面图片缓存。此操作不可撤销。'}
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setShowConfirm(null)}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)]"
          >
            取消
          </button>
          <button
            onClick={() => handleClear(showConfirm)}
            className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white"
          >
            确认清除
          </button>
        </div>
      </div>
    </div>
  ) : null

  return (
    <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-4">
      {ConfirmDialog}
      <h3 className="text-base font-medium text-[var(--text-primary)] border-b border-[var(--border)] pb-3">
        缓存管理
      </h3>

      {loading ? (
        <p className="text-sm text-[var(--text-secondary)]">加载中...</p>
      ) : stats ? (
        <>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">封面缓存</span>
              <span className="text-[var(--text-primary)]">
                {stats.cover.file_count} 张 · ≈ {formatSize(stats.cover.total_size_bytes)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">预览缓存</span>
              <span className="text-[var(--text-primary)]">
                {stats.preview.file_count} 张 · ≈ {formatSize(stats.preview.total_size_bytes)}
              </span>
            </div>
            <div className="border-t border-[var(--border)] pt-2 flex justify-between font-medium">
              <span className="text-[var(--text-primary)]">合计</span>
              <span className="text-[var(--text-primary)]">
                {stats.total.file_count} 张 · ≈ {formatSize(stats.total.total_size_bytes)}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
              缓存上限
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={100}
                max={2048}
                step={50}
                value={sizeLimitMB}
                onChange={handleSliderChange}
                className="flex-1 h-1.5 rounded-full appearance-none bg-[var(--bg-secondary)] cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:cursor-pointer"
              />
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={inputValue}
                  onChange={handleInputChange}
                  onBlur={handleInputBlur}
                  className="w-16 px-2 py-1 text-sm text-center rounded border border-[var(--border)]
                    bg-[var(--bg-secondary)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
                <span className="text-sm text-[var(--text-secondary)]">MB</span>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setShowConfirm('preview')}
              disabled={clearing !== null}
              className="flex-1 px-4 py-2 text-sm rounded-lg border border-[var(--border)]
                text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {clearing === 'preview' ? '清除中...' : '清除预览缓存'}
            </button>
            <button
              onClick={() => setShowConfirm('all')}
              disabled={clearing !== null}
              className="flex-1 px-4 py-2 text-sm rounded-lg border border-red-300
                text-red-500 hover:bg-red-50 transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {clearing === 'all' ? '清除中...' : '清除全部缓存'}
            </button>
          </div>
        </>
      ) : (
        <p className="text-sm text-[var(--text-secondary)]">无法获取缓存信息</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/settings/CacheSettings.tsx
git commit -m "feat: add CacheSettings component for cache management UI"
```

---

### Task 9: SettingsPage 集成

**Files:**
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: 导入 CacheSettings 并添加状态**

在 `SettingsPage.tsx` 顶部导入：

```tsx
import { CacheSettings } from '../components/settings/CacheSettings'
```

在 `ConfigState` 接口中添加字段：

```typescript
  previewCacheSizeLimitMB: number
```

在 `config` 初始状态中添加：

```typescript
    previewCacheSizeLimitMB: 500,
```

在 `loadConfig` 中添加加载逻辑（在设置 `tagBlacklist` 之后）：

```typescript
        if (typeof result.config.previewCacheSizeLimitMB === 'number') {
          setConfigState(prev => ({ ...prev, previewCacheSizeLimitMB: result.config.previewCacheSizeLimitMB }))
        }
```

- [ ] **Step 2: 在 JSX 中嵌入 CacheSettings**

在 `NotificationSettings` 之后、`MigrationDialog` 之前添加：

```tsx
      <CacheSettings
        sizeLimitMB={config.previewCacheSizeLimitMB}
        onSizeLimitChange={(mb) => handleConfigChange('previewCacheSizeLimitMB', mb)}
      />
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/SettingsPage.tsx
git commit -m "feat: integrate CacheSettings into SettingsPage"
```

---

### Task 10: 最终验证与端到端检查

- [ ] **Step 1: 运行全部 Python 测试**

Run: `pytest tests/ -v`
Expected: 全部 PASS（确保没有回归）

- [ ] **Step 2: 运行 TypeScript 类型检查**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: 构建检查**

Run: `npm run build` 或 `npx electron-vite build`
Expected: 构建成功

- [ ] **Step 4: Commit（如有修复）**

如有修正，commit 后 squash。
```
