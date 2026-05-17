"""漫画库迁移引擎"""
import json
import logging
import os
import shutil
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


@dataclass
class MigrationPlanItem:
    """迁移计划中的单个条目"""
    source: str
    target: str
    db_key: Tuple[str, str, str]
    status: str = "pending"  # pending | done | failed | skipped

    def to_dict(self) -> dict:
        return {
            "source": self.source,
            "target": self.target,
            "db_key": list(self.db_key),
            "status": self.status,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "MigrationPlanItem":
        return cls(
            source=d["source"],
            target=d["target"],
            db_key=tuple(d["db_key"]),
            status=d.get("status", "pending"),
        )


@dataclass
class MigrationProgress:
    """迁移进度信息"""
    completed: int
    total: int
    current_file: str
    speed: float = 0.0
    phase: str = "moving"


@dataclass
class MigrationState:
    """迁移状态持久化"""
    id: str
    mode: str  # full | repair
    source_dir: str
    target_dir: str
    status: str = "planning"
    started_at: float = 0.0
    updated_at: float = 0.0
    total_items: int = 0
    completed_items: int = 0
    failed_items: List[Dict] = field(default_factory=list)
    plan: List[MigrationPlanItem] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "mode": self.mode,
            "source_dir": self.source_dir,
            "target_dir": self.target_dir,
            "status": self.status,
            "started_at": self.started_at,
            "updated_at": self.updated_at,
            "total_items": self.total_items,
            "completed_items": self.completed_items,
            "failed_items": self.failed_items,
            "plan": [item.to_dict() for item in self.plan],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "MigrationState":
        plan_items = [MigrationPlanItem.from_dict(p) for p in d.get("plan", [])]
        return cls(
            id=d["id"],
            mode=d["mode"],
            source_dir=d["source_dir"],
            target_dir=d["target_dir"],
            status=d.get("status", "planning"),
            started_at=d.get("started_at", 0.0),
            updated_at=d.get("updated_at", 0.0),
            total_items=d.get("total_items", 0),
            completed_items=d.get("completed_items", 0),
            failed_items=d.get("failed_items", []),
            plan=plan_items,
        )

    def save(self, path: str):
        self.updated_at = time.time()
        tmp_path = path + ".tmp"
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(self.to_dict(), f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, path)
        except Exception:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
            raise

    @classmethod
    def load(cls, path: str) -> Optional["MigrationState"]:
        if not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return cls.from_dict(data)


class MigrationEngine:
    """漫画库迁移引擎"""

    def __init__(self, history_db, state_path: str = ""):
        self._history_db = history_db
        self._state: Optional[MigrationState] = None
        self._pause_requested = False
        self._state_path = state_path
        self._migration_logger = logging.getLogger("migration.engine")
        log_path = self._get_log_path()
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        self._log_handler = logging.FileHandler(log_path, encoding="utf-8")
        self._log_handler.setFormatter(logging.Formatter(
            "[%(asctime)s] [%(levelname)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        ))
        self._migration_logger.addHandler(self._log_handler)
        self._migration_logger.setLevel(logging.DEBUG)

    @property
    def state(self) -> Optional[MigrationState]:
        return self._state

    @staticmethod
    def _is_same_drive(path1: str, path2: str) -> bool:
        try:
            return os.stat(path1).st_dev == os.stat(path2).st_dev
        except OSError:
            return False

    def _save_state_if_needed(self):
        if self._state_path and self._state:
            self._state.save(self._state_path)

    def load_state(self, path: str) -> bool:
        """Load a previously saved migration state."""
        state = MigrationState.load(path)
        if state:
            self._state = state
            self._state_path = path
            return True
        return False

    # ── Full migration ────────────────────────────────────────────────

    def plan_full_migration(self, source_dir: str, target_dir: str) -> MigrationState:
        """Generate a full migration plan based on DB records."""
        source_dir = os.path.normpath(source_dir)
        target_dir = os.path.normpath(target_dir)

        records = self._history_db.get_all_records()
        plan: List[MigrationPlanItem] = []

        for record in records:
            output_path = os.path.normpath(record["output_path"])
            if not output_path.startswith(source_dir + os.sep) and output_path != source_dir:
                continue
            if not os.path.exists(output_path):
                continue

            rel_path = os.path.relpath(output_path, source_dir)
            target_path = os.path.join(target_dir, rel_path)

            plan.append(MigrationPlanItem(
                source=output_path,
                target=target_path,
                db_key=(record["source_site"], record["comic_id"], record["comic_source"]),
            ))

        state = MigrationState(
            id=str(uuid.uuid4()),
            mode="full",
            source_dir=source_dir,
            target_dir=target_dir,
            status="ready",
            total_items=len(plan),
            plan=plan,
        )
        self._state = state
        return state

    # ── Repair mode ───────────────────────────────────────────────────

    def plan_repair(
        self,
        target_dir: str,
        filename_template: str = "{author}-{title}.cbz",
    ) -> MigrationState:
        """Generate a repair plan: match files in target_dir to DB records."""
        target_dir = os.path.normpath(target_dir)
        records = self._history_db.get_all_records()

        files_on_disk: List[str] = []
        if os.path.isdir(target_dir):
            for entry in os.listdir(target_dir):
                full_path = os.path.join(target_dir, entry)
                ext = os.path.splitext(entry)[1].lower()
                if os.path.isfile(full_path) and ext in (".cbz", ".zip"):
                    files_on_disk.append(full_path)
                elif os.path.isdir(full_path):
                    files_on_disk.append(full_path)

        plan: List[MigrationPlanItem] = []

        for record in records:
            title = record.get("title", "")
            author = record.get("author", "")
            comic_id = record.get("comic_id", "")
            db_key = (record["source_site"], record["comic_id"], record["comic_source"])

            best_match = self._find_match(
                files_on_disk, title, author, comic_id, filename_template
            )
            if best_match:
                plan.append(MigrationPlanItem(
                    source=record["output_path"],
                    target=best_match,
                    db_key=db_key,
                ))
                files_on_disk.remove(best_match)

        state = MigrationState(
            id=str(uuid.uuid4()),
            mode="repair",
            source_dir="",
            target_dir=target_dir,
            status="ready",
            total_items=len(plan),
            plan=plan,
        )
        self._state = state
        return state

    @staticmethod
    def _find_match(
        files: List[str],
        title: str,
        author: str,
        comic_id: str,
        template: str,
    ) -> Optional[str]:
        """Try to find a file matching the given comic metadata."""
        if comic_id:
            for f in files:
                name = os.path.basename(f)
                if comic_id in name:
                    return f

        search_str = f"{author}-{title}" if author else title
        search_str = search_str.lower()
        for f in files:
            name = os.path.basename(f).lower()
            name_no_ext = os.path.splitext(name)[0]
            if search_str and search_str in name_no_ext:
                return f

        return None

    # ── Execution ─────────────────────────────────────────────────────

    def execute(
        self,
        on_progress: Optional[Callable[[MigrationProgress], None]] = None,
        on_error: Optional[Callable[[Dict], None]] = None,
    ):
        """Execute the migration plan."""
        if not self._state or self._state.status not in ("ready", "paused"):
            raise RuntimeError("No migration plan ready to execute")

        self._state.status = "running"
        self._pause_requested = False

        if self._state.started_at == 0.0:
            self._state.started_at = time.time()
            log_path = self._get_log_path()
            if self._log_handler:
                self._migration_logger.removeHandler(self._log_handler)
                self._log_handler.close()
            if os.path.exists(log_path):
                try:
                    os.unlink(log_path)
                except OSError:
                    pass
            self._reinit_log_handler()

        self._save_state_if_needed()

        for item in self._state.plan:
            if item.status != "pending":
                continue

            if self._pause_requested:
                self._state.status = "paused"
                self._pause_requested = False
                self._save_state_if_needed()
                return

            try:
                self._move_item(item)
                item.status = "done"
                self._state.completed_items += 1
                self._write_log(
                    "INFO",
                    f"Moved: {os.path.basename(item.source)} -> {os.path.basename(item.target)}"
                )
            except Exception as e:
                item.status = "failed"
                self._state.failed_items.append({
                    "path": item.source,
                    "error": str(e),
                })
                self._write_log(
                    "ERROR",
                    f"Failed: {os.path.basename(item.source)} — {e}"
                )
                logger.error("Migration failed for %s: %s", item.source, e)
                if on_error:
                    on_error({"message": str(e), "file_path": item.source})

            self._save_state_if_needed()

            if on_progress:
                on_progress(MigrationProgress(
                    completed=self._state.completed_items,
                    total=self._state.total_items,
                    current_file=os.path.basename(item.source),
                    phase="moving",
                ))

        self._state.status = "completed"
        self._save_state_if_needed()

    def _move_item(self, item: MigrationPlanItem):
        """Move a single file or directory."""
        if self._state is None:
            raise RuntimeError("Migration state not initialized")
        os.makedirs(os.path.dirname(item.target), exist_ok=True)

        if not os.path.exists(item.source):
            raise FileNotFoundError(f"Source not found: {item.source}")

        source_dir = self._state.source_dir
        target_dir = self._state.target_dir

        if self._is_same_drive(source_dir, target_dir):
            try:
                os.rename(item.source, item.target)
            except FileExistsError:
                raise FileExistsError(
                    f"目标文件已存在: {item.target} (源: {item.source})"
                )
        else:
            if os.path.isdir(item.source):
                shutil.copytree(item.source, item.target)
                try:
                    shutil.rmtree(item.source)
                except OSError as e:
                    logger.warning(
                        "跨盘迁移源目录删除失败（文件已在目标位置）: %s — %s",
                        item.source, e,
                    )
                    self._write_log(
                        "WARNING",
                        f"Source dir removal failed: {item.source} — {e}"
                    )
                    return
            else:
                shutil.copy2(item.source, item.target)
                try:
                    os.remove(item.source)
                except OSError as e:
                    logger.warning(
                        "跨盘迁移源文件删除失败（文件已在目标位置）: %s — %s",
                        item.source, e,
                    )
                    self._write_log(
                        "WARNING",
                        f"Source file removal failed: {item.source} — {e}"
                    )
                    return

        self._history_db.update_output_path(item.db_key, item.target)

    def pause(self):
        """Request pause."""
        self._pause_requested = True
        if self._state:
            self._state.status = "paused"

    def resume(self):
        """Resume from paused state."""
        if self._state and self._state.status == "paused":
            self._state.status = "running"
            self._pause_requested = False

    # ── Logging ───────────────────────────────────────────────────────

    @staticmethod
    def _get_log_path() -> str:
        return os.path.join(
            os.path.expanduser("~"), ".hcomic_downloader", "migration.log"
        )

    def _write_log(self, level: str, message: str):
        log_level = getattr(logging, level.upper(), logging.INFO)
        self._migration_logger.log(log_level, message)

    def _reinit_log_handler(self):
        if self._log_handler:
            self._migration_logger.removeHandler(self._log_handler)
            self._log_handler.close()
        log_path = self._get_log_path()
        self._log_handler = logging.FileHandler(log_path, encoding="utf-8")
        self._log_handler.setFormatter(logging.Formatter(
            "[%(asctime)s] [%(levelname)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        ))
        self._migration_logger.addHandler(self._log_handler)
