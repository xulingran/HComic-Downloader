"""Reading history mixin for IPCServer."""

from __future__ import annotations

import logging
import os
import sqlite3
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

_HISTORY_PAGE_SIZE = 20


class HistoryMixin:
    """Mixin providing reading history handler methods."""

    _reading_history_db: ReadingHistoryDB

    def _init_reading_history(self) -> None:
        db_path = os.path.join(
            os.path.expanduser("~"), ".hcomic_downloader", "reading_history.db"
        )
        self._reading_history_db = ReadingHistoryDB(db_path)

    def handle_get_history(self, page: int = 1) -> dict:
        effective_page = max(1, page)
        items, total = self._reading_history_db.get_history(
            page=effective_page, page_size=_HISTORY_PAGE_SIZE
        )
        total_pages = max(1, (total + _HISTORY_PAGE_SIZE - 1) // _HISTORY_PAGE_SIZE)
        return {
            "items": items,
            "pagination": {
                "currentPage": effective_page,
                "totalPages": total_pages,
                "totalItems": total,
            },
        }

    def handle_add_history(
        self,
        comic_id: str,
        title: str,
        cover_url: str = "",
        source: str = "",
        source_site: str = "",
        media_id: str = "",
        source_url: str = "",
        last_page: int = 0,
        total_pages: int = 0,
    ) -> dict:
        self._reading_history_db.upsert(
            comic_id=comic_id,
            title=title,
            cover_url=cover_url,
            source=source,
            source_site=source_site,
            media_id=media_id,
            source_url=source_url,
            last_page=last_page,
            total_pages=total_pages,
        )
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
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
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
        self._conn.commit()

    def upsert(
        self,
        comic_id: str,
        title: str,
        cover_url: str,
        source: str,
        source_site: str,
        media_id: str,
        source_url: str,
        last_page: int,
        total_pages: int,
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()  # noqa: UP017
        self._conn.execute(
            """
            INSERT INTO reading_history (comic_id, title, cover_url, source, source_site, media_id, source_url, last_page, total_pages, last_read_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(comic_id, source) DO UPDATE SET
                title = excluded.title,
                cover_url = excluded.cover_url,
                source_site = excluded.source_site,
                media_id = excluded.media_id,
                source_url = excluded.source_url,
                last_page = excluded.last_page,
                total_pages = excluded.total_pages,
                last_read_at = excluded.last_read_at
            """,
            (comic_id, title, cover_url, source, source_site, media_id, source_url, last_page, total_pages, now, now),
        )
        self._conn.commit()

    def get_history(self, page: int = 1, page_size: int = 20) -> tuple[list[dict], int]:
        offset = (page - 1) * page_size
        total = self._conn.execute("SELECT COUNT(*) FROM reading_history").fetchone()[0]
        rows = self._conn.execute(
            """
            SELECT id, comic_id, title, cover_url, source, source_site, media_id, source_url,
                   last_page, total_pages, last_read_at, created_at
            FROM reading_history
            ORDER BY last_read_at DESC
            LIMIT ? OFFSET ?
            """,
            (page_size, offset),
        ).fetchall()
        items = []
        for row in rows:
            items.append({
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
                "lastReadAt": row["last_read_at"],
                "createdAt": row["created_at"],
            })
        return items, total

    def delete(self, comic_id: str, source: str) -> None:
        self._conn.execute(
            "DELETE FROM reading_history WHERE comic_id = ? AND source = ?",
            (comic_id, source),
        )
        self._conn.commit()

    def clear(self) -> None:
        self._conn.execute("DELETE FROM reading_history")
        self._conn.commit()
