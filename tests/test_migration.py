"""Tests for migration.py"""
import logging
import os
from unittest.mock import MagicMock, patch

import pytest

from migration import MigrationEngine, MigrationPlanItem, MigrationState


@pytest.fixture(autouse=True)
def _cleanup_migration_logger():
    yield
    logger = logging.getLogger("migration.engine")
    for handler in logger.handlers[:]:
        handler.close()
        logger.removeHandler(handler)


# ── Data model tests ──────────────────────────────────────────────────


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


# ── Fixtures ───────────────────────────────────────────────────────────


@pytest.fixture
def mock_history_db(tmp_path):
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


# ── Full migration planning ───────────────────────────────────────────


def test_plan_full_migration_generates_plan(mock_history_db, tmp_path):
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

    assert state.status == "ready"
    assert state.total_items == 2
    assert len(state.plan) == 2
    assert state.plan[0].source == src_file1
    assert state.plan[0].target == os.path.join(target_dir, "Author A-Comic A.cbz")
    assert state.plan[0].db_key == ("hcomic", "100", "MMCG_SHORT")


def test_plan_full_migration_skips_missing_files(mock_history_db, tmp_path):
    source_dir = str(tmp_path / "source")
    target_dir = str(tmp_path / "target")
    os.makedirs(source_dir, exist_ok=True)
    os.makedirs(target_dir, exist_ok=True)

    src_file1 = os.path.join(source_dir, "Author A-Comic A.cbz")
    with open(src_file1, "w") as f:
        f.write("comic a")

    engine = MigrationEngine(history_db=mock_history_db)
    state = engine.plan_full_migration(source_dir, target_dir)

    assert state.total_items == 1
    assert len(state.plan) == 1


# ── Full migration execution ──────────────────────────────────────────


def test_execute_full_migration_moves_files_and_updates_db(mock_history_db, tmp_path):
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
    engine.plan_full_migration(source_dir, target_dir)

    progress_calls = []
    engine.execute(on_progress=lambda p: progress_calls.append(p))

    assert not os.path.exists(src_file1)
    assert not os.path.exists(src_file2)
    assert os.path.exists(os.path.join(target_dir, "Author A-Comic A.cbz"))
    assert os.path.exists(os.path.join(target_dir, "Author B-Comic B.cbz"))

    assert mock_history_db.update_output_path.call_count == 2
    assert len(progress_calls) > 0
    assert engine.state.status == "completed"


def test_execute_continues_on_single_file_failure(mock_history_db, tmp_path):
    source_dir = str(tmp_path / "source")
    target_dir = str(tmp_path / "target")
    os.makedirs(source_dir, exist_ok=True)
    os.makedirs(target_dir, exist_ok=True)

    src_file1 = os.path.join(source_dir, "Author A-Comic A.cbz")
    with open(src_file1, "w") as f:
        f.write("comic a")

    engine = MigrationEngine(history_db=mock_history_db)
    state = engine.plan_full_migration(source_dir, target_dir)
    assert state.total_items == 1

    error_calls = []
    engine.execute(on_progress=lambda p: None, on_error=lambda e: error_calls.append(e))

    assert state.status == "completed"
    assert state.completed_items == 1


# ── Repair mode ───────────────────────────────────────────────────────


def test_plan_repair_matches_files_by_title_author(tmp_path):
    target_dir = str(tmp_path / "target")
    os.makedirs(target_dir, exist_ok=True)

    with open(os.path.join(target_dir, "Author A-Comic A.cbz"), "w") as f:
        f.write("comic a")

    mock_db = MagicMock()
    mock_db.get_all_records.return_value = [
        {
            "source_site": "hcomic",
            "comic_id": "100",
            "comic_source": "MMCG_SHORT",
            "title": "Comic A",
            "author": "Author A",
            "output_path": "/old/path.cbz",
            "output_format": "cbz",
            "downloaded_at": 1715836800,
        },
    ]

    engine = MigrationEngine(history_db=mock_db)
    state = engine.plan_repair(target_dir)

    assert state.mode == "repair"
    assert state.status == "ready"
    assert len(state.plan) == 1
    assert state.plan[0].target == os.path.join(target_dir, "Author A-Comic A.cbz")


