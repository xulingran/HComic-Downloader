"""漫画库索引 SQLite 存储。

该模块独立于 ``download_history``，维护可重建的漫画库索引。
索引数据库存储资产摘要、章节、阅读进度和扫描状态；schema 不兼容或
数据库损坏时通过隔离旧文件并完整重建恢复，绝不修改漫画文件本身。

设计约束（见 openspec/changes/local-comic-library/design.md §2）：
- ``library.db`` 默认位于应用数据目录 ``~/.hcomic_downloader/``，并与
  ``config.json`` 一样支持 ``HCOMIC_CONFIG_DIR`` 覆盖。
- 资产 ID 使用持久化随机 UUID，路径未变化时复用 ID。
- 页面 manifest 只在首次阅读或资产版本变化时生成。
- 真实路径和压缩包条目名只在后端使用，不通过列表 IPC 暴露。
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from utils import open_sqlite_db

# ── schema 版本与迁移 ──────────────────────────────────────────────

_SCHEMA_VERSION = 1
_UNSET = object()

_CREATE_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS library_items (
    asset_id TEXT PRIMARY KEY,
    root_generation INTEGER NOT NULL DEFAULT 1,
    rel_path TEXT NOT NULL,
    format TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    mtime_ns INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    source_site TEXT NOT NULL DEFAULT '',
    comic_id TEXT NOT NULL DEFAULT '',
    comic_source TEXT NOT NULL DEFAULT '',
    album_id TEXT NOT NULL DEFAULT '',
    album_total_chapters INTEGER NOT NULL DEFAULT 1,
    page_count INTEGER NOT NULL DEFAULT 0,
    is_album INTEGER NOT NULL DEFAULT 0,
    chapter_count INTEGER NOT NULL DEFAULT 1,
    cover_key TEXT,
    health_status TEXT NOT NULL DEFAULT 'unknown',
    last_read_at INTEGER,
    created_at INTEGER NOT NULL,
    scanned_at INTEGER NOT NULL DEFAULT 0,
    metadata_override TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS library_chapters (
    chapter_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    chapter_index INTEGER NOT NULL DEFAULT 0,
    rel_path TEXT NOT NULL DEFAULT '',
    archive_prefix TEXT NOT NULL DEFAULT '',
    page_count INTEGER NOT NULL DEFAULT 0,
    page_manifest TEXT NOT NULL DEFAULT '[]',
    manifest_version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chapter_id, asset_id),
    FOREIGN KEY (asset_id) REFERENCES library_items(asset_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS library_reading_progress (
    asset_id TEXT PRIMARY KEY,
    chapter_id TEXT,
    page INTEGER NOT NULL DEFAULT 1,
    total_pages INTEGER NOT NULL DEFAULT 0,
    last_read_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS library_scan_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    root_generation INTEGER NOT NULL DEFAULT 1,
    scan_id TEXT,
    phase TEXT NOT NULL DEFAULT 'idle',
    is_scanning INTEGER NOT NULL DEFAULT 0,
    current INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    current_label TEXT NOT NULL DEFAULT '',
    last_scan_completed_at INTEGER,
    last_scan_cancelled INTEGER NOT NULL DEFAULT 0,
    last_scan_error TEXT
);

CREATE TABLE IF NOT EXISTS library_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_root_gen ON library_items(root_generation);
CREATE INDEX IF NOT EXISTS idx_items_rel_path ON library_items(rel_path, root_generation);
CREATE INDEX IF NOT EXISTS idx_items_source_site ON library_items(source_site);
CREATE INDEX IF NOT EXISTS idx_items_format ON library_items(format);
CREATE INDEX IF NOT EXISTS idx_items_health ON library_items(health_status);
CREATE INDEX IF NOT EXISTS idx_items_last_read ON library_items(last_read_at);
CREATE INDEX IF NOT EXISTS idx_items_created_at ON library_items(created_at);
CREATE INDEX IF NOT EXISTS idx_items_title ON library_items(title);
CREATE INDEX IF NOT EXISTS idx_chapters_asset ON library_chapters(asset_id);
"""


