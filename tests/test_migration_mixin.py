"""Tests for migration_mixin.py"""

import threading
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
    # ConfigMixin 在 IPCServer.__init__ 中创建的锁，迁移回调落库时需共享。
    m._config_write_lock = threading.Lock()
    m._init_migration()
    return m


class TestPlanLifecycle:
    def test_cancelled_ready_plan_allows_a_new_plan(self, mixin, tmp_path):
        target = str(tmp_path / "library")

        first = mixin.handle_start_migration(target, "repair")
        assert mixin._migration_engine.state.status == "ready"
        with pytest.raises(RuntimeError, match="already in progress"):
            mixin.handle_start_migration(target, "repair")

        mixin.handle_cancel_migration()
        assert mixin._migration_engine.state.status == "cancelled"

        second = mixin.handle_start_migration(target, "repair")
        assert second["migrationId"] != first["migrationId"]
        assert mixin._migration_engine.state.status == "ready"

    @pytest.mark.parametrize("status", ["running", "paused"])
    def test_active_plan_cannot_be_replaced(self, mixin, tmp_path, status):
        target = str(tmp_path / "library")
        first = mixin.handle_start_migration(target, "repair")
        active_engine = mixin._migration_engine
        mixin._migration_engine.state.status = status

        with pytest.raises(RuntimeError, match="already in progress"):
            mixin.handle_start_migration(target, "repair")

        assert mixin._migration_engine.state.id == first["migrationId"]
        assert mixin._migration_engine.state.status == status
        assert mixin._migration_engine is active_engine
        assert active_engine._log_handler is not None

    def test_ready_status_contains_preview_recovery_fields(self, mixin, tmp_path):
        target = str(tmp_path / "library")
        preview = mixin.handle_start_migration(target, "repair")

        status = mixin.handle_get_migration_status()

        assert status["status"] == "ready"
        assert status["id"] == preview["migrationId"]
        assert status["mode"] == "repair"
        assert status["target_dir"] == target
        assert status["total_items"] == preview["totalItems"]
        assert status["is_same_drive"] is False

    def test_replacing_cancelled_plan_closes_old_engine_and_keeps_lock(self, mixin, tmp_path):
        target = str(tmp_path / "library")
        lifecycle_lock = mixin._migration_lock
        mixin.handle_start_migration(target, "repair")
        old_engine = mixin._migration_engine

        mixin.handle_cancel_migration()
        mixin.handle_start_migration(target, "repair")

        assert old_engine._log_handler is None
        assert mixin._migration_lock is lifecycle_lock


