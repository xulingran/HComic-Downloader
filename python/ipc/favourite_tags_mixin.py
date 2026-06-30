"""Favourite tag index mixin for IPCServer."""

from __future__ import annotations

import json
import logging
import os
import threading
from typing import Any

from utils import normalize_source_key, open_sqlite_db

logger = logging.getLogger(__name__)

_TAG_RECOMMENDATION_SOURCES = ("hcomic", "jm", "bika", "moeimg")


class FavouriteTagsDB:
    """SQLite-backed favourite tag frequency index."""

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._lock = threading.Lock()
        parent = os.path.dirname(db_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        self._conn = open_sqlite_db(db_path, row_factory=True)
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
        self._migrate_source_ids()

    def _migrate_source_ids(self) -> None:
        """迁移旧推荐标签来源标识 jmcomic 到 jm。"""
        with self._lock:
            has_legacy = self._conn.execute("""
                SELECT 1 FROM favourite_tag_comics WHERE source = 'jmcomic'
                UNION ALL
                SELECT 1 FROM favourite_tag_index WHERE source = 'jmcomic'
                LIMIT 1
                """).fetchone()
            if not has_legacy:
                return

            comic_rows = self._conn.execute(
                "SELECT comic_id, source, tags FROM favourite_tag_comics WHERE source IN ('jmcomic', 'jm')"
            ).fetchall()
            index_rows = self._conn.execute(
                "SELECT tag, source, count FROM favourite_tag_index WHERE source IN ('jmcomic', 'jm')"
            ).fetchall()

            comics: dict[str, set[str]] = {}
            for row in comic_rows:
                comic_id = row["comic_id"]
                source = normalize_source_key(row["source"])
                if source != "jm":
                    continue
                try:
                    tags = set(json.loads(row["tags"]))
                except (TypeError, ValueError):
                    tags = set()
                comics.setdefault(comic_id, set()).update(str(tag) for tag in tags)

            tag_counts: dict[str, int] = {}
            for row in index_rows:
                source = normalize_source_key(row["source"])
                if source != "jm":
                    continue
                tag = str(row["tag"] or "")
                if not tag:
                    continue
                tag_counts[tag] = tag_counts.get(tag, 0) + int(row["count"] or 0)

            self._conn.execute("BEGIN IMMEDIATE")
            try:
                self._conn.execute("DELETE FROM favourite_tag_comics WHERE source IN ('jmcomic', 'jm')")
                self._conn.execute("DELETE FROM favourite_tag_index WHERE source IN ('jmcomic', 'jm')")
                for comic_id, tags in comics.items():
                    self._conn.execute(
                        "INSERT INTO favourite_tag_comics (comic_id, source, tags) VALUES (?, ?, ?)",
                        (comic_id, "jm", json.dumps(sorted(tags))),
                    )
                for tag, count in tag_counts.items():
                    if count <= 0:
                        continue
                    self._conn.execute(
                        "INSERT INTO favourite_tag_index (tag, source, count) VALUES (?, ?, ?)",
                        (tag, "jm", count),
                    )
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise

    def upsert_comic(self, comic_id: str, source: str, tags: list[str]) -> None:
        """Add or update a comic's tag snapshot, adjusting counts incrementally."""
        with self._lock:
            self._upsert_comic_unlocked(comic_id, source, tags)

    def _upsert_comic_unlocked(self, comic_id: str, source: str, tags: list[str]) -> None:
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
            self._conn.execute("DELETE FROM favourite_tag_index WHERE source = ?", (source,))
            self._conn.execute("DELETE FROM favourite_tag_comics WHERE source = ?", (source,))
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

    def _init_favourite_tags(self) -> None:
        db_path = os.path.join(os.path.expanduser("~"), ".hcomic_downloader", "favourite_tags.db")
        self._favourite_tags_db = FavouriteTagsDB(db_path)

    def _emit_favourite_tags_progress(
        self,
        source: str,
        phase: str,
        current: int,
        total: int,
        *,
        current_page: int | None = None,
        total_pages: int | None = None,
        total_comics: int | None = None,
        total_tags: int | None = None,
        message: str = "",
    ) -> None:
        """推送收藏夹标签同步进度 notification 给前端。

        phase 取值：fetching（扫描收藏夹页）/ enriching（补全无标签漫画详情）/
        completed / error。current/total 描述当前阶段进度；页码字段仅在
        fetching 阶段有意义，故为 None 时不写入 payload。
        """
        params: dict[str, Any] = {
            "source": source,
            "phase": phase,
            "current": current,
            "total": total,
        }
        if current_page is not None:
            params["currentPage"] = current_page
        if total_pages is not None:
            params["totalPages"] = total_pages
        if total_comics is not None:
            params["totalComics"] = total_comics
        if total_tags is not None:
            params["totalTags"] = total_tags
        if message:
            params["message"] = message
        notification = {
            "jsonrpc": "2.0",
            "method": "favourite_tags_progress",
            "params": params,
        }
        self._write_response(notification)

    def handle_get_favourite_tags(self, source: str = "hcomic") -> dict:
        effective_source = source if source in _TAG_RECOMMENDATION_SOURCES else "hcomic"
        tags = self._favourite_tags_db.get_tags(effective_source)
        return {"tags": tags}

    def handle_clear_favourite_tags(self, source: str = "hcomic") -> dict:
        """清空指定来源的推荐标签索引（轻量操作，无 HTTP 请求）。"""
        effective_source = source if source in _TAG_RECOMMENDATION_SOURCES else "hcomic"
        self._favourite_tags_db.clear(effective_source)
        return {"success": True}

    def handle_remove_favourite_tag(self, tag: str, source: str = "hcomic") -> dict:
        effective_source = source if source in _TAG_RECOMMENDATION_SOURCES else "hcomic"
        self._favourite_tags_db.remove_tag(tag, effective_source)
        return {"success": True}

    def handle_sync_favourite_tags(self, source: str = "hcomic") -> dict:
        """一站式同步：获取全部收藏 → 清空索引 → 更新有标签漫画 → 补全无标签漫画。

        先获取第一页确认可访问，再清空索引，避免未登录时丢失已有数据。
        同步过程逐阶段推送 favourite_tags_progress 进度事件，异常路径在
        推送 error 后重新抛出，保持现有 JSON-RPC 错误行为不变。
        """
        effective_source = source if source in _TAG_RECOMMENDATION_SOURCES else "hcomic"

        # 2. 逐页获取收藏夹，收集有/无标签漫画
        all_empty: list = []
        total_comics = 0
        skipped_pages = 0
        total_pages = 1

        try:
            try:
                comics, pagination, needs_login = self.parser.favourites(
                    page=1,
                    raise_errors=True,
                    source=effective_source,
                )
            except Exception as e:
                logger.error("sync_favourite_tags page 1 failed: %s", e, exc_info=True)
                self._emit_favourite_tags_progress(effective_source, "error", 0, 1, message=str(e) or "同步失败")
                raise

            if needs_login:
                raise RuntimeError(f"{effective_source} 未登录或会话已过期，请先登录后再同步")

            # 1. 第一页成功后才清空该来源的标签索引
            self._favourite_tags_db.clear(effective_source)

            total_pages = pagination.total_pages if pagination else 1
            total_comics += len(comics)
            empty = self._update_tags_from_favourites_page(comics, effective_source, collect_empty=True)
            all_empty.extend(empty)
            self._emit_favourite_tags_progress(
                effective_source,
                "fetching",
                1,
                total_pages,
                current_page=1,
                total_pages=total_pages,
                total_comics=total_comics,
            )

            for page in range(2, total_pages + 1):
                try:
                    comics, pagination, _needs_login = self.parser.favourites(
                        page=page,
                        raise_errors=False,
                        source=effective_source,
                    )
                    total_comics += len(comics)
                    empty = self._update_tags_from_favourites_page(comics, effective_source, collect_empty=True)
                    all_empty.extend(empty)
                except Exception as e:
                    logger.warning("sync_favourite_tags page %d failed: %s", page, e)
                    skipped_pages += 1
                self._emit_favourite_tags_progress(
                    effective_source,
                    "fetching",
                    page,
                    total_pages,
                    current_page=page,
                    total_pages=total_pages,
                    total_comics=total_comics,
                )

            # 3. 对无标签漫画做 enrichment
            enrich_needed = len(all_empty)
            if enrich_needed > 0:
                self._emit_favourite_tags_progress(effective_source, "enriching", 0, enrich_needed)

                def _on_enrich(done: int) -> None:
                    self._emit_favourite_tags_progress(effective_source, "enriching", done, enrich_needed)

                enriched_count = self._enrich_tags_for_comics(all_empty, effective_source, progress_callback=_on_enrich)
            else:
                enriched_count = 0

            # 4. 返回最终标签列表
            tags = self._favourite_tags_db.get_tags(effective_source)
            self._emit_favourite_tags_progress(
                effective_source,
                "completed",
                total_pages,
                total_pages,
                total_comics=total_comics,
                total_tags=len(tags),
            )
            logger.info(
                "sync_favourite_tags done: source=%s total=%d enrich_needed=%d enriched=%d skipped=%d",
                effective_source,
                total_comics,
                enrich_needed,
                enriched_count,
                skipped_pages,
            )
            return {
                "tags": tags,
                "totalComics": total_comics,
                "enrichedCount": enriched_count,
                "enrichNeeded": enrich_needed,
                "skippedPages": skipped_pages,
            }
        except Exception as e:
            # 兜底：未被内层捕获的异常也推送 error，保持 UI 不卡在同步中。
            # 已由内层推送过 error 的异常会再推一次，前端按终态处理无副作用。
            message = str(e) or "同步失败"
            try:
                self._emit_favourite_tags_progress(
                    effective_source, "error", 0, total_pages, total_comics=total_comics, message=message
                )
            except Exception:  # noqa: SIM107 - 推送失败不应掩盖原始同步错误
                logger.debug("failed to emit favourite tags error progress: %s", e)
            raise
