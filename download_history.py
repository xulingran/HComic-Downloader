"""下载历史数据库模块 — 使用 SQLite 持久化记录下载成功的漫画"""

from __future__ import annotations

import logging
import os
import threading
import time

from models import ComicInfo
from utils import open_sqlite_db

logger = logging.getLogger(__name__)


class DownloadHistoryDB:
    """SQLite-based download history tracker."""

    def __init__(self, db_path: str):
        self._db_path = db_path
        self._lock = threading.Lock()
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._conn = open_sqlite_db(db_path)
        self._create_table()

    def _create_table(self):
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS download_history (
                source_site TEXT NOT NULL,
                comic_id TEXT NOT NULL,
                comic_source TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                author TEXT NOT NULL DEFAULT '',
                output_path TEXT NOT NULL DEFAULT '',
                output_format TEXT NOT NULL DEFAULT '',
                downloaded_at INTEGER NOT NULL,
                PRIMARY KEY (source_site, comic_id, comic_source)
            )
        """)
        # 列迁移：为多章节专辑判定补充 album_id / album_total_chapters。
        existing = {row[1] for row in self._conn.execute("PRAGMA table_info(download_history)")}
        if "album_id" not in existing:
            self._conn.execute("ALTER TABLE download_history ADD COLUMN album_id TEXT NOT NULL DEFAULT ''")
        if "album_total_chapters" not in existing:
            self._conn.execute(
                "ALTER TABLE download_history ADD COLUMN album_total_chapters INTEGER NOT NULL DEFAULT 1"
            )
        self._conn.commit()
        self._migrate_album_ids()

    def _migrate_album_ids(self):
        """旧记录 album_id 为空时回填为 comic_id，使其按单本专辑(1/1)正确判定。"""
        with self._lock:
            self._conn.execute("UPDATE download_history SET album_id = comic_id WHERE album_id = ''")
            self._conn.commit()

    def record_download(self, comic: ComicInfo, output_path: str, output_format: str):
        """INSERT OR REPLACE a download record."""
        with self._lock:
            self._conn.execute(
                """
                INSERT OR REPLACE INTO download_history
                    (source_site, comic_id, comic_source, title, author,
                     output_path, output_format, album_id, album_total_chapters,
                     downloaded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    comic.source_site,
                    comic.id,
                    comic.comic_source,
                    comic.title,
                    comic.author or "",
                    output_path,
                    output_format,
                    getattr(comic, "album_id", "") or comic.id,
                    getattr(comic, "album_total_chapters", 1) or 1,
                    int(time.time()),
                ),
            )
            self._conn.commit()

    def check_downloaded_batch(
        self,
        comic_keys: list[tuple[str, str, str]],
        output_dir: str,
        output_format: str,
        filename_template: str,
        comic_data_map: dict[tuple[str, str, str], dict] | None = None,
    ) -> dict[tuple[str, str, str], str]:
        """Check download status for a batch of comics.

        Args:
            comic_keys: List of (source_site, comic_id, comic_source) tuples.
            output_dir: Current download directory.
            output_format: Current output format (folder/zip/cbz).
            filename_template: Current filename template.
            comic_data_map: Optional mapping from key to {title, author} for fallback path.

        Returns:
            Dict mapping each key to "downloaded" or "unknown".
        """
        if not comic_keys:
            return {}

        # 大列表分批查询，避免 SQLite IN 子句占位符过多。
        # 占位符 (?, ?, ?) 通过字符串乘法生成，不拼接用户输入，无注入风险。
        BATCH_SIZE = 500
        if len(comic_keys) <= BATCH_SIZE:
            batches = [comic_keys]
        else:
            batches = [comic_keys[i : i + BATCH_SIZE] for i in range(0, len(comic_keys), BATCH_SIZE)]

        from cbz_builder import CBZBuilder

        builder = CBZBuilder(filename_template=filename_template)

        result: dict[tuple[str, str, str], str] = {}
        with self._lock:
            for batch in batches:
                placeholders = ",".join(["(?, ?, ?)"] * len(batch))
                flat_keys: list[str] = []
                for k in batch:
                    flat_keys.extend(k)

                # 以传入 comic_id 作为 album_id 查询同专辑所有章节行。
                cursor = self._conn.execute(
                    f"""
                    SELECT source_site, album_id, comic_source, output_path,
                           album_total_chapters, title, author
                    FROM download_history
                    WHERE (source_site, album_id, comic_source) IN ({placeholders})
                """,
                    flat_keys,
                )

                # 按 (site, album_id, source) 聚合：统计仍存在的章数与总章数。
                from collections import defaultdict

                agg: dict[tuple[str, str, str], dict] = defaultdict(lambda: {"have": 0, "total": 1, "rec": None})
                for row in cursor:
                    key = (row[0], row[1], row[2])
                    bucket = agg[key]
                    bucket["total"] = row[4] or 1
                    bucket["rec"] = {
                        "output_path": row[3],
                        "title": row[5],
                        "author": row[6],
                    }
                    if row[3] and os.path.exists(row[3]):
                        bucket["have"] += 1

                # 第二轮：第一轮无匹配的 key，按主键 (source_site, comic_id, comic_source) 回退查询。
                # 这解决了批量专辑下载时 album_id 为 md5 hash 而非 comic_id 导致的匹配失败问题。
                # 注意：主键查询每 key 最多返回一行，因此直接检查 output_path 存在性即可，
                # 不需要也用不了 album_total_chapters 的多行聚合逻辑。SELECT 仅取所需列。
                #
                # 关键：仅当 output_path 实际存在时才判定 "downloaded" 并写入 result。
                # 若"DB 有记录但 output_path 缺失"，不要在此处提前判 unknown——否则会短路
                # 下方第三轮的 expected_path 探测（用于"文件移动/改过输出目录"等 DB 记录失效
                # 但文件仍存在于新路径的场景）。把这类 key 留给第三轮，由 expected_path 探测决定。
                unmatched_keys = [key for key in batch if key not in agg]
                if unmatched_keys:
                    fallback_phs = ",".join(["(?, ?, ?)"] * len(unmatched_keys))
                    fallback_flat: list[str] = []
                    for k in unmatched_keys:
                        fallback_flat.extend(k)
                    cursor2 = self._conn.execute(
                        f"""
                        SELECT source_site, comic_id, comic_source, output_path
                        FROM download_history
                        WHERE (source_site, comic_id, comic_source) IN ({fallback_phs})
                    """,
                        fallback_flat,
                    )
                    for row in cursor2:
                        key = (row[0], row[1], row[2])  # (source_site, comic_id, comic_source) 与 batch key 格式一致
                        out_path = row[3]
                        if out_path and os.path.exists(out_path):
                            result[key] = "downloaded"
                        # 否则不写入 result，留给第三轮 expected_path 探测后判定 unknown

                for key in batch:
                    if key in result:
                        # 已在第二轮回退查询中确认 downloaded，或之前的批次中判定，跳过
                        continue
                    bucket = agg.get(key)
                    if bucket and bucket["have"] >= bucket["total"]:
                        result[key] = "downloaded"
                    else:
                        # 回退：无聚合命中或章节不全时，按预期路径探测（兼容旧单本记录）。
                        data = (comic_data_map or {}).get(key, {})
                        rec = bucket["rec"] if bucket else None
                        comic = ComicInfo(
                            id=key[1],
                            title=rec["title"] if rec else data.get("title", ""),
                            author=rec["author"] if rec else data.get("author"),
                            source_site=key[0],
                            comic_source=key[2],
                        )
                        expected_path = builder.get_output_path_for_format(comic, output_format, output_dir)
                        if os.path.exists(expected_path):
                            result[key] = "downloaded"
                        else:
                            result[key] = "unknown"

        return result

    def get_all_records(self) -> list[dict]:
        """Return all download history records."""
        with self._lock:
            cursor = self._conn.execute(
                "SELECT source_site, comic_id, comic_source, title, author, "
                "output_path, output_format, downloaded_at "
                "FROM download_history"
            )
            columns = [
                "source_site",
                "comic_id",
                "comic_source",
                "title",
                "author",
                "output_path",
                "output_format",
                "downloaded_at",
            ]
            return [dict(zip(columns, row, strict=True)) for row in cursor]

    def update_output_path(self, key: tuple[str, str, str], new_path: str):
        """Update the output_path for a specific record."""
        with self._lock:
            self._conn.execute(
                "UPDATE download_history SET output_path = ? "
                "WHERE source_site = ? AND comic_id = ? AND comic_source = ?",
                (new_path, key[0], key[1], key[2]),
            )
            self._conn.commit()

    def update_output_path_by_album(
        self,
        source_site: str,
        comic_source: str,
        album_id: str,
        new_path: str,
    ) -> int:
        """将指定专辑下所有章节记录的 output_path 批量更新为 new_path。

        Returns:
            受影响的行数。
        """
        with self._lock:
            cursor = self._conn.execute(
                "UPDATE download_history SET output_path = ? "
                "WHERE source_site = ? AND comic_source = ? AND album_id = ?",
                (new_path, source_site, comic_source, album_id),
            )
            self._conn.commit()
            return cursor.rowcount

    def close(self):
        if self._conn:
            self._conn.close()
