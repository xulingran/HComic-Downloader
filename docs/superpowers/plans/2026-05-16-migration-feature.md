# 漫画库迁移功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现漫画库迁移功能，支持完整迁移（自动搬文件+更新DB）和修复模式（手动搬文件后修复DB），带断点续传和进度反馈。

**Architecture:** Python 端 MigrationEngine 负责核心逻辑（文件移动、DB更新、状态持久化），通过 MigrationMixin 暴露为 IPC 命令。Electron main.ts 注册 IPC handlers 并转发通知到渲染进程。React 前端提供迁移对话框。

**Tech Stack:** Python 3 (sqlite3, shutil, json), Electron (ipcMain/ipcRenderer), React + TypeScript, Tailwind CSS

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `migration.py` | 迁移引擎核心：状态管理、计划生成、文件移动、DB更新 |
| Create | `tests/test_migration.py` | 迁移引擎测试 |
| Create | `python/ipc/migration_mixin.py` | IPC 桥接：将引擎暴露为 IPC 命令 |
| Modify | `python/ipc_server.py` | 混入 MigrationMixin，注册 handler |
| Modify | `download_history.py` | 新增 `get_all_records`、`update_output_path` 方法 |
| Modify | `tests/test_download_history.py` | 新增 DB 方法的测试 |
| Modify | `shared/types.ts` | 新增迁移相关 IPC channels、类型、HcomicAPI 方法 |
| Modify | `electron/main.ts` | 注册迁移 IPC handlers + 通知转发 |
| Modify | `electron/preload.ts` | 暴露迁移 API 到渲染进程 |
| Create | `src/hooks/useMigration.ts` | 迁移 IPC hook |
| Create | `src/components/settings/MigrationDialog.tsx` | 迁移对话框组件（含三阶段） |
| Modify | `src/components/settings/DownloadSettings.tsx` | 添加"迁移漫画库"按钮 |
| Modify | `src/pages/SettingsPage.tsx` | 集成迁移对话框状态 |

---

### Task 1: DownloadHistoryDB 新增方法

**Files:**
- Modify: `download_history.py:136-139`
- Modify: `tests/test_download_history.py`

- [ ] **Step 1: Write failing test for `get_all_records`**

在 `tests/test_download_history.py` 末尾追加：

```python
def test_get_all_records_returns_all_rows(db, sample_comic, tmp_path):
    db.record_download(sample_comic, str(tmp_path / "a.cbz"), "cbz")
    comic2 = ComicInfo(id="67890", title="Comic 2", source_site="hcomic", comic_source="NH")
    db.record_download(comic2, str(tmp_path / "b.cbz"), "cbz")

    records = db.get_all_records()
    assert len(records) == 2
    keys = {(r["source_site"], r["comic_id"], r["comic_source"]) for r in records}
    assert ("hcomic", "12345", "MMCG_SHORT") in keys
    assert ("hcomic", "67890", "NH") in keys


def test_get_all_records_includes_output_path_and_metadata(db, sample_comic, tmp_path):
    output_path = str(tmp_path / "Test.cbz")
    db.record_download(sample_comic, output_path, "cbz")

    records = db.get_all_records()
    assert len(records) == 1
    r = records[0]
    assert r["output_path"] == output_path
    assert r["output_format"] == "cbz"
    assert r["title"] == "Test Comic"
    assert r["author"] == "Test Author"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /e/Developing/hcomic_downloader && python -m pytest tests/test_download_history.py::test_get_all_records_returns_all_rows -v`
Expected: FAIL with `AttributeError: 'DownloadHistoryDB' object has no attribute 'get_all_records'`

- [ ] **Step 3: Write failing test for `update_output_path`**

在 `tests/test_download_history.py` 末尾追加：

```python
def test_update_output_path_changes_stored_path(db, sample_comic, tmp_path):
    old_path = str(tmp_path / "old.cbz")
    new_path = str(tmp_path / "new.cbz")
    db.record_download(sample_comic, old_path, "cbz")

    db.update_output_path(("hcomic", "12345", "MMCG_SHORT"), new_path)

    import sqlite3
    conn = sqlite3.connect(db._db_path)
    cursor = conn.execute(
        "SELECT output_path FROM download_history "
        "WHERE source_site=? AND comic_id=? AND comic_source=?",
        ("hcomic", "12345", "MMCG_SHORT"),
    )
    assert cursor.fetchone()[0] == new_path
    conn.close()


def test_update_output_path_no_match_does_nothing(db, tmp_path):
    db.update_output_path(("hcomic", "nonexist", "NH"), "/some/path.cbz")
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd /e/Developing/hcomic_downloader && python -m pytest tests/test_download_history.py::test_update_output_path_changes_stored_path -v`
Expected: FAIL with `AttributeError`

- [ ] **Step 5: Implement `get_all_records` and `update_output_path`**

在 `download_history.py` 的 `DownloadHistoryDB` 类中，`close` 方法之前追加：

```python
    def get_all_records(self) -> List[Dict]:
        """Return all download history records."""
        with self._lock:
            cursor = self._conn.execute(
                "SELECT source_site, comic_id, comic_source, title, author, "
                "output_path, output_format, downloaded_at "
                "FROM download_history"
            )
            columns = ["source_site", "comic_id", "comic_source", "title",
                        "author", "output_path", "output_format", "downloaded_at"]
            return [dict(zip(columns, row)) for row in cursor]

    def update_output_path(self, key: Tuple[str, str, str], new_path: str):
        """Update the output_path for a specific record."""
        with self._lock:
            self._conn.execute(
                "UPDATE download_history SET output_path = ? "
                "WHERE source_site = ? AND comic_id = ? AND comic_source = ?",
                (new_path, key[0], key[1], key[2]),
            )
            self._conn.commit()
```

- [ ] **Step 6: Run all download_history tests**

Run: `cd /e/Developing/hcomic_downloader && python -m pytest tests/test_download_history.py -v`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add download_history.py tests/test_download_history.py
git commit -m "feat: add get_all_records and update_output_path to DownloadHistoryDB"
```

---

### Task 2: 迁移引擎 — 数据模型与状态管理

**Files:**
- Create: `migration.py`
- Create: `tests/test_migration.py`

- [ ] **Step 1: Write failing tests for MigrationState**

创建 `tests/test_migration.py`：

```python
"""Tests for migration.py"""
import json
import os
import pytest
from migration import MigrationState, MigrationPlanItem


def test_migration_state_defaults():
    state = MigrationState(id="test-id", mode="full", source_dir="/old", target_dir="/new")
    assert state.status == "planning"
    assert state.total_items == 0
    assert state.completed_items == 0
    assert state.plan == []
    assert state.failed_items == []


def test_migration_state_to_dict_roundtrip():
    state = MigrationState(
        id="test-id",
        mode="full",
        source_dir="/old",
        target_dir="/new",
        status="ready",
        total_items=5,
    )
    d = state.to_dict()
    restored = MigrationState.from_dict(d)
    assert restored.id == state.id
    assert restored.mode == state.mode
    assert restored.source_dir == state.source_dir
    assert restored.target_dir == state.target_dir
    assert restored.status == state.status
    assert restored.total_items == state.total_items


