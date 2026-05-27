"""Hybrid file-system + SQLite persistent cache for preview page images.

Stores raw image bytes as files on disk and metadata (URL, file path, size,
access time) in SQLite for efficient LRU eviction and statistics.
"""

from __future__ import annotations

import contextlib
import hashlib
import logging
import os
import sqlite3
import threading
import time
from collections import OrderedDict

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

        # In-memory LRU index: url -> None, insertion order = LRU order
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
                    with contextlib.suppress(OSError):
                        os.remove(old_path)

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

    def get_stats(self) -> dict:
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