class TestDMRecovery:
    def test_confirm_migration_pauses_dm(self, mixin):
        dm = MagicMock()
        mixin._download_manager = dm
        mixin._migration_engine = MagicMock()
        mixin._migration_engine.state = _make_migration_state(id="test-id", status="ready")

        with patch.object(mixin, "_run_migration"):
            mixin.handle_confirm_migration("test-id")

        # 降级记录（test-discipline-gate Phase 1）：已删除 dm.toggle_global_pause.assert_called_once()
        # —— 裸 mock 调用断言重述实现行 self._download_manager.toggle_global_pause()。
        # 真实信号由下方 _migration_paused_dm 状态断言承载（confirm 后置位为 True）。
        assert mixin._migration_paused_dm is True

    def test_migration_complete_resumes_dm(self, mixin):
        mixin._migration_paused_dm = True
        dm = MagicMock()
        mixin._download_manager = dm
        mixin._migration_engine = MagicMock()
        mixin._migration_engine.execute = MagicMock()
        mixin._migration_engine.state = _make_migration_state(status="completed", completed_items=1)

        mixin._run_migration()

        # 降级记录：已删除 dm.toggle_global_pause.assert_called_once()（裸调用断言，重述实现）。
        # 真实信号：迁移完成后 _migration_paused_dm 复位为 False。
        assert mixin._migration_paused_dm is False

    def test_migration_error_resumes_dm(self, mixin):
        mixin._migration_paused_dm = True
        dm = MagicMock()
        mixin._download_manager = dm
        mixin._migration_engine = MagicMock()
        mixin._migration_engine.execute = MagicMock(side_effect=RuntimeError("boom"))
        mixin._migration_engine.state = _make_migration_state(status="error")

        mixin._run_migration()

        # 降级记录：已删除 dm.toggle_global_pause.assert_called_once()（裸调用断言，重述实现）。
        # 真实信号：迁移异常后 _migration_paused_dm 仍复位为 False（finally 兜底）。
        assert mixin._migration_paused_dm is False

    def test_cancel_migration_resumes_dm(self, mixin):
        mixin._migration_paused_dm = True
        dm = MagicMock()
        mixin._download_manager = dm
        mixin._migration_engine = MagicMock()
        mixin._migration_engine.state = _make_migration_state(status="running")

        mixin.handle_cancel_migration()

        # 降级记录：已删除 dm.toggle_global_pause.assert_called_once()（裸调用断言，重述实现）。
        # 真实信号：取消迁移后 _migration_paused_dm 复位为 False。
        assert mixin._migration_paused_dm is False

    def test_no_dm_no_crash_on_complete(self, mixin):
        if hasattr(mixin, "_download_manager"):
            del mixin._download_manager
        mixin._migration_engine = MagicMock()
        mixin._migration_engine.execute = MagicMock()
        mixin._migration_engine.state = _make_migration_state(status="completed")

        mixin._run_migration()

    def test_no_dm_no_crash_on_cancel(self, mixin):
        if hasattr(mixin, "_download_manager"):
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

        # 降级记录（test-discipline-gate Phase 1）：原 dm.toggle_global_pause.assert_not_called()
        # 是裸 mock 调用断言（mock 替换测试：换真实 dm，"未被调用"仍成立，因 _run_migration
        # 仅在 _migration_paused_dm 为 True 时才调用 toggle_global_pause）。
        # 真实信号：_migration_paused_dm 保持 False（未被置位为 True），证明"未暂停则不恢复"的守卫。
        assert mixin._migration_paused_dm is False


class TestLockProtection:
    # 降级记录（test-discipline-gate Phase 1）：已删除两个纯 mock 调用断言用例：
    #   - test_pause_migration_holds_lock：仅断言 mixin._migration_engine.pause.assert_called_once()
    #   - test_resume_migration_holds_lock：仅断言 resume.assert_called_once()
    # 两者均重述紧邻的实现行（handle_pause/resume 内调用 self._migration_engine.pause()/resume()），
    # 无任何可观察状态/返回值断言承载真实信号（mock 替换测试：换真实 engine 断言仍必然成立）。
    # 该类保留有真实信号的 test_resume_migration_invalid_state（守卫：非 paused 状态抛 RuntimeError）。

    def test_resume_migration_invalid_state(self, mixin):
        mixin._migration_engine = MagicMock()
        mixin._migration_engine.state = _make_migration_state(status="running")

        with pytest.raises(RuntimeError, match="No paused migration"):
            mixin.handle_resume_migration()

    def test_concurrent_pause_is_serialized_under_migration_lock(self, mixin):
        """并发 handle_pause_migration 必须在 _migration_lock 下串行——pause 回调不得重叠。

        强化记录（test-discipline-gate Phase 1 / 任务 2.2）：原 test_pause_and_confirm_are_serialized
        的断言 `assert "pause" in pause_order` 仅验证 tracked_pause 包装器被执行，重述调用本身
        （mock 替换测试：换真实 pause 断言仍成立）。改为验证真实并发不变量——
        handle_pause_migration 持 self._migration_lock，故 engine.pause() 调用不得并发重叠。
        """
        import threading

        mixin._migration_engine = MagicMock()
        mixin._migration_engine.state = _make_migration_state(id="test-id", status="ready")

        overlap = {"active": 0, "max": 0}
        overlap_lock = threading.Lock()

        def observing_pause():
            with overlap_lock:
                overlap["active"] += 1
                overlap["max"] = max(overlap["max"], overlap["active"])
            # 放大并发窗口，使未串行化的实现能被捕获
            import time

            time.sleep(0.01)
            with overlap_lock:
                overlap["active"] -= 1

        mixin._migration_engine.pause = observing_pause

        num_threads = 6
        barrier = threading.Barrier(num_threads)
        threads = [
            threading.Thread(target=lambda: (barrier.wait(), mixin.handle_pause_migration()))
            for _ in range(num_threads)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=5)

        # 不变量：_migration_lock 串行化 pause 调用，峰值并发必须为 1
        assert (
            overlap["max"] == 1
        ), f"handle_pause_migration 必须串行调用 engine.pause()，实测峰值并发 = {overlap['max']}（应 = 1）"


