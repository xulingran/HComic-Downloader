"""Tests for python/maintenance/orphan_cleaner.py."""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"),
)


from maintenance.orphan_cleaner import cleanup_orphan_temp_dirs, scan_orphan_temp_dirs


def _age_directory(path: Path, hours: float) -> None:
    """将目录的修改时间设为 N 小时前。"""
    old_time = time.time() - hours * 3600
    os.utime(path, (old_time, old_time))


def test_scan_finds_old_orphan(tmp_path: Path):
    orphan = tmp_path / "temp_hcomic_123"
    orphan.mkdir()
    (orphan / "001.jpg").write_text("img")
    _age_directory(orphan, 25)

    db = MagicMock()
    db.get_all_records.return_value = []

    orphans = scan_orphan_temp_dirs(str(tmp_path), history_db=db)
    assert len(orphans) == 1
    assert orphans[0].path == str(orphan)


def test_scan_skips_recent_temp(tmp_path: Path):
    orphan = tmp_path / "temp_hcomic_123"
    orphan.mkdir()
    _age_directory(orphan, 1)

    db = MagicMock()
    db.get_all_records.return_value = []

    orphans = scan_orphan_temp_dirs(str(tmp_path), history_db=db)
    assert orphans == []


def test_scan_skips_active_temp(tmp_path: Path):
    active = tmp_path / "temp_hcomic_123"
    active.mkdir()
    _age_directory(active, 25)

    db = MagicMock()
    db.get_all_records.return_value = []

    orphans = scan_orphan_temp_dirs(
        str(tmp_path),
        history_db=db,
        active_temp_dirs={str(active)},
    )
    assert orphans == []


def test_scan_skips_history_output_path(tmp_path: Path):
    orphan = tmp_path / "temp_hcomic_123"
    orphan.mkdir()
    _age_directory(orphan, 25)

    db = MagicMock()
    db.get_all_records.return_value = [{"output_path": str(orphan)}]

    orphans = scan_orphan_temp_dirs(str(tmp_path), history_db=db)
    assert orphans == []


def test_cleanup_removes_orphans(tmp_path: Path):
    orphan = tmp_path / "temp_hcomic_123"
    orphan.mkdir()
    (orphan / "001.jpg").write_text("img")
    _age_directory(orphan, 25)

    db = MagicMock()
    db.get_all_records.return_value = []

    result = cleanup_orphan_temp_dirs(str(tmp_path), paths=[str(orphan)], history_db=db)
    assert result["removed"] == 1
    assert result["freedBytes"] > 0
    assert not orphan.exists()


def test_cleanup_revalidates_active_temp(tmp_path: Path):
    active = tmp_path / "temp_hcomic_123"
    active.mkdir()
    _age_directory(active, 25)

    db = MagicMock()
    db.get_all_records.return_value = []

    result = cleanup_orphan_temp_dirs(
        str(tmp_path),
        paths=[str(active)],
        history_db=db,
        active_temp_dirs={str(active)},
    )
    assert result["removed"] == 0
    assert len(result["failed"]) == 1
    assert active.exists()


def test_cleanup_toctou_new_active_after_scan(tmp_path: Path):
    """Critical #2 回归：扫描后才有新下载任务复用该 temp_* 目录。

    扫描时 active_temp_dirs 为空（目录当时未被占用），扫描后被新任务复用。
    清理时即时传入最新 active 集合，必须将该目录加入 failed 且不删除。
    """
    orphan = tmp_path / "temp_hcomic_456"
    orphan.mkdir()
    (orphan / "001.jpg").write_text("img")
    _age_directory(orphan, 25)

    db = MagicMock()
    db.get_all_records.return_value = []

    # 扫描时刻无活跃任务
    orphans = scan_orphan_temp_dirs(str(tmp_path), history_db=db, active_temp_dirs=set())
    assert len(orphans) == 1

    # 清理时刻：新下载任务已复用该目录（active_temp_dirs 即时重取到最新集合）
    result = cleanup_orphan_temp_dirs(
        str(tmp_path),
        paths=[str(orphan)],
        history_db=db,
        active_temp_dirs={str(orphan)},  # 模拟清理前即时重取发现的新活跃任务
    )
    assert result["removed"] == 0
    assert any("活跃任务" in f["reason"] for f in result["failed"])
    assert orphan.exists(), "被新活跃任务复用的目录必须保留"


def test_cleanup_toctou_mtime_refreshed_after_scan(tmp_path: Path):
    """Critical #2 回归：扫描后目录被写入导致 mtime 刷新到 24 小时以内。

    扫描时目录足够旧（判定为孤儿），清理前被新内容刷新 mtime。
    清理时实时读 mtime，必须将该目录加入 failed 且不删除。
    """
    orphan = tmp_path / "temp_hcomic_789"
    orphan.mkdir()
    (orphan / "001.jpg").write_text("img")
    _age_directory(orphan, 25)

    db = MagicMock()
    db.get_all_records.return_value = []

    # 扫描时刻目录足够旧
    orphans = scan_orphan_temp_dirs(str(tmp_path), history_db=db, active_temp_dirs=set())
    assert len(orphans) == 1

    # 清理前：模拟新写入刷新 mtime 到当前时间
    (orphan / "002.jpg").write_text("new")
    os.utime(orphan, (time.time(), time.time()))

    result = cleanup_orphan_temp_dirs(
        str(tmp_path),
        paths=[str(orphan)],
        history_db=db,
        active_temp_dirs=set(),
    )
    assert result["removed"] == 0
    assert any("24 小时" in f["reason"] for f in result["failed"])
    assert orphan.exists(), "mtime 被刷新的目录必须保留"