def test_plan_repair_no_match_returns_empty_plan(tmp_path):
    target_dir = str(tmp_path / "target")
    os.makedirs(target_dir, exist_ok=True)

    with open(os.path.join(target_dir, "Unknown-Comic.cbz"), "w") as f:
        f.write("unknown")

    mock_db = MagicMock()
    mock_db.get_all_records.return_value = []

    engine = MigrationEngine(history_db=mock_db)
    state = engine.plan_repair(target_dir)

    assert state.mode == "repair"
    assert len(state.plan) == 0


# ── State persistence ─────────────────────────────────────────────────


def test_execute_saves_state_after_each_item(mock_history_db, tmp_path):
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

    final_state = MigrationState.load(state_path)
    assert final_state is not None
    assert final_state.status == "completed"
    assert final_state.completed_items == 2


def test_resume_from_saved_state(mock_history_db, tmp_path):
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
    engine._state.plan[0].status = "done"
    engine._state.plan[1].status = "pending"
    engine._state.completed_items = 1
    engine._state.status = "paused"
    engine._state.save(state_path)

    engine2 = MigrationEngine(history_db=mock_history_db, state_path=state_path)
    restored = engine2.load_state(state_path)
    assert restored is True
    assert engine2._state.completed_items == 1
    assert engine2._state.plan[1].status == "pending"


# ── T5: FileExistsError handling ──────────────────────────────────────


def test_same_drive_target_exists_reports_clear_error(tmp_path):
    source_dir = str(tmp_path / "source")
    target_dir = str(tmp_path / "target")
    os.makedirs(source_dir, exist_ok=True)
    os.makedirs(target_dir, exist_ok=True)

    src_file = os.path.join(source_dir, "comic.cbz")
    tgt_file = os.path.join(target_dir, "comic.cbz")
    with open(src_file, "w") as f:
        f.write("source content")
    with open(tgt_file, "w") as f:
        f.write("existing target")

    mock_db = MagicMock()
    mock_db.get_all_records.return_value = [
        {
            "source_site": "hcomic",
            "comic_id": "100",
            "comic_source": "MMCG_SHORT",
            "title": "Comic",
            "author": "Author",
            "output_path": src_file,
            "output_format": "cbz",
            "downloaded_at": 1715836800,
        },
    ]

    engine = MigrationEngine(history_db=mock_db)
    state = engine.plan_full_migration(source_dir, target_dir)

    error_calls = []
    engine.execute(on_progress=lambda p: None, on_error=lambda e: error_calls.append(e))

    assert state.status == "completed"
    assert state.plan[0].status == "failed"
    assert "目标文件已存在" in state.failed_items[0]["error"]


# ── T6: Cross-drive source removal failure ────────────────────────────


def test_cross_drive_source_removal_failure_keeps_db_path(tmp_path):
    source_dir = str(tmp_path / "source")
    target_dir = str(tmp_path / "target")
    os.makedirs(source_dir, exist_ok=True)
    os.makedirs(target_dir, exist_ok=True)

    src_file = os.path.join(source_dir, "comic.cbz")
    with open(src_file, "w") as f:
        f.write("content")

    mock_db = MagicMock()
    mock_db.get_all_records.return_value = [
        {
            "source_site": "hcomic",
            "comic_id": "100",
            "comic_source": "MMCG_SHORT",
            "title": "Comic",
            "author": "Author",
            "output_path": src_file,
            "output_format": "cbz",
            "downloaded_at": 1715836800,
        },
    ]

    engine = MigrationEngine(history_db=mock_db)
    state = engine.plan_full_migration(source_dir, target_dir)

    with patch("migration.MigrationEngine._is_same_drive", return_value=False), \
         patch("os.remove", side_effect=OSError("permission denied")):
        engine.execute(on_progress=lambda p: None)

    assert state.plan[0].status == "done"
    mock_db.update_output_path.assert_not_called()