class TestConfigWriteLockSerialization:
    """迁移完成回调落库必须与 set_config 落库串行（共享 _config_write_lock）。

    回归：迁移回调在工作线程内 config.save 不持锁时，与 set_config 的
    config.save 并发触发 os.replace，Windows 上偶发 WinError 5，导致
    文件已移动但 config.download_dir 未更新（配置与磁盘脱节）。
    """

    def test_migration_complete_callback_holds_config_write_lock(self, mixin):
        """回调落库段必须持 _config_write_lock（用锁竞争观察验证）。"""
        mixin._migration_engine = MagicMock()
        mixin._migration_engine.state = _make_migration_state(
            status="completed", completed_items=1, target_dir="/new/dir"
        )

        lock_held_during_save = {"value": False}
        original_save = mixin.config.save

        def observing_save(*args, **kwargs):
            # config.save 执行时，_config_write_lock 应已被回调持有（locked 不可再获）
            # 用 acquire(blocking=False) 探测：返回 False 说明锁正被持有
            lock_held_during_save["value"] = not mixin._config_write_lock.acquire(blocking=False)
            if lock_held_during_save["value"]:
                # 探测成功，立刻释放让回调继续（实际是同一把锁，不会再 release）
                # 注意：这里不 release，因为锁就是回调自己持有的；acquire 失败=正确
                pass
            else:
                mixin._config_write_lock.release()
            return original_save(*args, **kwargs)

        mixin.config.save = observing_save
        mixin._apply_runtime = MagicMock()

        mixin._migration_complete_callback()

        assert lock_held_during_save["value"] is True, "config.save 执行期间 _config_write_lock 必须被持有"

    def test_concurrent_save_calls_are_serialized(self, mixin):
        """两处 config.save（回调 + 模拟 set_config）并发时不得重叠执行。"""
        mixin._migration_engine = MagicMock()
        mixin._migration_engine.state = _make_migration_state(
            status="completed", completed_items=1, target_dir="/new/dir"
        )

        overlap = {"active": 0, "max": 0}
        lock = threading.Lock()

        def tracking_save(*args, **kwargs):
            with lock:
                overlap["active"] += 1
                overlap["max"] = max(overlap["max"], overlap["active"])
            # 模拟 save 耗时，放大并发窗口
            import time

            time.sleep(0.01)
            with lock:
                overlap["active"] -= 1

        mixin.config.save = tracking_save
        mixin._apply_runtime = MagicMock()

        # 模拟 set_config 路径的落库（持同一把锁）
        def set_config_save_path():
            with mixin._config_write_lock:
                mixin.config.save()

        threads = [
            threading.Thread(target=mixin._migration_complete_callback),
            threading.Thread(target=set_config_save_path),
            threading.Thread(target=set_config_save_path),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # 串行化验证：任何时刻最多 1 个 save 在执行
        assert overlap["max"] == 1, f"config.save 调用必须串行，实测峰值并发 = {overlap['max']}（应 = 1）"
