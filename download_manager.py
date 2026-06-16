"""下载管理器核心模块"""

import copy
import logging
import os
import shutil
import threading
import time
from collections import Counter
from collections.abc import Callable

from config import DEFAULT_OUTPUT_FORMAT
from downloader import DownloadOptions, DownloadResult
from image_formats import SUPPORTED_IMAGE_EXTENSIONS
from models import ComicInfo, DownloadCancelledError, DownloadStatus, DownloadTask
from output_staging import OutputStagingManager
from utils import sanitize_filename

logger = logging.getLogger(__name__)


_STATUS_SORT_PRIORITY: dict[DownloadStatus, int] = {
    DownloadStatus.DOWNLOADING: 0,
    DownloadStatus.PAUSING: 1,
    DownloadStatus.QUEUED: 2,
    DownloadStatus.PAUSED: 3,
    DownloadStatus.FAILED: 4,
    DownloadStatus.COMPLETED: 5,
    DownloadStatus.CANCELLED: 6,
}

_MAX_AUTO_RETRY_ATTEMPTS = 5


class DownloadManager:
    """下载管理器 - 管理下载队列和任务状态"""

    def __init__(self):
        # 任务存储
        self.tasks: dict[str, DownloadTask] = {}
        self.queue: list[str] = []

        # 状态标志
        self.is_running: bool = False
        self.global_pause: bool = False
        self.current_task_id: str | None = None

        # 线程同步
        self._lock = threading.Lock()
        self._queue_condition = threading.Condition(self._lock)
        self._stop_event = threading.Event()
        self._worker_thread: threading.Thread | None = None

        # 回调
        self._on_task_update: Callable[[DownloadTask], None] | None = None
        self._on_queue_complete: Callable[[], None] | None = None

    def add_task(self, comic: ComicInfo, overwrite: bool = False) -> str:
        """添加单个任务到队列"""
        task = DownloadTask(comic=comic, status=DownloadStatus.QUEUED, overwrite=overwrite)
        task_id = task.task_id

        with self._lock:
            existing = self.tasks.get(task_id)
            if existing and existing.status not in (
                DownloadStatus.COMPLETED,
                DownloadStatus.CANCELLED,
                DownloadStatus.FAILED,
            ):
                logger.info(
                    "Task %s already active (%s), skipping duplicate",
                    task_id,
                    existing.status.value,
                )
                return task_id
            self.tasks[task_id] = task
            insert_index = self._calculate_insert_index_locked()
            self.queue.insert(insert_index, task_id)

        logger.info("Added task %s: %s at queue index %d", task_id, comic.title, insert_index)
        self._notify_queue_changed()
        self._notify_task_update(task)
        return task_id

    def add_tasks(self, comics: list[ComicInfo]) -> list[str]:
        """添加多个任务到队列"""
        task_ids = []
        for comic in comics:
            task_id = self.add_task(comic)
            task_ids.append(task_id)
        return task_ids

    def set_callbacks(
        self,
        on_task_update: Callable[[DownloadTask], None] | None = None,
        on_queue_complete: Callable[[], None] | None = None,
    ):
        """设置状态更新回调"""
        self._on_task_update = on_task_update
        self._on_queue_complete = on_queue_complete

    def start(self):
        """启动队列处理器（如果未运行）"""
        with self._lock:
            if self.is_running:
                return
            self._stop_event.clear()
            self.is_running = True

        self._worker_thread = threading.Thread(target=self._process_queue, daemon=True)
        self._worker_thread.start()
        logger.info("Download manager started")

    def stop(self):
        """停止队列处理器"""
        self._stop_event.set()
        self._notify_queue_changed()
        logger.info("Download manager stop requested")

    def wait_active_downloads(self, timeout: float = 10.0) -> bool:
        """等待队列工作线程完全退出（包括正在执行的下载收尾和清理）。

        调用方应先 cancel_task + stop，再调此方法。

        Args:
            timeout: 最大等待秒数。

        Returns:
            True 如果工作线程已结束，False 如果超时。
        """
        thread = self._worker_thread
        if thread is None or not thread.is_alive():
            return True
        thread.join(timeout=timeout)
        return not thread.is_alive()

    def _process_queue(self):
        """队列处理主循环（在后台线程运行）"""
        logger.info("Queue processor started")
        drained = False

        while True:
            should_exit = False
            task_id = None
            with self._queue_condition:
                while True:
                    if self._stop_event.is_set():
                        should_exit = True
                        break

                    if self.global_pause:
                        self._queue_condition.wait()
                        continue

                    task_id = self._get_next_task_locked()
                    if task_id:
                        break

                    # 仍有待处理任务（例如全部处于暂停状态）时阻塞等待状态变化
                    if self._has_pending_tasks_locked():
                        self._queue_condition.wait()
                        continue

                    # Queue drained naturally — no stop requested, no pending tasks
                    drained = True
                    should_exit = True
                    break

            if should_exit:
                break

            self._process_task(task_id)

        with self._lock:
            self.is_running = False
        logger.info("Queue processor stopped")

        if drained:
            with self._lock:
                still_empty = not self.queue and not self._has_pending_tasks_locked()
            if still_empty and self._on_queue_complete:
                self._on_queue_complete()

    def _get_next_task_locked(self) -> str | None:
        """获取下一个可处理的任务（调用方需持有 _lock）。

        遍历队列查找首个 QUEUED 任务，遇到不可执行任务（FAILED/PAUSED/PAUSING）
        原地跳过而非轮转到队尾，以保持队列物理顺序与展示顺序一致。
        COMPLETED/CANCELLED 任务从队列中移除（清理残留）。
        """
        for task_id in self.queue:
            task = self.tasks.get(task_id)
            if not task:
                continue
            if task.status in (DownloadStatus.COMPLETED, DownloadStatus.CANCELLED):
                continue
            if task.status in (
                DownloadStatus.FAILED,
                DownloadStatus.PAUSED,
                DownloadStatus.PAUSING,
            ):
                continue
            if task.status == DownloadStatus.QUEUED:
                self._cleanup_finished_from_queue()
                return task_id
        self._cleanup_finished_from_queue()
        return None

    def _has_pending_tasks_locked(self) -> bool:
        """检查是否仍有未完成任务（调用方需持有 _lock）。"""
        return any(
            task.status
            in (
                DownloadStatus.QUEUED,
                DownloadStatus.DOWNLOADING,
                DownloadStatus.PAUSING,
                DownloadStatus.PAUSED,
            )
            for task in self.tasks.values()
        )

    def _snapshot_queue_state(self) -> tuple[list[str], dict[str, DownloadStatus]]:
        """锁内返回队列和任务状态快照。"""
        with self._lock:
            queue_copy = list(self.queue)
            statuses = {}
            for tid in queue_copy:
                task = self.tasks.get(tid)
                if task:
                    statuses[tid] = task.status
            return queue_copy, statuses

    def snapshot_tasks(self) -> dict:
        """锁内返回所有任务的只读快照（任务 ID -> 任务深拷贝）。"""
        with self._lock:
            return {tid: copy.deepcopy(task) for tid, task in self.tasks.items()}

    def get_sorted_tasks(self) -> list[DownloadTask]:
        """返回按状态分组排序的任务列表（线程安全）。

        排序规则：
        1. 未完成任务在前（DOWNLOADING > PAUSING > QUEUED > PAUSED > FAILED）
        2. 已完成任务在后（COMPLETED > CANCELLED）
        3. 同组内按 created_at 升序
        """
        snapshot = self.snapshot_tasks()
        return sorted(
            snapshot.values(),
            key=lambda t: (_STATUS_SORT_PRIORITY[t.status], t.created_at),
        )

    def _cleanup_finished_from_queue(self):
        """从队列中移除所有 COMPLETED/CANCELLED 任务及无效 ID（调用方需持有 _lock）。"""
        self.queue = [
            tid
            for tid in self.queue
            if tid in self.tasks and self.tasks[tid].status not in (DownloadStatus.COMPLETED, DownloadStatus.CANCELLED)
        ]

    def _calculate_insert_index_locked(self) -> int:
        """计算新任务在 self.queue 中的插入位置（调用方需持有 _lock）。

        规则：新任务插入到所有未完成任务之后、所有已完成任务之前。
        若无未完成任务，插入到队列头部（index 0）。
        若无已完成任务，插入到队列末尾（index == len(queue)）。
        """
        insert_index = 0
        for i, task_id in enumerate(self.queue):
            task = self.tasks.get(task_id)
            if task and task.status not in (
                DownloadStatus.COMPLETED,
                DownloadStatus.CANCELLED,
            ):
                insert_index = i + 1
        return insert_index

    def _notify_queue_changed(self):
        """唤醒队列处理线程，响应任务状态变化。"""
        with self._queue_condition:
            self._queue_condition.notify_all()

    def _process_task(self, task_id: str):
        """处理单个任务（子类可覆盖）"""
        with self._lock:
            task = self.tasks.get(task_id)
            if not task or task.status != DownloadStatus.QUEUED:
                return
            self.current_task_id = task_id
            task.status = DownloadStatus.DOWNLOADING
            task.started_at = time.time()
        self._notify_task_update(task)

        logger.info("Processing task %s: %s", task_id, task.comic.title)

    def _notify_task_update(self, task: DownloadTask):
        """通知任务更新"""
        if self._on_task_update:
            self._on_task_update(task)

    def _modify_task_locked(
        self,
        task_id: str,
        *,
        guard: Callable[[DownloadTask], bool],
        apply: Callable[[DownloadTask], bool | None],
        post_notify: bool = True,
        post_queue_notify: bool = True,
        post_start: bool = False,
    ) -> DownloadTask | None:
        """在锁内验证并变更任务状态。

        guard(task)  → False = 状态不允许，返回 None
        apply(task) → False = 业务逻辑拒绝，返回 None
                    → True/None = 变更成功
        """
        with self._lock:
            task = self.tasks.get(task_id)
            if not task or not guard(task):
                return None
            result = apply(task)
            if result is False:
                return None
        if post_notify:
            self._notify_task_update(task)
        if post_queue_notify:
            self._notify_queue_changed()
        if post_start and not self.is_running:
            self.start()
        return task

    def pause_task(self, task_id: str) -> bool:
        """暂停指定任务"""

        def _apply(task):
            if task.status == DownloadStatus.DOWNLOADING:
                task.request_pause()
                task.status = DownloadStatus.PAUSING
            else:
                task.status = DownloadStatus.PAUSED

        task = self._modify_task_locked(
            task_id,
            guard=lambda t: t.status in (DownloadStatus.DOWNLOADING, DownloadStatus.QUEUED),
            apply=_apply,
        )
        if task:
            logger.info("Task %s pausing", task_id)
            return True
        return False

    def resume_task(self, task_id: str) -> bool:
        """继续指定任务"""

        def _apply(task):
            task.clear_pause_request()
            task.status = DownloadStatus.QUEUED

        task = self._modify_task_locked(
            task_id,
            guard=lambda t: (
                t.status
                in (
                    DownloadStatus.PAUSED,
                    DownloadStatus.PAUSING,
                )
            ),
            apply=_apply,
            post_start=True,
        )
        if task:
            logger.info("Task %s resumed", task_id)
            return True
        return False

    def cancel_task(self, task_id: str) -> bool:
        """取消指定任务"""

        def _apply(task):
            task.request_cancel()
            task.status = DownloadStatus.CANCELLED
            if task_id in self.queue:
                self.queue.remove(task_id)

        task = self._modify_task_locked(
            task_id,
            guard=lambda t: (
                t.status
                not in (
                    DownloadStatus.COMPLETED,
                    DownloadStatus.CANCELLED,
                    DownloadStatus.FAILED,
                )
            ),
            apply=_apply,
        )
        if task:
            logger.info("Task %s cancelled", task_id)
            return True
        return False

    def retry_task(self, task_id: str) -> bool:
        """重试失败的任务"""

        def _apply(task):
            task.status = DownloadStatus.QUEUED
            task.retry_count += 1
            task.error_message = None

        task = self._modify_task_locked(
            task_id,
            guard=lambda t: t.status == DownloadStatus.FAILED,
            apply=_apply,
            post_start=True,
        )
        if task:
            logger.info("Task %s queued for retry (attempt #%s)", task_id, task.retry_count)
            return True
        return False

    def toggle_global_pause(self) -> bool:
        """切换全局暂停状态"""
        with self._lock:
            self.global_pause = not self.global_pause
            new_state = self.global_pause
        self._notify_queue_changed()
        logger.info("Global pause: %s", new_state)
        return new_state

    # ── 专辑级批量控制 ──────────────────────────────────────────
    # 以 (source_site, album_id) 为单位批量暂停/继续/取消整个专辑。
    # 优先使用注入的 album coordinator 查找任务 ID；若 coordinator 未跟踪该专辑
    # （例如跨进程重启后状态丢失），则遍历 self.tasks 按 comic.album_id 兜底匹配。

    def _get_album_task_ids(self, album_key: tuple[str, str]) -> list[str]:
        """查找专辑下的任务 ID 列表（coordinator 优先，tasks 兜底）。"""
        coordinator = getattr(self, "_album_coordinator", None)
        if coordinator is not None and coordinator.is_tracked(album_key):
            return list(coordinator.get_task_ids(album_key))
        # 兜底：遍历任务按 (source_site, album_id) 匹配
        source_site, album_id = album_key
        with self._lock:
            return [
                tid
                for tid, task in self.tasks.items()
                if task.comic.source_site == source_site and (task.comic.album_id or task.comic.id) == album_id
            ]

    def pause_album_tasks(self, album_key: tuple[str, str]) -> dict:
        """暂停专辑下所有可暂停任务（queued/downloading）。

        Returns:
            {"affected": 暂停成功数, "skipped": 跳过数, "notFound": 是否无任务}
        """
        task_ids = self._get_album_task_ids(album_key)
        if not task_ids:
            return {"affected": 0, "skipped": 0, "notFound": True}
        affected = 0
        skipped = 0
        for tid in task_ids:
            if self.pause_task(tid):
                affected += 1
            else:
                skipped += 1
        logger.info("Pause album %s: %d paused, %d skipped", album_key, affected, skipped)
        return {"affected": affected, "skipped": skipped, "notFound": False}

    def resume_album_tasks(self, album_key: tuple[str, str]) -> dict:
        """继续专辑下所有 paused/pausing 任务。"""
        task_ids = self._get_album_task_ids(album_key)
        if not task_ids:
            return {"affected": 0, "skipped": 0, "notFound": True}
        affected = 0
        skipped = 0
        for tid in task_ids:
            if self.resume_task(tid):
                affected += 1
            else:
                skipped += 1
        logger.info("Resume album %s: %d resumed, %d skipped", album_key, affected, skipped)
        return {"affected": affected, "skipped": skipped, "notFound": False}

    def cancel_album_tasks(self, album_key: tuple[str, str]) -> dict:
        """取消专辑下所有未完成任务（跳过 completed 以保留已下载文件）。"""
        task_ids = self._get_album_task_ids(album_key)
        if not task_ids:
            return {"affected": 0, "skipped": 0, "notFound": True}
        affected = 0
        skipped = 0
        for tid in task_ids:
            # cancel_task 内部 guard 已排除 completed/cancelled/failed，
            # 这里显式跳过 completed 以保留已下载章节文件。
            task = self.tasks.get(tid)
            if task and task.status == DownloadStatus.COMPLETED:
                skipped += 1
                continue
            if self.cancel_task(tid):
                affected += 1
            else:
                skipped += 1
        logger.info("Cancel album %s: %d cancelled, %d skipped", album_key, affected, skipped)
        return {"affected": affected, "skipped": skipped, "notFound": False}

    def get_stats(self) -> dict:
        """获取队列统计信息"""
        with self._lock:
            status_counts = Counter(t.status for t in self.tasks.values())
            total = len(self.tasks)
        return {
            "total": total,
            "incomplete": total
            - status_counts.get(DownloadStatus.COMPLETED, 0)
            - status_counts.get(DownloadStatus.CANCELLED, 0),
            "queued": status_counts.get(DownloadStatus.QUEUED, 0),
            "downloading": status_counts.get(DownloadStatus.DOWNLOADING, 0),
            "paused": status_counts.get(DownloadStatus.PAUSED, 0),
            "completed": status_counts.get(DownloadStatus.COMPLETED, 0),
            "failed": status_counts.get(DownloadStatus.FAILED, 0),
            "cancelled": status_counts.get(DownloadStatus.CANCELLED, 0),
        }


