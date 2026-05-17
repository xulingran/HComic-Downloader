"""下载历史数据库模块 — 使用 SQLite 持久化记录下载成功的漫画"""
from __future__ import annotations

import logging
import os
import sqlite3
import threading
import time
from typing import Dict, List, Optional, Tuple

from models import ComicInfo

logger = logging.getLogger(__name__)


class DownloadHistoryDB:
    """SQLite-based download history tracker."""

    def __init__(self, db_path: str):
        self._db_path = db_path
        self._lock = threading.Lock()
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
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
        self._conn.commit()

    def record_download(self, comic: ComicInfo, output_path: str, output_format: str):
        """INSERT OR REPLACE a download record."""
        with self._lock:
            self._conn.execute("""
                INSERT OR REPLACE INTO download_history
                    (source_site, comic_id, comic_source, title, author,
                     output_path, output_format, downloaded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                comic.source_site,
                comic.id,
                comic.comic_source,
                comic.title,
                comic.author or "",
                output_path,
                output_format,
                int(time.time()),
            ))
            self._conn.commit()

    def check_downloaded_batch(
        self,
        comic_keys: List[Tuple[str, str, str]],
        output_dir: str,
        output_format: str,
        filename_template: str,
        comic_data_map: Optional[Dict[Tuple[str, str, str], dict]] = None,
    ) -> Dict[Tuple[str, str, str], str]:
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
            batches = [comic_keys[i:i + BATCH_SIZE] for i in range(0, len(comic_keys), BATCH_SIZE)]

        from cbz_builder import CBZBuilder
        builder = CBZBuilder(filename_template=filename_template)

        result: Dict[Tuple[str, str, str], str] = {}
        with self._lock:
            for batch in batches:
                placeholders = ",".join(["(?, ?, ?)"] * len(batch))
                flat_keys: list[str] = []
                for k in batch:
                    flat_keys.extend(k)

                cursor = self._conn.execute(f"""
                    SELECT source_site, comic_id, comic_source, output_path, title, author
                    FROM download_history
                    WHERE (source_site, comic_id, comic_source) IN ({placeholders})
                """, flat_keys)

                db_records: Dict[Tuple[str, str, str], dict] = {}
                for row in cursor:
                    key = (row[0], row[1], row[2])
                    db_records[key] = {"output_path": row[3], "title": row[4], "author": row[5]}

                for key in batch:
                    record = db_records.get(key)
                    if record and os.path.exists(record["output_path"]):
                        result[key] = "downloaded"
                    else:
                        data = (comic_data_map or {}).get(key, {})
                        comic = ComicInfo(
                            id=key[1],
                            title=record["title"] if record else data.get("title", ""),
                            author=record["author"] if record else data.get("author"),
                            source_site=key[0],
                            comic_source=key[2],
                        )
                        expected_path = builder.get_output_path_for_format(
                            comic, output_format, output_dir
                        )
                        if os.path.exists(expected_path):
                            result[key] = "downloaded"
                        else:
                            result[key] = "unknown"

        return result

    def get_all_records(self) -> List[Dict]:
        """Return all download history records."""
        with self._lock:
            cursor = self._conn.execute(
                "SELECT source_site, comic_id, comic_source, title, author, "
                "output_path, output_format, downloaded_at "
                "FROM download_history"
            )
            columns = ["source_site", "comic_id", "comic_source", "title",
                        "author", "output_path", "output_format", "downloaded_at"]
            return [dict(zip(columns, row)) for row in cursor]

    def update_output_path(self, key: Tuple[str, str, str], new_path: str):
        """Update the output_path for a specific record."""
        with self._lock:
            self._conn.execute(
                "UPDATE download_history SET output_path = ? "
                "WHERE source_site = ? AND comic_id = ? AND comic_source = ?",
                (new_path, key[0], key[1], key[2]),
            )
            self._conn.commit()

    def close(self):
        if self._conn:
            self._conn.close()
