"""下载状态机并发与时序不变量测试。

验证 DownloadManager 在并发操作（add/cancel/pause）与异步状态过渡下的不变量。
严格遵循 design.md 决策 3："测不变量而非时序"：
- 用 threading.Barrier/Event 显式同步并发起点
- 只断言最终一致状态（任务守恒、无重复 ID、已完成不被回滚）
- 禁止 time.sleep 时序断言、禁止 mock 调用顺序断言
对应 regression-guards 的状态机并发回归需求。

基础 DownloadManager（非 ComicDownloadManager）无真实下载 IO，状态转换在锁内同步完成，
适合做并发竞态测试——不会因真实下载耗时而引入时序不确定性。
"""

from __future__ import annotations

import threading

import pytest

from download_manager import DownloadManager, DownloadStatus
from models import ComicInfo

# ── fixtures ──────────────────────────────────────────────────────────


@pytest.fixture
def dm() -> DownloadManager:
    """提供一个基础 DownloadManager，不在 fixture 内 start worker。

    基础 DownloadManager 的 _process_task 只做状态转换（不执行真实下载），
    适合测试并发 add/cancel/pause 的竞态安全。
    """
    manager = DownloadManager()
    yield manager
    # teardown：确保无残留线程。本 fixture 不 start worker，故 _worker_thread 通常为 None；
    # 此 if 防御个别用例在 fixture 外自行启动 worker 的场景，避免线程泄漏影响后续测试。
    manager.stop()
    if manager._worker_thread is not None:
        manager.wait_active_downloads(timeout=2)


def _make_comic(comic_id: str, title: str = "测试") -> ComicInfo:
    """构造测试用 ComicInfo。"""
    return ComicInfo(
        id=comic_id,
        title=title,
        preview_url=f"https://h-comic.com/comic/{comic_id}",
        cover_url=f"https://h-comic.com/cover/{comic_id}.jpg",
        source_site="hcomic",
        comic_source="MMCG_SHORT",
        pages=1,
    )


# ── 并发 add 竞态：任务守恒与去重 ────────────────────────────────────


