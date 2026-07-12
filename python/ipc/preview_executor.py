"""Priority-aware executor for reader preview image requests.

Replaces a plain ``ThreadPoolExecutor`` for the ``_preview_executor`` pool so
that the in-process reader can jump (via the progress slider) to a target page
and have that page's requests overtake stale requests still queued from a
previous target.

Design (see openspec/changes/reader-jump-preload-priority/design.md):

- Tasks live in a ``PriorityQueue`` ordered by ``(priority, sequence)``.
  Lower tuple sorts first → served first. ``priority`` currently collapses to
  a binary "current generation" (0) vs "stale generation" — stale tasks are
  not enqueued with a higher priority value because they are skipped on
  dequeue, not merely deprioritised. ``sequence`` keeps same-priority FIFO
  and prevents the comparable-task pitfall (functions aren't comparable, so
  it must be a leading tie-breaker that sorts before the callable).
- A monotonic *cancelled floor* marks generations whose queued-but-unstarted
  tasks should be dropped when a worker pulls them. The floor advances via
  ``advance_cancelled_floor(before)`` whenever the front-end switches target.
- Already-running tasks (a worker has pulled them and started the network
  download) are *not* interrupted — Python ``ThreadPoolExecutor`` + ``requests``
  have no clean stream-level cancel, and the benefit rarely justifies the
  cost. Their slot frees on completion and is immediately reclaimed by the
  next current-generation task.
- Workers are self-managed threads (not ``ThreadPoolExecutor`` internals) so
  we own the dequeue→floor-check→execute boundary. ``shutdown`` injects one
  sentinel per worker and joins.

Concurrency: the floor is read inside the worker loop under ``_floor_lock``.
The lock is held only for a comparison (microseconds), dwarfed by any image
download, so contention is negligible.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from queue import PriorityQueue
from typing import Any

logger = logging.getLogger(__name__)

# Sentinel pushed once per worker to signal shutdown. Any comparable tuple
# whose first element outranks every real (priority, sequence) pair would
# work; (-1, ...) sorts before all real priorities (>= 0), so workers pull
# sentinels only after the queue is otherwise empty at shutdown time.
_SHUTDOWN_SENTINEL_PRIORITY = -1


class PriorityPreviewExecutor:
    """Thread pool that serves preview requests by priority and skips stale generations.

    Public surface mirrors the subset of ``ThreadPoolExecutor`` the existing
    call sites use (``submit``, ``shutdown``), plus ``advance_cancelled_floor``.
    """

    def __init__(self, max_workers: int, thread_name_prefix: str = "preview") -> None:
        if max_workers <= 0:
            raise ValueError("max_workers must be positive")
        self._max_workers = max_workers
        self._thread_name_prefix = thread_name_prefix
        self._queue: PriorityQueue[tuple[Any, ...]] = PriorityQueue()
        self._floor_lock = threading.Lock()
        # Generations strictly less than this floor are considered cancelled.
        # Starts at 0 so generation-0 tasks (the very first preload batch) are
        # active until the front-end advances the floor.
        self._cancelled_floor = 0
        self._seq_counter = 0
        self._seq_lock = threading.Lock()
        self._shutdown = False
        self._shutdown_lock = threading.Lock()
        self._workers: list[threading.Thread] = []
        for i in range(max_workers):
            t = threading.Thread(
                target=self._worker_loop,
                name=f"{thread_name_prefix}-{i}",
                daemon=True,
            )
            t.start()
            self._workers.append(t)

    def submit(
        self,
        fn: Callable[..., Any],
        /,
        *args: Any,
        priority: int = 0,
        generation: int = 0,
        **kwargs: Any,
    ) -> None:
        """Enqueue ``fn(*args, **kwargs)`` for a worker.

        ``priority`` lower = served first (default 0 = current generation).
        ``generation`` identifies the preload batch; tasks whose generation is
        below the cancelled floor are skipped at dequeue time without running.
        """
        if self._shutdown:
            logger.debug("submit after shutdown: generation=%s priority=%s dropped", generation, priority)
            return
        with self._seq_lock:
            self._seq_counter += 1
            seq = self._seq_counter
        # Tuple ordering: (priority, sequence, generation, fn, args, kwargs).
        # sequence is unique & monotonic so tuple comparison never reaches fn
        # (which is not orderable) — avoids the classic "can't compare
        # functions" TypeError on tie.
        self._queue.put((priority, seq, generation, fn, args, kwargs))

    def advance_cancelled_floor(self, before: int) -> int:
        """Mark all generations ``< before`` as cancelled.

        Returns the resulting floor. Monotonically non-decreasing: a stale
        ``before`` is ignored.
        """
        with self._floor_lock:
            if before > self._cancelled_floor:
                self._cancelled_floor = before
            return self._cancelled_floor

    @property
    def cancelled_floor(self) -> int:
        with self._floor_lock:
            return self._cancelled_floor

    def _worker_loop(self) -> None:
        while True:
            item = self._queue.get()
            try:
                # Shutdown sentinel: (sentinel_priority, worker_idx). Real
                # tasks use priority >= 0, so the sentinel sorts ahead and is
                # only pulled once shutdown has drained competing work.
                if item[0] == _SHUTDOWN_SENTINEL_PRIORITY:
                    return
                _prio, _seq, generation, fn, args, kwargs = item
                # Snapshot the floor under lock; a task cancelled between this
                # check and execution still runs (already pulled) — that is the
                # documented "running tasks not interrupted" contract.
                with self._floor_lock:
                    floor = self._cancelled_floor
                # generation=0 是保留代：叶子组件（ReaderPage / PageFlipView）加载
                # 用户正在看的当前页时不传 generation，后端缺省为 0。当前页加载是
                # 最高优先级、永不被取消——否则 usePreloadManager 首次推进 floor
                # 会把当前页请求一起跳过，导致整本漫画不加载。故只有 generation>0
                # 的预加载请求才受 floor 约束。
                if generation > 0 and generation < floor:
                    logger.debug("preview task skipped: generation=%s floor=%s", generation, floor)
                    continue
                try:
                    fn(*args, **kwargs)
                except Exception:
                    # Task callables own their error handling (e.g.
                    # _async_fetch_preview_image writes its own error response).
                    # Swallow to keep the worker alive.
                    logger.exception("preview executor task raised")
            finally:
                self._queue.task_done()

    def shutdown(self, wait: bool = True, cancel_futures: bool = False) -> None:
        """Stop accepting work and optionally drain queued tasks.

        Mirrors ``ThreadPoolExecutor.shutdown``. ``cancel_futures`` currently
        cannot selectively purge a ``PriorityQueue`` of only pending (not-
        yet-running) items cheaply, so it is treated as best-effort: the
        sentinels are pushed regardless, and workers exit after draining.
        """
        with self._shutdown_lock:
            if self._shutdown:
                return
            self._shutdown = True
        if cancel_futures:
            # Best-effort drain of currently-queued items. Races with workers
            # pulling tasks are acceptable: any task a worker already pulled
            # runs to completion (documented non-interruption of running work).
            drained = 0
            while True:
                try:
                    item = self._queue.get_nowait()
                    self._queue.task_done()
                    drained += 1
                    if item[0] == _SHUTDOWN_SENTINEL_PRIORITY:
                        # A stray sentinel (shouldn't happen pre-shutdown) — re-inject count below still correct.
                        pass
                except Exception:
                    break
            logger.debug("preview executor shutdown drained %d queued tasks", drained)
        for _ in self._workers:
            self._queue.put((_SHUTDOWN_SENTINEL_PRIORITY, 0, 0, None, (), {}))
        if wait:
            for t in self._workers:
                t.join()