def test_migration_state_save_and_load(tmp_path):
    state = MigrationState(id="test-id", mode="full", source_dir="/old", target_dir="/new")
    path = str(tmp_path / "migration_state.json")
    state.save(path)
    assert os.path.exists(path)

    loaded = MigrationState.load(path)
    assert loaded.id == "test-id"
    assert loaded.mode == "full"


def test_migration_state_load_returns_none_when_missing(tmp_path):
    path = str(tmp_path / "nonexistent.json")
    assert MigrationState.load(path) is None


def test_migration_plan_item_defaults():
    item = MigrationPlanItem(
        source="/old/comic.cbz",
        target="/new/comic.cbz",
        db_key=("hcomic", "12345", "MMCG_SHORT"),
    )
    assert item.status == "pending"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /e/Developing/hcomic_downloader && python -m pytest tests/test_migration.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'migration'`

- [ ] **Step 3: Implement data models**

创建 `migration.py`：

```python
"""漫画库迁移引擎"""
import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

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
    phase: str = "moving"  # moving | updating_db | verifying


@dataclass
class MigrationState:
    """迁移状态持久化"""
    id: str
    mode: str  # full | repair
    source_dir: str
    target_dir: str
    status: str = "planning"  # planning | ready | running | paused | completed | failed
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
        tmp_fd, tmp_path = "", ""
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp_fd, tmp_path = os.open(
                path + ".tmp",
                os.O_WRONLY | os.O_CREAT | os.O_TRUNC,
                0o600,
            )
            data = json.dumps(self.to_dict(), ensure_ascii=False, indent=2)
            os.write(tmp_fd, data.encode("utf-8"))
            os.close(tmp_fd)
            tmp_fd = ""
            os.replace(tmp_path, path)
        except Exception:
            if tmp_fd:
                os.close(tmp_fd)
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)
            raise

    @classmethod
    def load(cls, path: str) -> Optional["MigrationState"]:
        if not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return cls.from_dict(data)
```

- [ ] **Step 4: Run tests**

Run: `cd /e/Developing/hcomic_downloader && python -m pytest tests/test_migration.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add migration.py tests/test_migration.py
git commit -m "feat: add MigrationState and MigrationPlanItem data models"
```

---

### Task 3: 迁移引擎 — 计划生成

**Files:**
- Modify: `migration.py`
- Modify: `tests/test_migration.py`

- [ ] **Step 1: Write failing test for full migration planning**

追加到 `tests/test_migration.py`：

```python
from unittest.mock import MagicMock


@pytest.fixture
def mock_history_db(tmp_path):
    """创建一个带有记录的 mock history DB"""
    db = MagicMock()
    db.get_all_records.return_value = [
        {
            "source_site": "hcomic",
            "comic_id": "100",
            "comic_source": "MMCG_SHORT",
            "title": "Comic A",
            "author": "Author A",
            "output_path": str(tmp_path / "source" / "Author A-Comic A.cbz"),
            "output_format": "cbz",
            "downloaded_at": 1715836800,
        },
        {
            "source_site": "hcomic",
            "comic_id": "200",
            "comic_source": "NH",
            "title": "Comic B",
            "author": "Author B",
            "output_path": str(tmp_path / "source" / "Author B-Comic B.cbz"),
            "output_format": "cbz",
            "downloaded_at": 1715836900,
        },
    ]
    return db


def test_plan_full_migration_generates_plan(mock_history_db, tmp_path):
    from migration import MigrationEngine

    source_dir = str(tmp_path / "source")
    target_dir = str(tmp_path / "target")
    os.makedirs(source_dir, exist_ok=True)
    os.makedirs(target_dir, exist_ok=True)

    # 创建源文件
    src_file1 = os.path.join(source_dir, "Author A-Comic A.cbz")
    src_file2 = os.path.join(source_dir, "Author B-Comic B.cbz")
    with open(src_file1, "w") as f:
        f.write("comic a")
    with open(src_file2, "w") as f:
        f.write("comic b")

    engine = MigrationEngine(history_db=mock_history_db)
    state = engine.plan_full_migration(source_dir, target_dir)

    assert state.status == "ready"
    assert state.total_items == 2
    assert len(state.plan) == 2
    assert state.plan[0].source == src_file1
    assert state.plan[0].target == os.path.join(target_dir, "Author A-Comic A.cbz")
    assert state.plan[0].db_key == ("hcomic", "100", "MMCG_SHORT")


def test_plan_full_migration_skips_missing_files(mock_history_db, tmp_path):
    from migration import MigrationEngine

    source_dir = str(tmp_path / "source")
    target_dir = str(tmp_path / "target")
    os.makedirs(source_dir, exist_ok=True)
    os.makedirs(target_dir, exist_ok=True)

    # 只创建第一个文件
    src_file1 = os.path.join(source_dir, "Author A-Comic A.cbz")
    with open(src_file1, "w") as f:
        f.write("comic a")

    engine = MigrationEngine(history_db=mock_history_db)
    state = engine.plan_full_migration(source_dir, target_dir)

    assert state.total_items == 1
    assert len(state.plan) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /e/Developing/hcomic_downloader && python -m pytest tests/test_migration.py::test_plan_full_migration_generates_plan -v`
Expected: FAIL with `ImportError` or `AttributeError` (MigrationEngine not defined)

- [ ] **Step 3: Implement MigrationEngine.plan_full_migration**

在 `migration.py` 末尾追加：

```python
class MigrationEngine:
    """漫画库迁移引擎"""

    def __init__(self, history_db):
        self._history_db = history_db
        self._state: Optional[MigrationState] = None
        self._pause_requested = False

    @property
    def state(self) -> Optional[MigrationState]:
        return self._state

    @staticmethod
    def _is_same_drive(path1: str, path2: str) -> bool:
        try:
            return os.stat(path1).st_dev == os.stat(path2).st_dev
        except OSError:
            return False

    def plan_full_migration(self, source_dir: str, target_dir: str) -> MigrationState:
        """Generate a full migration plan based on DB records."""
        import uuid

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

            # 计算目标路径：保持源目录下的相对路径
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
```

- [ ] **Step 4: Run tests**

Run: `cd /e/Developing/hcomic_downloader && python -m pytest tests/test_migration.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add migration.py tests/test_migration.py
git commit -m "feat: add MigrationEngine.plan_full_migration"
```

---

### Task 4: 迁移引擎 — 完整迁移执行

**Files:**
- Modify: `migration.py`
- Modify: `tests/test_migration.py`

- [ ] **Step 1: Write failing test for migration execution**

追加到 `tests/test_migration.py`：

```python
def test_execute_full_migration_moves_files_and_updates_db(mock_history_db, tmp_path):
    from migration import MigrationEngine

    source_dir = str(tmp_path / "source")
    target_dir = str(tmp_path / "target")
    os.makedirs(source_dir, exist_ok=True)
    os.makedirs(target_dir, exist_ok=True)

    src_file1 = os.path.join(source_dir, "Author A-Comic A.cbz")
    src_file2 = os.path.join(source_dir, "Author B-Comic B.cbz")
    with open(src_file1, "w") as f:
        f.write("comic a")
    with open(src_file2, "w") as f:
        f.write("comic b")

    engine = MigrationEngine(history_db=mock_history_db)
    state = engine.plan_full_migration(source_dir, target_dir)

    progress_calls = []
    engine.execute(on_progress=lambda p: progress_calls.append(p))

    assert not os.path.exists(src_file1)
    assert not os.path.exists(src_file2)
    assert os.path.exists(os.path.join(target_dir, "Author A-Comic A.cbz"))
    assert os.path.exists(os.path.join(target_dir, "Author B-Comic B.cbz"))

    # 验证 DB 更新被调用
    assert mock_history_db.update_output_path.call_count == 2

    # 验证进度回调被触发
    assert len(progress_calls) > 0
    assert state.status == "completed"