class LibraryDB:
    """漫画库索引数据库访问层。

    所有方法线程安全（内部 threading.Lock）。与 ``ReadingHistoryDB`` 和
    ``DownloadHistoryDB`` 遵循相同的连接策略（WAL + check_same_thread=False）。

    若数据库无法打开或 schema 校验失败，调用 ``rebuild_corrupt_db()``
    隔离旧文件并创建全新索引——此过程只操作应用数据目录，不会触碰漫画文件。
    """

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._lock = threading.RLock()
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._conn = self._open_and_init()

    # ── 连接与 schema 初始化 ───────────────────────────────────────

    def _open_and_init(self) -> sqlite3.Connection:
        """打开数据库并执行 schema 创建/迁移。损坏时隔离并重建。"""
        try:
            return self._try_open()
        except sqlite3.DatabaseError:
            # 数据库损坏：隔离旧文件后创建空库
            self._quarantine_corrupt_db()
            return self._try_open()

    def _try_open(self) -> sqlite3.Connection:
        """打开数据库，配置 WAL，执行 schema。

        若文件损坏，在 WAL PRAGMA 或 schema 步骤抛出 ``sqlite3.DatabaseError``。
        """
        # 先用轻量探测检查文件是否为有效 SQLite 数据库，
        # 避免损坏文件的连接句柄残留导致 Windows 上无法重命名。
        if os.path.exists(self._db_path) and os.path.getsize(self._db_path) > 0:
            probe = sqlite3.connect(self._db_path)
            try:
                probe.execute("SELECT 1 FROM sqlite_master LIMIT 1").fetchone()
            except sqlite3.DatabaseError:
                probe.close()
                raise
            probe.close()
        conn = open_sqlite_db(self._db_path, row_factory=True)
        self._ensure_schema(conn)
        return conn

    def _ensure_schema(self, conn: sqlite3.Connection) -> None:
        """创建 schema（如果不存在）并执行向前迁移。"""
        conn.executescript(_CREATE_SCHEMA_SQL)
        # 版本检查/迁移
        row = conn.execute("SELECT value FROM library_meta WHERE key = 'schema_version'").fetchone()
        current_version = int(row["value"]) if row else 0
        if current_version < _SCHEMA_VERSION:
            self._migrate(conn, current_version)
        if current_version == 0:
            conn.execute(
                "INSERT OR REPLACE INTO library_meta (key, value) VALUES ('schema_version', ?)",
                (str(_SCHEMA_VERSION),),
            )
        # 确保 scan_state 有初始行
        conn.execute("""
            INSERT OR IGNORE INTO library_scan_state
                (id, root_generation, phase, is_scanning, current, total, current_label)
            VALUES (1, 1, 'idle', 0, 0, 0, '')
            """)
        conn.commit()

    def _migrate(self, conn: sqlite3.Connection, from_version: int) -> None:
        """向前迁移逻辑。当前只有 version 1，无迁移步骤。"""
        # version 0 → 1：初始创建已由 _CREATE_SCHEMA_SQL 完成
        conn.execute(
            "INSERT OR REPLACE INTO library_meta (key, value) VALUES ('schema_version', ?)",
            (str(_SCHEMA_VERSION),),
        )
        conn.commit()

    def _quarantine_corrupt_db(self) -> None:
        """隔离损坏的数据库文件，以便从磁盘重建。

        将旧文件重命名为 ``library.db.corrupt.<timestamp>``，
        保留备份供调试但不阻塞重建。如果重命名失败（权限/占用），
        则尝试删除。绝不触碰任何漫画文件。
        """
        corrupt_path = f"{self._db_path}.corrupt.{int(time.time())}"
        try:
            if os.path.exists(self._db_path):
                os.rename(self._db_path, corrupt_path)
        except OSError:
            # 重命名失败则删除
            try:
                if os.path.exists(self._db_path):
                    os.remove(self._db_path)
            except OSError:
                pass
        # 同时清理 WAL/SHM（已损坏）
        for suffix in ("-wal", "-shm"):
            sidecar = f"{self._db_path}{suffix}"
            try:
                if os.path.exists(sidecar):
                    os.remove(sidecar)
            except OSError:
                pass

    # ── 通用辅助 ──────────────────────────────────────────────────

    @staticmethod
    def _now_ms() -> int:
        return int(time.time() * 1000)

    @staticmethod
    def _generate_asset_id() -> str:
        return str(uuid.uuid4())

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # ── 扫描状态 ──────────────────────────────────────────────────

    def get_scan_state(self) -> dict[str, Any]:
        with self._lock:
            row = self._conn.execute("SELECT * FROM library_scan_state WHERE id = 1").fetchone()
            if not row:
                return {
                    "phase": "idle",
                    "scanId": None,
                    "isScanning": False,
                    "current": 0,
                    "total": 0,
                    "currentLabel": "",
                    "lastScanCompletedAt": None,
                    "lastScanCancelled": False,
                    "lastScanError": None,
                }
            return {
                "phase": row["phase"],
                "scanId": row["scan_id"],
                "isScanning": bool(row["is_scanning"]),
                "current": row["current"],
                "total": row["total"],
                "currentLabel": row["current_label"],
                "lastScanCompletedAt": row["last_scan_completed_at"],
                "lastScanCancelled": bool(row["last_scan_cancelled"]),
                "lastScanError": row["last_scan_error"],
            }

    def set_scan_state(
        self,
        *,
        phase: str | None = None,
        scan_id: str | None | object = _UNSET,
        is_scanning: bool | None = None,
        current: int | None = None,
        total: int | None = None,
        current_label: str | None = None,
        last_scan_completed_at: int | None | object = _UNSET,
        last_scan_cancelled: bool | None = None,
        last_scan_error: str | None | object = _UNSET,
    ) -> None:
        with self._lock:
            updates: list[str] = []
            params: list[Any] = []
            if phase is not None:
                updates.append("phase = ?")
                params.append(phase)
            if scan_id is not _UNSET:
                updates.append("scan_id = ?")
                params.append(scan_id)
            if is_scanning is not None:
                updates.append("is_scanning = ?")
                params.append(int(is_scanning))
            if current is not None:
                updates.append("current = ?")
                params.append(current)
            if total is not None:
                updates.append("total = ?")
                params.append(total)
            if current_label is not None:
                updates.append("current_label = ?")
                params.append(current_label)
            if last_scan_completed_at is not _UNSET:
                updates.append("last_scan_completed_at = ?")
                params.append(last_scan_completed_at)
            if last_scan_cancelled is not None:
                updates.append("last_scan_cancelled = ?")
                params.append(int(last_scan_cancelled))
            if last_scan_error is not _UNSET:
                updates.append("last_scan_error = ?")
                params.append(last_scan_error)
            if updates:
                params.append(1)  # WHERE id = 1
                self._conn.execute(f"UPDATE library_scan_state SET {', '.join(updates)} WHERE id = ?", params)
                self._conn.commit()

    def get_root_generation(self) -> int:
        with self._lock:
            row = self._conn.execute("SELECT root_generation FROM library_scan_state WHERE id = 1").fetchone()
            return int(row["root_generation"]) if row else 1

    def bump_root_generation(self) -> int:
        """目录迁移完成后递增 root generation，使旧资产令牌失效。"""
        with self._lock:
            self._conn.execute("UPDATE library_scan_state SET root_generation = root_generation + 1 WHERE id = 1")
            self._conn.commit()
            row = self._conn.execute("SELECT root_generation FROM library_scan_state WHERE id = 1").fetchone()
            return int(row["root_generation"]) if row else 1

    # ── 资产 CRUD ─────────────────────────────────────────────────

    def upsert_item(self, item: dict[str, Any]) -> str:
        """插入或更新单个资产，返回 asset_id。

        ``item`` 必须包含 rel_path、format 等字段。如果 rel_path+root_generation
        已存在且 size/mtime 未变化，则复用已有 asset_id 和元数据。
        """
        with self._lock:
            asset_id = item.get("asset_id") or self._generate_asset_id()
            root_gen = item.get("root_generation", self.get_root_generation())
            self._conn.execute(
                """
                INSERT INTO library_items (
                    asset_id, root_generation, rel_path, format, size_bytes, mtime_ns,
                    title, author, tags, source_site, comic_id, comic_source,
                    album_id, album_total_chapters, page_count, is_album, chapter_count,
                    cover_key, health_status, last_read_at, created_at, scanned_at,
                    metadata_override, version
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                )
                ON CONFLICT(asset_id) DO UPDATE SET
                    root_generation=excluded.root_generation,
                    rel_path=excluded.rel_path,
                    format=excluded.format,
                    size_bytes=excluded.size_bytes,
                    mtime_ns=excluded.mtime_ns,
                    title=excluded.title,
                    author=excluded.author,
                    tags=excluded.tags,
                    source_site=excluded.source_site,
                    comic_id=excluded.comic_id,
                    comic_source=excluded.comic_source,
                    album_id=excluded.album_id,
                    album_total_chapters=excluded.album_total_chapters,
                    page_count=excluded.page_count,
                    is_album=excluded.is_album,
                    chapter_count=excluded.chapter_count,
                    cover_key=excluded.cover_key,
                    health_status=excluded.health_status,
                    scanned_at=excluded.scanned_at,
                    metadata_override=excluded.metadata_override,
                    version=excluded.version
                """,
                (
                    asset_id,
                    root_gen,
                    item["rel_path"],
                    item["format"],
                    item.get("size_bytes", 0),
                    item.get("mtime_ns", 0),
                    item.get("title", ""),
                    item.get("author", ""),
                    json.dumps(item.get("tags", []), ensure_ascii=False),
                    item.get("source_site", ""),
                    item.get("comic_id", ""),
                    item.get("comic_source", ""),
                    item.get("album_id", ""),
                    item.get("album_total_chapters", 1),
                    item.get("page_count", 0),
                    int(item.get("is_album", False)),
                    item.get("chapter_count", 1),
                    item.get("cover_key"),
                    item.get("health_status", "unknown"),
                    item.get("last_read_at"),
                    item.get("created_at", self._now_ms()),
                    item.get("scanned_at", self._now_ms()),
                    json.dumps(item.get("metadata_override", {}), ensure_ascii=False),
                    item.get("version", 1),
                ),
            )
            self._conn.commit()
            return asset_id

    def find_item_by_path(self, rel_path: str, root_generation: int | None = None) -> dict[str, Any] | None:
        """通过规范化相对路径查找资产，用于增量判定时复用 ID。"""
        root_gen = root_generation if root_generation is not None else self.get_root_generation()
        with self._lock:
            row = self._conn.execute(
                """
                SELECT * FROM library_items
                WHERE rel_path = ? AND root_generation = ?
                """,
                (rel_path, root_gen),
            ).fetchone()
            return self._row_to_item(row) if row else None

    def get_item(self, asset_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM library_items WHERE asset_id = ?", (asset_id,)).fetchone()
            return self._row_to_item(row) if row else None

    def get_item_with_progress(self, asset_id: str) -> dict[str, Any] | None:
        """获取资产详情，并合并阅读进度信息。"""
        item = self.get_item(asset_id)
        if not item:
            return None
        progress = self.get_reading_progress(asset_id)
        if progress:
            item["reading_page"] = progress["page"]
            item["reading_chapter_id"] = progress.get("chapter_id")
        else:
            item["reading_page"] = None
            item["reading_chapter_id"] = None
        return item

    def _row_to_item(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "asset_id": row["asset_id"],
            "root_generation": row["root_generation"],
            "rel_path": row["rel_path"],
            "format": row["format"],
            "size_bytes": row["size_bytes"],
            "mtime_ns": row["mtime_ns"],
            "title": row["title"],
            "author": row["author"],
            "tags": json.loads(row["tags"]) if row["tags"] else [],
            "source_site": row["source_site"],
            "comic_id": row["comic_id"],
            "comic_source": row["comic_source"],
            "album_id": row["album_id"],
            "album_total_chapters": row["album_total_chapters"],
            "page_count": row["page_count"],
            "is_album": bool(row["is_album"]),
            "chapter_count": row["chapter_count"],
            "cover_key": row["cover_key"],
            "health_status": row["health_status"],
            "last_read_at": row["last_read_at"],
            "created_at": row["created_at"],
            "scanned_at": row["scanned_at"],
            "metadata_override": json.loads(row["metadata_override"]) if row["metadata_override"] else {},
            "version": row["version"],
        }

    def delete_item(self, asset_id: str) -> bool:
        """删除资产及其章节、阅读进度。返回是否删除了行。"""
        with self._lock:
            cur = self._conn.execute("DELETE FROM library_items WHERE asset_id = ?", (asset_id,))
            self._conn.execute("DELETE FROM library_chapters WHERE asset_id = ?", (asset_id,))
            self._conn.execute("DELETE FROM library_reading_progress WHERE asset_id = ?", (asset_id,))
            self._conn.commit()
            return cur.rowcount > 0

    def delete_items_not_in(self, seen_rel_paths: set[str], root_generation: int) -> int:
        """删除指定 generation 中未在 ``seen_rel_paths`` 里出现的陈旧索引项。

        仅在完整扫描未被取消时调用。
        """
        with self._lock:
            # 构建占位符
            if not seen_rel_paths:
                cur = self._conn.execute(
                    """
                    DELETE FROM library_items
                    WHERE root_generation = ?
                    """,
                    (root_generation,),
                )
            else:
                placeholders = ",".join(["?"] * len(seen_rel_paths))
                cur = self._conn.execute(
                    f"""
                    DELETE FROM library_items
                    WHERE root_generation = ?
                      AND rel_path NOT IN ({placeholders})
                    """,
                    (root_generation, *seen_rel_paths),
                )
            self._conn.commit()
            return cur.rowcount

    def update_item_cover(self, asset_id: str, cover_key: str | None) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE library_items SET cover_key = ? WHERE asset_id = ?",
                (cover_key, asset_id),
            )
            self._conn.commit()

    def update_item_health(self, asset_id: str, health_status: str) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE library_items SET health_status = ? WHERE asset_id = ?",
                (health_status, asset_id),
            )
            self._conn.commit()

    def bump_item_version(self, asset_id: str) -> int:
        """递增资产版本令牌，用于元数据编辑后使缓存失效。"""
        with self._lock:
            self._conn.execute(
                "UPDATE library_items SET version = version + 1, cover_key = NULL, scanned_at = ? WHERE asset_id = ?",
                (self._now_ms(), asset_id),
            )
            self._conn.commit()
            row = self._conn.execute("SELECT version FROM library_items WHERE asset_id = ?", (asset_id,)).fetchone()
            return int(row["version"]) if row else 0

    def update_item_file_stat(self, asset_id: str, size_bytes: int, mtime_ns: int) -> None:
        """Refresh the indexed stat after an app-managed in-place rewrite."""
        with self._lock:
            self._conn.execute(
                "UPDATE library_items SET size_bytes = ?, mtime_ns = ?, scanned_at = ? WHERE asset_id = ?",
                (size_bytes, mtime_ns, self._now_ms(), asset_id),
            )
            self._conn.commit()

    def update_item_path(self, asset_id: str, rel_path: str, size_bytes: int, mtime_ns: int) -> None:
        """应用内重命名时更新路径，保留 asset_id。"""
        with self._lock:
            self._conn.execute(
                """
                UPDATE library_items
                SET rel_path = ?, size_bytes = ?, mtime_ns = ?, scanned_at = ?
                WHERE asset_id = ?
                """,
                (rel_path, size_bytes, mtime_ns, self._now_ms(), asset_id),
            )
            self._conn.commit()

    def apply_item_rename(
        self,
        asset_id: str,
        *,
        rel_path: str,
        title: str,
        size_bytes: int,
        mtime_ns: int,
    ) -> int:
        """Atomically update the library side of an app-managed rename."""
        with self._lock:
            self._conn.execute(
                """
                UPDATE library_items
                SET rel_path = ?, title = ?, size_bytes = ?, mtime_ns = ?,
                    scanned_at = ?, version = version + 1, cover_key = NULL
                WHERE asset_id = ?
                """,
                (rel_path, title, size_bytes, mtime_ns, self._now_ms(), asset_id),
            )
            self._conn.commit()
            row = self._conn.execute("SELECT version FROM library_items WHERE asset_id = ?", (asset_id,)).fetchone()
            return int(row["version"]) if row else 0

    def update_item_metadata_override(self, asset_id: str, override: dict[str, Any]) -> None:
        """存储 ZIP/文件夹的仅应用内元数据覆盖。"""
        with self._lock:
            self._conn.execute(
                "UPDATE library_items SET metadata_override = ? WHERE asset_id = ?",
                (json.dumps(override, ensure_ascii=False), asset_id),
            )
            self._conn.commit()

    def update_item_title_author_tags(
        self,
        asset_id: str,
        title: str | None = None,
        author: str | None = None,
        tags: list[str] | None = None,
    ) -> None:
        """更新 CBZ 内 ComicInfo.xml 写回后的字段。"""
        with self._lock:
            if title is not None:
                self._conn.execute(
                    "UPDATE library_items SET title = ? WHERE asset_id = ?",
                    (title, asset_id),
                )
            if author is not None:
                self._conn.execute(
                    "UPDATE library_items SET author = ? WHERE asset_id = ?",
                    (author, asset_id),
                )
            if tags is not None:
                self._conn.execute(
                    "UPDATE library_items SET tags = ? WHERE asset_id = ?",
                    (json.dumps(tags, ensure_ascii=False), asset_id),
                )
            self._conn.commit()

    # ── 章节管理 ──────────────────────────────────────────────────

    def upsert_chapter(self, chapter: dict[str, Any]) -> None:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO library_chapters (
                    chapter_id, asset_id, display_name, chapter_index,
                    rel_path, archive_prefix, page_count, page_manifest, manifest_version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(chapter_id, asset_id) DO UPDATE SET
                    display_name=excluded.display_name,
                    chapter_index=excluded.chapter_index,
                    rel_path=excluded.rel_path,
                    archive_prefix=excluded.archive_prefix,
                    page_count=excluded.page_count,
                    page_manifest=excluded.page_manifest,
                    manifest_version=excluded.manifest_version
                """,
                (
                    chapter["chapter_id"],
                    chapter["asset_id"],
                    chapter.get("display_name", ""),
                    chapter.get("chapter_index", 0),
                    chapter.get("rel_path", ""),
                    chapter.get("archive_prefix", ""),
                    chapter.get("page_count", 0),
                    json.dumps(chapter.get("page_manifest", []), ensure_ascii=False),
                    chapter.get("manifest_version", 0),
                ),
            )
            self._conn.commit()

    def replace_chapters(self, asset_id: str, chapters: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Replace an asset's chapter set while preserving IDs by relative path.

        A changed folder must not accumulate stale chapter rows, and reading
        progress should continue to point at the same chapter when its relative
        path is unchanged.
        """
        with self._lock:
            existing_rows = self._conn.execute(
                "SELECT chapter_id, rel_path FROM library_chapters WHERE asset_id = ?",
                (asset_id,),
            ).fetchall()
            existing_ids = {row["rel_path"]: row["chapter_id"] for row in existing_rows}
            normalized: list[dict[str, Any]] = []
            for chapter in chapters:
                rel_path = chapter.get("rel_path", "")
                normalized.append(
                    {
                        **chapter,
                        "asset_id": asset_id,
                        "chapter_id": existing_ids.get(rel_path) or chapter.get("chapter_id") or str(uuid.uuid4()),
                    }
                )

            try:
                self._conn.execute("DELETE FROM library_chapters WHERE asset_id = ?", (asset_id,))
                for chapter in normalized:
                    self._conn.execute(
                        """
                        INSERT INTO library_chapters (
                            chapter_id, asset_id, display_name, chapter_index,
                            rel_path, archive_prefix, page_count, page_manifest, manifest_version
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            chapter["chapter_id"],
                            asset_id,
                            chapter.get("display_name", ""),
                            chapter.get("chapter_index", 0),
                            chapter.get("rel_path", ""),
                            chapter.get("archive_prefix", ""),
                            chapter.get("page_count", 0),
                            json.dumps(chapter.get("page_manifest", []), ensure_ascii=False),
                            chapter.get("manifest_version", 0),
                        ),
                    )
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise
            return normalized

    def get_chapters(self, asset_id: str) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT * FROM library_chapters
                WHERE asset_id = ?
                ORDER BY chapter_index
                """,
                (asset_id,),
            ).fetchall()
            return [
                {
                    "chapter_id": row["chapter_id"],
                    "asset_id": row["asset_id"],
                    "display_name": row["display_name"],
                    "chapter_index": row["chapter_index"],
                    "rel_path": row["rel_path"],
                    "archive_prefix": row["archive_prefix"],
                    "page_count": row["page_count"],
                    "page_manifest": json.loads(row["page_manifest"]) if row["page_manifest"] else [],
                    "manifest_version": row["manifest_version"],
                }
                for row in rows
            ]

    def get_chapter(self, asset_id: str, chapter_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                """
                SELECT * FROM library_chapters
                WHERE asset_id = ? AND chapter_id = ?
                """,
                (asset_id, chapter_id),
            ).fetchone()
            if not row:
                return None
            return {
                "chapter_id": row["chapter_id"],
                "asset_id": row["asset_id"],
                "display_name": row["display_name"],
                "chapter_index": row["chapter_index"],
                "rel_path": row["rel_path"],
                "archive_prefix": row["archive_prefix"],
                "page_count": row["page_count"],
                "page_manifest": json.loads(row["page_manifest"]) if row["page_manifest"] else [],
                "manifest_version": row["manifest_version"],
            }

    def set_chapter_manifest(self, asset_id: str, chapter_id: str, manifest: list[dict], manifest_version: int) -> None:
        with self._lock:
            self._conn.execute(
                """
                UPDATE library_chapters
                SET page_manifest = ?, manifest_version = ?
                WHERE asset_id = ? AND chapter_id = ?
                """,
                (json.dumps(manifest, ensure_ascii=False), manifest_version, asset_id, chapter_id),
            )
            self._conn.commit()

    # ── 阅读进度 ──────────────────────────────────────────────────

    def save_reading_progress(self, asset_id: str, chapter_id: str | None, page: int, total_pages: int) -> None:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO library_reading_progress
                    (asset_id, chapter_id, page, total_pages, last_read_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(asset_id) DO UPDATE SET
                    chapter_id=excluded.chapter_id,
                    page=excluded.page,
                    total_pages=excluded.total_pages,
                    last_read_at=excluded.last_read_at
                """,
                (asset_id, chapter_id, page, total_pages, self._now_ms()),
            )
            # 同步更新 library_items 的 last_read_at（用于排序和列表展示）
            self._conn.execute(
                "UPDATE library_items SET last_read_at = ? WHERE asset_id = ?",
                (self._now_ms(), asset_id),
            )
            self._conn.commit()

    def get_reading_progress(self, asset_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM library_reading_progress WHERE asset_id = ?", (asset_id,)
            ).fetchone()
            if not row:
                return None
            return {
                "asset_id": row["asset_id"],
                "chapter_id": row["chapter_id"],
                "page": row["page"],
                "total_pages": row["total_pages"],
                "last_read_at": row["last_read_at"],
            }

    def delete_reading_progress(self, asset_id: str) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM library_reading_progress WHERE asset_id = ?", (asset_id,))
            self._conn.commit()
            return cur.rowcount > 0

    # ── 分页查询 ──────────────────────────────────────────────────

    def query_items(
        self,
        *,
        page: int = 1,
        page_size: int = 50,
        query: str = "",
        source_site: str = "",
        fmt: str = "",
        health_status: str = "",
        sort: str = "recent_added",
    ) -> tuple[list[dict[str, Any]], int]:
        """分页查询资产摘要，返回 (items, total_count)。

        支持标题/作者/标签关键字搜索、来源/格式/健康状态筛选。
        排序使用资产 ID 作为次级键保证稳定性。
        """
        where_clauses: list[str] = ["root_generation = ?"]
        params: list[Any] = [self.get_root_generation()]

        if query:
            where_clauses.append("(title LIKE ? OR author LIKE ? OR tags LIKE ?)")
            like = f"%{query}%"
            params.extend([like, like, like])
        if source_site:
            where_clauses.append("source_site = ?")
            params.append(source_site)
        if fmt:
            where_clauses.append("format = ?")
            params.append(fmt)
        if health_status:
            where_clauses.append("health_status = ?")
            params.append(health_status)

        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        sort_map = {
            "recent_added": "created_at DESC, asset_id",
            "recent_read": "last_read_at IS NULL, last_read_at DESC, asset_id",
            "title": "title, asset_id",
            "size": "size_bytes DESC, asset_id",
            "mtime": "mtime_ns DESC, asset_id",
        }
        order_by = sort_map.get(sort, sort_map["recent_added"])

        with self._lock:
            count_row = self._conn.execute(f"SELECT COUNT(*) as cnt FROM library_items {where_sql}", params).fetchone()
            total = int(count_row["cnt"])

            offset = max(0, (page - 1) * page_size)
            rows = self._conn.execute(
                f"""
                SELECT * FROM library_items {where_sql}
                ORDER BY {order_by}
                LIMIT ? OFFSET ?
                """,
                (*params, page_size, offset),
            ).fetchall()

        items = [self._row_to_summary(row) for row in rows]
        return items, total

    def _row_to_summary(self, row: sqlite3.Row) -> dict[str, Any]:
        override = json.loads(row["metadata_override"]) if row["metadata_override"] else {}
        return {
            "assetId": row["asset_id"],
            "title": row["title"],
            "author": row["author"],
            "tags": json.loads(row["tags"]) if row["tags"] else [],
            "sourceSite": row["source_site"],
            "format": row["format"],
            "pageCount": row["page_count"],
            "sizeBytes": row["size_bytes"],
            "isAlbum": bool(row["is_album"]),
            "chapterCount": row["chapter_count"],
            "coverKey": row["cover_key"],
            "healthStatus": row["health_status"],
            "lastReadAt": row["last_read_at"],
            "createdAt": row["created_at"],
            "metadataOverridden": bool(override),
        }

    def get_stats(self) -> dict[str, Any]:
        """获取漫画库统计信息。"""
        root_generation = self.get_root_generation()
        with self._lock:
            total_row = self._conn.execute(
                "SELECT COUNT(*) as cnt, COALESCE(SUM(page_count), 0) as pages, "
                "COALESCE(SUM(size_bytes), 0) as size FROM library_items WHERE root_generation = ?",
                (root_generation,),
            ).fetchone()
            fmt_rows = self._conn.execute(
                "SELECT format, COUNT(*) as cnt FROM library_items WHERE root_generation = ? GROUP BY format",
                (root_generation,),
            ).fetchall()
            source_rows = self._conn.execute(
                "SELECT source_site, COUNT(*) as cnt FROM library_items WHERE root_generation = ? GROUP BY source_site",
                (root_generation,),
            ).fetchall()
            health_rows = self._conn.execute(
                "SELECT health_status, COUNT(*) as cnt FROM library_items WHERE root_generation = ? GROUP BY health_status",
                (root_generation,),
            ).fetchall()

        by_format = {"cbz": 0, "zip": 0, "folder": 0}
        for r in fmt_rows:
            by_format[r["format"]] = int(r["cnt"])

        by_source = {r["source_site"]: int(r["cnt"]) for r in source_rows}
        by_health = {r["health_status"]: int(r["cnt"]) for r in health_rows}

        return {
            "totalAssets": int(total_row["cnt"]),
            "totalPages": int(total_row["pages"]),
            "totalSizeBytes": int(total_row["size"]),
            "byFormat": by_format,
            "bySource": by_source,
            "byHealth": by_health,
        }

    def get_all_items_for_reconcile(self, root_generation: int) -> list[dict[str, Any]]:
        """获取指定 generation 的所有资产（用于增量判定）。"""
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM library_items WHERE root_generation = ?", (root_generation,)
            ).fetchall()
        return [self._row_to_item(row) for row in rows]


def get_default_library_db_path() -> str:
    """获取漫画库索引数据库路径，支持统一应用数据目录覆盖。"""
    data_dir = Path(os.environ.get("HCOMIC_CONFIG_DIR") or Path.home() / ".hcomic_downloader")
    return str(data_dir / "library.db")
