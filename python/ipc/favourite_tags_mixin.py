"""Favourite tag index mixin for IPCServer."""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
from typing import Any

logger = logging.getLogger(__name__)


class FavouriteTagsDB:
    """SQLite-backed favourite tag frequency index."""

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._lock = threading.Lock()
        parent = os.path.dirname(db_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
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
        with self._lock:
            self._upsert_comic_unlocked(comic_id, source, tags)

    def _upsert_comic_unlocked(
        self, comic_id: str, source: str, tags: list[str]
    ) -> None:
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
        with self._lock:
            self._remove_comic_unlocked(comic_id, source)

    def _remove_comic_unlocked(self, comic_id: str, source: str) -> None:
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
            self._conn.execute(
                "DELETE FROM favourite_tag_index WHERE tag = ? AND source = ? AND count <= 0",
                (tag, source),
            )
        self._conn.execute(
            "DELETE FROM favourite_tag_comics WHERE comic_id = ? AND source = ?",
            (comic_id, source),
        )
        self._conn.commit()

    def remove_tag(self, tag: str, source: str) -> None:
        """Remove a specific tag from the index entirely."""
        with self._lock:
            self._conn.execute(
                "DELETE FROM favourite_tag_index WHERE tag = ? AND source = ?",
                (tag, source),
            )
            self._conn.commit()

    def get_tags(self, source: str) -> list[dict[str, Any]]:
        """Return all tags for a source sorted by count descending."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT tag, count FROM favourite_tag_index WHERE source = ? ORDER BY count DESC, tag ASC",
                (source,),
            ).fetchall()
            return [{"tag": r["tag"], "count": r["count"]} for r in rows]

    def clear(self, source: str) -> None:
        """Clear all tag data for a source."""
        with self._lock:
            self._conn.execute(
                "DELETE FROM favourite_tag_index WHERE source = ?", (source,)
            )
            self._conn.execute(
                "DELETE FROM favourite_tag_comics WHERE source = ?", (source,)
            )
            self._conn.commit()

    def get_comic_tags(self, comic_id: str, source: str) -> list[str]:
        """Get stored tags for a specific comic."""
        with self._lock:
            row = self._conn.execute(
                "SELECT tags FROM favourite_tag_comics WHERE comic_id = ? AND source = ?",
                (comic_id, source),
            ).fetchone()
            return json.loads(row["tags"]) if row else []


class FavouriteTagsMixin:
    """Mixin providing favourite tag recommendation IPC handlers."""

    _favourite_tags_db: FavouriteTagsDB
    parser: Any
    _write_response: Any

    MAX_SYNC_PAGES = 200

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
        while page <= self.MAX_SYNC_PAGES:
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
        if page > self.MAX_SYNC_PAGES:
            logger.warning(
                "sync_favourite_tags hit MAX_SYNC_PAGES=%d limit for source=%s",
                self.MAX_SYNC_PAGES,
                effective_source,
            )
        return {"synced": synced}

    def handle_remove_favourite_tag(self, tag: str, source: str = "hcomic") -> dict:
        effective_source = source if source in ("hcomic", "jmcomic") else "hcomic"
        self._favourite_tags_db.remove_tag(tag, effective_source)
        return {"success": True}