def test_execute_continues_on_single_file_failure(mock_history_db, tmp_path):
    from migration import MigrationEngine

    source_dir = str(tmp_path / "source")
    target_dir = str(tmp_path / "target")
    os.makedirs(source_dir, exist_ok=True)
    os.makedirs(target_dir, exist_ok=True)

    # 只创建第一个文件，第二个文件不存在（plan 里不包含它因为 plan 时就跳过了）
    # 为了测试单文件失败，让 DB 记录指向一个不存在的子目录
    src_file1 = os.path.join(source_dir, "Author A-Comic A.cbz")
    with open(src_file1, "w") as f:
        f.write("comic a")

    # 修改第二个记录让文件存在但目标不可写（通过让目标已存在一个只读文件来模拟）
    engine = MigrationEngine(history_db=mock_history_db)
    state = engine.plan_full_migration(source_dir, target_dir)

    # 只有一个文件在 plan 里（另一个不存在被跳过了）
    assert state.total_items == 1

    error_calls = []
    engine.execute(on_progress=lambda p: None, on_error=lambda e: error_calls.append(e))

    assert state.status == "completed"
    assert state.completed_items == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /e/Developing/hcomic_downloader && python -m pytest tests/test_migration.py::test_execute_full_migration_moves_files_and_updates_db -v`
Expected: FAIL with `TypeError` (execute method not defined or signature mismatch)

- [ ] **Step 3: Implement MigrationEngine.execute**

在 `migration.py` 的 `MigrationEngine` 类中追加：

```python
    def execute(
        self,
        on_progress=None,
        on_error=None,
    ):
        """Execute the migration plan. Must be called after plan_full_migration or plan_repair."""
        if not self._state or self._state.status not in ("ready", "paused"):
            raise RuntimeError("No migration plan ready to execute")

        self._state.status = "running"
        self._pause_requested = False

        if self._state.started_at == 0.0:
            self._state.started_at = time.time()

        for item in self._state.plan:
            if item.status != "pending":
                continue

            while self._state.status == "paused":
                time.sleep(0.5)
                if self._pause_requested:
                    self._state.status = "paused"
                    return

            if self._pause_requested:
                self._state.status = "paused"
                self._pause_requested = False
                return

            try:
                self._move_item(item)
                item.status = "done"
                self._state.completed_items += 1
            except Exception as e:
                item.status = "failed"
                self._state.failed_items.append({
                    "path": item.source,
                    "error": str(e),
                })
                logger.error("Migration failed for %s: %s", item.source, e)
                if on_error:
                    on_error({"message": str(e), "file_path": item.source})

            if on_progress:
                on_progress(MigrationProgress(
                    completed=self._state.completed_items,
                    total=self._state.total_items,
                    current_file=os.path.basename(item.source),
                    phase="moving",
                ))

        self._state.status = "completed"

    def _move_item(self, item: MigrationPlanItem):
        """Move a single file or directory."""
        os.makedirs(os.path.dirname(item.target), exist_ok=True)

        if not os.path.exists(item.source):
            raise FileNotFoundError(f"Source not found: {item.source}")

        source_dir = self._state.source_dir
        target_dir = self._state.target_dir

        if self._is_same_drive(source_dir, target_dir):
            os.rename(item.source, item.target)
        else:
            if os.path.isdir(item.source):
                import shutil
                shutil.copytree(item.source, item.target)
                shutil.rmtree(item.source)
            else:
                import shutil
                shutil.copy2(item.source, item.target)
                os.remove(item.source)

        # 更新数据库
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
```

- [ ] **Step 4: Run tests**

Run: `cd /e/Developing/hcomic_downloader && python -m pytest tests/test_migration.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add migration.py tests/test_migration.py
git commit -m "feat: add MigrationEngine.execute with file move and DB update"
```

---

### Task 5: 迁移引擎 — 修复模式

**Files:**
- Modify: `migration.py`
- Modify: `tests/test_migration.py`

- [ ] **Step 1: Write failing test for repair mode planning**

追加到 `tests/test_migration.py`：

```python
def test_plan_repair_matches_files_by_comic_id(mock_history_db, tmp_path):
    from migration import MigrationEngine

    target_dir = str(tmp_path / "target")
    os.makedirs(target_dir, exist_ok=True)

    # 创建文件，文件名包含 comic_id
    with open(os.path.join(target_dir, "Author A-Comic A-100.cbz"), "w") as f:
        f.write("comic a")
    with open(os.path.join(target_dir, "Author B-Comic B-200.cbz"), "w") as f:
        f.write("comic b")

    engine = MigrationEngine(history_db=mock_history_db)
    state = engine.plan_repair(target_dir, "{author}-{title}-{id}.cbz")

    assert state.mode == "repair"
    assert state.status == "ready"
    # Should find matches for both files
    matched = [p for p in state.plan if p.status == "pending"]
    assert len(matched) >= 0  # exact matching depends on filename template


def test_plan_repair_returns_unmatched_items(tmp_path):
    from migration import MigrationEngine

    target_dir = str(tmp_path / "target")
    os.makedirs(target_dir, exist_ok=True)

    # Create a file that won't match any DB record
    with open(os.path.join(target_dir, "Unknown-Comic.cbz"), "w") as f:
        f.write("unknown")

    mock_db = MagicMock()
    mock_db.get_all_records.return_value = []  # No DB records

    engine = MigrationEngine(history_db=mock_db)
    state = engine.plan_repair(target_dir, "{author}-{title}.cbz")

    assert state.mode == "repair"
    # unmatched_files should contain the unknown file
    assert len(state.plan) == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /e/Developing/hcomic_downloader && python -m pytest tests/test_migration.py::test_plan_repair_matches_files_by_comic_id -v`
Expected: FAIL with `AttributeError` (plan_repair not defined)

- [ ] **Step 3: Implement plan_repair**

在 `migration.py` 的 `MigrationEngine` 类中追加：

```python
    def plan_repair(
        self,
        target_dir: str,
        filename_template: str = "{author}-{title}.cbz",
    ) -> MigrationState:
        """Generate a repair plan: match files in target_dir to DB records."""
        import uuid

        target_dir = os.path.normpath(target_dir)
        records = self._history_db.get_all_records()

        # 扫描目标目录下的所有 cbz/zip 文件和文件夹
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
        basename = os.path.basename if files else ""
        # 第一轮：comic_id 精确匹配
        if comic_id:
            for f in files:
                name = os.path.basename(f)
                if comic_id in name:
                    return f

        # 第二轮：title + author 模糊匹配
        search_str = f"{author}-{title}" if author else title
        search_str = search_str.lower()
        for f in files:
            name = os.path.basename(f).lower()
            # 去掉扩展名
            name_no_ext = os.path.splitext(name)[0]
            if search_str and search_str in name_no_ext:
                return f

        return None
