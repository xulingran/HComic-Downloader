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

    def close(self):
        if self._conn:
            self._conn.close()
