"""SQLite-backed persistent cache for cover image data URIs."""

import hashlib
import logging
import os
import sqlite3
import threading
from collections import OrderedDict

logger = logging.getLogger(__name__)

_DEFAULT_DB_DIR = os.path.join(os.path.expanduser("~"), ".hcomic_downloader")
_DEFAULT_DB_NAME = "cover_cache.db"


class CoverCacheDB:
    """Disk-backed LRU cache for cover data URIs.

    Stores up to *max_disk* entries in SQLite.  On startup the most recent
    *preload* entries are loaded into an in-memory OrderedDict for fast lookup.
    """

    def __init__(
        self,
        db_path: str | None = None,
        preload: int = 200,
        max_disk: int = 500,
    ):
        if db_path is None:
            os.makedirs(_DEFAULT_DB_DIR, exist_ok=True)
            db_path = os.path.join(_DEFAULT_DB_DIR, _DEFAULT_DB_NAME)
        self._db_path = db_path
        self._preload = preload
        self._max_disk = max_disk
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("""CREATE TABLE IF NOT EXISTS cover_cache (
                url_hash TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                data_uri TEXT NOT NULL,
                fetched_at REAL NOT NULL
            )""")
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_fetched_at ON cover_cache(fetched_at)"
        )
        self._conn.commit()

        # Pre-load hot entries into memory
        self._memory: OrderedDict[str, str] = OrderedDict()
        rows = self._conn.execute(
            "SELECT url, data_uri FROM cover_cache ORDER BY fetched_at DESC LIMIT ?",
            (preload,),
        ).fetchall()
        for url, data_uri in reversed(rows):
            self._memory[url] = data_uri
        logger.info(
            "Cover cache DB opened (%s), pre-loaded %d entries",
            db_path,
            len(self._memory),
        )

    # ── public API ──────────────────────────────────────────────────────

    def get(self, url: str) -> str | None:
        """Return cached data URI or *None*."""
        with self._lock:
            if url in self._memory:
                self._memory.move_to_end(url)
                return self._memory[url]
        return None

    def put(self, url: str, data_uri: str) -> None:
        """Store a data URI in both memory and disk cache."""
        with self._lock:
            self._memory[url] = data_uri
            self._memory.move_to_end(url)
            if len(self._memory) > self._preload:
                self._memory.popitem(last=False)
            url_hash = hashlib.sha256(url.encode()).hexdigest()
            now = _now()
            self._conn.execute(
                """INSERT OR REPLACE INTO cover_cache (url_hash, url, data_uri, fetched_at)
                   VALUES (?, ?, ?, ?)""",
                (url_hash, url, data_uri, now),
            )
            self._conn.commit()
            count = self._conn.execute("SELECT COUNT(*) FROM cover_cache").fetchone()[0]
            if count > self._max_disk:
                excess = count - self._max_disk
                self._conn.execute(
                    "DELETE FROM cover_cache WHERE url_hash IN ("
                    "  SELECT url_hash FROM cover_cache ORDER BY fetched_at ASC LIMIT ?"
                    ")",
                    (excess,),
                )
                self._conn.commit()

    def get_stats(self):
        """Return ``{file_count, total_size_bytes}`` for this cache."""
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

    def close(self) -> None:
        self._conn.close()


def _now() -> float:
    import time

    return time.time()