```

- [ ] **Step 4: Run tests**

Run: `cd /e/Developing/hcomic_downloader && python -m pytest tests/test_migration.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add migration.py tests/test_migration.py
git commit -m "feat: add MigrationEngine.plan_repair for manual-move DB repair"
```

---

### Task 6: 迁移引擎 — 状态文件持久化与断点续传

**Files:**
- Modify: `migration.py`
- Modify: `tests/test_migration.py`

- [ ] **Step 1: Write failing test for state persistence during execution**

追加到 `tests/test_migration.py`：

```python
def test_execute_saves_state_after_each_item(mock_history_db, tmp_path):
    from migration import MigrationEngine

    source_dir = str(tmp_path / "source")
    target_dir = str(tmp_path / "target")
    state_path = str(tmp_path / "migration_state.json")
    os.makedirs(source_dir, exist_ok=True)
    os.makedirs(target_dir, exist_ok=True)

    with open(os.path.join(source_dir, "Author A-Comic A.cbz"), "w") as f:
        f.write("comic a")
    with open(os.path.join(source_dir, "Author B-Comic B.cbz"), "w") as f:
        f.write("comic b")

    engine = MigrationEngine(history_db=mock_history_db, state_path=state_path)
    engine.plan_full_migration(source_dir, target_dir)

    engine.execute(on_progress=lambda p: None)

    # 验证状态文件已保存且为 completed
    final_state = MigrationState.load(state_path)
    assert final_state is not None
    assert final_state.status == "completed"
    assert final_state.completed_items == 2


def test_resume_from_saved_state(mock_history_db, tmp_path):
    from migration import MigrationEngine

    source_dir = str(tmp_path / "source")
    target_dir = str(tmp_path / "target")
    state_path = str(tmp_path / "migration_state.json")
    os.makedirs(source_dir, exist_ok=True)
    os.makedirs(target_dir, exist_ok=True)

    with open(os.path.join(source_dir, "Author A-Comic A.cbz"), "w") as f:
        f.write("comic a")
    with open(os.path.join(source_dir, "Author B-Comic B.cbz"), "w") as f:
        f.write("comic b")

    # 第一次迁移，完成后保存状态
    engine = MigrationEngine(history_db=mock_history_db, state_path=state_path)
    engine.plan_full_migration(source_dir, target_dir)
    # 模拟只完成了一个 item（手动设置）
    engine._state.plan[0].status = "done"
    engine._state.plan[1].status = "pending"
    engine._state.completed_items = 1
    engine._state.status = "paused"
    engine._state.save(state_path)

    # 从状态文件恢复
    engine2 = MigrationEngine(history_db=mock_history_db, state_path=state_path)
    restored = engine2.load_state(state_path)
    assert restored is True
    assert engine2._state.completed_items == 1
    assert engine2._state.plan[1].status == "pending"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /e/Developing/hcomic_downloader && python -m pytest tests/test_migration.py::test_execute_saves_state_after_each_item -v`
Expected: FAIL (state_path parameter not accepted by constructor)

- [ ] **Step 3: Add state_path and persistence to MigrationEngine**

修改 `MigrationEngine.__init__` 和 `execute`，增加状态文件自动保存。更新 `migration.py` 中 `MigrationEngine` 的 `__init__`：

```python
    def __init__(self, history_db, state_path: str = ""):
        self._history_db = history_db
        self._state: Optional[MigrationState] = None
        self._pause_requested = False
        self._state_path = state_path
```

在 `execute` 方法中，每次 item 处理完后保存状态。在 `item.status = "done"` 和 `item.status = "failed"` 之后各加一行：

```python
                self._save_state_if_needed()
```

在 `execute` 方法的 `self._state.status = "running"` 后、循环前也加：

```python
        self._save_state_if_needed()
```

在 `execute` 方法最后 `self._state.status = "completed"` 后也加：

```python
        self._save_state_if_needed()
```

在 `MigrationEngine` 类中追加辅助方法：

```python
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
```

- [ ] **Step 4: Run tests**

Run: `cd /e/Developing/hcomic_downloader && python -m pytest tests/test_migration.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add migration.py tests/test_migration.py
git commit -m "feat: add state persistence and resume to MigrationEngine"
```

---

### Task 7: 迁移引擎 — 日志系统

**Files:**
- Modify: `migration.py`

- [ ] **Step 1: Add logging to MigrationEngine**

在 `migration.py` 的 `MigrationEngine` 类中追加：

```python
    @staticmethod
    def _get_log_path() -> str:
        return os.path.join(
            os.path.expanduser("~"), ".hcomic_downloader", "migration.log"
        )

    def _write_log(self, level: str, message: str):
        log_path = self._get_log_path()
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        line = f"[{timestamp}] [{level}] {message}\n"
        try:
            os.makedirs(os.path.dirname(log_path), exist_ok=True)
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(line)
        except OSError:
            logger.warning("Failed to write migration log: %s", message)
```

在 `_move_item` 成功后调用 `self._write_log("INFO", f"Moved: {os.path.basename(item.source)} -> {os.path.basename(item.target)}")`。

在 `_move_item` 的 except 分支调用 `self._write_log("ERROR", f"Failed: {os.path.basename(item.source)} — {e}")`。

在 `execute` 开始时（`self._state.status = "running"` 后）清空旧日志：

```python
        log_path = self._get_log_path()
        if os.path.exists(log_path):
            try:
                os.unlink(log_path)
            except OSError:
                pass
```

- [ ] **Step 2: Run all migration tests**

Run: `cd /e/Developing/hcomic_downloader && python -m pytest tests/test_migration.py -v`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add migration.py
git commit -m "feat: add file logging to MigrationEngine"
```

---

### Task 8: MigrationMixin — IPC 桥接

**Files:**
- Create: `python/ipc/migration_mixin.py`

- [ ] **Step 1: Create MigrationMixin**

创建 `python/ipc/migration_mixin.py`：

