"""Tag list mixin for IPCServer — maintains a searchable tag catalog per source."""

from __future__ import annotations

import logging
import os
import random
import sqlite3
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)

_TAG_LIST_SOURCES = ("hcomic",)


class TagListDB:
    """SQLite-backed tag catalog collected incrementally from search results."""

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
            CREATE TABLE IF NOT EXISTS tag_list (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tag TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'hcomic',
                count INTEGER NOT NULL DEFAULT 1,
                UNIQUE(tag, source)
            )
        """)
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tag_list_source ON tag_list(source)"
        )
        self._conn.commit()

    def upsert_tags(self, tags: list[str], source: str) -> None:
        """Incrementally upsert tags from a search result page.

        Each unique tag is inserted if new, or has its count incremented if existing.
        """
        with self._lock:
            for tag in tags:
                if not tag:
                    continue
                self._conn.execute(
                    """INSERT INTO tag_list (tag, source, count) VALUES (?, ?, 1)
                       ON CONFLICT(tag, source) DO UPDATE SET count = count + 1""",
                    (tag, source),
                )
            self._conn.commit()

    def get_tags(
        self,
        source: str,
        keyword: str = "",
        page: int = 1,
        limit: int = 200,
    ) -> tuple[list[dict[str, Any]], int]:
        """Return paginated tags for a source, optionally filtered by keyword.

        Returns:
            (tags_list, total_count) where tags_list is a list of {tag, count}.
        """
        offset = (page - 1) * limit
        with self._lock:
            if keyword:
                escaped = keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                like_pattern = f"%{escaped}%"
                total_row = self._conn.execute(
                    "SELECT COUNT(*) AS cnt FROM tag_list WHERE source = ? AND tag LIKE ? ESCAPE '\\'",
                    (source, like_pattern),
                ).fetchone()
                total = total_row["cnt"] if total_row else 0
                rows = self._conn.execute(
                    """SELECT tag, count FROM tag_list
                       WHERE source = ? AND tag LIKE ? ESCAPE '\\'
                       ORDER BY count DESC, tag ASC
                       LIMIT ? OFFSET ?""",
                    (source, like_pattern, limit, offset),
                ).fetchall()
            else:
                total_row = self._conn.execute(
                    "SELECT COUNT(*) AS cnt FROM tag_list WHERE source = ?",
                    (source,),
                ).fetchone()
                total = total_row["cnt"] if total_row else 0
                rows = self._conn.execute(
                    """SELECT tag, count FROM tag_list
                       WHERE source = ?
                       ORDER BY count DESC, tag ASC
                       LIMIT ? OFFSET ?""",
                    (source, limit, offset),
                ).fetchall()
            return [{"tag": r["tag"], "count": r["count"]} for r in rows], total

    def get_tag_count(self, source: str) -> int:
        """Return total number of tags for a source."""
        with self._lock:
            row = self._conn.execute(
                "SELECT COUNT(*) AS cnt FROM tag_list WHERE source = ?",
                (source,),
            ).fetchone()
            return row["cnt"] if row else 0

    def clear(self, source: str) -> None:
        """Clear all tags for a source."""
        with self._lock:
            self._conn.execute("DELETE FROM tag_list WHERE source = ?", (source,))
            self._conn.commit()


class TagListMixin:
    """Mixin providing tag list IPC handlers."""

    _tag_list_db: TagListDB
    _favourite_tags_db: Any
    parser: Any
    _write_response: Any
    _cover_executor: Any
    _refresh_lock: threading.Lock

    def _init_tag_list(self) -> None:
        db_path = os.path.join(os.path.expanduser("~"), ".hcomic_downloader", "tag_list.db")
        self._tag_list_db = TagListDB(db_path)
        self._refresh_lock = threading.Lock()
        self._seed_tag_list_from_favourites()

    def _seed_tag_list_from_favourites(self) -> None:
        """Seed the tag list from favourite tags DB if the tag list is empty."""
        try:
            for source in _TAG_LIST_SOURCES:
                existing_count = self._tag_list_db.get_tag_count(source)
                if existing_count > 0:
                    continue
                fav_tags = self._favourite_tags_db.get_tags(source)
                if fav_tags:
                    tags_list = [t["tag"] for t in fav_tags if t.get("tag")]
                    if tags_list:
                        self._tag_list_db.upsert_tags(tags_list, source)
                        logger.info(
                            "Seeded tag_list from favourite_tags for source=%s: %d tags",
                            source, len(tags_list),
                        )
        except Exception as e:
            logger.debug("Failed to seed tag list from favourites: %s", e)

    def handle_get_tag_list(
        self,
        source: str = "hcomic",
        keyword: str = "",
        page: int = 1,
        limit: int = 200,
    ) -> dict:
        """Return paginated tag list for the given source."""
        effective_source = source if source in _TAG_LIST_SOURCES else "hcomic"
        if page < 1:
            page = 1
        if limit < 1 or limit > 500:
            limit = 200
        tags, total = self._tag_list_db.get_tags(
            effective_source, keyword=keyword, page=page, limit=limit,
        )
        return {"tags": tags, "total": total}

    def handle_refresh_tag_list(self, source: str = "hcomic") -> dict:
        """Full sync: iterate search results to collect all tags.

        This is a long-running operation dispatched to the thread pool.
        Data is collected in memory first; the DB is only replaced after all
        pages have been fetched, preventing data loss on network failures.
        """
        effective_source = source if source in _TAG_LIST_SOURCES else "hcomic"

        # Prevent concurrent refreshes for the same source
        if not self._refresh_lock.acquire(blocking=False):
            return {"error": "refresh already in progress"}

        try:
            return self._do_refresh_tag_list(effective_source)
        finally:
            self._refresh_lock.release()

    def _do_refresh_tag_list(self, effective_source: str) -> dict:
        """Collect tags in memory, then atomically replace DB contents."""
        # Collect all tags in memory first — never clear before we have data
        collected: dict[str, int] = {}
        total_comics = 0
        total_pages_done = 0

        # Fetch page 1 to get pagination info
        try:
            comics, pagination = self.parser.search(
                "", page=1, source=effective_source, tag="",
            )
        except Exception as e:
            logger.error("refresh_tag_list page 1 failed: %s", e, exc_info=True)
            raise

        self._accumulate_tags(comics, collected)
        total_comics += len(comics)
        total_pages_done += 1

        max_pages = pagination.total_pages if pagination else 1
        # Cap at 100 pages to avoid infinite loops
        max_pages = min(max_pages, 100)

        for page in range(2, max_pages + 1):
            # Polite delay to avoid hammering the server
            time.sleep(random.uniform(0.3, 0.8))
            try:
                comics, _pagination = self.parser.search(
                    "", page=page, source=effective_source, tag="",
                )
                self._accumulate_tags(comics, collected)
                total_comics += len(comics)
                total_pages_done += 1
            except Exception as e:
                logger.warning("refresh_tag_list page %d failed: %s", page, e)

        # All data collected — now atomically replace DB contents
        self._tag_list_db.clear(effective_source)
        for tag, count in collected.items():
            self._tag_list_db.upsert_tags([tag] * count, effective_source)

        total_tags = self._tag_list_db.get_tag_count(effective_source)
        logger.info(
            "refresh_tag_list done: source=%s pages=%d comics=%d tags=%d",
            effective_source, total_pages_done, total_comics, total_tags,
        )
        return {
            "totalTags": total_tags,
            "totalComics": total_comics,
            "totalPages": total_pages_done,
        }

    @staticmethod
    def _accumulate_tags(comics: list, target: dict[str, int]) -> None:
        """Extract tags from comics and accumulate counts in *target* dict."""
        for comic in comics:
            for tag in getattr(comic, "tags", None) or []:
                if tag:
                    target[tag] = target.get(tag, 0) + 1

    def _collect_tags_from_comics(self, comics: list, source: str) -> None:
        """Extract tags from a list of ComicInfo objects and store in tag_list DB."""
        all_tags: list[str] = []
        for comic in comics:
            tags = getattr(comic, "tags", None) or []
            all_tags.extend(tags)
        if all_tags:
            self._tag_list_db.upsert_tags(all_tags, source)