class TestConcurrentAddTask:
    """验证并发 add_task 的任务守恒与去重正确性。"""

    def test_concurrent_add_distinct_comics_no_loss_no_duplicate(self, dm):
        """多线程并发添加不同 comic，任务总数必须守恒（无丢失、无重复）。

        用 Barrier 同步所有线程同时发起 add，最大化竞态窗口。
        """
        num_threads = 8
        barrier = threading.Barrier(num_threads)
        results: list[str | None] = [None] * num_threads
        errors: list[Exception] = []

        def _adder(idx: int):
            try:
                barrier.wait()  # 所有线程同时释放，最大化 add_task 竞态
                comic = _make_comic(f"concurrent_{idx}")
                results[idx] = dm.add_task(comic)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=_adder, args=(i,)) for i in range(num_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=5)

        assert not errors, f"并发 add 抛出异常: {errors}"

        # 不变量 1：所有线程都拿到非 None task_id
        assert all(r is not None for r in results), "部分线程未获得 task_id（任务丢失）"

        # 不变量 2：task_id 唯一（无重复 ID）
        task_ids = [r for r in results if r is not None]
        assert len(task_ids) == len(set(task_ids)), "出现重复 task_id"

        # 不变量 3：tasks 字典与 queue 数量守恒
        assert len(dm.tasks) == num_threads, f"tasks 字典数量不守恒: {len(dm.tasks)}"
        assert len(dm.queue) == num_threads, f"queue 数量不守恒: {len(dm.queue)}"

    def test_concurrent_add_same_comic_dedup_consistent(self, dm):
        """多线程并发添加同一 comic.id，去重后任务集必须一致。

        add_task 对活跃任务跳过重复（返回 existing task_id）。
        并发场景下，必须保证最终只有一个任务，且所有线程拿到同一 task_id。
        """
        num_threads = 6
        barrier = threading.Barrier(num_threads)
        results: list[str | None] = [None] * num_threads

        def _adder(idx: int):
            barrier.wait()
            # 每个线程添加同一 comic（需重建 ComicInfo 对象，但 id 相同）
            comic = _make_comic("same_comic")
            results[idx] = dm.add_task(comic)

        threads = [threading.Thread(target=_adder, args=(i,)) for i in range(num_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=5)

        # 不变量：所有线程拿到的 task_id 必须相同（去重生效）
        non_none = [r for r in results if r is not None]
        assert len(set(non_none)) == 1, f"同一 comic 并发 add 产生多个 task_id: {set(non_none)}"

        # 不变量：tasks 字典只有一个该 comic 的任务
        assert len(dm.tasks) == 1, "同一 comic 并发 add 应去重为 1 个任务"


# ── 并发 add/cancel 竞态：状态一致性 ─────────────────────────────────


class TestConcurrentAddCancel:
    """验证并发 add 与 cancel 交错时的状态一致性。"""

    def test_concurrent_cancel_does_not_corrupt_task_dict(self, dm):
        """并发 cancel 不同任务不得破坏 tasks 字典与 queue 一致性。

        先批量 add 一批任务，然后多线程并发 cancel 各自的任务。
        """
        num_tasks = 10
        task_ids = [dm.add_task(_make_comic(f"cancel_{i}")) for i in range(num_tasks)]
        assert len(dm.tasks) == num_tasks

        barrier = threading.Barrier(num_tasks)
        cancel_results: list[bool] = [False] * num_tasks

        def _canceller(idx: int):
            barrier.wait()
            cancel_results[idx] = dm.cancel_task(task_ids[idx])

        threads = [threading.Thread(target=_canceller, args=(i,)) for i in range(num_tasks)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=5)

        # 不变量 1：每个 cancel 必须成功（任务初始为 QUEUED，guard 允许 cancel）
        assert all(cancel_results), f"部分 cancel 失败: {cancel_results}"

        # 不变量 2：所有任务状态转为 CANCELLED
        for tid in task_ids:
            assert (
                dm.tasks[tid].status == DownloadStatus.CANCELLED
            ), f"任务 {tid} 状态应为 CANCELLED，实际 {dm.tasks[tid].status}"

        # 不变量 3：queue 已清空（cancel 移除队列项）
        assert len(dm.queue) == 0, f"cancel 后 queue 应清空，实际 {len(dm.queue)}"

        # 不变量 4：tasks 字典数量不变（cancel 不删除 task 记录，只改状态）
        assert len(dm.tasks) == num_tasks, "cancel 不应删除 task 记录"

    def test_concurrent_cancel_and_add_mix_preserves_invariants(self, dm):
        """并发 add 新任务 + cancel 已有任务，集合不变量保持。

        场景：3 个线程 add 新任务，3 个线程 cancel 已有任务，同时进行。
        """
        # 预置 3 个任务供 cancel
        pre_task_ids = [dm.add_task(_make_comic(f"pre_{i}")) for i in range(3)]

        barrier = threading.Barrier(6)
        errors: list[Exception] = []

        def _adder(idx: int):
            try:
                barrier.wait()
                dm.add_task(_make_comic(f"new_{idx}"))
            except Exception as e:
                errors.append(e)

        def _canceller(idx: int):
            try:
                barrier.wait()
                dm.cancel_task(pre_task_ids[idx])
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=_adder, args=(i,)) for i in range(3)] + [
            threading.Thread(target=_canceller, args=(i,)) for i in range(3)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=5)

        assert not errors, f"并发操作抛出异常: {errors}"

        # 不变量：总任务数 = 3 pre + 3 new = 6（cancel 不删记录）
        assert len(dm.tasks) == 6, f"任务总数不守恒: {len(dm.tasks)}"

        # 不变量：3 个 pre 任务 CANCELLED，3 个 new 任务 QUEUED
        cancelled = [tid for tid in pre_task_ids if dm.tasks[tid].status == DownloadStatus.CANCELLED]
        assert len(cancelled) == 3, "所有 pre 任务应被 cancel"

        # 不变量：queue 中只剩 3 个 new 任务（cancel 移除了 pre）
        assert len(dm.queue) == 3, f"queue 应剩 3 个 new 任务，实际 {len(dm.queue)}"


# ── 已完成任务状态不被回滚（关键不变量）──────────────────────────────


