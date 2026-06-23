"""Tests for download directory change → migration linkage.

验证 config_mixin._apply_download_dir_change 与 migration_mixin.trigger_download_dir_migration
的联动：改下载目录时正确触发 full migration plan，落库时机正确。

对应 capability: download-dir-change-migration
"""

from __future__ import annotations

import os
import sys
import threading
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"),
)

import pytest

from config import Config
from download_history import DownloadHistoryDB
from migration import MigrationEngine
from models import ComicInfo


class _DirChangeHarness:
    """最小化混合实例，同时具备 config_mixin 与 migration_mixin 的相关方法/属性。

    避免实例化完整 IPCServer（需 patch 大量重依赖），聚焦测试目录变更联动逻辑。
    """

    def __init__(self, config: Config, history_db: DownloadHistoryDB, download_manager):
        self.config = config
        self._history_db = history_db
        self._download_manager = download_manager
        # migration_mixin 依赖
        self._migration_engine = MigrationEngine(
            history_db=history_db,
            state_path=None,
        )
        self._migration_thread = None
        self._migration_lock = threading.Lock()
        self._migration_paused_dm = False
        self._write_response = MagicMock()

    # 复用 migration_mixin 的真实方法实现
    from ipc.migration_mixin import MigrationMixin as _MM

    _init_migration = _MM._init_migration
    trigger_download_dir_migration = _MM.trigger_download_dir_migration
    plan_full_migration_via = _MM.trigger_download_dir_migration  # alias for clarity

    # 复用 config_mixin 的真实方法实现
    from ipc.config_mixin import ConfigMixin as _CM

    _apply_download_dir_change = _CM._apply_download_dir_change


@pytest.fixture
def harness(tmp_path: Path):
    config = Config()
    config.download_dir = str(tmp_path / "old_dir")
    os.makedirs(config.download_dir, exist_ok=True)

    db_path = str(tmp_path / "test_history.db")
    history_db = DownloadHistoryDB(db_path)

    download_manager = MagicMock()

    h = _DirChangeHarness(config, history_db, download_manager)
    # _init_migration 会用真实 history_db 重建 engine
    h._init_migration()
    yield h
    history_db.close()


def _make_record(harness, tmp_path: Path, name: str, source_site: str = "hcomic") -> str:
    """在旧 download_dir 下创建一个真实文件并写入历史记录，返回 output_path。"""
    output_path = os.path.join(harness.config.download_dir, f"{name}.cbz")
    Path(output_path).write_bytes(b"fake cbz content")
    comic = ComicInfo(id=name, title=name, source_site=source_site, comic_source="NH")
    harness._history_db.record_download(comic, output_path, "cbz", pages=1)
    return output_path


def test_trigger_migration_plans_when_old_dir_has_records(harness, tmp_path: Path):
    """场景：旧目录有记录文件 → plan 返回 totalItems > 0, skipped=False。"""
    _make_record(harness, tmp_path, "comic1")
    _make_record(harness, tmp_path, "comic2")

    new_dir = str(tmp_path / "new_dir")
    info = harness.trigger_download_dir_migration(new_dir)

    assert info["skipped"] is False
    assert info["totalItems"] == 2
    assert info["migrationId"]
    assert info["sourceDir"] == harness.config.download_dir
    assert info["targetDir"] == new_dir


def test_trigger_migration_skips_when_old_dir_empty(harness, tmp_path: Path):
    """场景：旧目录无记录（total_items==0）→ skipped=True，不启动迁移。"""
    new_dir = str(tmp_path / "new_dir")
    info = harness.trigger_download_dir_migration(new_dir)

    assert info["skipped"] is True
    assert info["totalItems"] == 0


def test_apply_download_dir_change_same_dir_is_fast_path(harness):
    """场景：新旧目录相同 → 快速路径，仅 set_output_dir，返回 None。"""
    same_dir = harness.config.download_dir
    result = harness._apply_download_dir_change(same_dir)

    assert result is None
    harness._download_manager.set_output_dir.assert_called_once_with(same_dir)


def test_apply_download_dir_change_first_time_no_old_dir_is_fast_path(harness, tmp_path: Path):
    """场景：旧 download_dir 为空（首次设置）→ 快速路径。"""
    harness.config.download_dir = ""
    new_dir = str(tmp_path / "first_dir")
    result = harness._apply_download_dir_change(new_dir)

    assert result is None
    harness._download_manager.set_output_dir.assert_called_once_with(new_dir)


def test_apply_download_dir_change_no_records_is_fast_path(harness, tmp_path: Path):
    """场景：新旧不同但旧目录无记录 → skipped, 走快速路径落库。"""
    new_dir = str(tmp_path / "new_dir")
    result = harness._apply_download_dir_change(new_dir)

    # 无记录 → skipped → 快速路径，返回 None 且 set_output_dir 被调
    assert result is None
    harness._download_manager.set_output_dir.assert_called_once_with(new_dir)


def test_apply_download_dir_change_with_records_returns_migration_info(harness, tmp_path: Path):
    """场景：新旧不同且有记录 → 返回 migrationTriggered 信息，不调 set_output_dir（落库交给迁移回调）。"""
    _make_record(harness, tmp_path, "comic1")
    _make_record(harness, tmp_path, "comic2")
    new_dir = str(tmp_path / "new_dir")

    result = harness._apply_download_dir_change(new_dir)

    assert result is not None
    assert result["migrationTriggered"] is True
    assert result["migrationId"]
    assert result["migrationTotalItems"] == 2
    # 关键：未调 set_output_dir（落库延后到迁移完成）
    harness._download_manager.set_output_dir.assert_not_called()
