"""下载管理器核心模块"""
import logging
import os
import shutil
import tempfile
import threading
import time
from typing import Dict, List, Optional, Callable

from downloader import DownloadResult
from image_formats import SUPPORTED_IMAGE_EXTENSIONS
from models import ComicInfo, DownloadCancelledError, DownloadTask, DownloadStatus

logger = logging.getLogger(__name__)


class DownloadManager:
    """下载管理器 - 管理下载队列和任务状态"""

    def __init__(self):
        # 任务存储
        self.tasks: Dict[str, DownloadTask] = {}
        self.queue: List[str] = []

        # 状态标志
        self.is_running: bool = False
        self.global_pause: bool = False
        self.current_task_id: Optional[str] = None

        # 线程同步
        self._lock = threading.Lock()
        self._queue_condition = threading.Condition(self._lock)
        self._stop_event = threading.Event()
        self._worker_thread: Optional[threading.Thread] = None

        # 回调
        self._on_task_update: Optional[Callable[[DownloadTask], None]] = None
        self._on_queue_complete: Optional[Callable[[], None]] = None

    def add_task(self, comic: ComicInfo, overwrite: bool = False) -> str:
        """添加单个任务到队列"""
        task = DownloadTask(comic=comic, status=DownloadStatus.QUEUED, overwrite=overwrite)
        task_id = task.task_id

        with self._lock:
            existing = self.tasks.get(task_id)
            if existing and existing.status not in (
                DownloadStatus.COMPLETED, DownloadStatus.CANCELLED, DownloadStatus.FAILED
            ):
                logger.info(f"Task {task_id} already active ({existing.status.value}), skipping duplicate")
                return task_id
            self.tasks[task_id] = task
            self.queue.append(task_id)

        logger.info(f"Added task {task_id}: {comic.title}")
        self._notify_queue_changed()
        self._notify_task_update(task)
        return task_id

    def add_tasks(self, comics: List[ComicInfo]) -> List[str]:
        """添加多个任务到队列"""
        task_ids = []
        for comic in comics:
            task_id = self.add_task(comic)
            task_ids.append(task_id)
        return task_ids

    def set_callbacks(
        self,
        on_task_update: Optional[Callable[[DownloadTask], None]] = None,
        on_queue_complete: Optional[Callable[[], None]] = None,
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

                    should_exit = True
                    break

            if should_exit:
                break

            self._process_task(task_id)

        with self._lock:
            self.is_running = False
        logger.info("Queue processor stopped")

        if self._on_queue_complete:
            self._on_queue_complete()

    def _get_next_task(self) -> Optional[str]:
        """获取下一个可处理的任务"""
        with self._lock:
            return self._get_next_task_locked()

    def _get_next_task_locked(self) -> Optional[str]:
        """获取下一个可处理的任务（调用方需持有 _lock）。"""
        seen: set[str] = set()

        while self.queue:
            task_id = self.queue[0]
            if task_id in seen:
                return None

            task = self.tasks.get(task_id)

            if not task:
                self.queue.pop(0)
                continue

            # 跳过已完成的任务（取消/完成）- 从队列移除
            if task.status in (DownloadStatus.COMPLETED, DownloadStatus.CANCELLED):
                self.queue.pop(0)
                continue

            # 跳过失败/暂停任务，轮转到队列尾部
            if task.status in (DownloadStatus.FAILED, DownloadStatus.PAUSED):
                seen.add(task_id)
                self.queue.append(self.queue.pop(0))
                continue

            return task_id

        return None

    def _has_pending_tasks(self) -> bool:
        """检查是否仍有未完成任务（包括暂停中的任务）"""
        with self._lock:
            return self._has_pending_tasks_locked()

    def _has_pending_tasks_locked(self) -> bool:
        """检查是否仍有未完成任务（调用方需持有 _lock）。"""
        return any(
            task.status in (DownloadStatus.QUEUED, DownloadStatus.DOWNLOADING, DownloadStatus.PAUSED)
            for task in self.tasks.values()
        )

    def _notify_queue_changed(self):
        """唤醒队列处理线程，响应任务状态变化。"""
        with self._queue_condition:
            self._queue_condition.notify_all()

    def _process_task(self, task_id: str):
        """处理单个任务（子类可覆盖）"""
        task = self.tasks.get(task_id)
        if not task or task.status != DownloadStatus.QUEUED:
            return

        self.current_task_id = task_id
        task.status = DownloadStatus.DOWNLOADING
        task.started_at = time.time()
        self._notify_task_update(task)

        # 实际下载逻辑由子类或回调实现
        # 这里仅模拟状态流转
        logger.info(f"Processing task {task_id}: {task.comic.title}")

    def _notify_task_update(self, task: DownloadTask):
        """通知任务更新"""
        if self._on_task_update:
            self._on_task_update(task)

    def pause_task(self, task_id: str) -> bool:
        """暂停指定任务"""
        changed = False
        with self._lock:
            task = self.tasks.get(task_id)
            if not task:
                return False

            if task.status == DownloadStatus.DOWNLOADING:
                task._pause_requested = True
                task.status = DownloadStatus.PAUSED
                self._notify_task_update(task)
                logger.info(f"Task {task_id} paused")
                changed = True
            elif task.status == DownloadStatus.QUEUED:
                task.status = DownloadStatus.PAUSED
                self._notify_task_update(task)
                changed = True

        if changed:
            self._notify_queue_changed()
        return changed

    def resume_task(self, task_id: str) -> bool:
        """继续指定任务"""
        should_start = False
        with self._lock:
            task = self.tasks.get(task_id)
            if not task or task.status != DownloadStatus.PAUSED:
                return False

            task._pause_requested = False
            task.status = DownloadStatus.QUEUED
            self._notify_task_update(task)
            logger.info(f"Task {task_id} resumed")

            if not self.is_running:
                should_start = True

        if should_start:
            self.start()
        self._notify_queue_changed()
        return True

    def cancel_task(self, task_id: str) -> bool:
        """取消指定任务"""
        changed = False
        with self._lock:
            task = self.tasks.get(task_id)
            if not task:
                return False

            if task.status not in (
                DownloadStatus.COMPLETED, DownloadStatus.CANCELLED, DownloadStatus.FAILED
            ):
                task._cancel_requested = True

            task.status = DownloadStatus.CANCELLED

            # 从队列移除
            if task_id in self.queue:
                self.queue.remove(task_id)

            self._notify_task_update(task)
            logger.info(f"Task {task_id} cancelled")
            changed = True
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
        with self._lock:
            task = self.tasks.get(task_id)
            if not task or task.status != DownloadStatus.FAILED:
                return False

            # 重置任务状态
            task.status = DownloadStatus.QUEUED
            task.retry_count += 1
            task.error_message = None
            # 保留 failed_pages 和 completed_pages 用于断点续传
            self._notify_task_update(task)
            logger.info(f"Task {task_id} queued for retry (attempt #{task.retry_count})")

            # 检查是否需要启动队列处理器
            should_start = not self.is_running

        # 在锁外启动处理器
        if should_start:
            self.start()
        self._notify_queue_changed()

        return True

    def toggle_global_pause(self) -> bool:
        """切换全局暂停状态"""
        self.global_pause = not self.global_pause
        self._notify_queue_changed()
        logger.info(f"Global pause: {self.global_pause}")
        return self.global_pause

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

    def clear_completed(self):
        """清理已完成/已取消的任务（失败任务保留供重试）"""
        changed = False
        with self._lock:
            to_remove = [
                task_id for task_id, task in self.tasks.items()
                if task.status in (
                    DownloadStatus.COMPLETED,
                    DownloadStatus.CANCELLED,
                )
            ]
            for task_id in to_remove:
                del self.tasks[task_id]
                if task_id in self.queue:
                    self.queue.remove(task_id)
                changed = True
        if changed:
            self._notify_queue_changed()


class ComicDownloadManager(DownloadManager):
    """漫画下载管理器 - 集成 ComicDownloader"""

    def __init__(
        self,
        downloader,
        cbz_builder,
        output_dir: str,
        prepare_comic: Optional[Callable[[ComicInfo], ComicInfo]] = None,
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
            logger.info(f"Output format set to: {output_format}")

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
            all_pages = set(range(1, task.comic.pages + 1))
            task.failed_pages = sorted(all_pages - set(task.completed_pages))

    def _process_output_by_format(self, temp_dir: str, comic, overwrite: bool = False) -> str:
        """根据输出格式处理下载内容

        Args:
            temp_dir: 临时图片目录
            comic: 漫画信息
            overwrite: 是否覆盖已有文件

        Returns:
            输出路径
        """
        if self.output_format == "folder":
            # 保存为普通文件夹（移动临时目录）
            return self.cbz_builder.save_as_folder(temp_dir, comic, self.output_dir, overwrite=overwrite)
        output_path = self.cbz_builder.get_output_path_for_format(comic, self.output_format, self.output_dir)
        if self.output_format == "zip":
            # 打包为 ZIP
            return self.cbz_builder.build_zip(temp_dir, comic, output_path, overwrite=overwrite)
        # 打包为 CBZ
        return self.cbz_builder.build_cbz(temp_dir, comic, output_path, overwrite=overwrite)

    def _build_staged_output(self, temp_dir: str, comic) -> tuple[str, str, Optional[str]]:
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
                shutil.rmtree(staging_root, ignore_errors=True)
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

    def _cleanup_staged_output(self, staged_path: Optional[str], staging_root: Optional[str] = None) -> None:
        """Remove a staged output without touching the final destination."""
        if staging_root and os.path.exists(staging_root):
            shutil.rmtree(staging_root, ignore_errors=True)
            return
        if not staged_path or not os.path.exists(staged_path):
            return
        if os.path.isdir(staged_path):
            shutil.rmtree(staged_path, ignore_errors=True)
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
            raise FileExistsError(f"Output already exists: {final_path}")

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
            shutil.rmtree(backup_path)
        except Exception:
            if os.path.exists(final_path):
                shutil.rmtree(final_path, ignore_errors=True)
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
        if task._cancel_requested:
            cancel_event.set()

        def progress_callback(current: int, total: int, status: str, comic_info: dict = None):
            if task._cancel_requested:
                cancel_event.set()
            if task._pause_requested:
                pause_event.set()
            with self._lock:
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

    def _handle_download_success(self, task: DownloadTask, result: DownloadResult) -> None:
        """处理下载成功：格式转换、清理临时目录、更新状态。"""
        if task._cancel_requested:
            logger.info(f"Task {task.task_id} cancelled before packaging, discarding temp")
            if result.temp_dir and os.path.exists(result.temp_dir):
                self.downloader.cleanup_temp_dir(result.temp_dir)
            task.temp_dir = None
            task.status = DownloadStatus.CANCELLED
            return

        # 构建前复查目标路径冲突
        if not task.overwrite:
            output_path = self.cbz_builder.get_output_path_for_format(
                task.comic, self.output_format, self.output_dir
            )
            if os.path.exists(output_path):
                logger.warning(f"Conflict detected at build time for {output_path}, skipping")
                task.status = DownloadStatus.FAILED
                task.error_message = f"File already exists: {output_path}"
                if result.temp_dir and os.path.exists(result.temp_dir):
                    self.downloader.cleanup_temp_dir(result.temp_dir)
                task.temp_dir = None
                return

        staged_path = None
        staging_root = None
        try:
            staged_path, output_path, staging_root = self._build_staged_output(result.temp_dir, task.comic)

            if task._cancel_requested:
                logger.info(f"Task {task.task_id} cancelled during packaging, discarding staged output")
                self._cleanup_staged_output(staged_path, staging_root)
                if self.output_format != "folder" and result.temp_dir and os.path.exists(result.temp_dir):
                    self.downloader.cleanup_temp_dir(result.temp_dir)
                task.temp_dir = None
                task.status = DownloadStatus.CANCELLED
                return

            output_path = self._commit_staged_output(staged_path, output_path, overwrite=task.overwrite)
            if staging_root and os.path.exists(staging_root):
                shutil.rmtree(staging_root, ignore_errors=True)
            staged_path = None
            staging_root = None
        except Exception:
            self._cleanup_staged_output(staged_path, staging_root)
            raise

        if self.output_format != "folder":
            self.downloader.cleanup_temp_dir(result.temp_dir)
        task.temp_dir = None

        task.status = DownloadStatus.COMPLETED
        task.current_downloading_page = 0
        logger.info(f"Task {task.task_id} completed: {output_path}")

    def _handle_download_failure(self, task: DownloadTask, result: DownloadResult) -> None:
        """处理下载失败：记录失败信息并尝试自动重试。"""
        task.failed_pages = result.failed_pages
        task.completed_pages = result.completed_pages
        task.last_failed_at = time.time()
        task.error_message = result.error_message or "下载失败"
        task.temp_dir = result.temp_dir
        self._attempt_auto_retry(task)

    def _handle_download_exception(self, task: DownloadTask, exception: Exception, temp_dir: Optional[str]) -> None:
        """处理下载异常：保留进度、尝试自动重试或清理。"""
        logger.error(f"Task {task.task_id} failed: {exception}")

        if task.status == DownloadStatus.CANCELLED:
            if temp_dir and os.path.exists(temp_dir):
                self.downloader.cleanup_temp_dir(temp_dir)
            return

        task.error_message = str(exception)
        task.last_failed_at = time.time()

        if temp_dir and os.path.exists(temp_dir):
            task.temp_dir = temp_dir
            try:
                self._scan_temp_dir_progress(temp_dir, task)
            except Exception as scan_error:
                logger.warning(f"Failed to scan temp dir for progress: {scan_error}")

        self._attempt_auto_retry(task)

    def _attempt_auto_retry(self, task: DownloadTask) -> None:
        """尝试自动重试任务。若重试次数已用尽则标记为 FAILED。"""
        if task.retry_count < self.auto_retry_max_attempts:
            task.retry_count += 1
            task.status = DownloadStatus.QUEUED
            logger.warning(
                f"Task {task.task_id} failed, auto-retrying ({task.retry_count}/{self.auto_retry_max_attempts}): {task.error_message}"
            )
            self._notify_queue_changed()
        else:
            task.status = DownloadStatus.FAILED
            task.current_downloading_page = 0
            logger.error(f"Task {task.task_id} failed after {task.retry_count} retries: {task.error_message}")

    def _apply_delay_after(self, task_id: str) -> None:
        """在任务完成后应用批量下载间隔。"""
        if self.delay_after <= 0 or task_id not in self.queue:
            return
        has_pending = any(
            self.tasks.get(tid) and
            self.tasks[tid].status in (DownloadStatus.QUEUED, DownloadStatus.PAUSED)
            for tid in self.queue
        )
        if has_pending:
            logger.info(f"Waiting {self.delay_after}s before next download")
            time.sleep(self.delay_after)

    def _process_task(self, task_id: str):
        """处理单个下载任务（编排器）。"""
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

            if task._cancel_requested:
                logger.info(f"Task {task_id} cancelled after download returned, skipping success")
                if result.temp_dir and os.path.exists(result.temp_dir):
                    self.downloader.cleanup_temp_dir(result.temp_dir)
                task.status = DownloadStatus.CANCELLED
                self._notify_task_update(task)
                return

            if task._pause_requested:
                task.temp_dir = result.temp_dir
                task.completed_pages = result.completed_pages
                task.failed_pages = result.failed_pages
                task.status = DownloadStatus.PAUSED
                self._notify_task_update(task)
                logger.info(f"Task {task_id} paused after current checkpoint")
                return

            task.temp_dir = result.temp_dir
            task.completed_pages = result.completed_pages
            task.failed_pages = result.failed_pages
            self._notify_task_update(task)

            if result.success:
                self._handle_download_success(task, result)
            else:
                self._handle_download_failure(task, result)
        except DownloadCancelledError as e:
            if e.temp_dir and os.path.exists(e.temp_dir):
                self.downloader.cleanup_temp_dir(e.temp_dir)
        except Exception as e:
            self._handle_download_exception(task, e, temp_dir)
        finally:
            self.current_task_id = None
            self._notify_task_update(task)
            self._apply_delay_after(task_id)
