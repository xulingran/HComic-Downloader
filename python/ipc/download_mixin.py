"""Download management mixin for IPCServer."""

from __future__ import annotations

import contextlib
import logging
import os
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from concurrent.futures import ThreadPoolExecutor

    from cbz_builder import CBZBuilder
    from config import Config
    from download_history import DownloadHistoryDB
    from download_manager import ComicDownloadManager

logger = logging.getLogger(__name__)


class DownloadMixin:
    """Mixin providing all download management handler methods."""

    _history_db: DownloadHistoryDB
    config: Config
    _write_response: Callable[[dict], None]
    _download_manager: ComicDownloadManager
    cbz_builder: CBZBuilder
    _cover_executor: ThreadPoolExecutor
    _preview_executor: ThreadPoolExecutor
    _build_and_prepare_comic: Callable[[dict, str | None], Any]
    _comic_to_dict: Callable[[Any], dict]

    def _on_download_update(self, task):
        """Send download progress as JSON-RPC notification to stdout."""
        current = task.progress_current
        total = task.progress_total
        # Defensive: ensure current never exceeds total to avoid IPC validation errors
        if total > 0 and current > total:
            logger.warning(
                "progress current (%d) exceeds total (%d) for task %s, clamping",
                current,
                total,
                task.task_id,
            )
            current = total
        notification = {
            "jsonrpc": "2.0",
            "method": "download_progress",
            "params": {
                "taskId": task.task_id,
                "status": task.status.value,
                "progress": task.progress_percentage,
                "current": current,
                "total": total,
                "title": task.comic.title,
            },
        }
        self._write_response(notification)

    def _on_download_success_record(self, comic, output_path: str, output_format: str):
        """Record a successful download to the history database."""
        try:
            self._history_db.record_download(comic, output_path, output_format)
            logger.info("Recorded download history for %s", comic.title)
        except Exception:
            logger.warning("Failed to record download history for %s", comic.title, exc_info=True)

    def handle_download(
        self,
        comic_id: str,
        comic_data: dict | None = None,
        overwrite: bool = False,
        chapter_ids: list | None = None,
    ) -> dict:
        comic_data = comic_data or {}
        if chapter_ids:
            return self._download_chapters(comic_id, comic_data, chapter_ids, overwrite)

        comic = self._build_and_prepare_comic(comic_data, comic_id=comic_id)

        if not overwrite:
            output_path = self.cbz_builder.get_output_path_for_format(
                comic, self.config.output_format, self.config.download_dir
            )
            if os.path.exists(output_path):
                return {
                    "taskId": None,
                    "status": "conflict",
                    "conflictPath": output_path,
                }

        task_id = self._download_manager.add_task(comic, overwrite=overwrite)
        task = self._download_manager.tasks.get(task_id)
        return {
            "taskId": task_id,
            "status": task.status.value if task else "queued",
        }

    def _download_chapters(self, album_id: str, comic_data: dict, chapter_ids: list, overwrite: bool) -> dict:
        """为选中的每个章节创建独立下载任务。"""
        from models import ComicInfo

        source_site = comic_data.get("sourceSite", "hcomic") or "hcomic"
        album_title = comic_data.get("title", "Unknown")
        raw_album_title = comic_data.get("albumTitle") or album_title  # 优先使用专辑标题
        comic_author = comic_data.get("author")
        api_total = comic_data.get("albumTotalChapters") or 0
        # 取较大值：API 可能少报（陈旧数据），用户也可能只选部分章节。
        # 部分下载时 coordinator 不会自动打包，用户需手动 force-pack。
        total = max(api_total, len(chapter_ids))
        chapter_meta = {c["id"]: c for c in (comic_data.get("chapters") or []) if "id" in c}

        logger.info(
            "_download_chapters: source=%s, api_total=%s, len(chapter_ids)=%s, total=%s, albumTitle=%r, title=%r",
            source_site,
            api_total,
            len(chapter_ids),
            total,
            comic_data.get("albumTitle"),
            comic_data.get("title"),
        )

        task_ids = []
        failed = []
        for chap_id in chapter_ids:
            chap_name = chapter_meta.get(chap_id, {}).get("name", chap_id)
            try:
                if source_site == "bika":
                    chap_order = chapter_meta.get(chap_id, {}).get("index", 1)
                    parser = self.parser.parsers.get("bika")
                    if parser is None:
                        raise ValueError("bika source unavailable")
                    image_urls = parser.get_chapter_images(album_id, chap_order)
                    comic = ComicInfo(
                        id=chap_id,
                        title=f"{album_title} - {chap_name}",
                        author=comic_author,
                        source_site="bika",
                        comic_source="BIKA",
                        media_id=chap_id,
                        image_urls=image_urls,
                        pages=len(image_urls),
                        album_id=album_id,
                        album_total_chapters=total,
                        album_title=raw_album_title,
                    )
                else:
                    jm = self.parser.parsers.get("jmcomic")
                    if jm is None:
                        raise ValueError("jmcomic source unavailable")
                    image_urls, scramble_id = jm.get_chapter_images(chap_id)
                    comic = ComicInfo(
                        id=chap_id,
                        title=f"{album_title} - {chap_name}",
                        author=comic_author,
                        source_site="jmcomic",
                        comic_source="JMCOMIC",
                        media_id=chap_id,
                        image_urls=image_urls,
                        pages=len(image_urls),
                        scramble_id=scramble_id,
                        album_id=album_id,
                        album_total_chapters=total,
                        album_title=raw_album_title,
                    )
                task_ids.append(self._download_manager.add_task(comic, overwrite=overwrite))
            except Exception as e:
                # 单章失败不应中断其余章节：记录后继续，让调用方据 failedChapters 提示并保持前后端状态一致。
                logger.warning("Failed to queue chapter %s (%s): %s", chap_id, chap_name, e)
                failed.append({"id": chap_id, "name": chap_name, "error": str(e)})

        # 注册到专辑 coordinator
        album_key = (source_site, album_id)
        coordinator = getattr(self, "_album_coordinator", None)
        if coordinator and task_ids:
            coordinator.register_album_tasks(album_key, task_ids, total)

        status = "queued" if task_ids else "error"
        result = {"taskIds": task_ids, "failedChapters": failed, "status": status}
        if task_ids:
            result["albumKey"] = {"sourceSite": source_site, "albumId": album_id}
        return result

    def handle_check_download_conflict(self, comic_data: dict) -> dict:
        comic = self._build_and_prepare_comic(comic_data or {})

        # 多章专辑：检查专辑文件夹内是否有该章子文件夹
        if comic.is_album_chapter:
            album_dir_name = self.cbz_builder.get_album_folder_name(comic)
            album_work_dir = os.path.join(self.config.download_dir, album_dir_name)
            chapter_name = comic.chapter_display_name
            chapter_path = os.path.join(album_work_dir, chapter_name)
            has_conflict = os.path.exists(chapter_path)
            return {
                "hasConflict": has_conflict,
                "path": chapter_path,
            }

        output_path = self.cbz_builder.get_output_path_for_format(
            comic, self.config.output_format, self.config.download_dir
        )
        return {
            "hasConflict": os.path.exists(output_path),
            "path": output_path,
        }

    def handle_get_downloads(self) -> dict:
        sorted_tasks = self._download_manager.get_sorted_tasks()
        tasks = []
        for task in sorted_tasks:
            task_id = task.task_id
            tasks.append(
                {
                    "id": task_id,
                    "comic": self._comic_to_dict(task.comic),
                    "status": task.status.value,
                    "progress": task.progress_percentage,
                    "totalPages": task.progress_total,
                    "downloadedPages": task.progress_current,
                    "error": task.error_message,
                }
            )
        return {"tasks": tasks}

    def handle_cancel_download(self, task_id: str) -> dict:
        success = self._download_manager.cancel_task(task_id)
        return {"success": success}

    def handle_shutdown(self) -> dict:
        """Gracefully shut down: cancel active tasks, wait for completion, stop the queue."""
        active_statuses = {"queued", "downloading", "paused", "pausing"}
        cancelled_count = 0
        for task_id in list(self._download_manager.tasks.keys()):
            task = self._download_manager.tasks.get(task_id)
            if task and task.status.value in active_statuses:
                self._download_manager.cancel_task(task_id)
                cancelled_count += 1
        self._download_manager.stop()
        worker = getattr(self._download_manager, "_worker_thread", None)
        if worker and worker.is_alive():
            self._download_manager.wait_active_downloads(timeout=10.0)
        self._cover_executor.shutdown(cancel_futures=True, wait=False)
        self._preview_executor.shutdown(cancel_futures=True, wait=False)
        self._request_executor.shutdown(cancel_futures=True, wait=False)
        logger.info("Shutdown: cancelled %d active tasks", cancelled_count)
        return {"success": True, "cancelledTasks": cancelled_count}

    def handle_pause_task(self, task_id: str) -> dict:
        """Pause a specific download task."""
        if not task_id or not isinstance(task_id, str):
            raise ValueError("Invalid task_id")
        success = self._download_manager.pause_task(task_id)
        if not success:
            raise ValueError(f"Task not found or cannot be paused: {task_id}")
        return {"success": True}

    def handle_resume_task(self, task_id: str) -> dict:
        """Resume a paused download task."""
        if not task_id or not isinstance(task_id, str):
            raise ValueError("Invalid task_id")
        success = self._download_manager.resume_task(task_id)
        if not success:
            raise ValueError(f"Task not found or cannot be resumed: {task_id}")
        return {"success": True}

    def handle_retry_task(self, task_id: str) -> dict:
        """Retry a failed download task."""
        if not task_id or not isinstance(task_id, str):
            raise ValueError("Invalid task_id")
        success = self._download_manager.retry_task(task_id)
        if not success:
            raise ValueError(f"Task not found or cannot be retried: {task_id}")
        return {"success": True}

    def handle_toggle_global_pause(self) -> dict:
        """Toggle global pause on the download queue."""
        is_paused = self._download_manager.toggle_global_pause()
        return {"isPaused": is_paused}

    def handle_get_download_detail(self, task_id: str) -> dict:
        """Return detailed information about a download task."""
        if not task_id or not isinstance(task_id, str):
            raise ValueError("Invalid task_id")
        task = self._download_manager.tasks.get(task_id)
        if not task:
            raise ValueError(f"Task not found: {task_id}")
        output_path = ""
        with contextlib.suppress(Exception):
            output_path = self.cbz_builder.get_output_path_for_format(
                task.comic, self.config.output_format, self.config.download_dir
            )
        return {
            "taskId": task_id,
            "tempDir": getattr(task, "temp_dir", ""),
            "errorMessage": getattr(task, "error_message", ""),
            "outputPath": output_path,
        }

    def handle_force_pack_album(self, source_site: str, album_id: str, overwrite: bool = False) -> dict:
        """强制打包专辑。"""
        coordinator = getattr(self, "_album_coordinator", None)
        if coordinator is None:
            return {"status": "error", "errorMessage": "Album coordinator not available"}
        album_key = (source_site, album_id)
        result = coordinator.force_pack_album(album_key, overwrite=overwrite)
        return {
            "status": result.status,
            "outputPath": result.output_path,
            "packedChapters": result.packed_chapters,
            "missingChapters": result.missing_chapters,
            "existingPath": result.existing_path,
            "errorMessage": result.error_message,
        }

    def handle_get_album_progress(self, source_site: str, album_id: str) -> dict:
        """查询专辑下载进度。"""
        coordinator = getattr(self, "_album_coordinator", None)
        if coordinator is None:
            return {
                "albumId": album_id,
                "albumTitle": "",
                "albumFolderPath": "",
                "packedPath": None,
                "totalChapters": 0,
                "chaptersOnDisk": 0,
                "chaptersInQueue": 0,
                "isComplete": False,
            }
        album_key = (source_site, album_id)
        prog = coordinator.get_progress(album_key)
        return {
            "albumId": prog.album_id,
            "albumTitle": prog.album_title,
            "albumFolderPath": prog.album_folder_path,
            "packedPath": prog.packed_path,
            "totalChapters": prog.total_chapters,
            "chaptersOnDisk": prog.chapters_on_disk,
            "chaptersInQueue": prog.chapters_in_queue,
            "isComplete": prog.is_complete,
        }

    def handle_check_downloaded_status(self, comics: list) -> dict:
        """Check which comics from the list have been downloaded."""
        if not isinstance(comics, list):
            raise ValueError("Invalid comics parameter")

        keys = []
        comic_data_map = {}
        for c in comics:
            if not isinstance(c, dict):
                continue
            source_site = c.get("sourceSite", "hcomic") or "hcomic"
            comic_id = c.get("id", "")
            comic_source = c.get("source", "")
            if comic_id:
                key = (source_site, comic_id, comic_source)
                keys.append(key)
                comic_data_map[key] = {
                    "title": c.get("title", ""),
                    "author": c.get("author"),
                }

        status_map = self._history_db.check_downloaded_batch(
            keys,
            self.config.download_dir,
            self.config.output_format,
            self.config.cbz_filename_template,
            comic_data_map=comic_data_map,
        )

        result = {}
        for key, status in status_map.items():
            task_id = f"{key[0]}_{key[2]}_{key[1]}"
            result[task_id] = status

        return {"statusMap": result}

    def handle_open_download_dir(self) -> dict:
        """Open the download directory in the OS file manager."""
        import platform
        import subprocess

        directory = self.config.download_dir
        if not directory or not os.path.isdir(directory):
            raise ValueError(f"Download directory does not exist: {directory}")
        try:
            system = platform.system()
            if system == "Windows":
                os.startfile(directory)
            elif system == "Darwin":
                subprocess.Popen(["open", directory])
            else:
                subprocess.Popen(["xdg-open", directory])
            return {"success": True}
        except Exception as e:
            logger.error("Open download dir error: %s", e)
            raise RuntimeError(f"Failed to open directory: {e}") from e