class ComicDownloadManager(DownloadManager):
    """漫画下载管理器 - 集成 ComicDownloader"""

    def __init__(
        self,
        downloader,
        cbz_builder,
        output_dir: str,
        prepare_comic: Callable[[ComicInfo], ComicInfo] | None = None,
        output_format: str = DEFAULT_OUTPUT_FORMAT,
    ):
        super().__init__()
        self.downloader = downloader
        self.prepare_comic = prepare_comic
        self.delay_after = 0  # 批量下载间隔（秒）
        self.auto_retry_max_attempts = 2  # 自动重试次数（默认2次）
        self._staging = OutputStagingManager(output_dir, cbz_builder, output_format)
        self.on_download_success = None  # Optional callback: (comic, output_path, output_format) -> None

    @property
    def output_dir(self) -> str:
        return self._staging.output_dir

    @property
    def output_format(self) -> str:
        return self._staging.output_format

    @property
    def cbz_builder(self):
        return self._staging.cbz_builder

    def set_auto_retry_max_attempts(self, attempts: int):
        """设置自动重试次数

        Args:
            attempts: 最大自动重试次数（0-5，0表示禁用）
        """
        self.auto_retry_max_attempts = max(0, min(_MAX_AUTO_RETRY_ATTEMPTS, attempts))

    def set_output_dir(self, output_dir: str):
        """设置输出目录"""
        self._staging.output_dir = output_dir

    def set_delay_after(self, delay: int):
        """设置批量下载间隔（秒）"""
        self.delay_after = delay

    def set_output_format(self, output_format: str):
        """设置输出格式

        Args:
            output_format: 输出格式 ("folder" | "zip" | "cbz")
        """
        if output_format in ("folder", "zip", "cbz"):
            self._staging.output_format = output_format
            logger.info("Output format set to: %s", output_format)

    def add_task(self, comic: ComicInfo, overwrite: bool = False) -> str:
        """添加单个任务到队列，若 manager 已停止则自动重启。"""
        task_id = super().add_task(comic, overwrite=overwrite)

        should_start = False
        with self._lock:
            if not self.is_running:
                should_start = True

        if should_start:
            self.start()

        return task_id

    def _scan_temp_dir_progress(self, temp_dir: str, task):
        """扫描临时目录，恢复已完成页码进度。

        Args:
            temp_dir: 临时图片目录路径
            task: 下载任务对象（会直接修改其 completed_pages / failed_pages）
        """
        downloaded_files = sorted(
            name
            for name in os.listdir(temp_dir)
            if os.path.isfile(os.path.join(temp_dir, name))
            and os.path.splitext(name)[1].lower() in SUPPORTED_IMAGE_EXTENSIONS
            and os.path.getsize(os.path.join(temp_dir, name)) > 0
        )
        completed_from_files = []
        for f in downloaded_files:
            try:
                page_num = int(os.path.splitext(os.path.basename(f))[0])
                completed_from_files.append(page_num)
            except ValueError:
                continue
        if completed_from_files:
            task.completed_pages = sorted(completed_from_files)
            task.progress_current = len(task.completed_pages)
            pages = task.comic.pages or 0
            if pages == 0:
                pages = max(completed_from_files)
            task.progress_total = max(pages, task.progress_current)
            all_pages = set(range(1, pages + 1))
            task.failed_pages = sorted(all_pages - set(task.completed_pages))

    def _execute_download(self, task: DownloadTask) -> DownloadResult:
        """执行漫画下载并返回结果。"""
        if self.prepare_comic:
            prepared = self.prepare_comic(task.comic)
            if prepared is not None:
                task.comic = prepared

        cancel_event = threading.Event()
        pause_event = threading.Event()
        with self._lock:
            if task.is_cancel_requested:
                cancel_event.set()

        def progress_callback(current: int, total: int, status: str, comic_info: dict | None = None):
            with self._lock:
                if task.is_cancel_requested:
                    cancel_event.set()
                if task.is_pause_requested:
                    pause_event.set()
                task.progress_current = current
                task.progress_total = total
                elapsed = time.time() - task.started_at if task.started_at else 0.0
                task.download_speed = (current / elapsed) if elapsed > 0 else 0.0
                task.current_downloading_page = min(total, current + 1) if total > 0 else 0
            self._notify_task_update(task)

        # 多章专辑：temp 目录放在专辑工作目录内
        effective_output_dir = self.output_dir
        if task.comic.is_album_chapter:
            album_dir_name = self.cbz_builder.get_album_folder_name(task.comic)
            effective_output_dir = os.path.join(self.output_dir, album_dir_name)
            os.makedirs(effective_output_dir, exist_ok=True)

        result: DownloadResult = self.downloader.download_comic_resume(
            task.comic,
            effective_output_dir,
            options=DownloadOptions(
                completed_pages=task.completed_pages,
                failed_pages=task.failed_pages,
                progress_callback=progress_callback,
                cancel_event=cancel_event,
                pause_event=pause_event,
            ),
        )

        if cancel_event.is_set():
            raise DownloadCancelledError("Download cancelled", temp_dir=result.temp_dir)

        return result

    def _safe_cleanup_temp_dir(self, temp_dir: str | None) -> None:
        """安全清理临时目录（若存在）。"""
        if temp_dir and os.path.exists(temp_dir):
            self.downloader.cleanup_temp_dir(temp_dir)

    def _cleanup_cancelled_task(self, task: DownloadTask, temp_dir: str | None, reason: str = "") -> None:
        """清理已取消任务的临时目录和状态。"""
        logger.info("Task %s cancelled (%s), discarding temp", task.task_id, reason)
        self._safe_cleanup_temp_dir(temp_dir)
        with self._lock:
            task.temp_dir = None
            task.status = DownloadStatus.CANCELLED

    def _check_cancel_before_packaging(self, task: DownloadTask, result: DownloadResult) -> bool:
        if task.is_cancel_requested:
            self._cleanup_cancelled_task(task, result.temp_dir, "before packaging")
            return True
        return False

    def _check_output_conflict(self, task: DownloadTask) -> bool:
        """检查输出路径冲突。返回 True 表示有冲突（已处理）。"""
        if task.overwrite:
            return False
        output_path = self.cbz_builder.get_output_path_for_format(task.comic, self.output_format, self.output_dir)
        if not os.path.exists(output_path):
            return False
        logger.warning("Conflict detected at build time for %s, skipping", output_path)
        with self._lock:
            task.status = DownloadStatus.FAILED
            task.error_message = f"File already exists: {output_path}"
        self._safe_cleanup_temp_dir(task.temp_dir)
        task.temp_dir = None
        return True

    def _handle_download_success(self, task: DownloadTask, result: DownloadResult) -> None:
        """处理下载成功：格式转换、清理临时目录、更新状态。"""
        with self._lock:
            task.temp_dir = result.temp_dir

        logger.info(
            "Task %s success: is_album_chapter=%s, album_total_chapters=%s, album_title=%r, title=%r",
            task.task_id,
            task.comic.is_album_chapter,
            task.comic.album_total_chapters,
            task.comic.album_title,
            task.comic.title,
        )

        if task.comic.is_album_chapter:
            if self._check_cancel_before_packaging(task, result):
                return
            self._handle_album_chapter_success(task, result)
            return

        if self._check_cancel_before_packaging(task, result):
            return

        if self._check_output_conflict(task):
            return

        staged_path = None
        staging_root = None
        try:
            staged_path, output_path, staging_root = self._staging.build(result.temp_dir, task.comic)

            if task.is_cancel_requested:
                self._cleanup_cancelled_task(
                    task,
                    (result.temp_dir if self.output_format != "folder" else None),
                    "during packaging",
                )
                self._staging.cleanup(staged_path, staging_root)
                return

            output_path = self._staging.commit(staged_path, output_path, overwrite=task.overwrite)
            if staging_root and os.path.exists(staging_root):
                self._staging.safe_rmtree(staging_root, self.output_dir)
            staged_path = None
            staging_root = None
        except Exception:
            self._staging.cleanup(staged_path, staging_root)
            logger.error("Packaging failed for task %s", task.task_id, exc_info=True)
            with self._lock:
                task.temp_dir = None
                task.status = DownloadStatus.FAILED
                task.error_message = "打包失败"
            return

        if self.output_format != "folder":
            self._safe_cleanup_temp_dir(result.temp_dir)
        with self._lock:
            task.temp_dir = None
            task.status = DownloadStatus.COMPLETED
            task.current_downloading_page = 0
        logger.info("Task %s completed: %s", task.task_id, output_path)

        if self.on_download_success:
            try:
                self.on_download_success(task.comic, output_path, self.output_format)
            except Exception:
                logger.warning("on_download_success callback failed", exc_info=True)

    def set_album_coordinator(self, coordinator):
        """注入专辑 staging 协调器。"""
        self._album_coordinator = coordinator

    def _handle_album_chapter_success(self, task: DownloadTask, result: DownloadResult) -> None:
        """处理专辑章下载成功：移动 temp 到 专辑文件夹/章节名/。"""
        comic = task.comic
        album_dir_name = self.cbz_builder.get_album_folder_name(comic)
        album_work_dir = os.path.join(self.output_dir, album_dir_name)
        chapter_name = sanitize_filename(comic.chapter_display_name)
        chapter_final_path = os.path.join(album_work_dir, chapter_name)

        # 如果已有同名章节目录（重试场景），先清理
        if os.path.exists(chapter_final_path):
            shutil.rmtree(chapter_final_path)

        os.makedirs(album_work_dir, exist_ok=True)
        shutil.move(result.temp_dir, chapter_final_path)

        logger.info(
            "Album chapter saved: %s -> %s",
            result.temp_dir,
            chapter_final_path,
        )

        # 写入历史（章级，output_path 暂为章节子文件夹路径）
        output_path_for_history = chapter_final_path
        if self.on_download_success:
            try:
                self.on_download_success(comic, output_path_for_history, self.output_format)
            except Exception:
                logger.warning("on_download_success callback failed", exc_info=True)

        with self._lock:
            task.temp_dir = None
            task.status = DownloadStatus.COMPLETED
            task.current_downloading_page = 0
        self._notify_task_update(task)

        # 通知 coordinator
        coordinator = getattr(self, "_album_coordinator", None)
        if coordinator:
            coordinator.on_chapter_complete(task, album_work_dir)

    def _handle_download_failure(self, task: DownloadTask, result: DownloadResult) -> None:
        """处理下载失败：记录失败信息并尝试自动重试。"""
        with self._lock:
            task.failed_pages = result.failed_pages
            task.completed_pages = result.completed_pages
            task.last_failed_at = time.time()
            task.error_message = result.error_message or "下载失败"
            task.temp_dir = result.temp_dir
        self._attempt_auto_retry(task)

    def _handle_download_exception(self, task: DownloadTask, exception: Exception, temp_dir: str | None) -> None:
        """处理下载异常：保留进度、尝试自动重试或清理。"""
        logger.error("Task %s failed: %s", task.task_id, exception)

        with self._lock:
            _is_cancelled = task.status == DownloadStatus.CANCELLED
        if _is_cancelled:
            self._safe_cleanup_temp_dir(temp_dir)
            return

        with self._lock:
            task.error_message = str(exception)
            task.last_failed_at = time.time()

            if temp_dir and os.path.exists(temp_dir):
                task.temp_dir = temp_dir
                try:
                    self._scan_temp_dir_progress(temp_dir, task)
                except Exception as scan_error:
                    logger.warning(
                        "Failed to scan temp dir %s for progress: %s",
                        temp_dir,
                        scan_error,
                    )

        self._attempt_auto_retry(task)

    def _attempt_auto_retry(self, task: DownloadTask) -> None:
        """尝试自动重试任务。若重试次数已用尽则标记为 FAILED。"""
        should_notify = False
        with self._lock:
            if task.retry_count < self.auto_retry_max_attempts:
                task.retry_count += 1
                task.status = DownloadStatus.QUEUED
                should_notify = True
            else:
                task.status = DownloadStatus.FAILED
                task.current_downloading_page = 0

        if should_notify:
            logger.warning(
                "Task %s failed, auto-retrying (%s/%s): %s",
                task.task_id,
                task.retry_count,
                self.auto_retry_max_attempts,
                task.error_message,
            )
            self._notify_queue_changed()
        else:
            logger.error(
                "Task %s failed after %s retries: %s",
                task.task_id,
                task.retry_count,
                task.error_message,
            )

    def _apply_delay_after(self, task_id: str) -> None:
        """在任务完成后应用批量下载间隔。"""
        if self.delay_after <= 0:
            return
        queue_copy, task_statuses = self._snapshot_queue_state()
        if task_id not in queue_copy:
            return
        has_pending = any(s in (DownloadStatus.QUEUED, DownloadStatus.PAUSED) for s in task_statuses.values())
        if has_pending:
            logger.info("Waiting %ss before next download", self.delay_after)
            if self._stop_event.wait(self.delay_after):
                logger.info("Stop requested during delay after, aborting wait")

    def _handle_post_download(self, task: DownloadTask, result: DownloadResult) -> None:
        """处理下载完成后的取消/暂停检查和结果分发。"""
        with self._lock:
            task.temp_dir = result.temp_dir
            task.completed_pages = result.completed_pages
            task.failed_pages = result.failed_pages
        self._notify_task_update(task)

        if task.is_cancel_requested:
            self._cleanup_cancelled_task(task, result.temp_dir, "after download returned")
            self._notify_task_update(task)
            return

        if task.is_pause_requested:
            with self._lock:
                task.status = DownloadStatus.PAUSED
            self._notify_task_update(task)
            logger.info("Task %s paused after current checkpoint", task.task_id)
            return

        if result.success:
            self._handle_download_success(task, result)
        else:
            self._handle_download_failure(task, result)

    def _process_task(self, task_id: str):
        """处理单个下载任务（编排器）。"""
        with self._lock:
            task = self.tasks.get(task_id)
            if not task or task.status != DownloadStatus.QUEUED:
                return
            self.current_task_id = task_id
            task.status = DownloadStatus.DOWNLOADING
            task.started_at = time.time()
        self._notify_task_update(task)

        temp_dir = None
        try:
            result = self._execute_download(task)
            temp_dir = result.temp_dir
            self._handle_post_download(task, result)
        except DownloadCancelledError as e:
            self._safe_cleanup_temp_dir(e.temp_dir)
        except Exception as e:
            self._handle_download_exception(task, e, temp_dir)
        finally:
            with self._lock:
                self.current_task_id = None
            self._notify_task_update(task)
            self._apply_delay_after(task_id)
