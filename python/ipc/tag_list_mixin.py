"""Tag list mixin for IPCServer — maintains a searchable tag catalog per source."""

from __future__ import annotations

import logging
import os
import random
import threading
import time
from typing import Any

from utils import normalize_source_key, open_sqlite_db

logger = logging.getLogger(__name__)

_TAG_LIST_SOURCES = ("hcomic", "moeimg", "bika", "nh")
# NH tags API anonymous limit is 15 requests / minute per IP.
# Keep a conservative interval so a full ~39-page sync does not hit 429.
_NH_TAG_LIST_REQUEST_INTERVAL_SECONDS = 4.2


class TagListDB:
    """SQLite-backed tag catalog collected incrementally from search results."""

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._lock = threading.Lock()
        parent = os.path.dirname(db_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        self._conn = open_sqlite_db(db_path, row_factory=True)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS tag_list (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tag TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'hcomic',
                count INTEGER NOT NULL DEFAULT 1,
                UNIQUE(tag, source)
            )
        """)
        self._conn.execute("CREATE INDEX IF NOT EXISTS idx_tag_list_source ON tag_list(source)")
        self._conn.commit()
        self._migrate_source_ids()

    def _migrate_source_ids(self) -> None:
        """迁移旧标签目录来源标识 jmcomic 到 jm。"""
        with self._lock:
            rows = self._conn.execute(
                "SELECT tag, source, count FROM tag_list WHERE source IN ('jmcomic', 'jm')"
            ).fetchall()
            if not any(row["source"] == "jmcomic" for row in rows):
                return
            counts: dict[str, int] = {}
            for row in rows:
                source = normalize_source_key(row["source"])
                if source != "jm":
                    continue
                tag = str(row["tag"] or "")
                if not tag:
                    continue
                counts[tag] = counts.get(tag, 0) + int(row["count"] or 0)
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                self._conn.execute("DELETE FROM tag_list WHERE source IN ('jmcomic', 'jm')")
                for tag, count in counts.items():
                    self._conn.execute(
                        "INSERT INTO tag_list (tag, source, count) VALUES (?, ?, ?)",
                        (tag, "jm", count),
                    )
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise

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

    def replace_tags(self, tags: dict[str, int], source: str) -> None:
        """Atomically replace all tags for *source* with explicit counts."""
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                self._conn.execute("DELETE FROM tag_list WHERE source = ?", (source,))
                for tag, count in tags.items():
                    if not tag:
                        continue
                    self._conn.execute(
                        "INSERT INTO tag_list (tag, source, count) VALUES (?, ?, ?)",
                        (tag, source, max(0, int(count or 0))),
                    )
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise

    def get_tags(
        self,
        source: str,
        keyword: str = "",
        page: int = 1,
        limit: int = 200,
        sort: str = "popular",
    ) -> tuple[list[dict[str, Any]], int]:
        """Return paginated tags for a source, optionally filtered by keyword.

        Returns:
            (tags_list, total_count) where tags_list is a list of {tag, count}.
        """
        offset = (page - 1) * limit
        order_by = "tag ASC" if sort == "name" else "count DESC, tag ASC"
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
                    f"""SELECT tag, count FROM tag_list
                       WHERE source = ? AND tag LIKE ? ESCAPE '\\'
                       ORDER BY {order_by}
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
                    f"""SELECT tag, count FROM tag_list
                       WHERE source = ?
                       ORDER BY {order_by}
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
    _refresh_locks: dict[str, threading.Lock]

    def _init_tag_list(self) -> None:
        db_path = os.path.join(os.path.expanduser("~"), ".hcomic_downloader", "tag_list.db")
        self._tag_list_db = TagListDB(db_path)
        self._refresh_locks = {s: threading.Lock() for s in _TAG_LIST_SOURCES}
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
                            source,
                            len(tags_list),
                        )
        except Exception as e:
            logger.debug("Failed to seed tag list from favourites: %s", e)

    def handle_get_tag_list(
        self,
        source: str = "hcomic",
        keyword: str = "",
        page: int = 1,
        limit: int = 200,
        sort: str = "popular",
    ) -> dict:
        """Return paginated tag list for the given source."""
        effective_source = source if source in _TAG_LIST_SOURCES else "hcomic"
        if page < 1:
            page = 1
        if limit < 1 or limit > 500:
            limit = 200
        sort_value = sort if sort in ("popular", "name") else "popular"
        tags, total = self._tag_list_db.get_tags(
            effective_source,
            keyword=keyword,
            page=page,
            limit=limit,
            sort=sort_value,
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
        lock = self._refresh_locks[effective_source]
        if not lock.acquire(blocking=False):
            return {"error": "refresh already in progress"}

        try:
            return (
                self._do_refresh_nh_tag_list()
                if effective_source == "nh"
                else self._do_refresh_tag_list(effective_source)
            )
        finally:
            lock.release()

    def _emit_tag_list_progress(
        self,
        source: str,
        current_page: int,
        total_pages: int,
        total_tags: int,
        status: str = "running",
        message: str = "",
    ) -> None:
        notification = {
            "jsonrpc": "2.0",
            "method": "tag_list_progress",
            "params": {
                "source": source,
                "currentPage": current_page,
                "totalPages": total_pages,
                "totalTags": total_tags,
                "status": status,
            },
        }
        if message:
            notification["params"]["message"] = message
        self._write_response(notification)

    def _do_refresh_tag_list(self, effective_source: str) -> dict:
        """Collect tags in memory, then atomically replace DB contents."""
        # Collect all tags in memory first — never clear before we have data
        collected: dict[str, int] = {}
        total_comics = 0
        total_pages_done = 0

        # Fetch page 1 to get pagination info
        try:
            comics, pagination = self.parser.search(
                "",
                page=1,
                source=effective_source,
                tag="",
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
                    "",
                    page=page,
                    source=effective_source,
                    tag="",
                )
                self._accumulate_tags(comics, collected)
                total_comics += len(comics)
                total_pages_done += 1
            except Exception as e:
                logger.warning("refresh_tag_list page %d failed: %s", page, e)

        # All data collected — now atomically replace DB contents
        self._tag_list_db.replace_tags(collected, effective_source)

        total_tags = self._tag_list_db.get_tag_count(effective_source)
        logger.info(
            "refresh_tag_list done: source=%s pages=%d comics=%d tags=%d",
            effective_source,
            total_pages_done,
            total_comics,
            total_tags,
        )
        return {
            "totalTags": total_tags,
            "totalComics": total_comics,
            "totalPages": total_pages_done,
        }

    def _do_refresh_nh_tag_list(self) -> dict:
        """Sync NH tags from its original tag directory pages."""
        parser = self.parser.parsers.get("nh")
        if parser is None:
            raise ValueError("nh source unavailable")

        collected: dict[str, int] = {}
        total_pages_done = 0

        try:
            tags, pagination = parser.get_tag_list(page=1, sort="popular")
        except Exception as e:
            logger.error("refresh nh tag_list page 1 failed: %s", e, exc_info=True)
            raise

        for item in tags:
            tag = str(item.get("tag") or "").strip()
            if tag:
                collected[tag] = int(item.get("count") or 0)
        total_pages_done = 1
        max_pages = pagination.total_pages if pagination else 1
        max_pages = min(max_pages, 100)
        self._emit_tag_list_progress("nh", total_pages_done, max_pages, len(collected), "running")

        for page in range(2, max_pages + 1):
            time.sleep(_NH_TAG_LIST_REQUEST_INTERVAL_SECONDS)
            try:
                page_tags, _pagination = parser.get_tag_list(page=page, sort="popular")
                for item in page_tags:
                    tag = str(item.get("tag") or "").strip()
                    if tag:
                        collected[tag] = int(item.get("count") or 0)
                total_pages_done += 1
                self._emit_tag_list_progress("nh", total_pages_done, max_pages, len(collected), "running")
            except Exception as e:
                logger.warning("refresh nh tag_list page %d failed: %s", page, e)
                self._emit_tag_list_progress("nh", page, max_pages, len(collected), "error", str(e))

        if not collected:
            raise RuntimeError("nh tag list refresh returned no tags")

        self._tag_list_db.replace_tags(collected, "nh")
        total_tags = self._tag_list_db.get_tag_count("nh")
        self._emit_tag_list_progress("nh", total_pages_done, max_pages, total_tags, "completed")
        logger.info(
            "refresh nh tag_list done: pages=%d tags=%d",
            total_pages_done,
            total_tags,
        )
        return {
            "totalTags": total_tags,
            "totalComics": 0,
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
