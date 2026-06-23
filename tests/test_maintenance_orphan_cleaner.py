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