def test_cross_drive_full_success_updates_db(tmp_path):
    source_dir = str(tmp_path / "source")
    target_dir = str(tmp_path / "target")
    os.makedirs(source_dir, exist_ok=True)
    os.makedirs(target_dir, exist_ok=True)

    src_file = os.path.join(source_dir, "comic.cbz")
    with open(src_file, "w") as f:
        f.write("content")

    mock_db = MagicMock()
    mock_db.get_all_records.return_value = [
        {
            "source_site": "hcomic",
            "comic_id": "100",
            "comic_source": "MMCG_SHORT",
            "title": "Comic",
            "author": "Author",
            "output_path": src_file,
            "output_format": "cbz",
            "downloaded_at": 1715836800,
        },
    ]

    engine = MigrationEngine(history_db=mock_db)
    state = engine.plan_full_migration(source_dir, target_dir)

    with patch("migration.MigrationEngine._is_same_drive", return_value=False):
        engine.execute(on_progress=lambda p: None)

    assert state.plan[0].status == "done"
    mock_db.update_output_path.assert_called_once()


# ── T9: Log handler initialized once ─────────────────────────────────


def test_log_handler_initialized_in_constructor(tmp_path):
    with patch("os.makedirs") as mock_makedirs:
        mock_db = MagicMock()
        engine = MigrationEngine(history_db=mock_db)
        mock_makedirs.assert_called_once()
        assert engine._log_handler is not None
        assert engine._migration_logger is not None


# ── T10: Resume preserves log ────────────────────────────────────────


def test_resume_preserves_log(tmp_path):
    source_dir = str(tmp_path / "source")
    target_dir = str(tmp_path / "target")
    os.makedirs(source_dir, exist_ok=True)
    os.makedirs(target_dir, exist_ok=True)

    src_file = os.path.join(source_dir, "comic.cbz")
    with open(src_file, "w") as f:
        f.write("content")

    mock_db = MagicMock()
    mock_db.get_all_records.return_value = [
        {
            "source_site": "hcomic",
            "comic_id": "100",
            "comic_source": "MMCG_SHORT",
            "title": "Comic",
            "author": "Author",
            "output_path": src_file,
            "output_format": "cbz",
            "downloaded_at": 1715836800,
        },
    ]

    engine = MigrationEngine(history_db=mock_db)
    engine.plan_full_migration(source_dir, target_dir)
    engine._state.started_at = 1000.0

    log_path = engine._get_log_path()
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    with open(log_path, "w", encoding="utf-8") as f:
        f.write("[existing log line]\n")

    engine.execute(on_progress=lambda p: None)

    with open(log_path, encoding="utf-8") as f:
        content = f.read()
    assert "[existing log line]" in content


def test_first_execution_clears_log(tmp_path):
    source_dir = str(tmp_path / "source")
    target_dir = str(tmp_path / "target")
    os.makedirs(source_dir, exist_ok=True)
    os.makedirs(target_dir, exist_ok=True)

    src_file = os.path.join(source_dir, "comic.cbz")
    with open(src_file, "w") as f:
        f.write("content")

    mock_db = MagicMock()
    mock_db.get_all_records.return_value = [
        {
            "source_site": "hcomic",
            "comic_id": "100",
            "comic_source": "MMCG_SHORT",
            "title": "Comic",
            "author": "Author",
            "output_path": src_file,
            "output_format": "cbz",
            "downloaded_at": 1715836800,
        },
    ]

    engine = MigrationEngine(history_db=mock_db)
    engine.plan_full_migration(source_dir, target_dir)

    log_path = engine._get_log_path()
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    with open(log_path, "w", encoding="utf-8") as f:
        f.write("[old log]\n")

    assert engine._state.started_at == 0.0
    engine.execute(on_progress=lambda p: None)

    with open(log_path, encoding="utf-8") as f:
        content = f.read()
    assert "[old log]" not in content
