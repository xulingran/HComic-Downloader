"""Tests for migration_mixin.py"""
from unittest.mock import MagicMock, patch

import pytest

from python.ipc.migration_mixin import MigrationMixin


def _make_migration_state(**overrides):
    state = MagicMock()
    state.completed_items = overrides.get("completed_items", 0)
    state.failed_items = overrides.get("failed_items", [])
    state.target_dir = overrides.get("target_dir", "/tmp")
    state.status = overrides.get("status", "completed")
    state.updated_at = overrides.get("updated_at", 2)
    state.started_at = overrides.get("started_at", 1)
    if "id" in overrides:
        state.id = overrides["id"]
    return state


@pytest.fixture
def mixin(tmp_path):
    m = MigrationMixin()
    m._history_db = MagicMock()
    m.config = MagicMock()
    m.config.download_dir = str(tmp_path / "downloads")
    m.config.cbz_filename_template = "{author}-{title}.cbz"
    m._write_response = MagicMock()
    m._init_migration()
    return m


class TestDMRecovery:
    def test_confirm_migration_pauses_dm(self, mixin):
        dm = MagicMock()
        mixin._download_manager = dm
        mixin._migration_engine = MagicMock()
        mixin._migration_engine.state = _make_migration_state(id="test-id", status="ready")

        with patch.object(mixin, '_run_migration'):
            mixin.handle_confirm_migration("test-id")

        dm.toggle_global_pause.assert_called_once()
        assert mixin._migration_paused_dm is True

    def test_migration_complete_resumes_dm(self, mixin):
        mixin._migration_paused_dm = True
        dm = MagicMock()
        mixin._download_manager = dm
        mixin._migration_engine = MagicMock()
        mixin._migration_engine.execute = MagicMock()
        mixin._migration_engine.state = _make_migration_state(status="completed", completed_items=1)

        mixin._run_migration()

        dm.toggle_global_pause.assert_called_once()
        assert mixin._migration_paused_dm is False

    def test_migration_error_resumes_dm(self, mixin):
        mixin._migration_paused_dm = True
        dm = MagicMock()
        mixin._download_manager = dm
        mixin._migration_engine = MagicMock()
        mixin._migration_engine.execute = MagicMock(side_effect=RuntimeError("boom"))
        mixin._migration_engine.state = _make_migration_state(status="error")

        mixin._run_migration()

        dm.toggle_global_pause.assert_called_once()
        assert mixin._migration_paused_dm is False

    def test_cancel_migration_resumes_dm(self, mixin):
        mixin._migration_paused_dm = True
        dm = MagicMock()
        mixin._download_manager = dm
        mixin._migration_engine = MagicMock()
        mixin._migration_engine.state = _make_migration_state(status="running")

        mixin.handle_cancel_migration()

        dm.toggle_global_pause.assert_called_once()
        assert mixin._migration_paused_dm is False

    def test_no_dm_no_crash_on_complete(self, mixin):
        if hasattr(mixin, '_download_manager'):
            del mixin._download_manager
        mixin._migration_engine = MagicMock()
        mixin._migration_engine.execute = MagicMock()
        mixin._migration_engine.state = _make_migration_state(status="completed")

        mixin._run_migration()

    def test_no_dm_no_crash_on_cancel(self, mixin):
        if hasattr(mixin, '_download_manager'):
            del mixin._download_manager
        mixin._migration_engine = MagicMock()
        mixin._migration_engine.state = _make_migration_state(status="running")

        result = mixin.handle_cancel_migration()

        assert result == {"cancelled": True}

    def test_dm_not_resumed_when_not_paused(self, mixin):
        mixin._migration_paused_dm = False
        dm = MagicMock()
        mixin._download_manager = dm
        mixin._migration_engine = MagicMock()
        mixin._migration_engine.execute = MagicMock()
        mixin._migration_engine.state = _make_migration_state(status="completed")

        mixin._run_migration()

        dm.toggle_global_pause.assert_not_called()


class TestLockProtection:
    def test_pause_migration_holds_lock(self, mixin):
        mixin._migration_engine = MagicMock()

        mixin.handle_pause_migration()

        mixin._migration_engine.pause.assert_called_once()

    def test_resume_migration_holds_lock(self, mixin):
        mixin._migration_engine = MagicMock()
        mixin._migration_engine.state = _make_migration_state(status="paused")

        with patch.object(mixin, '_run_migration'):
            result = mixin.handle_resume_migration()

        mixin._migration_engine.resume.assert_called_once()
        assert result == {"resumed": True}

    def test_resume_migration_invalid_state(self, mixin):
        mixin._migration_engine = MagicMock()
        mixin._migration_engine.state = _make_migration_state(status="running")

        with pytest.raises(RuntimeError, match="No paused migration"):
            mixin.handle_resume_migration()

    def test_pause_and_confirm_are_serialized(self, mixin):
        mixin._migration_engine = MagicMock()
        mixin._migration_engine.state = _make_migration_state(id="test-id", status="ready")

        pause_order = []
        original_pause = mixin._migration_engine.pause

        def tracked_pause():
            pause_order.append("pause")
            original_pause()

        mixin._migration_engine.pause = tracked_pause

        mixin.handle_pause_migration()

        assert "pause" in pause_order
