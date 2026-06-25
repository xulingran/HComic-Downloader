"""Reading history mixin for IPCServer."""

from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass
from datetime import datetime, timezone

from utils import normalize_comic_source_key, normalize_source_key, open_sqlite_db

logger = logging.getLogger(__name__)

_HISTORY_PAGE_SIZE = 20
_ALLOWED_COLUMNS = frozenset({"source_site", "media_id", "last_chapter_id", "last_chapter_name"})


@dataclass
class ReadingHistoryEntry:
    comic_id: str
    title: str
    cover_url: str = ""
    source: str = ""
    source_site: str = ""
    media_id: str = ""
    source_url: str = ""
    last_page: int = 0
    total_pages: int = 0
    last_chapter_id: str = ""
    last_chapter_name: str = ""


class HistoryMixin:
    """Mixin providing reading history handler methods."""

    _reading_history_db: ReadingHistoryDB

    def _init_reading_history(self) -> None:
        db_path = os.path.join(os.path.expanduser("~"), ".hcomic_downloader", "reading_history.db")
        self._reading_history_db = ReadingHistoryDB(db_path)

    def handle_get_history(self, page: int = 1) -> dict:
        effective_page = max(1, page)
        items, total = self._reading_history_db.get_history(page=effective_page, page_size=_HISTORY_PAGE_SIZE)
        total_pages = max(1, (total + _HISTORY_PAGE_SIZE - 1) // _HISTORY_PAGE_SIZE)
        return {
            "items": items,
            "pagination": {
                "currentPage": effective_page,
                "totalPages": total_pages,
                "totalItems": total,
            },
        }

    def handle_add_history(self, **params) -> dict:
        entry = ReadingHistoryEntry(**params)
        self._reading_history_db.upsert(entry)
        return {"success": True}

    def handle_delete_history(self, comic_id: str, source: str) -> dict:
        self._reading_history_db.delete(comic_id=comic_id, source=source)
        return {"success": True}

    def handle_clear_history(self) -> dict:
        self._reading_history_db.clear()
        return {"success": True}


class ReadingHistoryDB:
    """SQLite-backed reading history storage."""

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._lock = threading.Lock()
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._conn = open_sqlite_db(db_path, row_factory=True)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS reading_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                comic_id TEXT NOT NULL,
                title TEXT NOT NULL,
                cover_url TEXT,
                source TEXT NOT NULL,
                source_site TEXT DEFAULT '',
                media_id TEXT DEFAULT '',
                source_url TEXT,
                last_page INTEGER DEFAULT 0,
                total_pages INTEGER DEFAULT 0,
                last_read_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(comic_id, source)
            )
        """)
        # Migrate: add columns if they don't exist (for existing databases)
        existing_cols = {row[1] for row in self._conn.execute("PRAGMA table_info(reading_history)")}
        for col in ("source_site", "media_id", "last_chapter_id", "last_chapter_name"):
            if col not in existing_cols:
                if col not in _ALLOWED_COLUMNS:
                    raise ValueError(f"Unknown migration column: {col}")
                self._conn.execute(f"ALTER TABLE reading_history ADD COLUMN {col} TEXT DEFAULT ''")
        self._conn.commit()
        self._migrate_source_ids()

    def _migrate_source_ids(self) -> None:
        """迁移旧阅读历史来源标识 jmcomic/JMCOMIC 到 jm/JM。"""
        with self._lock:
            rows = self._conn.execute("""
                SELECT id, comic_id, title, cover_url, source, source_site, media_id, source_url,
                       last_page, total_pages, last_chapter_id, last_chapter_name, last_read_at, created_at
                FROM reading_history
                WHERE source = 'JMCOMIC' OR source_site = 'jmcomic'
                """).fetchall()
            if not rows:
                return
            canonical_keys = {(row["comic_id"], normalize_comic_source_key(row["source"])) for row in rows}
            placeholders = ",".join(["(?, ?)"] * len(canonical_keys))
            flat_keys: list[str] = []
            for key in canonical_keys:
                flat_keys.extend(key)
            all_rows = self._conn.execute(
                """
                SELECT id, comic_id, title, cover_url, source, source_site, media_id, source_url,
                       last_page, total_pages, last_chapter_id, last_chapter_name, last_read_at, created_at
                FROM reading_history
                """ f"WHERE (comic_id, source) IN ({placeholders}) OR source = 'JMCOMIC' OR source_site = 'jmcomic'",
                flat_keys,
            ).fetchall()

            merged: dict[tuple[str, str], dict] = {}
            ids_to_delete: set[int] = set()
            for row in all_rows:
                canonical_key = (row["comic_id"], normalize_comic_source_key(row["source"]))
                ids_to_delete.add(int(row["id"]))
                item = dict(row)
                item["source"] = canonical_key[1]
                item["source_site"] = normalize_source_key(row["source_site"] or "")
                current = merged.get(canonical_key)
                if current is None:
                    merged[canonical_key] = item
                    continue
                if str(item["last_read_at"] or "") >= str(current["last_read_at"] or ""):
                    preferred = item
                    older = current
                else:
                    preferred = current
                    older = item
                preferred["created_at"] = min(str(preferred["created_at"] or ""), str(older["created_at"] or ""))
                merged[canonical_key] = preferred

            self._conn.execute("BEGIN IMMEDIATE")
            try:
                for row_id in ids_to_delete:
                    self._conn.execute("DELETE FROM reading_history WHERE id = ?", (row_id,))
                for item in merged.values():
                    self._conn.execute(
                        """
                        INSERT INTO reading_history
                            (comic_id, title, cover_url, source, source_site, media_id, source_url,
                             last_page, total_pages, last_chapter_id, last_chapter_name, last_read_at, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            item["comic_id"],
                            item["title"] or "",
                            item["cover_url"] or "",
                            item["source"],
                            item["source_site"] or "",
                            item["media_id"] or "",
                            item["source_url"] or "",
                            item["last_page"] or 0,
                            item["total_pages"] or 0,
                            item["last_chapter_id"] or "",
                            item["last_chapter_name"] or "",
                            item["last_read_at"],
                            item["created_at"],
                        ),
                    )
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise

    def upsert(self, entry: ReadingHistoryEntry) -> None:
        now = datetime.now(timezone.utc).isoformat()  # noqa: UP017
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO reading_history (comic_id, title, cover_url, source, source_site, media_id, source_url, last_page, total_pages, last_chapter_id, last_chapter_name, last_read_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(comic_id, source) DO UPDATE SET
                    title = excluded.title,
                    cover_url = excluded.cover_url,
                    source_site = excluded.source_site,
                    media_id = excluded.media_id,
                    source_url = excluded.source_url,
                    last_page = excluded.last_page,
                    total_pages = excluded.total_pages,
                    last_chapter_id = excluded.last_chapter_id,
                    last_chapter_name = excluded.last_chapter_name,
                    last_read_at = excluded.last_read_at
                """,
                (
                    entry.comic_id,
                    entry.title,
                    entry.cover_url,
                    entry.source,
                    entry.source_site,
                    entry.media_id,
                    entry.source_url,
                    entry.last_page,
                    entry.total_pages,
                    entry.last_chapter_id,
                    entry.last_chapter_name,
                    now,
                    now,
                ),
            )
            self._conn.commit()

    def get_history(self, page: int = 1, page_size: int = 20) -> tuple[list[dict], int]:
        offset = (page - 1) * page_size
        with self._lock:
            total = self._conn.execute("SELECT COUNT(*) FROM reading_history").fetchone()[0]
            rows = self._conn.execute(
                """
                SELECT id, comic_id, title, cover_url, source, source_site, media_id, source_url,
                       last_page, total_pages, last_chapter_id, last_chapter_name, last_read_at, created_at
                FROM reading_history
                ORDER BY last_read_at DESC
                LIMIT ? OFFSET ?
                """,
                (page_size, offset),
            ).fetchall()
        items = []
        for row in rows:
            items.append(
                {
                    "id": row["id"],
                    "comicId": row["comic_id"],
                    "title": row["title"],
                    "coverUrl": row["cover_url"] or "",
                    "source": row["source"],
                    "sourceSite": row["source_site"] or "",
                    "mediaId": row["media_id"] or "",
                    "sourceUrl": row["source_url"] or "",
                    "lastPage": row["last_page"],
                    "totalPages": row["total_pages"],
                    "lastChapterId": row["last_chapter_id"] or "",
                    "lastChapterName": row["last_chapter_name"] or "",
                    "lastReadAt": row["last_read_at"],
                    "createdAt": row["created_at"],
                }
            )
        return items, total

    def delete(self, comic_id: str, source: str) -> None:
        with self._lock:
            self._conn.execute(
                "DELETE FROM reading_history WHERE comic_id = ? AND source = ?",
                (comic_id, source),
            )
            self._conn.commit()

    def clear(self) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM reading_history")
            self._conn.commit()
