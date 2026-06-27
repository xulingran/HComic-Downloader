"""Hybrid file-system + SQLite persistent cache for cover image data URIs.

Mirrors :mod:`ipc.preview_cache`: raw image bytes live as files on disk, while
SQLite keeps metadata (url_hash, url, file_path, size, fetched_at, last_access)
for LRU eviction and statistics.  Startup only scans URL keys to build the LRU
index — it never reads image bytes, so cold-start cost stays flat regardless of
cache size.

A one-shot, resumable migration upgrades legacy databases that stored the full
base64 ``data_uri`` inline.  See :meth:`CoverCacheDB._migrate_legacy`.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import threading
from collections import OrderedDict

from utils import open_sqlite_db

from .image_utils import _now

logger = logging.getLogger(__name__)

_DEFAULT_DB_DIR = os.path.join(os.path.expanduser("~"), ".hcomic_downloader")
_DEFAULT_DB_NAME = "cover_cache.db"
_DEFAULT_FILES_DIR_NAME = "cover_cache"

# Migration writes commit every N rows to bound transaction size / memory.
_MIGRATE_BATCH_SIZE = 50


class CoverCacheDB:
    """Disk-backed LRU cache for cover image data URIs.

    Raw image bytes are stored as files under *files_dir* (file name = url hash).
    Metadata (url_hash, url, file_path, size, fetched_at, last_access) is kept
    in SQLite.  An in-memory ``OrderedDict`` tracks LRU order for fast eviction
    decisions, holding only URL keys — never image bytes.

    Thread-safe: all public methods acquire ``self._lock``.
    """

    def __init__(
        self,
        db_path: str | None = None,
        max_size_mb: int = 500,
        files_dir: str | None = None,
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

        self._conn = open_sqlite_db(db_path)
        # Ensure the canonical table exists. On a legacy DB the table already
        # exists with a `data_uri` column and possibly without the new columns;
        # _migrate_legacy handles both cases below. Note: indexes are created
        # AFTER migration, because legacy tables lack the `last_access` column
        # that idx_cover_last_access depends on.
        self._conn.execute("""CREATE TABLE IF NOT EXISTS cover_cache (
                url_hash   TEXT PRIMARY KEY,
                url        TEXT NOT NULL,
                file_path  TEXT,
                size       INTEGER NOT NULL DEFAULT 0,
                fetched_at REAL NOT NULL,
                last_access REAL NOT NULL,
                data_uri   TEXT
            )""")

        # One-shot migration of legacy inline base64 storage, if present.
        self._migrate_legacy()

        # Indexes now safe to create — migration has normalized all schemas.
        self._conn.execute("CREATE INDEX IF NOT EXISTS idx_cover_last_access ON cover_cache(last_access)")
        self._conn.execute("CREATE INDEX IF NOT EXISTS idx_cover_url ON cover_cache(url)")
        self._conn.commit()

        # In-memory LRU index: url -> None, insertion order = LRU order
        self._lru: OrderedDict[str, None] = OrderedDict()
        rows = self._conn.execute("SELECT url FROM cover_cache ORDER BY last_access ASC").fetchall()
        for (url,) in rows:
            self._lru[url] = None

        logger.info(
            "Cover cache DB opened (%s), %d entries, max %d MB",
            db_path,
            len(self._lru),
            max_size_mb,
        )

    # ── legacy migration ────────────────────────────────────────────────

    def _migrate_legacy(self) -> None:
        """Upgrade legacy DBs that stored base64 data URIs inline.

        Idempotent and resumable:
        - Skips entirely on databases that never had a ``data_uri`` column.
        - On legacy DBs, adds a ``migrated`` flag column, decodes each row's
          ``data_uri`` to raw bytes on disk, sets ``file_path``/``last_access``
          and ``migrated = 1``.  A crash mid-migration leaves the remaining
          ``migrated = 0`` rows for the next launch to finish.
        - Once all rows are migrated, drops ``data_uri`` and ``migrated`` and
          VACUUMs (best-effort) to reclaim the freed space.
        """
        cols = {row[1] for row in self._conn.execute("PRAGMA table_info(cover_cache)").fetchall()}
        if "data_uri" not in cols:
            # Either a fresh DB or already fully migrated.
            return

        # Ensure the tracking columns exist (resumability across versions).
        if "migrated" not in cols:
            self._conn.execute("ALTER TABLE cover_cache ADD COLUMN migrated INTEGER NOT NULL DEFAULT 0")
        if "file_path" not in cols:
            self._conn.execute("ALTER TABLE cover_cache ADD COLUMN file_path TEXT")
        if "last_access" not in cols:
            self._conn.execute("ALTER TABLE cover_cache ADD COLUMN last_access REAL NOT NULL DEFAULT 0")

        pending = self._conn.execute(
            "SELECT COUNT(*) FROM cover_cache WHERE migrated = 0 AND data_uri IS NOT NULL"
        ).fetchone()[0]
        if pending == 0:
            # All rows already migrated on a prior run — finish the cleanup.
            self._finalize_legacy_migration()
            return

        logger.info("Cover cache: migrating %d legacy inline entries to file storage", pending)
        os.makedirs(self._files_dir, exist_ok=True)

        rows = self._conn.execute(
            "SELECT url_hash, url, data_uri, size, fetched_at FROM cover_cache WHERE migrated = 0 AND data_uri IS NOT NULL"
        ).fetchall()
        migrated_count = 0
        for url_hash, _url, data_uri, _size, fetched_at in rows:
            file_name = self._write_bytes_for(url_hash, data_uri)
            # size must reflect true decoded byte count (matches PreviewCacheDB
            # and get_stats semantics), never the legacy base64 string length.
            actual_size = len(self._decode_data_uri(data_uri))
            self._conn.execute(
                "UPDATE cover_cache SET file_path = ?, size = ?, last_access = ?, migrated = 1 WHERE url_hash = ?",
                (file_name, actual_size, fetched_at, url_hash),
            )
            migrated_count += 1
            if migrated_count % _MIGRATE_BATCH_SIZE == 0:
                self._conn.commit()
        self._conn.commit()
        logger.info("Cover cache: migrated %d entries to file storage", migrated_count)

        self._finalize_legacy_migration()

    def _finalize_legacy_migration(self) -> None:
        """Drop legacy columns and reclaim space once all rows are migrated."""
        # SQLite cannot DROP COLUMN before 3.35; use the rebuild-via-temp-table
        # approach which works on all supported versions.
        #
        # NOTE: do NOT issue a manual ``BEGIN`` here. Under Python's default
        # ``sqlite3`` isolation level any prior DML has already opened an
        # implicit transaction, so a second ``BEGIN`` raises
        # ``cannot start a transaction within a transaction``. The DDL/DML
        # below run inside that implicit transaction and are committed atomically
        # via ``commit()`` (or rolled back on error).
        try:
            self._conn.execute("""CREATE TABLE cover_cache_new (
                    url_hash   TEXT PRIMARY KEY,
                    url        TEXT NOT NULL,
                    file_path  TEXT,
                    size       INTEGER NOT NULL DEFAULT 0,
                    fetched_at REAL NOT NULL,
                    last_access REAL NOT NULL
                )""")
            self._conn.execute("""INSERT INTO cover_cache_new (url_hash, url, file_path, size, fetched_at, last_access)
                   SELECT url_hash, url, file_path, size, fetched_at, last_access FROM cover_cache""")
            self._conn.execute("DROP TABLE cover_cache")
            self._conn.execute("ALTER TABLE cover_cache_new RENAME TO cover_cache")
            self._conn.execute("CREATE INDEX IF NOT EXISTS idx_cover_last_access ON cover_cache(last_access)")
            self._conn.execute("CREATE INDEX IF NOT EXISTS idx_cover_url ON cover_cache(url)")
            self._conn.commit()
        except Exception:
            self._conn.rollback()
            raise

        # VACUUM must run outside a transaction; best-effort.
        try:
            self._conn.execute("VACUUM")
            logger.info("Cover cache: VACUUM succeeded after legacy migration")
        except Exception as e:  # noqa: BLE001 — disk-space / lock failures are non-fatal
            logger.warning("Cover cache: VACUUM failed after legacy migration: %s", e)

    def _decode_data_uri(self, data_uri: str) -> bytes:
        """Decode the base64 payload of a data URI to raw image bytes.

        ``data_uri`` looks like ``"data:image/jpeg;base64,/9j/..."``.
        """
        _, _, b64_part = data_uri.partition(",")
        return base64.b64decode(b64_part)

    def _write_bytes_for(self, url_hash: str, data_uri: str) -> str:
        """Decode a data URI and persist its raw bytes; return the file name."""
        raw = self._decode_data_uri(data_uri)
        file_path = os.path.join(self._files_dir, url_hash)
        with open(file_path, "wb") as f:
            f.write(raw)
        return url_hash

    # ── public API ──────────────────────────────────────────────────────

    @property
    def db_dir(self) -> str:
        """Absolute path of the directory holding the cover cache DB file.

        Normalized via ``os.path.abspath`` so callers always receive a
        canonical absolute path regardless of how ``db_path`` was constructed.
        Used by the settings UI to show users where cache files live.
        """
        return os.path.abspath(os.path.dirname(self._db_path))

    @property
    def files_dir(self) -> str:
        """Absolute path of the directory holding the raw image byte files.

        Used by the ``app-image://`` protocol handler (Electron main process)
        to locate cover image files by url_hash.
        """
        return os.path.abspath(self._files_dir)

    def get(self, url: str) -> str | None:
        """Return cached ``url_hash`` (the disk file name) or *None*.

        Performs only an existence check (``os.path.exists``); it does **not**
        read image bytes or base64-encode them. Deep validity probing of the
        bytes (magic bytes recognition) is no longer done here — the fetch path
        validates bytes via ``detect_image_type`` before ``put``, so on-disk
        files are trusted. If the backing file vanished externally the record is
        purged and ``None`` returned.
        """
        with self._lock:
            if url not in self._lru:
                return None
            row = self._conn.execute("SELECT file_path FROM cover_cache WHERE url = ?", (url,)).fetchone()
            if row is None:
                self._lru.pop(url, None)
                return None
            file_name = row[0]
            if not file_name:
                return None
            file_path = os.path.join(self._files_dir, file_name)
            if not os.path.exists(file_path):
                # File vanished externally — drop the stale record.
                self._purge_entry(url, file_path)
                return None
            now = _now()
            self._conn.execute("UPDATE cover_cache SET last_access = ? WHERE url = ?", (now, url))
            self._conn.commit()
            self._lru.move_to_end(url)
            # file_name is the url_hash (sha256(url).hexdigest()), also the
            # disk file name and the identifier downstream layers use to build
            # the app-image:// protocol URL.
            return file_name

    def put(self, url: str, raw_bytes: bytes) -> None:
        """Store raw image bytes in the file + SQLite cache.

        ``raw_bytes`` must be the original image bytes (no base64 wrapping).
        ``size`` records the raw byte count (matching PreviewCacheDB) so
        get_stats()/eviction reflect true disk usage.
        """
        with self._lock:
            url_hash = hashlib.sha256(url.encode()).hexdigest()
            file_name = url_hash

            file_path = os.path.join(self._files_dir, file_name)
            with open(file_path, "wb") as f:
                f.write(raw_bytes)
            size = len(raw_bytes)
            now = _now()

            self._conn.execute(
                """INSERT OR REPLACE INTO cover_cache
                   (url_hash, url, file_path, size, fetched_at, last_access)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (url_hash, url, file_name, size, now, now),
            )
            self._conn.commit()

            self._lru[url] = None
            self._lru.move_to_end(url)

            self._evict_if_needed()

    def get_stats(self) -> dict:
        """Return ``{file_count, total_size_bytes}`` for this cache."""
        with self._lock:
            row = self._conn.execute("SELECT COUNT(*), COALESCE(SUM(size), 0) FROM cover_cache").fetchone()
            return {
                "file_count": row[0],
                "total_size_bytes": row[1],
            }

    def clear_all(self) -> None:
        """Delete all cached cover entries from disk and memory."""
        with self._lock:
            rows = self._conn.execute("SELECT file_path FROM cover_cache").fetchall()
            for (file_name,) in rows:
                if not file_name:
                    continue
                file_path = os.path.join(self._files_dir, file_name)
                try:
                    if os.path.exists(file_path):
                        os.remove(file_path)
                except OSError as e:
                    logger.debug("Failed to delete cover cache file %s: %s", file_path, e)
            self._conn.execute("DELETE FROM cover_cache")
            self._conn.commit()
            self._lru.clear()
            logger.info("Cover cache cleared")

    def update_max_size(self, max_size_mb: int) -> None:
        """Update byte limit and evict to comply."""
        self._max_size_bytes = max_size_mb * 1024 * 1024
        with self._lock:
            self._evict_if_needed()
            self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    # ── private helpers ─────────────────────────────────────────────────

    def _purge_entry(self, url: str, file_path: str) -> None:
        """Remove a single entry's file, SQLite row, and LRU index entry.

        Used when a backing file vanished externally or holds unrecognizable
        bytes. File deletion is best-effort (logged at debug on failure); the
        SQLite record and LRU entry are always removed.
        """
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except OSError as e:
            logger.debug("Failed to delete cover cache file %s: %s", file_path, e)
        self._conn.execute("DELETE FROM cover_cache WHERE url = ?", (url,))
        self._conn.commit()
        self._lru.pop(url, None)

    def _evict_if_needed(self) -> None:
        """Evict LRU entries until total size is within ``_max_size_bytes``."""
        row = self._conn.execute("SELECT COALESCE(SUM(size), 0) FROM cover_cache").fetchone()
        total = row[0]
        while total > self._max_size_bytes and self._lru:
            oldest_url = next(iter(self._lru))
            row = self._conn.execute("SELECT file_path, size FROM cover_cache WHERE url = ?", (oldest_url,)).fetchone()
            if row is None:
                self._lru.pop(oldest_url, None)
                continue
            file_name, size = row
            if file_name:
                file_path = os.path.join(self._files_dir, file_name)
                try:
                    if os.path.exists(file_path):
                        os.remove(file_path)
                except OSError as e:
                    logger.debug("Failed to evict cover cache file %s: %s", file_path, e)
            self._conn.execute("DELETE FROM cover_cache WHERE url = ?", (oldest_url,))
            self._conn.commit()
            self._lru.pop(oldest_url, None)
            total -= size
