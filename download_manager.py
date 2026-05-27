"""下载管理器核心模块"""
import copy
import logging
import os
import shutil
import tempfile
import threading
import time
from collections.abc import Callable

from downloader import DownloadResult
from image_formats import SUPPORTED_IMAGE_EXTENSIONS
from models import ComicInfo, DownloadCancelledError, DownloadStatus, DownloadTask

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
                DownloadStatus.COMPLETED, DownloadStatus.CANCELLED, DownloadStatus.FAILED
            ):
                logger.info("Task %s already active (%s), skipping duplicate", task_id, existing.status.value)
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

        if drained and self._on_queue_complete:
            self._on_queue_complete()

    def _get_next_task_locked(self) -> str | None:
        """获取下一个可处理的任务（调用方需持有 _lock）。

        遍历队列查找首个 QUEUED 任务，遇到不可执行任务（FAILED/PAUSED/PAUSING）
        原地跳过而非轮转到队尾，以保持队列物理顺序与展示顺序一致。
        COMPLETED/CANCELLED 任务从队列中移除（清理残留）。
        """
        for i, task_id in enumerate(self.queue):
            task = self.tasks.get(task_id)
            if not task:
                continue
            if task.status in (DownloadStatus.COMPLETED, DownloadStatus.CANCELLED):
                continue
            if task.status in (DownloadStatus.FAILED, DownloadStatus.PAUSED, DownloadStatus.PAUSING):
                continue
            if task.status == DownloadStatus.QUEUED:
                self._cleanup_finished_from_queue()
                return task_id
        self._cleanup_finished_from_queue()
        return None

    def _has_pending_tasks_locked(self) -> bool:
        """检查是否仍有未完成任务（调用方需持有 _lock）。"""
        return any(
            task.status in (DownloadStatus.QUEUED, DownloadStatus.DOWNLOADING, DownloadStatus.PAUSING, DownloadStatus.PAUSED)
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
            tid for tid in self.queue
            if tid in self.tasks
            and self.tasks[tid].status not in (DownloadStatus.COMPLETED, DownloadStatus.CANCELLED)
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
                DownloadStatus.COMPLETED, DownloadStatus.CANCELLED
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

        # 实际下载逻辑由子类或回调实现
        # 这里仅模拟状态流转
        logger.info("Processing task %s: %s", task_id, task.comic.title)

    def _notify_task_update(self, task: DownloadTask):
        """通知任务更新"""
        if self._on_task_update:
            self._on_task_update(task)

    def pause_task(self, task_id: str) -> bool:
        """暂停指定任务"""
        changed = False
        task_to_notify = None
        with self._lock:
            task = self.tasks.get(task_id)
            if not task:
                return False

            if task.status == DownloadStatus.DOWNLOADING:
                task.request_pause()
                task.status = DownloadStatus.PAUSING
                task_to_notify = task
                logger.info("Task %s pausing (waiting for current batch)", task_id)
                changed = True
            elif task.status == DownloadStatus.QUEUED:
                task.status = DownloadStatus.PAUSED
                task_to_notify = task
                changed = True

        if task_to_notify:
            self._notify_task_update(task_to_notify)
        if changed:
            self._notify_queue_changed()
        return changed

    def resume_task(self, task_id: str) -> bool:
        """继续指定任务"""
        should_start = False
        task_to_notify = None
        with self._lock:
            task = self.tasks.get(task_id)
            if not task or task.status not in (DownloadStatus.PAUSED, DownloadStatus.PAUSING):
                return False

            task.clear_pause_request()
            task.status = DownloadStatus.QUEUED
            task_to_notify = task
            logger.info("Task %s resumed", task_id)

            if not self.is_running:
                should_start = True

        if task_to_notify:
            self._notify_task_update(task_to_notify)
        if should_start:
            self.start()
        self._notify_queue_changed()
        return True

    def cancel_task(self, task_id: str) -> bool:
        """取消指定任务"""
        changed = False
        task_to_notify = None
        with self._lock:
            task = self.tasks.get(task_id)
            if not task:
                return False

            if task.status in (
                DownloadStatus.COMPLETED, DownloadStatus.CANCELLED, DownloadStatus.FAILED
            ):
                return False

            task.request_cancel()
            task.status = DownloadStatus.CANCELLED

            # 从队列移除
            if task_id in self.queue:
                self.queue.remove(task_id)

            task_to_notify = task
            logger.info("Task %s cancelled", task_id)
            changed = True
        if task_to_notify:
            self._notify_task_update(task_to_notify)
        if changed:
            self._notify_queue_changed()
        return changed

    def retry_task(self, task_id: str) -> bool:
        """重试失败的任务

        Args:
            task_id: 任务ID

        Returns:
            是否成功重置任务
        """
        should_start = False
        task_to_notify = None
        with self._lock:
            task = self.tasks.get(task_id)
            if not task or task.status != DownloadStatus.FAILED:
                return False

            # 重置任务状态
            task.status = DownloadStatus.QUEUED
            task.retry_count += 1
            task.error_message = None
            # 保留 failed_pages 和 completed_pages 用于断点续传
            task_to_notify = task
            logger.info("Task %s queued for retry (attempt #%s)", task_id, task.retry_count)

            # 检查是否需要启动队列处理器
            should_start = not self.is_running

        if task_to_notify:
            self._notify_task_update(task_to_notify)
        # 在锁外启动处理器
        if should_start:
            self.start()
        self._notify_queue_changed()

        return True

    def toggle_global_pause(self) -> bool:
        """切换全局暂停状态"""
        with self._lock:
            self.global_pause = not self.global_pause
            new_state = self.global_pause
        self._notify_queue_changed()
        logger.info("Global pause: %s", new_state)
        return new_state

    def get_stats(self) -> dict:
        """获取队列统计信息"""
        with self._lock:
            stats = {
                "total": len(self.tasks),
                "incomplete": sum(1 for t in self.tasks.values()
                               if t.status not in (DownloadStatus.COMPLETED, DownloadStatus.CANCELLED)),
                "queued": sum(1 for t in self.tasks.values() if t.status == DownloadStatus.QUEUED),
                "downloading": sum(1 for t in self.tasks.values() if t.status == DownloadStatus.DOWNLOADING),
                "paused": sum(1 for t in self.tasks.values() if t.status == DownloadStatus.PAUSED),
                "completed": sum(1 for t in self.tasks.values() if t.status == DownloadStatus.COMPLETED),
                "failed": sum(1 for t in self.tasks.values() if t.status == DownloadStatus.FAILED),
                "cancelled": sum(1 for t in self.tasks.values() if t.status == DownloadStatus.CANCELLED),
            }
            return stats


class ComicDownloadManager(DownloadManager):
    """漫画下载管理器 - 集成 ComicDownloader"""

    def __init__(
        self,
        downloader,
        cbz_builder,
        output_dir: str,
        prepare_comic: Callable[[ComicInfo], ComicInfo] | None = None,
        output_format: str = "cbz",
    ):
        super().__init__()
        self.downloader = downloader
        self.cbz_builder = cbz_builder
        self.output_dir = output_dir
        self.prepare_comic = prepare_comic
        self.delay_after = 0  # 批量下载间隔（秒）
        self.auto_retry_max_attempts = 2  # 自动重试次数（默认2次）
        self.output_format = output_format  # 输出格式: folder | zip | cbz
        self.on_download_success = None  # Optional callback: (comic, output_path, output_format) -> None

    @staticmethod
    def _rmtree_onerror(func, path, exc_info):
        logger.warning("Failed to remove %s during rmtree: %s", path, exc_info)

    @staticmethod
    def _safe_rmtree(path: str, parent_dir: str) -> None:
        """验证路径在 parent_dir 内后再执行删除。"""
        try:
            real_path = os.path.realpath(path)
            real_parent = os.path.realpath(parent_dir)
        except (TypeError, ValueError, OSError):
            logger.warning("Refusing to rmtree unresolvable path: %s", path)
            return
        if real_path != real_parent and not real_path.startswith(real_parent + os.sep):
            logger.warning("Refusing to rmtree path outside output dir: %s", path)
            return

        shutil.rmtree(path, ignore_errors=False, onerror=ComicDownloadManager._rmtree_onerror)

    def set_auto_retry_max_attempts(self, attempts: int):
        """设置自动重试次数

        Args:
            attempts: 最大自动重试次数（0-5，0表示禁用）
        """
        self.auto_retry_max_attempts = max(0, min(5, attempts))

    def set_output_dir(self, output_dir: str):
        """设置输出目录"""
        self.output_dir = output_dir

    def set_delay_after(self, delay: int):
        """设置批量下载间隔（秒）"""
        self.delay_after = delay

    def set_output_format(self, output_format: str):
        """设置输出格式

        Args:
            output_format: 输出格式 ("folder" | "zip" | "cbz")
        """
        if output_format in ("folder", "zip", "cbz"):
            self.output_format = output_format
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
            except (ValueError, IndexError):
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

    def _build_staged_output(self, temp_dir: str, comic) -> tuple[str, str, str | None]:
        """Build the requested output into a staging path.

        Returns:
            (staged_path, final_path, staging_root)
        """
        final_path = self.cbz_builder.get_output_path_for_format(
            comic, self.output_format, self.output_dir
        )

        if self.output_format == "folder":
            staging_root = tempfile.mkdtemp(dir=self.output_dir, prefix=".hcomic_stage_")
            try:
                staged_path = self.cbz_builder.save_as_folder(
                    temp_dir, comic, staging_root, overwrite=False
                )
                return staged_path, final_path, staging_root
            except Exception:
                self._safe_rmtree(staging_root, self.output_dir)
                raise

        output_dir = os.path.dirname(final_path)
        os.makedirs(output_dir, exist_ok=True)
        basename = os.path.basename(final_path)
        ext = ".zip" if self.output_format == "zip" else ".cbz"
        fd, staged_path = tempfile.mkstemp(
            dir=output_dir,
            prefix=f".{basename}.stage.",
            suffix=ext,
        )
        os.close(fd)
        os.unlink(staged_path)

        if self.output_format == "zip":
            self.cbz_builder.build_zip(temp_dir, comic, staged_path, overwrite=True)
        else:
            self.cbz_builder.build_cbz(temp_dir, comic, staged_path, overwrite=True)
        return staged_path, final_path, None

    def _cleanup_staged_output(self, staged_path: str | None, staging_root: str | None = None) -> None:
        """Remove a staged output without touching the final destination."""
        if staging_root and os.path.exists(staging_root):
            self._safe_rmtree(staging_root, self.output_dir)
            return
        if not staged_path or not os.path.exists(staged_path):
            return
        if os.path.isdir(staged_path):
            self._safe_rmtree(staged_path, self.output_dir)
        else:
            try:
                os.remove(staged_path)
            except FileNotFoundError:
                pass

    def _commit_staged_output(
        self,
        staged_path: str,
        final_path: str,
        overwrite: bool = False,
    ) -> str:
        """Atomically commit staged output to the final destination when possible."""
        if os.path.exists(final_path) and not overwrite:
            raise FileExistsError("Output already exists: %s" % final_path)

        if not os.path.isdir(staged_path):
            os.replace(staged_path, final_path)
            return final_path

        output_dir = os.path.dirname(final_path)
        os.makedirs(output_dir, exist_ok=True)
        if not os.path.exists(final_path):
            shutil.move(staged_path, final_path)
            return final_path

        folder_name = os.path.basename(final_path)
        backup_path = tempfile.mkdtemp(dir=output_dir, prefix=f".{folder_name}.old.")
        os.rmdir(backup_path)
        shutil.move(final_path, backup_path)
        try:
            shutil.move(staged_path, final_path)
            self._safe_rmtree(backup_path, self.output_dir)
        except Exception:
            if os.path.exists(final_path):
                self._safe_rmtree(final_path, self.output_dir)
            if os.path.exists(backup_path):
                shutil.move(backup_path, final_path)
            raise
        return final_path

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

        result: DownloadResult = self.downloader.download_comic_resume(
            task.comic,
            self.output_dir,
            completed_pages=task.completed_pages,
            failed_pages=task.failed_pages,
            progress_callback=progress_callback,
            cancel_event=cancel_event,
            pause_event=pause_event,
        )

        if cancel_event.is_set():
            raise DownloadCancelledError("Download cancelled", temp_dir=result.temp_dir)

        return result

    def _cleanup_cancelled_task(self, task: DownloadTask, temp_dir: str | None, reason: str = "") -> None:
        """清理已取消任务的临时目录和状态。"""
        logger.info("Task %s cancelled (%s), discarding temp", task.task_id, reason)
        if temp_dir and os.path.exists(temp_dir):
            self.downloader.cleanup_temp_dir(temp_dir)
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
        output_path = self.cbz_builder.get_output_path_for_format(
            task.comic, self.output_format, self.output_dir
        )
        if not os.path.exists(output_path):
            return False
        logger.warning("Conflict detected at build time for %s, skipping", output_path)
        with self._lock:
            task.status = DownloadStatus.FAILED
            task.error_message = "File already exists: %s" % output_path
        if task.temp_dir and os.path.exists(task.temp_dir):
            self.downloader.cleanup_temp_dir(task.temp_dir)
        task.temp_dir = None
        return True

    def _handle_download_success(self, task: DownloadTask, result: DownloadResult) -> None:
        """处理下载成功：格式转换、清理临时目录、更新状态。"""
        with self._lock:
            task.temp_dir = result.temp_dir

        if self._check_cancel_before_packaging(task, result):
            return

        if self._check_output_conflict(task):
            return

        staged_path = None
        staging_root = None
        try:
            staged_path, output_path, staging_root = self._build_staged_output(result.temp_dir, task.comic)

            if task.is_cancel_requested:
                self._cleanup_cancelled_task(task, (
                    result.temp_dir if self.output_format != "folder" else None
                ), "during packaging")
                self._cleanup_staged_output(staged_path, staging_root)
                return

            output_path = self._commit_staged_output(staged_path, output_path, overwrite=task.overwrite)
            if staging_root and os.path.exists(staging_root):
                self._safe_rmtree(staging_root, self.output_dir)
            staged_path = None
            staging_root = None
        except Exception:
            self._cleanup_staged_output(staged_path, staging_root)
            raise

        if self.output_format != "folder":
            self.downloader.cleanup_temp_dir(result.temp_dir)
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
            if temp_dir and os.path.exists(temp_dir):
                self.downloader.cleanup_temp_dir(temp_dir)
            return

        with self._lock:
            task.error_message = str(exception)
            task.last_failed_at = time.time()

            if temp_dir and os.path.exists(temp_dir):
                task.temp_dir = temp_dir
                try:
                    self._scan_temp_dir_progress(temp_dir, task)
                except Exception as scan_error:
                    logger.warning("Failed to scan temp dir %s for progress: %s", temp_dir, scan_error)

        self._attempt_auto_retry(task)

    def _attempt_auto_retry(self, task: DownloadTask) -> None:
        """尝试自动重试任务。若重试次数已用尽则标记为 FAILED。"""
        if task.retry_count < self.auto_retry_max_attempts:
            with self._lock:
                task.retry_count += 1
                task.status = DownloadStatus.QUEUED
            logger.warning(
                "Task %s failed, auto-retrying (%s/%s): %s",
                task.task_id, task.retry_count, self.auto_retry_max_attempts, task.error_message
            )
            self._notify_queue_changed()
        else:
            with self._lock:
                task.status = DownloadStatus.FAILED
                task.current_downloading_page = 0
            logger.error("Task %s failed after %s retries: %s", task.task_id, task.retry_count, task.error_message)

    def _apply_delay_after(self, task_id: str) -> None:
        """在任务完成后应用批量下载间隔。"""
        if self.delay_after <= 0:
            return
        queue_copy, task_statuses = self._snapshot_queue_state()
        if task_id not in queue_copy:
            return
        has_pending = any(
            s in (DownloadStatus.QUEUED, DownloadStatus.PAUSED)
            for s in task_statuses.values()
        )
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
            if e.temp_dir and os.path.exists(e.temp_dir):
                self.downloader.cleanup_temp_dir(e.temp_dir)
        except Exception as e:
            self._handle_download_exception(task, e, temp_dir)
        finally:
            with self._lock:
                self.current_task_id = None
            self._notify_task_update(task)
            self._apply_delay_after(task_id)
