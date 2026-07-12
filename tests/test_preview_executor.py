"""Tests for PriorityPreviewExecutor (reader-jump-preload-priority).

Covers the four contract surfaces:
- priority ordering (current-gen served before stale-gen would-be-queued)
- generation skip on dequeue (stale-gen tasks dropped without running)
- advance_cancelled_floor monotonicity
- graceful shutdown (sentinel drain + worker join)

Uses threading.Event-based deferred tasks so tests deterministically control
when a worker starts/finishes a task, mirroring the deferred pattern used in
the front-end integration test.
"""

import os
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"),
)

from ipc.preview_executor import PriorityPreviewExecutor


def _wait_condition(cond, predicate, timeout=3.0):
    """Spin on cond until predicate() is truthy or timeout. Returns predicate result."""
    deadline = time.time() + timeout
    with cond:
        while time.time() < deadline:
            if predicate():
                return True
            cond.wait(0.01)
    return predicate()


class TestPriorityOrdering:
    def test_lower_priority_served_first(self):
        """Tasks with lower priority value dequeue before higher priority value."""
        executor = PriorityPreviewExecutor(max_workers=1, thread_name_prefix="t")
        try:
            order: list[int] = []
            lock = threading.Lock()

            def make_task(tag: int):
                def _task():
                    with lock:
                        order.append(tag)

                return _task

            # Block the single worker until both tasks are queued, ensuring
            # the priority queue decides order (not arrival race).
            gate = threading.Event()
            blocker_done = threading.Event()

            def blocker():
                gate.wait(3.0)
                blocker_done.set()

            executor.submit(blocker, priority=5, generation=0)
            # Ensure blocker is the running task before enqueuing the rest.
            time.sleep(0.05)
            executor.submit(make_task(2), priority=2, generation=0)
            executor.submit(make_task(1), priority=1, generation=0)
            gate.set()
            # Wait for both tagged tasks to finish
            deadline = time.time() + 3.0
            while time.time() < deadline:
                with lock:
                    if len(order) >= 2:
                        break
                time.sleep(0.01)
            assert order == [1, 2], f"priority ordering broken: {order}"
        finally:
            executor.shutdown(wait=True, cancel_futures=True)


class TestGenerationSkip:
    def test_stale_generation_task_is_skipped(self):
        """A queued task whose generation < cancelled_floor runs zero times."""
        executor = PriorityPreviewExecutor(max_workers=1, thread_name_prefix="t")
        try:
            ran = threading.Event()

            def task():
                ran.set()

            # Occupy the single worker with a gate so the stale task queues
            # (rather than starting) before we advance the floor.
            gate = threading.Event()

            def blocker():
                gate.wait(3.0)

            executor.submit(blocker, priority=0, generation=0)
            time.sleep(0.05)  # let blocker start
            # Queue a generation-1 task, then advance floor to 2 → gen 1 stale.
            executor.submit(task, priority=0, generation=1)
            executor.advance_cancelled_floor(2)
            gate.set()  # release blocker; worker pulls stale task next
            # Give the worker a moment to observe + skip
            time.sleep(0.15)
            assert not ran.is_set(), "stale-generation task should have been skipped, but it ran"
        finally:
            executor.shutdown(wait=True, cancel_futures=True)

    def test_current_generation_task_runs_after_floor_advance(self):
        """A task at exactly the floor boundary (generation == floor) still runs."""
        executor = PriorityPreviewExecutor(max_workers=1, thread_name_prefix="t")
        try:
            ran = threading.Event()

            def task():
                ran.set()

            executor.advance_cancelled_floor(3)
            # generation == 3 is NOT < 3, so it is active.
            executor.submit(task, priority=0, generation=3)
            assert _wait_condition(threading.Condition(), lambda: ran.is_set(), timeout=3.0)
            assert ran.is_set()
        finally:
            executor.shutdown(wait=True, cancel_futures=True)

    def test_generation_zero_is_never_skipped(self):
        """generation=0（叶子组件当前页加载，不传 generation）永不被 floor 取消。

        回归守护：ReaderPage / PageFlipView 加载用户正在看的当前页时不传
        generation，后端缺省为 0。若 floor 推进后把 generation=0 跳过，
        会导致整本漫画当前页不加载。generation=0 是保留的"最高优先级"代。
        """
        executor = PriorityPreviewExecutor(max_workers=1, thread_name_prefix="t")
        try:
            ran = threading.Event()

            def task():
                ran.set()

            # 即使 floor 推进到很大，generation=0 也必须执行
            executor.advance_cancelled_floor(100)
            executor.submit(task, priority=0, generation=0)
            assert _wait_condition(threading.Condition(), lambda: ran.is_set(), timeout=3.0)
            assert ran.is_set(), "generation=0 (current-page load) must NEVER be skipped"
        finally:
            executor.shutdown(wait=True, cancel_futures=True)


class TestAdvanceCancelledFloor:
    def test_monotonic_non_decreasing(self):
        """A stale (smaller) `before` must not lower the floor."""
        executor = PriorityPreviewExecutor(max_workers=1, thread_name_prefix="t")
        try:
            assert executor.advance_cancelled_floor(5) == 5
            assert executor.advance_cancelled_floor(3) == 5  # ignored
            assert executor.advance_cancelled_floor(7) == 7  # advanced
            assert executor.cancelled_floor == 7
        finally:
            executor.shutdown(wait=True, cancel_futures=True)

    def test_initial_floor_is_zero(self):
        executor = PriorityPreviewExecutor(max_workers=1, thread_name_prefix="t")
        try:
            assert executor.cancelled_floor == 0
        finally:
            executor.shutdown(wait=True, cancel_futures=True)


class TestShutdown:
    def test_workers_join_on_shutdown(self):
        executor = PriorityPreviewExecutor(max_workers=3, thread_name_prefix="t")
        # All workers should exit promptly after shutdown joins.
        t0 = time.time()
        executor.shutdown(wait=True, cancel_futures=False)
        assert time.time() - t0 < 3.0

    def test_submit_after_shutdown_is_dropped(self):
        executor = PriorityPreviewExecutor(max_workers=1, thread_name_prefix="t")
        executor.shutdown(wait=True, cancel_futures=True)
        ran = threading.Event()

        # Should not raise; task silently dropped.
        executor.submit(lambda: ran.set(), priority=0, generation=0)
        time.sleep(0.05)
        assert not ran.is_set()
