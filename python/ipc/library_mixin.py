"""漫画库 IPC mixin — 漫画库索引、查询、扫描和阅读进度接口。

接入 ``LibraryDB`` 索引和 ``LibraryIndexer`` 扫描生命周期，
通过 JSON-RPC 向渲染进程暴露漫画库列表、详情、章节、扫描状态、
阅读进度以及后续的资产操作（封面/页面/管理）。
"""

from __future__ import annotations

import contextlib
import logging
import os
import sys
import threading
import time
import uuid
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from config import Config
    from download_history import DownloadHistoryDB

from ipc.library_cache import LibraryImageCache, LibraryPageReader
from library_db import LibraryDB, get_default_library_db_path
from library_indexer import LibraryIndexer

logger = logging.getLogger(__name__)

# 删除准备令牌 TTL（秒）
_DELETE_TOKEN_TTL = 300  # 5 分钟


class LibraryMixin:
    """Mixin providing library catalog and asset management handlers."""

    config: Config
    _history_db: DownloadHistoryDB
    _write_response: Callable[[dict], None]

    def _init_library(self) -> None:
        """初始化漫画库索引数据库和索引器。"""
        db_path = get_default_library_db_path()
        self._library_db = LibraryDB(db_path)
        self._library_indexer: LibraryIndexer | None = None
        self._delete_tokens: dict[str, dict[str, Any]] = {}
        self._reveal_tokens: dict[str, dict[str, Any]] = {}
        # Token cleanup is called while preparing a token, so this must be
        # re-entrant (prepare holds the guard and cleanup prunes expired rows).
        self._delete_tokens_lock = threading.RLock()
        self._asset_mutation_locks: dict[str, threading.Lock] = {}
        self._asset_mutation_locks_guard = threading.Lock()
        # 图片缓存和页面读取器
        self._library_cache = LibraryImageCache()
        self._library_page_reader: LibraryPageReader | None = None
        self._library_reader_lock = threading.Lock()

    def _get_page_reader(self) -> LibraryPageReader:
        """获取或延迟创建页面读取器（download_dir 可能变更）。"""
        with self._library_reader_lock:
            if self._library_page_reader is None or self._library_page_reader._download_dir != os.path.realpath(
                self.config.download_dir
            ):
                self._library_page_reader = LibraryPageReader(
                    self._library_db,
                    self.config.download_dir,
                    self._library_cache,
                )
            return self._library_page_reader

    def _get_indexer(self) -> LibraryIndexer:
        """获取或延迟创建索引器（download_dir 可能变更）。"""
        if self._library_indexer is None or self._library_indexer.download_dir != os.path.realpath(
            self.config.download_dir
        ):
            self._library_indexer = LibraryIndexer(
                self._library_db,
                self.config.download_dir,
                history_db=self._history_db,
                progress_callback=self._emit_library_scan_progress,
            )
        return self._library_indexer

    def _emit_library_scan_progress(self, phase: str, current: int, total: int, label: str) -> None:
        """发送漫画库扫描进度通知。

        使用独立的通知方法名 ``library_scan_progress``，不覆盖下载或维护进度。
        """
        notification = {
            "jsonrpc": "2.0",
            "method": "library_scan_progress",
            "params": {
                "phase": phase,
                "current": current,
                "total": total,
                "label": label,
            },
        }
        self._write_response(notification)
        sys.stdout.flush()

    # ── 资产级互斥锁 ───────────────────────────────────────────────

    def _get_asset_lock(self, asset_id: str) -> threading.Lock:
        with self._asset_mutation_locks_guard:
            if asset_id not in self._asset_mutation_locks:
                self._asset_mutation_locks[asset_id] = threading.Lock()
            return self._asset_mutation_locks[asset_id]

    @staticmethod
    def _paths_overlap(first: str, second: str) -> bool:
        """Return whether two paths are equal or one contains the other."""
        first_norm = os.path.normcase(os.path.abspath(first))
        second_norm = os.path.normcase(os.path.abspath(second))
        try:
            common = os.path.commonpath([first_norm, second_norm])
        except ValueError:
            return False
        return common in {first_norm, second_norm}

    def _assert_asset_not_busy(self, real_path: str) -> None:
        """Reject mutations that conflict with scanning, migration or downloads."""
        indexer = self._get_indexer()
        if indexer.is_scanning():
            raise ValueError("漫画库正在扫描，请等待扫描完成或先取消扫描")
        if hasattr(self, "_is_migration_occupied") and self._is_migration_occupied():
            raise ValueError("下载目录正在迁移，暂时不能修改漫画资产")

        manager = getattr(self, "_download_manager", None)
        for task in getattr(manager, "tasks", {}).values():
            status = getattr(getattr(task, "status", None), "value", "")
            if status not in {"queued", "downloading", "pausing", "paused"}:
                continue
            candidates: list[str] = []
            temp_dir = getattr(task, "temp_dir", None)
            if temp_dir:
                candidates.append(temp_dir)
            try:
                candidates.append(
                    self.cbz_builder.get_output_path_for_format(
                        task.comic,
                        self.config.output_format,
                        self.config.download_dir,
                    )
                )
            except Exception:
                logger.debug("Unable to resolve active task output path", exc_info=True)
            if any(self._paths_overlap(real_path, candidate) for candidate in candidates if candidate):
                raise ValueError("该漫画正在下载或打包，暂时不能修改")

    @contextlib.contextmanager
    def _asset_mutation(self, asset_id: str, expected_version: int):
        """Acquire the asset mutation lock and revalidate current disk state."""
        lock = self._get_asset_lock(asset_id)
        if not lock.acquire(blocking=False):
            raise ValueError("该漫画正在执行其他操作")
        try:
            real_path = self._resolve_asset_path(asset_id, expected_version)
            if not real_path:
                raise ValueError("资产不可访问、已变化或版本不匹配，请刷新漫画库")
            self._assert_asset_not_busy(real_path)
            yield real_path
        finally:
            lock.release()

    # ── 查询接口 ───────────────────────────────────────────────────

    def handle_library_list(
        self,
        page: int = 1,
        page_size: int = 50,
        query: str = "",
        source_site: str = "",
        format: str = "",
        health_status: str = "",
        sort: str = "recent_added",
    ) -> dict:
        """分页查询漫画库资产列表。"""
        items, total = self._library_db.query_items(
            page=max(1, page),
            page_size=min(200, max(1, page_size)),
            query=query,
            source_site=source_site,
            fmt=format,
            health_status=health_status,
            sort=sort,
        )
        return {
            "items": items,
            "pagination": {
                "currentPage": max(1, page),
                "totalPages": (total + page_size - 1) // max(1, page_size) if total > 0 else 0,
                "totalItems": total,
            },
        }

    def handle_library_stats(self) -> dict:
        """返回漫画库统计信息。"""
        return self._library_db.get_stats()

    def handle_library_detail(self, asset_id: str) -> dict:
        """返回资产详情。"""
        item = self._library_db.get_item_with_progress(asset_id)
        if not item:
            raise ValueError(f"资产不存在: {asset_id}")
        if item["root_generation"] != self._library_db.get_root_generation():
            raise ValueError("资产属于旧漫画库，请刷新")

        chapters = self._library_db.get_chapters(asset_id)

        return {
            "assetId": item["asset_id"],
            "title": item["title"],
            "author": item["author"],
            "tags": item["tags"],
            "sourceSite": item["source_site"],
            "comicId": item["comic_id"],
            "comicSource": item["comic_source"],
            "albumId": item["album_id"],
            "albumTotalChapters": item["album_total_chapters"],
            "format": item["format"],
            "pageCount": item["page_count"],
            "sizeBytes": item["size_bytes"],
            "modifiedAt": item["mtime_ns"] // 1_000_000 if item["mtime_ns"] else 0,
            "chapters": [
                {
                    "chapterId": ch["chapter_id"],
                    "name": ch["display_name"],
                    "index": ch["chapter_index"],
                    "pageCount": ch["page_count"],
                }
                for ch in chapters
            ],
            "coverKey": item["cover_key"],
            "healthStatus": item["health_status"],
            "lastReadAt": item.get("last_read_at"),
            "readingPage": item.get("reading_page"),
            "readingChapterId": item.get("reading_chapter_id"),
            "pathSummary": item["rel_path"],
            "metadataOverridden": bool(item.get("metadata_override")),
            "version": item["version"],
        }

    def handle_library_chapters(self, asset_id: str) -> dict:
        """返回资产章节列表。"""
        chapters = self._library_db.get_chapters(asset_id)
        item = self._library_db.get_item(asset_id)
        if not item or item["root_generation"] != self._library_db.get_root_generation():
            raise ValueError("资产不存在或属于旧漫画库")
        version = item["version"]
        return {
            "chapters": [
                {
                    "chapterId": ch["chapter_id"],
                    "name": ch["display_name"],
                    "index": ch["chapter_index"],
                    "pageCount": ch["page_count"],
                }
                for ch in chapters
            ],
            "version": version,
        }

    # ── 扫描接口 ───────────────────────────────────────────────────

    def handle_library_scan_status(self) -> dict:
        """返回当前扫描状态。"""
        return self._library_db.get_scan_state()

    def handle_library_start_scan(self) -> dict:
        """启动完整扫描。"""
        indexer = self._get_indexer()
        if indexer.is_scanning():
            state = self._library_db.get_scan_state()
            return {
                "scanId": state.get("scanId") or "",
                "started": False,
                "alreadyRunning": True,
            }
        scan_id = indexer.start_scan()
        return {
            "scanId": scan_id,
            "started": True,
            "alreadyRunning": False,
        }

    def handle_library_cancel_scan(self) -> dict:
        """取消当前扫描。"""
        indexer = self._get_indexer()
        cancelled = indexer.cancel_scan()
        state = self._library_db.get_scan_state()
        return {
            "cancelled": cancelled,
            "scanId": state.get("scanId"),
        }

    # ── 阅读进度接口 ───────────────────────────────────────────────

    def handle_library_get_reading_progress(self, asset_id: str) -> dict | None:
        """获取阅读进度。"""
        progress = self._library_db.get_reading_progress(asset_id)
        if not progress:
            return None
        return {
            "assetId": progress["asset_id"],
            "chapterId": progress.get("chapter_id"),
            "page": progress["page"],
            "totalPages": progress["total_pages"],
            "lastReadAt": progress["last_read_at"],
        }

    def handle_library_save_reading_progress(
        self,
        asset_id: str,
        chapter_id: str | None = None,
        page: int = 1,
        total_pages: int = 0,
    ) -> dict:
        """保存阅读进度。"""
        item = self._library_db.get_item(asset_id)
        if not item or item["root_generation"] != self._library_db.get_root_generation():
            raise ValueError("资产不存在或属于旧漫画库")
        actual_total = item["page_count"]
        if chapter_id:
            chapter = self._library_db.get_chapter(asset_id, chapter_id)
            if not chapter:
                raise ValueError("章节不存在")
            actual_total = chapter["page_count"]
        bounded_total = max(0, actual_total or total_pages)
        bounded_page = min(max(1, page), max(1, bounded_total))
        self._library_db.save_reading_progress(asset_id, chapter_id, bounded_page, bounded_total)
        return {"success": True}

    # ── 封面与页面交付接口 ─────────────────────────────────────────

    def handle_library_cover(self, asset_id: str) -> dict:
        """按需提取封面。"""
        reader = self._get_page_reader()
        result = reader.extract_cover(asset_id)
        if not result:
            raise ValueError(f"无法提取封面: {asset_id}")
        return {
            "coverKey": result["cover_key"],
            "mediaType": result["media_type"],
        }

    def handle_library_page_manifest(self, asset_id: str, chapter_id: str | None = None) -> dict:
        """获取章节页面 manifest。"""
        reader = self._get_page_reader()
        result = reader.get_page_manifest(asset_id, chapter_id)
        if not result:
            raise ValueError(f"无法生成页面清单: {asset_id}")
        return result

    def handle_library_get_page(
        self,
        asset_id: str,
        chapter_id: str | None = None,
        page: int = 1,
        version: int = 1,
    ) -> dict:
        """物化单页图片到缓存。"""
        reader = self._get_page_reader()
        result = reader.materialize_page(asset_id, chapter_id, page, version)
        if not result:
            raise ValueError(f"无法获取页面: asset={asset_id} page={page} version={version}")
        return result

    # ── 下载完成增量索引钩子 ───────────────────────────────────────

    def index_completed_download(self, output_path: str) -> str | None:
        """下载最终产物落盘后触发单路径增量索引。

        下载未完成和临时目录阶段禁止入库——只有最终原子产物可见时调用。
        """
        indexer = self._get_indexer()
        return indexer.index_single_path(output_path)

    # ── 目录迁移完成 root generation 切换 ───────────────────────────

    def on_download_dir_migrated(self) -> None:
        """下载目录迁移成功后切换 root generation 并触发完整重建。

        迁移失败/取消时不调用此方法。
        """
        self._library_db.bump_root_generation()
        self._library_indexer = None  # 强制重建索引器以指向新目录
        indexer = self._get_indexer()
        indexer.start_scan()

    # ── 资产管理接口 ───────────────────────────────────────────────

    def handle_library_reveal_asset(self, asset_id: str, expected_version: int) -> dict:
        """在文件管理器中定位资产。

        Python 权威解析路径后生成一次性 reveal token，
        路径**不**通过 IPC 响应返回给渲染进程。
        Electron 主进程通过 ``library_execute_reveal`` 内部方法取回路径。
        """
        real_path = self._resolve_asset_path(asset_id, expected_version)
        if not real_path:
            raise ValueError("资产不可访问或版本不匹配")

        token = str(uuid.uuid4())
        with self._delete_tokens_lock:
            self._reveal_tokens[token] = {
                "real_path": real_path,
                "created_at": time.time(),
            }
        return {"success": True, "revealToken": token}

    def handle_library_execute_reveal(self, reveal_token: str) -> dict:
        """Electron 主进程专用：用一次性 reveal token 取回路径并调用 shell。

        此方法**不**注册到渲染进程可达的 HcomicAPI——仅在 main.ts 内部调用。
        token 使用后立即失效。
        """
        with self._delete_tokens_lock:
            token_info = self._reveal_tokens.pop(reveal_token, None)
        if not token_info:
            raise ValueError("无效或已过期的 reveal token")
        return {"success": True, "resolved_path": token_info["real_path"]}

    def handle_library_health_check(self, asset_id: str, expected_version: int) -> dict:
        """对单个资产运行健康检查，复用现有 HealthChecker 逻辑。"""
        from maintenance.health_checker import HealthChecker

        with self._asset_mutation(asset_id, expected_version) as real_path:
            item = self._library_db.get_item(asset_id)
            record = {
                "source_site": item.get("source_site", ""),
                "comic_id": item.get("comic_id", "") or asset_id,
                "comic_source": item.get("comic_source", ""),
                "album_id": item.get("album_id", "") or asset_id,
                "title": item.get("title", ""),
                "output_path": real_path,
                "output_format": item["format"],
                "pages": item.get("page_count", 0),
            }
            checked = HealthChecker(self._history_db, self.config.download_dir).check_asset(record)
            issues = checked.checks

        health = "healthy" if not issues else "warning"
        self._library_db.update_item_health(asset_id, health)

        return {"assetId": asset_id, "healthy": not issues, "issues": issues}

    def handle_library_prepare_delete(self, asset_id: str, expected_version: int) -> dict:
        """准备删除：验证资产并生成一次性 operation token。

        路径不返回渲染进程。Token 供 commit 阶段使用。
        """
        real_path = self._resolve_asset_path(asset_id, expected_version)
        if not real_path:
            raise ValueError("资产不可访问或版本不匹配")
        self._assert_asset_not_busy(real_path)

        item = self._library_db.get_item(asset_id)
        size = 0
        if os.path.isfile(real_path):
            size = os.path.getsize(real_path)
        elif os.path.isdir(real_path):
            from python.maintenance.scanner import _dir_size

            size = _dir_size(real_path)

        token = str(uuid.uuid4())
        with self._delete_tokens_lock:
            self._cleanup_expired_tokens()
            self._delete_tokens[token] = {
                "asset_id": asset_id,
                "real_path": real_path,
                "expected_version": expected_version,
                "created_at": time.time(),
            }

        return {
            "token": token,
            "title": item["title"],
            "format": item["format"],
            "sizeBytes": size,
            "isAlbum": item["is_album"],
        }

    def handle_library_commit_delete(self, token: str) -> dict:
        """提交删除——由 Electron 主进程在 shell.trashItem 成功后调用。

        删除索引、页 manifest/缓存和精确匹配的下载历史关联。
        路径通过 ``library_execute_delete`` 取回，不经过渲染进程。
        """
        with self._delete_tokens_lock:
            token_info = self._delete_tokens.pop(token, None)

        if not token_info:
            raise ValueError("无效或已过期的删除令牌")

        asset_id = token_info["asset_id"]
        lock = token_info.get("lock")
        try:
            item = self._library_db.get_item(asset_id)
            freed = item["size_bytes"] if item else 0
            self._library_db.delete_item(asset_id)
            if item and self._history_db:
                self._cleanup_history_for_deleted_item(item, token_info["real_path"])
        finally:
            if lock and lock.locked():
                lock.release()

        return {"success": True, "freedBytes": freed}

    def handle_library_execute_delete(self, token: str) -> dict:
        """Electron 主进程专用：用一次性 delete token 取回路径供 shell.trashItem。

        此方法**不**注册到渲染进程可达的 HcomicAPI——仅在 main.ts 内部调用。
        token 在 commit 阶段消费，此方法只读取不消费。
        """
        with self._delete_tokens_lock:
            token_info = self._delete_tokens.get(token)
        if not token_info:
            raise ValueError("无效或已过期的删除令牌")
        real_path = self._resolve_asset_path(token_info["asset_id"], token_info["expected_version"])
        if not real_path or real_path != token_info["real_path"]:
            raise ValueError("资产已变化，请重新确认删除")
        self._assert_asset_not_busy(real_path)
        lock = self._get_asset_lock(token_info["asset_id"])
        if not lock.acquire(blocking=False):
            raise ValueError("该漫画正在执行其他操作")
        token_info["lock"] = lock
        return {"success": True, "resolved_path": token_info["real_path"]}

    def handle_library_abort_delete(self, token: str) -> dict:
        """Release a reserved delete after ``shell.trashItem`` fails."""
        with self._delete_tokens_lock:
            token_info = self._delete_tokens.pop(token, None)
        lock = token_info.get("lock") if token_info else None
        if lock and lock.locked():
            lock.release()
        return {"success": True}

    def handle_library_rename(
        self,
        asset_id: str,
        new_name: str,
        rename_file: bool,
        expected_version: int,
    ) -> dict:
        """安全重命名资产显示名称和可选磁盘文件。"""
        with self._asset_mutation(asset_id, expected_version) as real_path:
            return self._rename_library_asset(asset_id, real_path, new_name, rename_file)

    def _rename_library_asset(self, asset_id: str, real_path: str, new_name: str, rename_file: bool) -> dict:
        """Perform a rename while the caller holds the asset mutation lock."""
        item = self._library_db.get_item(asset_id)
        if not item:
            raise ValueError("资产不存在")

        # 文件名清理：禁止路径分隔符和保留名
        import re

        safe_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", new_name).strip()
        if not safe_name:
            raise ValueError("无效的新名称")
        # Windows 保留名检查
        win_reserved = (
            {"CON", "PRN", "AUX", "NUL"} | {f"COM{i}" for i in range(1, 10)} | {f"LPT{i}" for i in range(1, 10)}
        )
        if safe_name.upper().split(".")[0] in win_reserved:
            raise ValueError("名称为系统保留名")

        new_version = item["version"]
        if rename_file:
            # 构建目标路径
            ext = os.path.splitext(real_path)[1]
            if ext and safe_name.lower().endswith(ext.lower()):
                safe_name = safe_name[: -len(ext)].rstrip()
            if not safe_name:
                raise ValueError("无效的新名称")
            root = os.path.realpath(self.config.download_dir)
            new_rel_path = safe_name + ext if item["format"] != "folder" else safe_name
            new_abs_path = os.path.join(root, new_rel_path)

            # 冲突检查
            if os.path.exists(new_abs_path):
                raise ValueError("目标名称已存在")

            history_moved = False
            try:
                os.rename(real_path, new_abs_path)
                if self._history_db:
                    self._history_db.move_records_for_output_path(
                        real_path,
                        new_abs_path,
                        include_descendants=item["format"] == "folder",
                    )
                    history_moved = True
                stat = os.stat(new_abs_path)
                size_bytes = stat.st_size if os.path.isfile(new_abs_path) else item["size_bytes"]
                new_version = self._library_db.apply_item_rename(
                    asset_id,
                    rel_path=new_rel_path,
                    title=safe_name,
                    size_bytes=size_bytes,
                    mtime_ns=stat.st_mtime_ns,
                )
            except Exception as e:
                if history_moved and self._history_db:
                    with contextlib.suppress(Exception):
                        self._history_db.move_records_for_output_path(
                            new_abs_path,
                            real_path,
                            include_descendants=item["format"] == "folder",
                        )
                if os.path.exists(new_abs_path) and not os.path.exists(real_path):
                    with contextlib.suppress(OSError):
                        os.rename(new_abs_path, real_path)
                raise ValueError(f"重命名失败，已回滚: {e}") from e
        else:
            self._library_db.update_item_title_author_tags(asset_id, title=safe_name)
            new_version = self._library_db.bump_item_version(asset_id)

        return {
            "success": True,
            "assetId": asset_id,
            "newPathSummary": safe_name,
            "version": new_version,
        }

    def handle_library_edit_metadata(
        self,
        asset_id: str,
        fields: dict[str, str | list[str]],
        expected_version: int,
    ) -> dict:
        """编辑资产元数据。

        CBZ：写入 ComicInfo.xml 并原子替换。
        ZIP/文件夹：仅索引覆盖值。
        """
        with self._asset_mutation(asset_id, expected_version) as real_path:
            return self._edit_library_metadata(asset_id, real_path, fields)

    def _edit_library_metadata(self, asset_id: str, real_path: str, fields: dict[str, Any]) -> dict:
        """Edit metadata while the caller holds the asset mutation lock."""
        allowed = {"title", "author", "tags"}
        if set(fields) - allowed:
            raise ValueError("包含不支持的元数据字段")
        for key in ("title", "author"):
            if key in fields and (not isinstance(fields[key], str) or len(fields[key]) > 500):
                raise ValueError(f"无效的 {key} 字段")
        if "tags" in fields:
            tags = fields["tags"]
            if (
                not isinstance(tags, list)
                or len(tags) > 200
                or any(not isinstance(tag, str) or len(tag) > 200 for tag in tags)
            ):
                raise ValueError("无效的 tags 字段")

        item = self._library_db.get_item(asset_id)
        if not item:
            raise ValueError("资产不存在")

        written_to_file = False

        if item["format"] == "cbz":
            # CBZ 元数据编辑：同目录临时文件原子替换
            try:
                written_to_file = self._rewrite_cbz_metadata(real_path, fields)
            except Exception as e:
                logger.warning("CBZ metadata rewrite failed: %s", e)
                raise ValueError(f"元数据写回失败: {e}") from e

            if written_to_file:
                stat = os.stat(real_path)
                self._library_db.update_item_file_stat(asset_id, stat.st_size, stat.st_mtime_ns)
                # 更新索引中的字段
                self._library_db.update_item_title_author_tags(
                    asset_id,
                    title=fields.get("title") if isinstance(fields.get("title"), str) else None,
                    author=fields.get("author") if isinstance(fields.get("author"), str) else None,
                    tags=fields["tags"] if isinstance(fields.get("tags"), list) else None,
                )
        else:
            # ZIP/文件夹：仅索引覆盖
            override: dict[str, Any] = {}
            if "title" in fields:
                override["title"] = fields["title"]
            if "author" in fields:
                override["author"] = fields["author"]
            if "tags" in fields:
                override["tags"] = fields["tags"]
            self._library_db.update_item_metadata_override(asset_id, override)

            if "title" in fields:
                self._library_db.update_item_title_author_tags(asset_id, title=fields["title"])
            if "author" in fields:
                self._library_db.update_item_title_author_tags(asset_id, author=fields["author"])
            if "tags" in fields:
                self._library_db.update_item_title_author_tags(asset_id, tags=fields["tags"])

        # 递增版本令牌使缓存失效
        new_version = self._library_db.bump_item_version(asset_id)

        return {
            "success": True,
            "assetId": asset_id,
            "writtenToFile": written_to_file,
            "version": new_version,
        }

    def _rewrite_cbz_metadata(self, cbz_path: str, fields: dict[str, Any]) -> bool:
        """重写 CBZ 内的 ComicInfo.xml，保留所有原条目。

        使用同目录临时文件，testzip 校验后 os.replace。
        """
        import shutil
        import tempfile
        import zipfile as zf_module
        from xml.etree import ElementTree as ET

        # 读取原始 ComicInfo.xml
        with zf_module.ZipFile(cbz_path, "r") as zf:
            infos = zf.infolist()
            names = [info.filename for info in infos]
            comic_info_xml = zf.read("ComicInfo.xml") if "ComicInfo.xml" in names else None
            source_page_count = sum(
                1
                for info in infos
                if os.path.splitext(info.filename)[1].lower()
                in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".ico"}
            )

        # 构建/更新 ComicInfo.xml
        root = ET.fromstring(comic_info_xml) if comic_info_xml else ET.Element("ComicInfo")

        if isinstance(fields.get("title"), str) and fields["title"]:
            for tag in ("Title", "Series"):
                elem = root.find(tag)
                if elem is None:
                    elem = ET.SubElement(root, tag)
                elem.text = fields["title"]
        if isinstance(fields.get("author"), str) and fields["author"]:
            elem = root.find("Writer")
            if elem is None:
                elem = ET.SubElement(root, "Writer")
            elem.text = fields["author"]
        if isinstance(fields.get("tags"), list):
            elem = root.find("Tags")
            if elem is None:
                elem = ET.SubElement(root, "Tags")
            elem.text = ", ".join(fields["tags"])

        new_xml = ET.tostring(root, encoding="unicode", xml_declaration=False)
        new_xml_bytes = f'<?xml version="1.0" encoding="UTF-8"?>\n{new_xml}'.encode()

        # 同目录临时文件
        cbz_dir = os.path.dirname(cbz_path)
        required_free = os.path.getsize(cbz_path) + 1024 * 1024
        if shutil.disk_usage(cbz_dir).free < required_free:
            raise OSError("可用磁盘空间不足，无法安全重写 CBZ")
        tmp_fd, tmp_path = tempfile.mkstemp(dir=cbz_dir, prefix="tmp_edit_", suffix=".cbz")
        try:
            with (
                os.fdopen(tmp_fd, "wb") as tmp_file,
                zf_module.ZipFile(cbz_path, "r") as src,
                zf_module.ZipFile(tmp_file, "w", zf_module.ZIP_DEFLATED) as dst,
            ):
                wrote_comic_info = False
                for info in src.infolist():
                    if info.filename == "ComicInfo.xml":
                        if wrote_comic_info:
                            continue
                        dst.writestr(info, new_xml_bytes)
                        wrote_comic_info = True
                    else:
                        dst.writestr(info, src.read(info))
                if not wrote_comic_info:
                    dst.writestr("ComicInfo.xml", new_xml_bytes)

            # testzip 校验
            with zf_module.ZipFile(tmp_path, "r") as zf:
                bad_entry = zf.testzip()
                if bad_entry:
                    raise zf_module.BadZipFile(f"损坏条目: {bad_entry}")
                output_page_count = sum(
                    1
                    for name in zf.namelist()
                    if os.path.splitext(name)[1].lower() in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".ico"}
                )
                if output_page_count != source_page_count:
                    raise zf_module.BadZipFile("重写后图片页数不一致")

            # 原子替换
            os.replace(tmp_path, cbz_path)
            return True
        except Exception:
            with contextlib.suppress(OSError):
                os.remove(tmp_path)
            raise

    def _cleanup_history_for_deleted_item(self, item: dict, real_path: str) -> None:
        """清理已删除资产的精确匹配下载历史关联。"""
        removed = self._history_db.delete_records_for_output_path(
            real_path,
            include_descendants=item.get("format") == "folder",
        )
        logger.info("Removed %d download history rows for library asset %s", removed, item["asset_id"])

    # ── 生命周期辅助方法（供其他 mixin 调用）────────────────────────

    def _resolve_asset_path(self, asset_id: str, expected_version: int) -> str | None:
        """解析资产的真实磁盘路径，验证版本和根目录包含关系。

        路径不返回给渲染进程；此方法仅在主进程内部使用。
        """
        item = self._library_db.get_item(asset_id)
        if not item:
            return None
        if item["version"] != expected_version:
            return None
        if item["root_generation"] != self._library_db.get_root_generation():
            return None
        abs_path = os.path.join(os.path.realpath(self.config.download_dir), item["rel_path"])
        try:
            real_path = os.path.realpath(abs_path)
            root = os.path.realpath(self.config.download_dir)
            if real_path != root and not real_path.startswith(root + os.sep):
                return None
        except Exception:
            return None
        if not os.path.exists(real_path):
            return None
        try:
            stat = os.stat(real_path)
        except OSError:
            return None
        if item["format"] in ("cbz", "zip") and (
            stat.st_size != item["size_bytes"] or stat.st_mtime_ns != item["mtime_ns"]
        ):
            return None
        if item["format"] == "folder" and stat.st_mtime_ns != item["mtime_ns"]:
            return None
        return real_path

    # ── 清理过期删除令牌 ───────────────────────────────────────────

    def _cleanup_expired_tokens(self) -> None:
        now = time.time()
        with self._delete_tokens_lock:
            expired = [
                token for token, info in self._delete_tokens.items() if now - info["created_at"] > _DELETE_TOKEN_TTL
            ]
            for token in expired:
                token_info = self._delete_tokens.pop(token)
                lock = token_info.get("lock")
                if lock and lock.locked():
                    lock.release()
