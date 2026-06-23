"""Maintenance center mixin for IPCServer."""

from __future__ import annotations

import logging
import sys
from collections.abc import Callable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from cbz_builder import CBZBuilder
    from config import Config
    from download_history import DownloadHistoryDB
    from download_manager import ComicDownloadManager

from maintenance.health_checker import HealthChecker
from maintenance.orphan_cleaner import cleanup_orphan_temp_dirs, scan_orphan_temp_dirs
from maintenance.storage_analyzer import analyze_storage

logger = logging.getLogger(__name__)


class MaintenanceMixin:
    """Mixin providing maintenance center handlers."""

    config: Config
    _history_db: DownloadHistoryDB
    _download_manager: ComicDownloadManager
    cbz_builder: CBZBuilder
    _write_response: Callable[[dict], None]

    def _emit_maintenance_progress(self, current: int, total: int, label: str) -> None:
        """Send maintenance progress JSON-RPC notification to stdout.

        显式 flush stdout：非 TTY 环境下 stdout 默认块缓冲，不 flush 会让进度通知
        滞留缓冲区直到扫描结束，UI 进度条全程静止。
        """
        notification = {
            "jsonrpc": "2.0",
            "method": "maintenance_progress",
            "params": {
                "phase": "health_check",
                "current": current,
                "total": total,
                "label": label,
            },
        }
        self._write_response(notification)
        sys.stdout.flush()

    def _get_active_temp_dirs(self) -> set[str]:
        """Return temp_dirs currently in use by active download tasks."""
        temp_dirs: set[str] = set()
        manager = getattr(self, "_download_manager", None)
        if manager is None:
            return temp_dirs
        for task in getattr(manager, "tasks", {}).values():
            temp_dir = getattr(task, "temp_dir", None)
            if temp_dir:
                temp_dirs.add(temp_dir)
        return temp_dirs

    def handle_run_health_check(
        self,
        scope: str = "all",
        comic_keys: list[list[str]] | None = None,
    ) -> dict:
        """Run health check against download history records."""
        download_dir = self.config.download_dir
        checker = HealthChecker(
            self._history_db,
            download_dir,
            progress_callback=self._emit_maintenance_progress,
        )

        # Normalize comic_keys from list[list[str]] to list[tuple[str, str, str]]
        normalized_keys: list[tuple[str, str, str]] | None = None
        if comic_keys:
            normalized_keys = []
            for key in comic_keys:
                if len(key) >= 3:
                    normalized_keys.append((key[0], key[1], key[2]))

        return checker.check_all(scope=scope, comic_keys=normalized_keys)

    def handle_scan_orphan_temps(self) -> dict:
        """Scan for orphan temporary directories."""
        download_dir = self.config.download_dir
        orphans = scan_orphan_temp_dirs(
            download_dir,
            history_db=self._history_db,
            active_temp_dirs=self._get_active_temp_dirs(),
        )
        return {
            "orphans": [
                {
                    "path": o.path,
                    "sizeBytes": o.size_bytes,
                    "modifiedAt": o.modified_at,
                }
                for o in orphans
            ],
            "totalSizeBytes": sum(o.size_bytes for o in orphans),
        }

    def handle_cleanup_orphan_temps(self, paths: list[str] | None = None) -> dict:
        """Clean up orphan temporary directories.

        即时重新获取 active_temp_dirs：扫描与删除之间存在时间窗口，期间可能有
        新下载任务复用同名 temp_* 目录。复用扫描时刻的快照会漏判新活跃目录导致误删，
        因此必须在删除前重新拉取最新活跃集合。
        """
        download_dir = self.config.download_dir
        result = cleanup_orphan_temp_dirs(
            download_dir,
            paths=paths,
            history_db=self._history_db,
            active_temp_dirs=self._get_active_temp_dirs(),
        )
        return {
            "removed": result["removed"],
            "freedBytes": result["freedBytes"],
            "failed": result["failed"],
        }

    def handle_get_storage_stats(self) -> dict:
        """Return storage analytics for the download directory."""
        download_dir = self.config.download_dir
        return analyze_storage(download_dir, history_db=self._history_db)