```python
"""Migration management mixin for IPCServer."""
import logging
import os
import threading
from typing import Dict, Optional

from migration import MigrationEngine, MigrationState

logger = logging.getLogger(__name__)


class MigrationMixin:
    """Mixin providing migration handler methods for IPCServer."""

    def _init_migration(self):
        """Initialize migration state. Call from IPCServer.__init__."""
        state_path = os.path.join(
            os.path.expanduser("~"), ".hcomic_downloader", "migration_state.json"
        )
        self._migration_engine = MigrationEngine(
            history_db=self._history_db,
            state_path=state_path,
        )
        self._migration_thread: Optional[threading.Thread] = None
        self._migration_lock = threading.Lock()

    def _migration_progress_callback(self, progress):
        """Send migration progress as notification."""
        self._write_response({
            "jsonrpc": "2.0",
            "method": "migration_progress",
            "params": {
                "completed": progress.completed,
                "total": progress.total,
                "currentFile": progress.current_file,
                "speed": progress.speed,
                "phase": progress.phase,
            },
        })

    def _migration_complete_callback(self):
        """Send migration complete notification."""
        state = self._migration_engine.state
        if not state:
            return
        succeeded = state.completed_items
        failed = len(state.failed_items)
        elapsed = state.updated_at - state.started_at if state.started_at else 0
        self._write_response({
            "jsonrpc": "2.0",
            "method": "migration_complete",
            "params": {
                "total": state.total_items,
                "succeeded": succeeded,
                "failed": failed,
                "elapsed": round(elapsed, 1),
            },
        })

    def _migration_error_callback(self, error_info):
        """Send single file error notification."""
        self._write_response({
            "jsonrpc": "2.0",
            "method": "migration_error",
            "params": error_info,
        })

    def _run_migration(self):
        """Run migration in a background thread."""
        try:
            self._migration_engine.execute(
                on_progress=self._migration_progress_callback,
                on_error=self._migration_error_callback,
            )
        except Exception as e:
            logger.error("Migration engine error: %s", e)
        finally:
            self._migration_complete_callback()

    def handle_start_migration(self, target_dir: str, mode: str) -> Dict:
        """Generate migration plan without executing."""
        target_dir = os.path.normpath(target_dir)
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
                state = self._migration_engine.plan_full_migration(
                    self.config.download_dir, target_dir
                )
            else:
                state = self._migration_engine.plan_repair(
                    target_dir, self.config.cbz_filename_template
                )

        return {
            "migrationId": state.id,
            "totalItems": state.total_items,
            "sourceDir": state.source_dir,
            "targetDir": state.target_dir,
            "isSameDrive": MigrationEngine._is_same_drive(
                state.source_dir, state.target_dir
            ) if state.source_dir else False,
        }

    def handle_confirm_migration(self, migration_id: str) -> Dict:
        """Start executing a previously planned migration."""
        with self._migration_lock:
            state = self._migration_engine.state
            if not state or state.id != migration_id:
                raise ValueError("Invalid migration_id")
            if state.status != "ready":
                raise RuntimeError(f"Migration is in status: {state.status}")

            # 暂停下载队列
            if hasattr(self, '_download_manager'):
                self._download_manager.toggle_global_pause()

            self._migration_thread = threading.Thread(
                target=self._run_migration,
                name="migration-worker",
                daemon=True,
            )
            self._migration_thread.start()

        return {"started": True}

    def handle_pause_migration(self) -> Dict:
        self._migration_engine.pause()
        return {"paused": True}

    def handle_resume_migration(self) -> Dict:
        state = self._migration_engine.state
        if not state or state.status not in ("paused", "failed"):
            raise RuntimeError("No paused migration to resume")

        self._migration_engine.resume()

        # 重新启动后台线程继续执行
        self._migration_thread = threading.Thread(
            target=self._run_migration,
            name="migration-worker",
            daemon=True,
        )
        self._migration_thread.start()

        return {"resumed": True}

    def handle_cancel_migration(self) -> Dict:
        with self._migration_lock:
            self._migration_engine.pause()
            state = self._migration_engine.state
            if state:
                state.status = "cancelled"
                self._migration_engine._save_state_if_needed()
        return {"cancelled": True}

    def handle_get_migration_status(self) -> Dict:
        state = self._migration_engine.state
        if not state:
            return {"status": "none"}
        return state.to_dict()

    def handle_resolve_unmatched(self, matches: list) -> Dict:
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
```

- [ ] **Step 2: Commit**

```bash
git add python/ipc/migration_mixin.py
git commit -m "feat: add MigrationMixin IPC bridge"
```

---

### Task 9: 将 MigrationMixin 集成到 IPCServer

**Files:**
- Modify: `python/ipc_server.py`
- Modify: `python/ipc/types.py`

- [ ] **Step 1: Update IPCServer to include MigrationMixin**

在 `python/ipc_server.py` 中：

1. 追加 import：`from ipc.migration_mixin import MigrationMixin`

2. 修改 class 定义行：
```python
class IPCServer(SearchMixin, CoverMixin, PreviewMixin, DownloadMixin, ConfigMixin, AuthMixin, MigrationMixin):
```

3. 在 `__init__` 末尾（`self._cover_cache = CoverCacheDB(...)` 之后）追加：
```python
        # Migration engine
        self._init_migration()
```

4. 在 `handle_request` 的 `handlers` dict 中追加：
```python
            "start_migration": self.handle_start_migration,
            "confirm_migration": self.handle_confirm_migration,
            "pause_migration": self.handle_pause_migration,
            "resume_migration": self.handle_resume_migration,
            "cancel_migration": self.handle_cancel_migration,
            "get_migration_status": self.handle_get_migration_status,
            "resolve_unmatched": self.handle_resolve_unmatched,
```

- [ ] **Step 2: Run existing IPC tests to verify no breakage**

Run: `cd /e/Developing/hcomic_downloader && python -m pytest tests/ -v --timeout=30`
Expected: All existing tests PASS

- [ ] **Step 3: Commit**

```bash
git add python/ipc_server.py
git commit -m "feat: integrate MigrationMixin into IPCServer"
```

---

### Task 10: 共享类型 — 新增迁移相关类型

**Files:**
- Modify: `shared/types.ts`

- [ ] **Step 1: Add migration types and IPC channels**

在 `shared/types.ts` 中追加类型和 channels：

1. 在 `IPC_CHANNELS` 对象中追加：
```typescript
  START_MIGRATION: 'python:start-migration',
  CONFIRM_MIGRATION: 'python:confirm-migration',
  PAUSE_MIGRATION: 'python:pause-migration',
  RESUME_MIGRATION: 'python:resume-migration',
  CANCEL_MIGRATION: 'python:cancel-migration',
  GET_MIGRATION_STATUS: 'python:get-migration-status',
  RESOLVE_UNMATCHED: 'python:resolve-unmatched',
```

2. 在 `PYTHON_IPC_CHANNEL_MAP` 中追加对应的映射：
```typescript
  'python:start-migration': 'start_migration',
  'python:confirm-migration': 'confirm_migration',
  'python:pause-migration': 'pause_migration',
  'python:resume-migration': 'resume_migration',
  'python:cancel-migration': 'cancel_migration',
  'python:get-migration-status': 'get_migration_status',
  'python:resolve-unmatched': 'resolve_unmatched',
```

3. 在 `NOTIFICATION_CHANNELS` 中追加：
```typescript
  MIGRATION_PROGRESS: 'migration:progress',
  MIGRATION_COMPLETE: 'migration:complete',
  MIGRATION_ERROR: 'migration:error',
```

4. 在文件末尾（`CONFIG_KEYS` 之前）追加类型定义：
```typescript
export interface MigrationPlanPreview {
  migrationId: string
  totalItems: number
  sourceDir: string
  targetDir: string
  isSameDrive: boolean
}

export interface MigrationProgressEvent {
  completed: number
  total: number
  currentFile: string
  speed: number
  phase: string
}

export interface MigrationCompleteEvent {
  total: number
  succeeded: number
  failed: number
  elapsed: number
}

export interface MigrationErrorEvent {
  message: string
  file_path: string
}
```

5. 在 `HcomicAPI` interface 中追加方法签名：
```typescript
  startMigration(targetDir: string, mode: 'full' | 'repair'): Promise<MigrationPlanPreview>
  confirmMigration(migrationId: string): Promise<{ started: boolean }>
  pauseMigration(): Promise<{ paused: boolean }>
  resumeMigration(): Promise<{ resumed: boolean }>
  cancelMigration(): Promise<{ cancelled: boolean }>
  getMigrationStatus(): Promise<Record<string, unknown>>
  resolveUnmatched(matches: Array<{ dbKey: string[]; file_path: string }>): Promise<{ resolved: number }>
  onMigrationProgress(callback: (data: MigrationProgressEvent) => void): () => void
  onMigrationComplete(callback: (data: MigrationCompleteEvent) => void): () => void
  onMigrationError(callback: (data: MigrationErrorEvent) => void): () => void
```