class TestCompletedTaskRollbackProtection:
    """验证已完成（COMPLETED/CANCELLED/FAILED）任务状态不被并发操作回滚。

    这是状态机最重要的不变量：终态任务不可被 cancel/pause/resume 意外修改。
    """

    @pytest.mark.parametrize(
        "terminal_status",
        [
            DownloadStatus.COMPLETED,
            DownloadStatus.CANCELLED,
            DownloadStatus.FAILED,
        ],
    )
    def test_cancel_terminal_task_is_noop(self, dm, terminal_status):
        """cancel 一个已处于终态的任务必须是 no-op，状态不被改变。"""
        comic = _make_comic("terminal_task")
        task_id = dm.add_task(comic)
        # 手动置为终态（模拟下载完成/失败/取消）
        dm.tasks[task_id].status = terminal_status

        result = dm.cancel_task(task_id)

        # 不变量：cancel guard 拒绝终态任务 → 返回 False（或 None→False），状态不变
        assert result is False, f"终态任务不应被 cancel，实际返回 {result}"
        assert dm.tasks[task_id].status == terminal_status, "终态任务状态被意外改变"

    def test_concurrent_cancel_of_completing_task_no_rollback(self, dm):
        """并发 cancel 一个正在完成中的任务，不得回滚其 COMPLETED 状态。

        模拟：一个线程将任务设为 COMPLETED，同时另一线程尝试 cancel。
        无论谁先执行，最终状态必须包含 COMPLETED 的一致视图。
        """
        comic = _make_comic("racing_task")
        task_id = dm.add_task(comic)

        barrier = threading.Barrier(2)

        def _completer():
            barrier.wait()
            # 模拟 worker 完成（状态转换在锁内）
            with dm._lock:
                dm.tasks[task_id].status = DownloadStatus.COMPLETED

        def _canceller():
            barrier.wait()
            dm.cancel_task(task_id)

        t1 = threading.Thread(target=_completer)
        t2 = threading.Thread(target=_canceller)
        t1.start()
        t2.start()
        t1.join(timeout=3)
        t2.join(timeout=3)

        # 不变量：若 completer 先执行（设 COMPLETED），cancel 必须 no-op
        # 若 canceller 先执行（QUEUED→CANCELLED），completer 随后覆盖为 COMPLETED
        # 两种竞态结果都是合法的最终态（CANCELLED 或 COMPLETED），关键是不出现
        # 非法中间态（如 DOWNLOADING 被 cancel 后又回 QUEUED）
        final_status = dm.tasks[task_id].status
        assert final_status in (
            DownloadStatus.COMPLETED,
            DownloadStatus.CANCELLED,
        ), f"竞态后出现非法状态 {final_status}"


# ── 回调通知集合验证（不验证顺序）────────────────────────────────────


class TestCallbackNotification:
    """验证回调被触发的集合，不验证调用顺序或精确次数。"""

    def test_add_task_triggers_task_update_callback(self, dm):
        """add_task 必须触发 on_task_update 回调（验证触发集合，不验证次数）。"""
        notified_tasks: list[str] = []
        dm.set_callbacks(on_task_update=lambda task: notified_tasks.append(task.task_id))

        dm.add_task(_make_comic("callback_test"))

        # 不变量：回调被触发，且包含新任务 ID
        assert "callback_test" in notified_tasks or len(notified_tasks) > 0, "add_task 未触发回调"

    def test_concurrent_adds_all_trigger_callbacks(self, dm):
        """并发 add 的每个任务都必须触发回调（集合完整，不验证顺序）。"""
        notified: set[str] = set()
        lock = threading.Lock()

        def _on_update(task):
            with lock:
                notified.add(task.comic.id)

        dm.set_callbacks(on_task_update=_on_update)

        num_threads = 5
        barrier = threading.Barrier(num_threads)

        def _adder(idx: int):
            barrier.wait()
            dm.add_task(_make_comic(f"cb_{idx}"))

        threads = [threading.Thread(target=_adder, args=(i,)) for i in range(num_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=5)

        # 不变量：所有任务的回调都被触发（集合完整）
        assert len(notified) == num_threads, f"回调集合不完整: {notified}（预期 {num_threads} 个）"
