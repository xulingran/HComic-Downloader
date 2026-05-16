"""Download management mixin for IPCServer."""

import logging
import os
from typing import Dict

logger = logging.getLogger(__name__)


class DownloadMixin:
    """Mixin providing all download management handler methods."""

    def _on_download_update(self, task):
        """Send download progress as JSON-RPC notification to stdout."""
        notification = {
            "jsonrpc": "2.0",
            "method": "download_progress",
            "params": {
                "taskId": task.task_id,
                "status": task.status.value,
                "progress": task.progress_percentage,
                "current": task.progress_current,
                "total": task.progress_total,
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

    def handle_download(self, comic_id: str, comic_data: dict = None, overwrite: bool = False) -> Dict:
        comic = self._build_and_prepare_comic(comic_data or {}, comic_id=comic_id)

        if not overwrite:
            output_path = self.cbz_builder.get_output_path_for_format(
                comic, self.config.output_format, self.config.download_dir
            )
            if os.path.exists(output_path):
                return {"taskId": None, "status": "conflict", "conflictPath": output_path}

        task_id = self._download_manager.add_task(comic, overwrite=overwrite)
        task = self._download_manager.tasks.get(task_id)
        return {
            "taskId": task_id,
            "status": task.status.value if task else "queued",
        }

    def handle_check_download_conflict(self, comic_data: dict) -> Dict:
        comic = self._build_and_prepare_comic(comic_data or {})
        output_path = self.cbz_builder.get_output_path_for_format(
            comic, self.config.output_format, self.config.download_dir
        )
        return {
            "hasConflict": os.path.exists(output_path),
            "path": output_path,
        }

    def handle_get_downloads(self) -> Dict:
        sorted_tasks = self._download_manager.get_sorted_tasks()
        tasks = []
        for task in sorted_tasks:
            task_id = task.task_id
            tasks.append({
                "id": task_id,
                "comic": self._comic_to_dict(task.comic),
                "status": task.status.value,
                "progress": task.progress_percentage,
                "totalPages": task.progress_total,
                "downloadedPages": task.progress_current,
                "error": task.error_message,
            })
        return {"tasks": tasks}

    def handle_cancel_download(self, task_id: str) -> Dict:
        success = self._download_manager.cancel_task(task_id)
        return {"success": success}

    def handle_shutdown(self) -> Dict:
        """Gracefully shut down: cancel active tasks, wait for completion, stop the queue."""
        active_statuses = {"queued", "downloading", "paused", "pausing"}
        cancelled_count = 0
        for task_id in list(self._download_manager.tasks.keys()):
            task = self._download_manager.tasks.get(task_id)
            if task and task.status.value in active_statuses:
                self._download_manager.cancel_task(task_id)
                cancelled_count += 1
        self._download_manager.stop()
        worker = getattr(self._download_manager, '_worker_thread', None)
        if worker and worker.is_alive():
            self._download_manager.wait_active_downloads(timeout=10.0)
        self._cover_executor.shutdown(cancel_futures=True, wait=False)
        self._preview_executor.shutdown(cancel_futures=True, wait=False)
        logger.info("Shutdown: cancelled %d active tasks", cancelled_count)
        return {"success": True, "cancelledTasks": cancelled_count}

    def handle_pause_task(self, task_id: str) -> Dict:
        """Pause a specific download task."""
        if not task_id or not isinstance(task_id, str):
            raise ValueError("Invalid task_id")
        success = self._download_manager.pause_task(task_id)
        if not success:
            raise ValueError(f"Task not found or cannot be paused: {task_id}")
        return {"success": True}

    def handle_resume_task(self, task_id: str) -> Dict:
        """Resume a paused download task."""
        if not task_id or not isinstance(task_id, str):
            raise ValueError("Invalid task_id")
        success = self._download_manager.resume_task(task_id)
        if not success:
            raise ValueError(f"Task not found or cannot be resumed: {task_id}")
        return {"success": True}

    def handle_retry_task(self, task_id: str) -> Dict:
        """Retry a failed download task."""
        if not task_id or not isinstance(task_id, str):
            raise ValueError("Invalid task_id")
        success = self._download_manager.retry_task(task_id)
        if not success:
            raise ValueError(f"Task not found or cannot be retried: {task_id}")
        return {"success": True}

    def handle_toggle_global_pause(self) -> Dict:
        """Toggle global pause on the download queue."""
        is_paused = self._download_manager.toggle_global_pause()
        return {"isPaused": is_paused}

    def handle_get_download_detail(self, task_id: str) -> Dict:
        """Return detailed information about a download task."""
        if not task_id or not isinstance(task_id, str):
            raise ValueError("Invalid task_id")
        task = self._download_manager.tasks.get(task_id)
        if not task:
            raise ValueError(f"Task not found: {task_id}")
        output_path = ""
        try:
            output_path = self.cbz_builder.get_output_path_for_format(
                task.comic, self.config.output_format, self.config.download_dir
            )
        except Exception:
            pass
        return {
            "taskId": task_id,
            "tempDir": getattr(task, 'temp_dir', ''),
            "errorMessage": getattr(task, 'error_message', ''),
            "outputPath": output_path,
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

    def handle_open_download_dir(self) -> Dict:
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
            raise RuntimeError(f"Failed to open directory: {e}")