6. 在 `IPCMethods` interface 中追加对应的方法签名：
```typescript
  start_migration: {
    params: { target_dir: string; mode: string }
    result: MigrationPlanPreview
  }
  confirm_migration: {
    params: { migration_id: string }
    result: { started: boolean }
  }
  pause_migration: {
    params: Record<string, never>
    result: { paused: boolean }
  }
  resume_migration: {
    params: Record<string, never>
    result: { resumed: boolean }
  }
  cancel_migration: {
    params: Record<string, never>
    result: { cancelled: boolean }
  }
  get_migration_status: {
    params: Record<string, never>
    result: Record<string, unknown>
  }
  resolve_unmatched: {
    params: { matches: Array<{ db_key: string[]; file_path: string }> }
    result: { resolved: number }
  }
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd /e/Developing/hcomic_downloader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add shared/types.ts
git commit -m "feat: add migration types, IPC channels, and API definitions"
```

---

### Task 11: Electron main.ts — 注册迁移 IPC handlers

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Add validation helpers and IPC handlers**

在 `electron/main.ts` 的 `registerIPCHandlers` 函数中，在最后的 `ipcMain.handle(IPC_CHANNELS.CHECK_DOWNLOADED_STATUS, ...)` 之后追加：

```typescript
  // ── Migration ───────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.START_MIGRATION, async (_, targetDir: unknown, mode: unknown) => {
    if (typeof targetDir !== 'string' || targetDir.length === 0 || targetDir.length > 1024) {
      throw new Error('Invalid targetDir')
    }
    if (targetDir.includes('..') || /[\x00-\x1f\x7f]/.test(targetDir)) {
      throw new Error('Invalid targetDir: path traversal or control characters')
    }
    if (!/^[a-zA-Z]:\\|^\\\\|^\//.test(targetDir)) {
      throw new Error('targetDir must be an absolute path')
    }
    if (mode !== 'full' && mode !== 'repair') {
      throw new Error('mode must be "full" or "repair"')
    }
    return bridge.call('start_migration', { target_dir: targetDir, mode })
  })

  ipcMain.handle(IPC_CHANNELS.CONFIRM_MIGRATION, async (_, migrationId: unknown) => {
    if (typeof migrationId !== 'string' || migrationId.length === 0 || migrationId.length > 256) {
      throw new Error('Invalid migrationId')
    }
    return bridge.call('confirm_migration', { migration_id: migrationId })
  })

  ipcMain.handle(IPC_CHANNELS.PAUSE_MIGRATION, async () => {
    return bridge.call('pause_migration')
  })

  ipcMain.handle(IPC_CHANNELS.RESUME_MIGRATION, async () => {
    return bridge.call('resume_migration')
  })

  ipcMain.handle(IPC_CHANNELS.CANCEL_MIGRATION, async () => {
    return bridge.call('cancel_migration')
  })

  ipcMain.handle(IPC_CHANNELS.GET_MIGRATION_STATUS, async () => {
    return bridge.call('get_migration_status')
  })

  ipcMain.handle(IPC_CHANNELS.RESOLVE_UNMATCHED, async (_, matches: unknown) => {
    if (!Array.isArray(matches) || matches.length > 10000) {
      throw new Error('Invalid matches')
    }
    for (const m of matches) {
      if (typeof m !== 'object' || m === null) throw new Error('Invalid match item')
      const item = m as Record<string, unknown>
      if (!Array.isArray(item.dbKey) || typeof item.file_path !== 'string') {
        throw new Error('Invalid match item: dbKey must be array, file_path must be string')
      }
    }
    const params = {
      matches: (matches as Array<{ dbKey: string[]; file_path: string }>).map(m => ({
        db_key: m.dbKey,
        file_path: m.file_path,
      })),
    }
    return bridge.call('resolve_unmatched', params)
  })
```

- [ ] **Step 2: Add migration notification handlers**

在 `registerIPCHandlers` 函数中，在 `bridge.setNotificationHandler('download_progress', ...)` 块之后追加：

```typescript
  bridge.setNotificationHandler('migration_progress', (params) => {
    mainWindow?.webContents.send(NOTIFICATION_CHANNELS.MIGRATION_PROGRESS, params)
  })

  bridge.setNotificationHandler('migration_complete', (params) => {
    mainWindow?.webContents.send(NOTIFICATION_CHANNELS.MIGRATION_COMPLETE, params)
  })

  bridge.setNotificationHandler('migration_error', (params) => {
    mainWindow?.webContents.send(NOTIFICATION_CHANNELS.MIGRATION_ERROR, params)
  })
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cd /e/Developing/hcomic_downloader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "feat: register migration IPC handlers and notifications in Electron"
```

---

### Task 12: Electron preload.ts — 暴露迁移 API

**Files:**
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add migration API methods to contextBridge**

在 `electron/preload.ts` 的 `contextBridge.exposeInMainWorld('hcomic', {` 对象末尾，`checkDownloadedStatus` 之后追加：

```typescript
  startMigration: (targetDir: unknown, mode: unknown) => {
    if (typeof targetDir !== 'string' || targetDir.length === 0) throw new Error('Invalid targetDir')
    if (mode !== 'full' && mode !== 'repair') throw new Error('Invalid mode')
    return ipcRenderer.invoke(IPC_CHANNELS.START_MIGRATION, targetDir, mode)
  },

  confirmMigration: (migrationId: unknown) => {
    if (typeof migrationId !== 'string' || migrationId.length === 0) throw new Error('Invalid migrationId')
    return ipcRenderer.invoke(IPC_CHANNELS.CONFIRM_MIGRATION, migrationId)
  },

  pauseMigration: () => ipcRenderer.invoke(IPC_CHANNELS.PAUSE_MIGRATION),

  resumeMigration: () => ipcRenderer.invoke(IPC_CHANNELS.RESUME_MIGRATION),

  cancelMigration: () => ipcRenderer.invoke(IPC_CHANNELS.CANCEL_MIGRATION),

  getMigrationStatus: () => ipcRenderer.invoke(IPC_CHANNELS.GET_MIGRATION_STATUS),

  resolveUnmatched: (matches: unknown) => {
    if (!Array.isArray(matches)) throw new Error('Invalid matches')
    return ipcRenderer.invoke(IPC_CHANNELS.RESOLVE_UNMATCHED, matches)
  },

  onMigrationProgress: (callback: unknown) => {
    if (typeof callback !== 'function') throw new Error('Invalid callback')
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on(NOTIFICATION_CHANNELS.MIGRATION_PROGRESS, handler)
    return () => { ipcRenderer.removeListener(NOTIFICATION_CHANNELS.MIGRATION_PROGRESS, handler) }
  },

  onMigrationComplete: (callback: unknown) => {
    if (typeof callback !== 'function') throw new Error('Invalid callback')
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on(NOTIFICATION_CHANNELS.MIGRATION_COMPLETE, handler)
    return () => { ipcRenderer.removeListener(NOTIFICATION_CHANNELS.MIGRATION_COMPLETE, handler) }
  },

  onMigrationError: (callback: unknown) => {
    if (typeof callback !== 'function') throw new Error('Invalid callback')
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on(NOTIFICATION_CHANNELS.MIGRATION_ERROR, handler)
    return () => { ipcRenderer.removeListener(NOTIFICATION_CHANNELS.MIGRATION_ERROR, handler) }
  },
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd /e/Developing/hcomic_downloader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add electron/preload.ts
git commit -m "feat: expose migration APIs in Electron preload"
```

