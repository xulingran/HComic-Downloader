"""SQLite-backed persistent cache for cover image data URIs."""

import hashlib
import logging
import os
import sqlite3
import threading
from collections import OrderedDict

from .image_utils import _now

logger = logging.getLogger(__name__)

_DEFAULT_DB_DIR = os.path.join(os.path.expanduser("~"), ".hcomic_downloader")
_DEFAULT_DB_NAME = "cover_cache.db"


class CoverCacheDB:
    """Disk-backed byte-size-limited cache for cover data URIs.

    Stores entries in SQLite and an in-memory OrderedDict.  Eviction is
    triggered by total data-uri byte size (``max_size_mb``) rather than an
    entry count, giving the same guarantee as the preview cache.

    An in-memory ``_disk_bytes`` counter tracks total DB size so that
    ``put()`` and ``update_max_size()`` can avoid a ``SUM(size)`` scan.
    """

    def __init__(
        self,
        db_path: str | None = None,
        max_size_mb: int = 500,
    ):
        if db_path is None:
            os.makedirs(_DEFAULT_DB_DIR, exist_ok=True)
            db_path = os.path.join(_DEFAULT_DB_DIR, _DEFAULT_DB_NAME)
        self._db_path = db_path
        self._max_size_bytes = max_size_mb * 1024 * 1024
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("""CREATE TABLE IF NOT EXISTS cover_cache (
                url_hash TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                data_uri TEXT NOT NULL,
                size INTEGER NOT NULL DEFAULT 0,
                fetched_at REAL NOT NULL
            )""")
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_fetched_at ON cover_cache(fetched_at)"
        )
        ex = self._conn.execute("PRAGMA table_info(cover_cache)").fetchall()
        cols = {r[1] for r in ex}
        if "size" not in cols:
            self._conn.execute(
                "ALTER TABLE cover_cache ADD COLUMN size INTEGER NOT NULL DEFAULT 0"
            )
        self._conn.commit()

        self._memory: OrderedDict[str, tuple[str, int]] = OrderedDict()
        self._memory_bytes: int = 0
        rows = self._conn.execute(
            "SELECT url, data_uri, size FROM cover_cache ORDER BY fetched_at DESC"
        ).fetchall()
        for url, data_uri, size in reversed(rows):
            sz = size if size else len(data_uri)
            if self._memory_bytes + sz > self._max_size_bytes:
                break
            self._memory[url] = (data_uri, sz)
            self._memory.move_to_end(url)
            self._memory_bytes += sz

        self._disk_bytes: int = self._conn.execute(
            "SELECT COALESCE(SUM(size), 0) FROM cover_cache"
        ).fetchone()[0]

        logger.info(
            "Cover cache DB opened (%s), pre-loaded %d entries (%.1f MB / %d MB), disk %.1f MB",
            db_path,
            len(self._memory),
            self._memory_bytes / 1024 / 1024,
            self._max_size_bytes // 1024 // 1024,
            self._disk_bytes / 1024 / 1024,
        )

    # ── public API ──────────────────────────────────────────────────────

    def get(self, url: str) -> str | None:
        """Return cached data URI or *None*."""
        with self._lock:
            if url in self._memory:
                self._memory.move_to_end(url)
                return self._memory[url][0]
        return None

    def put(self, url: str, data_uri: str) -> None:
        """Store a data URI in both memory and disk cache."""
        with self._lock:
            sz = len(data_uri)
            self._evict_memory(sz)

            self._memory[url] = (data_uri, sz)
            self._memory.move_to_end(url)
            self._memory_bytes += sz

            url_hash = hashlib.sha256(url.encode()).hexdigest()
            now = _now()
            self._conn.execute(
                """INSERT OR REPLACE INTO cover_cache
                   (url_hash, url, data_uri, size, fetched_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (url_hash, url, data_uri, sz, now),
            )
            self._disk_bytes += sz
            self._evict_disk()
            self._conn.commit()

    def get_stats(self):
        """Return ``{file_count, total_size_bytes}`` for this cache."""
        with self._lock:
            row = self._conn.execute(
                "SELECT COUNT(*), COALESCE(SUM(size), 0) FROM cover_cache"
            ).fetchone()
            return {
                "file_count": row[0],
                "total_size_bytes": row[1],
            }

    def clear_all(self) -> None:
        """Delete all cached cover entries from memory and disk."""
        with self._lock:
            self._memory.clear()
            self._memory_bytes = 0
            self._conn.execute("DELETE FROM cover_cache")
            self._conn.commit()
            self._disk_bytes = 0
            logger.info("Cover cache cleared")

    def update_max_size(self, max_size_mb: int) -> None:
        """Update byte limit and evict to comply."""
        self._max_size_bytes = max_size_mb * 1024 * 1024
        with self._lock:
            self._evict_memory_until_below_limit()
            self._evict_disk()
            self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    # ── private helpers ─────────────────────────────────────────────────

    def _evict_memory(self, incoming_sz: int) -> None:
        """Make room in memory for *incoming_sz* bytes (FIFO eviction)."""
        while self._memory_bytes + incoming_sz > self._max_size_bytes and self._memory:
            _, (_, evicted_sz) = self._memory.popitem(last=False)
            self._memory_bytes -= evicted_sz

    def _evict_memory_until_below_limit(self) -> None:
        """Evict memory entries until total is within ``_max_size_bytes``."""
        while self._memory_bytes > self._max_size_bytes and self._memory:
            _, (_, evicted_sz) = self._memory.popitem(last=False)
            self._memory_bytes -= evicted_sz

    def _evict_disk(self) -> None:
        """Evict oldest disk entries until ``_disk_bytes <= _max_size_bytes``.

        Uses the in-memory ``_disk_bytes`` counter to avoid a ``SUM(size)``
        query on every write.  Counter is maintained on put / delete.
        """
        if self._disk_bytes <= self._max_size_bytes:
            return
        excess = self._disk_bytes - self._max_size_bytes
        rows = self._conn.execute(
            "SELECT url_hash, size FROM cover_cache ORDER BY fetched_at ASC"
        ).fetchall()
        freed = 0
        for rhash, rsize in rows:
            self._conn.execute("DELETE FROM cover_cache WHERE url_hash = ?", (rhash,))
            freed += rsize
            if freed >= excess:
                break
        self._disk_bytes -= freed
