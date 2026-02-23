"""下载管理器核心模块"""
import logging
import os
import threading
import time
from typing import Dict, List, Optional, Callable

from downloader import DownloadResult
from models import ComicInfo, DownloadTask, DownloadStatus

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

        # 回调
        self._on_task_update: Optional[Callable[[DownloadTask], None]] = None
        self._on_queue_complete: Optional[Callable[[], None]] = None

    def add_task(self, comic: ComicInfo) -> str:
        """添加单个任务到队列"""
        task = DownloadTask(comic=comic, status=DownloadStatus.QUEUED)
        task_id = task.task_id

        with self._lock:
            self.tasks[task_id] = task
            self.queue.append(task_id)

        logger.info(f"Added task {task_id}: {comic.title}")
        self._notify_queue_changed()
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
        if self.is_running:
            return

        self._stop_event.clear()
        self.is_running = True

        threading.Thread(target=self._process_queue, daemon=True).start()
        logger.info("Download manager started")

    def stop(self):
        """停止队列处理器"""
        self._stop_event.set()
        self._notify_queue_changed()
        logger.info("Download manager stop requested")

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
        with self._lock:
            task = self.tasks.get(task_id)
            if not task or task.status != DownloadStatus.PAUSED:
                return False

            task._pause_requested = False
            task.status = DownloadStatus.QUEUED
            self._notify_task_update(task)
            logger.info(f"Task {task_id} resumed")

            # 如果处理器未运行，启动它
            if not self.is_running:
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

            if task.status == DownloadStatus.DOWNLOADING:
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
    ):
        super().__init__()
        self.downloader = downloader
        self.cbz_builder = cbz_builder
        self.output_dir = output_dir
        self.prepare_comic = prepare_comic
        self.delay_after = 0  # 批量下载间隔（秒）
        self.auto_retry_max_attempts = 2  # 自动重试次数（默认2次）

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

    def _process_task(self, task_id: str):
        """处理单个下载任务"""
        task = self.tasks.get(task_id)
        if not task or task.status != DownloadStatus.QUEUED:
            return

        self.current_task_id = task_id
        task.status = DownloadStatus.DOWNLOADING
        task.started_at = time.time()
        self._notify_task_update(task)

        temp_dir = None
        try:
            if self.prepare_comic:
                prepared = self.prepare_comic(task.comic)
                if prepared is not None:
                    task.comic = prepared

            # 下载图片（支持断点续传）
            def progress_callback(current: int, total: int, status: str, comic_info: dict = None):
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
            )

            # 检查是否被取消
            if task._cancel_requested:
                raise Exception("Download cancelled")

            temp_dir = result.temp_dir

            # 下载过程收到了暂停请求：保留已下载内容，维持 PAUSED 状态
            if task._pause_requested:
                task.temp_dir = temp_dir
                task.status = DownloadStatus.PAUSED
                logger.info(f"Task {task_id} paused after current checkpoint")
                return
            task.temp_dir = temp_dir
            task.completed_pages = result.completed_pages
            task.failed_pages = result.failed_pages
            self._notify_task_update(task)

            if result.success:
                # 下载成功，打包为 CBZ
                # 使用 download_manager 的 output_dir 而非配置文件中的目录
                output_path = self.cbz_builder.get_output_path(task.comic, self.output_dir)
                output_path = self.cbz_builder.build_cbz(temp_dir, task.comic, output_path)

                # 清理临时目录（成功时清理）
                self.downloader.cleanup_temp_dir(temp_dir)
                task.temp_dir = None

                task.status = DownloadStatus.COMPLETED
                task.current_downloading_page = 0
                logger.info(f"Task {task_id} completed: {output_path}")
            else:
                # 下载失败，检查是否可自动重试
                task.failed_pages = result.failed_pages
                task.completed_pages = result.completed_pages
                task.last_failed_at = time.time()
                task.error_message = result.error_message or "下载失败"

                # 自动重试逻辑
                if task.retry_count < self.auto_retry_max_attempts:
                    task.retry_count += 1
                    task.status = DownloadStatus.QUEUED
                    task.temp_dir = temp_dir  # 保留临时目录用于断点续传
                    logger.warning(
                        f"Task {task_id} failed, auto-retrying ({task.retry_count}/{self.auto_retry_max_attempts}): {task.error_message}"
                    )
                    self._notify_queue_changed()
                else:
                    task.status = DownloadStatus.FAILED
                    task.current_downloading_page = 0
                    logger.error(f"Task {task_id} failed after {task.retry_count} retries: {task.error_message}")
                    # 失败时不清理临时目录，保留已下载的图片用于手动重试

        except Exception as e:
            logger.error(f"Task {task_id} failed: {e}")
            # 如果任务已被取消，保留 CANCELLED 状态，不要覆盖为 FAILED
            if task.status != DownloadStatus.CANCELLED:
                task.error_message = str(e)
                task.last_failed_at = time.time()
                # 对于非下载相关的异常（如 CBZ 打包失败），
                # 如果已经有下载进度，保留它以便可能的重试
                if temp_dir and os.path.exists(temp_dir):
                    # 尝试从临时目录扫描已下载的文件来更新进度
                    try:
                        import glob
                        downloaded_files = glob.glob(os.path.join(temp_dir, "*.jpg"))
                        # 从文件名提取页码（格式: 001.jpg, 002.jpg 等）
                        completed_from_files = []
                        for f in downloaded_files:
                            try:
                                page_num = int(os.path.basename(f).split('.')[0])
                                completed_from_files.append(page_num)
                            except (ValueError, IndexError):
                                continue
                        if completed_from_files:
                            task.completed_pages = sorted(completed_from_files)
                            task.progress_current = len(task.completed_pages)
                            # 假设未下载的页面都是失败的
                            all_pages = set(range(1, task.comic.pages + 1))
                            task.failed_pages = sorted(all_pages - set(task.completed_pages))
                    except Exception as scan_error:
                        logger.warning(f"Failed to scan temp dir for progress: {scan_error}")

                # 自动重试逻辑
                if task.retry_count < self.auto_retry_max_attempts:
                    task.retry_count += 1
                    task.status = DownloadStatus.QUEUED
                    task.temp_dir = temp_dir  # 保留临时目录用于断点续传
                    logger.warning(
                        f"Task {task_id} failed with exception, auto-retrying ({task.retry_count}/{self.auto_retry_max_attempts}): {task.error_message}"
                    )
                    self._notify_queue_changed()
                else:
                    task.status = DownloadStatus.FAILED
                    task.current_downloading_page = 0
                    logger.error(f"Task {task_id} failed after {task.retry_count} retries: {task.error_message}")
                    # 失败时不清理临时目录，保留已下载的图片用于手动重试

            # 如果任务被取消，清理临时目录
            if task.status == DownloadStatus.CANCELLED and temp_dir and os.path.exists(temp_dir):
                self.downloader.cleanup_temp_dir(temp_dir)

        finally:
            self.current_task_id = None
            self._notify_task_update(task)

            # 批量下载间隔（如果不是队列中最后一个任务）
            if self.delay_after > 0 and task_id in self.queue:
                # 检查是否还有未完成的任务
                has_pending = any(
                    self.tasks.get(tid, None) and
                    self.tasks[tid].status in (DownloadStatus.QUEUED, DownloadStatus.PAUSED)
                    for tid in self.queue
                )
                if has_pending:
                    logger.info(f"Waiting {self.delay_after}s before next download")
                    time.sleep(self.delay_after)