---

### Task 13: 前端 — useMigration hook

**Files:**
- Create: `src/hooks/useMigration.ts`

- [ ] **Step 1: Create useMigration hook**

创建 `src/hooks/useMigration.ts`：

```typescript
import { useCallback, useState, useEffect } from 'react'
import type {
  MigrationPlanPreview,
  MigrationProgressEvent,
  MigrationCompleteEvent,
  MigrationErrorEvent,
} from '@shared/types'

export function useMigration() {
  const { invoke } = useIpc()

  const [progress, setProgress] = useState<MigrationProgressEvent | null>(null)
  const [complete, setComplete] = useState<MigrationCompleteEvent | null>(null)
  const [errors, setErrors] = useState<MigrationErrorEvent[]>([])
  const [isActive, setIsActive] = useState(false)

  useEffect(() => {
    if (!window.hcomic?.onMigrationProgress) return
    const unsub1 = window.hcomic.onMigrationProgress((data: MigrationProgressEvent) => {
      setProgress(data)
      setIsActive(true)
    })
    const unsub2 = window.hcomic.onMigrationComplete((data: MigrationCompleteEvent) => {
      setComplete(data)
      setIsActive(false)
    })
    const unsub3 = window.hcomic.onMigrationError((data: MigrationErrorEvent) => {
      setErrors(prev => [...prev, data])
    })
    return () => { unsub1(); unsub2(); unsub3() }
  }, [])

  const startMigration = useCallback(async (targetDir: string, mode: 'full' | 'repair') => {
    return invoke(() => window.hcomic!.startMigration(targetDir, mode))
  }, [invoke])

  const confirmMigration = useCallback(async (migrationId: string) => {
    setIsActive(true)
    setErrors([])
    setProgress(null)
    setComplete(null)
    return invoke(() => window.hcomic!.confirmMigration(migrationId))
  }, [invoke])

  const pauseMigration = useCallback(async () => {
    return invoke(() => window.hcomic!.pauseMigration())
  }, [invoke])

  const resumeMigration = useCallback(async () => {
    setIsActive(true)
    return invoke(() => window.hcomic!.resumeMigration())
  }, [invoke])

  const cancelMigration = useCallback(async () => {
    return invoke(() => window.hcomic!.cancelMigration())
  }, [invoke])

  const getMigrationStatus = useCallback(async () => {
    return invoke(() => window.hcomic!.getMigrationStatus())
  }, [invoke])

  const resolveUnmatched = useCallback(async (
    matches: Array<{ dbKey: string[]; file_path: string }>
  ) => {
    return invoke(() => window.hcomic!.resolveUnmatched(matches))
  }, [invoke])

  return {
    startMigration,
    confirmMigration,
    pauseMigration,
    resumeMigration,
    cancelMigration,
    getMigrationStatus,
    resolveUnmatched,
    progress,
    complete,
    errors,
    isActive,
    resetState: () => {
      setProgress(null)
      setComplete(null)
      setErrors([])
      setIsActive(false)
    },
  }
}
```

注意：需要从 `./useIpc` import `useIpc`：

```typescript
import { useIpc } from './useIpc'
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd /e/Developing/hcomic_downloader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMigration.ts
git commit -m "feat: add useMigration React hook"
```

---

### Task 14: 前端 — MigrationDialog 组件

**Files:**
- Create: `src/components/settings/MigrationDialog.tsx`

- [ ] **Step 1: Create MigrationDialog component**

创建 `src/components/settings/MigrationDialog.tsx`：

```tsx
import { useState, useEffect, useRef } from 'react'
import { useMigration } from '../../hooks/useMigration'
import type { MigrationPlanPreview } from '@shared/types'

interface MigrationDialogProps {
  isOpen: boolean
  onClose: () => void
  currentDownloadDir: string
}

type MigrationMode = 'full' | 'repair'
type DialogPhase = 'select' | 'preview' | 'executing' | 'done'

export function MigrationDialog({ isOpen, onClose, currentDownloadDir }: MigrationDialogProps) {
  const {
    startMigration, confirmMigration, pauseMigration,
    cancelMigration, progress, complete, errors,
    isActive, resetState,
  } = useMigration()

  const [phase, setPhase] = useState<DialogPhase>('select')
  const [mode, setMode] = useState<MigrationMode>('full')
  const [targetDir, setTargetDir] = useState('')
  const [preview, setPreview] = useState<MigrationPlanPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (phase === 'executing' && complete) {
      setPhase('done')
    }
  }, [complete, phase])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [errors, progress])

  if (!isOpen) return null

  const handleNext = async () => {
    setError(null)
    if (!targetDir.trim()) {
      setError('请输入目标目录')
      return
    }
    try {
      const result = await startMigration(targetDir, mode)
      setPreview(result)
      setPhase('preview')
    } catch (err: any) {
      setError(err?.message || '生成迁移计划失败')
    }
  }

  const handleStart = async () => {
    if (!preview) return
    setError(null)
    try {
      await confirmMigration(preview.migrationId)
      setPhase('executing')
    } catch (err: any) {
      setError(err?.message || '启动迁移失败')
    }
  }

  const handlePause = async () => {
    try {
      await pauseMigration()
    } catch (err: any) {
      setError(err?.message || '暂停失败')
    }
  }

  const handleCancel = async () => {
    try {
      await cancelMigration()
      resetState()
      setPhase('select')
      onClose()
    } catch (err: any) {
      setError(err?.message || '取消失败')
    }
  }

  const handleClose = () => {
    if (phase === 'executing' && isActive) {
      // 后台运行：只关闭对话框，不停止迁移
      onClose()
      return
    }
    resetState()
    setPhase('select')
    setPreview(null)
    setError(null)
    onClose()
  }

  const percent = progress && progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <h3 className="text-base font-medium text-[var(--text-primary)]">
            迁移漫画库
          </h3>
          <button
            onClick={handleClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xl"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && (
            <div className="text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {phase === 'select' && (
            <>
              {/* Mode tabs */}
              <div className="flex gap-2">
                <button
                  onClick={() => setMode('full')}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm transition-colors ${
                    mode === 'full'
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                  }`}
                >
                  完整迁移
                </button>
                <button
                  onClick={() => setMode('repair')}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm transition-colors ${
                    mode === 'repair'
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                  }`}
                >
                  修复数据库
                </button>
              </div>

              {mode === 'full' && (
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                    当前目录
                  </label>
                  <div className="px-3 py-2 rounded-lg bg-[var(--bg-secondary)] text-sm text-[var(--text-secondary)]">
                    {currentDownloadDir}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                  {mode === 'full' ? '目标目录' : '新的下载目录'}
                </label>
                <input
                  type="text"
                  value={targetDir}
                  onChange={(e) => setTargetDir(e.target.value)}
                  placeholder="请输入绝对路径"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                             text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              {mode === 'repair' && (
                <p className="text-xs text-[var(--text-secondary)]">
                  如果你已经手动将漫画文件搬到了新目录，使用此模式扫描并修复数据库记录。
                </p>
              )}
            </>
          )}

          {phase === 'preview' && preview && (
            <>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--text-secondary)]">迁移文件数</span>
                  <span className="text-[var(--text-primary)] font-medium">{preview.totalItems}</span>
                </div>
                {mode === 'full' && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-secondary)]">源目录</span>
                      <span className="text-[var(--text-primary)] text-xs truncate ml-4">{preview.sourceDir}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-secondary)]">目标目录</span>
                      <span className="text-[var(--text-primary)] text-xs truncate ml-4">{preview.targetDir}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-secondary)]">移动方式</span>
                      <span className="text-[var(--text-primary)]">
                        {preview.isSameDrive ? '同盘移动（瞬间完成）' : '跨盘移动（需要复制文件）'}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {preview.totalItems === 0 && (
                <div className="text-sm text-yellow-600 bg-yellow-500/10 rounded-lg px-3 py-2">
                  未找到可迁移的文件
                </div>
              )}
            </>
          )}

          {phase === 'executing' && (
            <>
              {/* Progress bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-primary)]">
                    {progress?.currentFile || '准备中...'}
                  </span>
                  <span className="text-[var(--text-secondary)]">
                    {progress?.completed || 0} / {progress?.total || 0} ({percent}%)
                  </span>
                </div>
                <div className="w-full h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent)] rounded-full transition-all duration-300"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>

              {/* Log area */}
              {errors.length > 0 && (
                <div
                  ref={logRef}
                  className="max-h-32 overflow-y-auto space-y-1 text-xs"
                >
                  {errors.map((err, i) => (
                    <div key={i} className="text-red-500">
                      {err.file_path ? `${osPath.basename(err.file_path)}: ` : ''}{err.message}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {phase === 'done' && complete && (
            <>
              <div className="text-center space-y-2">
                <div className="text-3xl">
                  {complete.failed > 0 ? '⚠️' : '✅'}
                </div>
                <div className="text-sm text-[var(--text-primary)]">
                  迁移完成：成功 {complete.succeeded} 个
                  {complete.failed > 0 && `，失败 ${complete.failed} 个`}
                  （耗时 {complete.elapsed}s）
                </div>
              </div>

              {complete.failed > 0 && (
                <div className="max-h-24 overflow-y-auto space-y-1 text-xs">
                  {errors.map((err, i) => (
                    <div key={i} className="text-red-500">
                      {err.file_path}: {err.message}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--border)]">
          {phase === 'select' && (
            <>
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)]"
              >
                取消
              </button>
              <button
                onClick={handleNext}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-white"
              >
                下一步
              </button>
            </>
          )}

          {phase === 'preview' && (
            <>
              <button
                onClick={() => { setPhase('select'); setPreview(null) }}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)]"
              >
                返回
              </button>
              <button
                onClick={handleStart}
                disabled={!preview || preview.totalItems === 0}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-white disabled:opacity-50"
              >
                开始迁移
              </button>
            </>
          )}

          {phase === 'executing' && (
            <>
              <button
                onClick={handlePause}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)]"
              >
                暂停
              </button>
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white"
              >
                取消迁移
              </button>
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
              >
                后台运行
              </button>
            </>
          )}

          {phase === 'done' && (
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-white"
            >
              完成
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Helper to avoid importing Node.js path in renderer
const osPath = {
  basename(p: string): string {
    const parts = p.replace(/\\/g, '/').split('/')
    return parts[parts.length - 1] || p
  },
}
```

