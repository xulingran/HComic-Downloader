"""Migration management mixin for IPCServer."""

from __future__ import annotations

import logging
import os
import threading
from collections.abc import Callable
from typing import TYPE_CHECKING

from migration import MigrationEngine

from .types import _get_config_path

if TYPE_CHECKING:
    from config import Config
    from download_history import DownloadHistoryDB
    from download_manager import ComicDownloadManager

logger = logging.getLogger(__name__)

# 迁移引擎的终态集合：state 为 None 或 status 属于此集合时，引擎可接受新 plan；
# 其余状态（ready / running / paused）一律视为占用，禁止被新 plan 覆盖。
# 采用补集式判据避免"新增状态忘记加入占用枚举"的疏漏。
_TERMINAL_MIGRATION_STATUSES = frozenset({"cancelled", "completed", "failed"})


class MigrationMixin:
    """Mixin providing migration handler methods for IPCServer."""

    config: Config
    _write_response: Callable[[dict], None]
    _download_manager: ComicDownloadManager
    _history_db: DownloadHistoryDB
    # 类型注解：运行时由 IPCServer.__init__ 创建，与 ConfigMixin 共享同一把锁。
    # 迁移完成回调落库时持此锁，与 handle_set_config 的 config.save 路径串行化，
    # 避免两处 os.replace 并发触发 Windows WinError 5。
    _config_write_lock: threading.Lock

    def _is_migration_occupied(self) -> bool:
        """引擎是否处于占用态（非终态）。

        state 为 None 或 status ∈ 终态集合时返回 False（可接受新 plan）；
        status ∈ {ready, running, paused} 时返回 True（禁止覆盖）。
        所有 plan 入口必须共用此判据。
        """
        state = self._migration_engine.state
        return bool(state and state.status not in _TERMINAL_MIGRATION_STATUSES)

    def _init_migration(self) -> None:
        """Initialize migration state. Call from IPCServer.__init__."""
        previous_engine = getattr(self, "_migration_engine", None)
        if previous_engine is not None:
            previous_engine.close()

        state_path = os.path.join(os.path.expanduser("~"), ".hcomic_downloader", "migration_state.json")
        self._migration_engine = MigrationEngine(
            history_db=self._history_db,
            state_path=state_path,
        )
        if not hasattr(self, "_migration_thread"):
            self._migration_thread: threading.Thread | None = None
        if not hasattr(self, "_migration_lock"):
            self._migration_lock = threading.Lock()
        if not hasattr(self, "_migration_paused_dm"):
            self._migration_paused_dm: bool = False

    def _migration_progress_callback(self, progress):
        self._write_response(
            {
                "jsonrpc": "2.0",
                "method": "migration_progress",
                "params": {
                    "completed": progress.completed,
                    "total": progress.total,
                    "currentFile": progress.current_file,
                    "speed": progress.speed,
                    "phase": progress.phase,
                },
            }
        )

    def _migration_complete_callback(self):
        state = self._migration_engine.state
        if not state:
            return
        succeeded = state.completed_items
        failed = len(state.failed_items)
        elapsed = state.updated_at - state.started_at if state.started_at else 0

        if succeeded > 0 and state.target_dir and state.status not in ("cancelled",):
            try:
                # 持 _config_write_lock：迁移在工作线程落库，与 handle_set_config
                # 的 config.save 路径串行化，避免并发 os.replace 在 Windows 上
                # 触发 WinError 5（PermissionError）导致文件已移动但配置未更新。
                # 锁粒度仅 setattr + save（毫秒级），不阻塞进度推送。
                with self._config_write_lock:
                    self._apply_runtime("downloadDir", state.target_dir)
                    self.config.download_dir = state.target_dir
                    self.config.save(_get_config_path())
                logger.info(
                    "Download dir auto-updated to migration target: %s",
                    state.target_dir,
                )
            except Exception as e:
                logger.error("Failed to auto-update download_dir after migration: %s", e)

        self._write_response(
            {
                "jsonrpc": "2.0",
                "method": "migration_complete",
                "params": {
                    "total": state.total_items,
                    "succeeded": succeeded,
                    "failed": failed,
                    "elapsed": round(elapsed, 1),
                },
            }
        )

    def _migration_error_callback(self, error_info):
        self._write_response(
            {
                "jsonrpc": "2.0",
                "method": "migration_error",
                "params": error_info,
            }
        )

    def _run_migration(self):
        try:
            self._migration_engine.execute(
                on_progress=self._migration_progress_callback,
                on_error=self._migration_error_callback,
            )
        except Exception as e:
            logger.error("Migration engine error: %s", e)
        finally:
            self._migration_complete_callback()
            if self._migration_paused_dm and hasattr(self, "_download_manager"):
                try:
                    self._download_manager.toggle_global_pause()
                except Exception as e:
                    logger.error("Failed to resume download manager: %s", e)
                self._migration_paused_dm = False

    def handle_start_migration(self, target_dir: str, mode: str) -> dict:
        target_dir = os.path.realpath(target_dir)
        if not os.path.isabs(target_dir):
            raise ValueError("target_dir must be an absolute path")
        if mode not in ("full", "repair"):
            raise ValueError("mode must be 'full' or 'repair'")

        with self._migration_lock:
            if self._is_migration_occupied():
                raise RuntimeError("A migration is already in progress")

            self._init_migration()

            if mode == "full":
                state = self._migration_engine.plan_full_migration(self.config.download_dir, target_dir)
            else:
                state = self._migration_engine.plan_repair(target_dir, self.config.cbz_filename_template)

        return {
            "migrationId": state.id,
            "totalItems": state.total_items,
            "sourceDir": state.source_dir,
            "targetDir": state.target_dir,
            "isSameDrive": (
                MigrationEngine._is_same_drive(state.source_dir, state.target_dir) if state.source_dir else False
            ),
        }

    def trigger_download_dir_migration(self, new_dir: str) -> dict:
        """供 config_mixin 在检测到 downloadDir 变更时调用，预检查迁移需求。

        只 plan 不执行：返回迁移计划信息（migrationId/totalItems/skipped）。
        - total_items == 0（旧目录无记录或无文件）→ skipped=True，调用方直接落库
        - total_items > 0 → skipped=False，调用方须让前端弹窗确认；
          前端确认后调既有 handle_confirm_migration(migrationId) 启动迁移，
          迁移完成后由 _migration_complete_callback 落库新 download_dir。

        这样保留了"知情确认"：用户在文件实际移动前可看到 N 并决定是否继续。

        Returns:
            {"migrationId": str, "totalItems": int, "skipped": bool,
             "sourceDir": str, "targetDir": str}
        """
        new_dir = os.path.realpath(new_dir)
        if not os.path.isabs(new_dir):
            raise ValueError("new_dir must be an absolute path")

        with self._migration_lock:
            if self._is_migration_occupied():
                raise RuntimeError("A migration is already in progress")

            self._init_migration()
            state = self._migration_engine.plan_full_migration(self.config.download_dir, new_dir)

        return {
            "migrationId": state.id,
            "totalItems": state.total_items,
            "skipped": state.total_items == 0,
            "sourceDir": state.source_dir,
            "targetDir": state.target_dir,
        }

    def handle_confirm_migration(self, migration_id: str) -> dict:
        with self._migration_lock:
            state = self._migration_engine.state
            if not state or state.id != migration_id:
                raise ValueError("Invalid migration_id")
            if state.status != "ready":
                raise RuntimeError(f"Migration is in status: {state.status}")

            if hasattr(self, "_download_manager"):
                self._download_manager.toggle_global_pause()
                self._migration_paused_dm = True

            self._migration_thread = threading.Thread(
                target=self._run_migration,
                name="migration-worker",
                daemon=True,
            )
            self._migration_thread.start()

        return {"started": True}

    def handle_pause_migration(self) -> dict:
        with self._migration_lock:
            self._migration_engine.pause()
        return {"paused": True}

    def handle_resume_migration(self) -> dict:
        with self._migration_lock:
            state = self._migration_engine.state
            if not state or state.status not in ("paused", "failed"):
                raise RuntimeError("No paused migration to resume")

            self._migration_engine.resume()

            self._migration_thread = threading.Thread(
                target=self._run_migration,
                name="migration-worker",
                daemon=True,
            )
            self._migration_thread.start()

        return {"resumed": True}

    def handle_cancel_migration(self) -> dict:
        with self._migration_lock:
            # mark_cancelled 封装了 pause + status=cancelled + 持久化，
            # 避免在此跨类访问引擎的 _save_state_if_needed 私有方法。
            self._migration_engine.mark_cancelled()
        if self._migration_paused_dm and hasattr(self, "_download_manager"):
            try:
                self._download_manager.toggle_global_pause()
            except Exception as e:
                logger.error("Failed to resume download manager on cancel: %s", e)
            self._migration_paused_dm = False
        return {"cancelled": True}

    def handle_get_migration_status(self) -> dict:
        state = self._migration_engine.state
        if not state:
            return {"status": "none"}
        result = state.to_dict()
        result["is_same_drive"] = (
            MigrationEngine._is_same_drive(state.source_dir, state.target_dir) if state.source_dir else False
        )
        return result

    def handle_resolve_unmatched(self, matches: list) -> dict:
        state = self._migration_engine.state
        if not state:
            raise RuntimeError("No migration in progress")

        resolved = 0
        for match in matches:
            db_key = tuple(match["db_key"])
            file_path = match["file_path"]
            self._history_db.update_output_path(db_key, file_path)
            resolved += 1

        return {"resolved": resolved}
