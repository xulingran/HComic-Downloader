"""下载历史数据库模块 — 使用 SQLite 持久化记录下载成功的漫画"""
import logging
import os
import sqlite3
import time
from typing import Dict, List, Tuple

from models import ComicInfo

logger = logging.getLogger(__name__)


class DownloadHistoryDB:
    """SQLite-based download history tracker."""

    def __init__(self, db_path: str):
        self._db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._conn = sqlite3.connect(db_path)
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
    ) -> Dict[Tuple[str, str, str], str]:
        """Check download status for a batch of comics.

        Args:
            comic_keys: List of (source_site, comic_id, comic_source) tuples.
            output_dir: Current download directory.
            output_format: Current output format (folder/zip/cbz).
            filename_template: Current filename template.

        Returns:
            Dict mapping each key to "downloaded" or "unknown".
        """
        if not comic_keys:
            return {}

        placeholders = ",".join(["(?, ?, ?)"] * len(comic_keys))
        flat_keys = []
        for k in comic_keys:
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

        from cbz_builder import CBZBuilder
        builder = CBZBuilder(filename_template=filename_template)

        result: Dict[Tuple[str, str, str], str] = {}
        for key in comic_keys:
            record = db_records.get(key)
            if record and os.path.exists(record["output_path"]):
                result[key] = "downloaded"
            else:
                comic = ComicInfo(
                    id=key[1],
                    title=record["title"] if record else "",
                    author=record["author"] if record else None,
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

    def close(self):
        if self._conn:
            self._conn.close()
