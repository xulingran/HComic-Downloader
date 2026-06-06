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


class MigrationMixin:
    """Mixin providing migration handler methods for IPCServer."""

    config: Config
    _write_response: Callable[[dict], None]
    _download_manager: ComicDownloadManager
    _history_db: DownloadHistoryDB

    def _init_migration(self):
        """Initialize migration state. Call from IPCServer.__init__."""
        state_path = os.path.join(os.path.expanduser("~"), ".hcomic_downloader", "migration_state.json")
        self._migration_engine = MigrationEngine(
            history_db=self._history_db,
            state_path=state_path,
        )
        self._migration_thread: threading.Thread | None = None
        self._migration_lock = threading.Lock()
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
            current = self._migration_engine.state
            if current and current.status in ("running", "paused"):
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
            self._migration_engine.pause()
            state = self._migration_engine.state
            if state:
                state.status = "cancelled"
                self._migration_engine._save_state_if_needed()
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
        return state.to_dict()

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