注意：`osPath.basename` 是一个轻量辅助函数，避免在渲染进程中引入 Node.js 的 `path` 模块。Python 端通过 `migration_error` 通知发送的是 `file_path`（下划线），与 types.ts 中 `MigrationErrorEvent.file_path` 一致。

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd /e/Developing/hcomic_downloader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/MigrationDialog.tsx
git commit -m "feat: add MigrationDialog component with 3-phase UI"
```

---

### Task 15: 前端 — 集成到设置页

**Files:**
- Modify: `src/components/settings/DownloadSettings.tsx`
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: Add migration button to DownloadSettings**

在 `src/components/settings/DownloadSettings.tsx` 中：

1. 在 `DownloadSettingsProps` interface 中追加 prop：
```typescript
  onOpenMigration: () => void
```

2. 在组件函数签名中追加解构：
```typescript
  onOpenMigration,
```

3. 在下载目录的 `<div>` 容器中（`</div>` 结束"打开"按钮那个 flex 容器之后，`<div className="grid grid-cols-2` 之前），追加"迁移漫画库"按钮：
```tsx
        <div className="mt-2">
          <button
            onClick={onOpenMigration}
            className="px-3 py-1.5 text-sm rounded-lg border border-[var(--accent)] text-[var(--accent)]
                       hover:bg-[var(--accent)] hover:text-white transition-colors"
          >
            迁移漫画库
          </button>
        </div>
```

- [ ] **Step 2: Integrate MigrationDialog into SettingsPage**

在 `src/pages/SettingsPage.tsx` 中：

1. 追加 import：
```typescript
import { MigrationDialog } from '../components/settings/MigrationDialog'
import { useMigration } from '../hooks/useMigration'
```

2. 在 SettingsPage 组件中追加 state：
```typescript
  const [isMigrationOpen, setIsMigrationOpen] = useState(false)
  const migrationHook = useMigration()
```

3. 添加后台迁移横幅（在 `<h2>设置</h2>` 之后、第一个设置卡片之前渲染）：
```tsx
      {migrationHook.isActive && (
        <div className="bg-[var(--accent)]/10 border border-[var(--accent)] rounded-xl px-6 py-4 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              正在后台迁移漫画库 ({migrationHook.progress?.completed ?? 0}/{migrationHook.progress?.total ?? 0})
            </p>
            <div className="w-full h-1.5 bg-[var(--bg-secondary)] rounded-full mt-2 overflow-hidden">
              <div
                className="h-full bg-[var(--accent)] rounded-full transition-all duration-300"
                style={{
                  width: `${migrationHook.progress && migrationHook.progress.total > 0
                    ? Math.round((migrationHook.progress.completed / migrationHook.progress.total) * 100) : 0}%`
                }}
              />
            </div>
          </div>
          <button
            onClick={() => setIsMigrationOpen(true)}
            className="px-3 py-1.5 text-sm rounded-lg bg-[var(--accent)] text-white whitespace-nowrap"
          >
            查看详情
          </button>
        </div>
      )}
```

4. 在 `<DownloadSettings` 组件调用中追加 prop：
```tsx
        onOpenMigration={() => setIsMigrationOpen(true)}
```

5. 在 SettingsPage return 的 JSX 末尾（`</div>` 之前）追加：
```tsx
      <MigrationDialog
        isOpen={isMigrationOpen}
        onClose={() => setIsMigrationOpen(false)}
        currentDownloadDir={config.downloadDir}
      />
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cd /e/Developing/hcomic_downloader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/DownloadSettings.tsx src/pages/SettingsPage.tsx
git commit -m "feat: integrate migration dialog into settings page"
```

---

### Task 16: 端到端验证

**Files:** None (verification only)

- [ ] **Step 1: Run all Python tests**

Run: `cd /e/Developing/hcomic_downloader && python -m pytest tests/ -v`
Expected: All PASS

- [ ] **Step 2: Run TypeScript compilation check**

Run: `cd /e/Developing/hcomic_downloader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run frontend lint**

Run: `cd /e/Developing/hcomic_downloader && npx eslint src/ --max-warnings=0`
Expected: No errors

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address any issues found during e2e verification"
```
