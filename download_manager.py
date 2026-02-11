"""下载管理器核心模块"""
import logging
import os
import threading
import time
from typing import Dict, List, Optional, Callable

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
        logger.info("Download manager stop requested")

    def _process_queue(self):
        """队列处理主循环（在后台线程运行）"""
        logger.info("Queue processor started")

        while not self._stop_event.is_set():
            # 检查全局暂停
            if self.global_pause:
                time.sleep(0.1)
                continue

            # 获取下一个任务
            task_id = self._get_next_task()
            if not task_id:
                break

            self._process_task(task_id)

        self.is_running = False
        logger.info("Queue processor stopped")

        if self._on_queue_complete:
            self._on_queue_complete()

    def _get_next_task(self) -> Optional[str]:
        """获取下一个可处理的任务"""
        with self._lock:
            while self.queue:
                task_id = self.queue[0]
                task = self.tasks.get(task_id)

                if not task:
                    self.queue.pop(0)
                    continue

                # 跳过暂停的任务，轮转到队列尾部
                if task.status == DownloadStatus.PAUSED:
                    self.queue.append(self.queue.pop(0))
                    continue

                return task_id

            return None

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
        with self._lock:
            task = self.tasks.get(task_id)
            if not task:
                return False

            if task.status == DownloadStatus.DOWNLOADING:
                task._pause_requested = True
                task.status = DownloadStatus.PAUSED
                self._notify_task_update(task)
                logger.info(f"Task {task_id} paused")
                return True
            elif task.status == DownloadStatus.QUEUED:
                task.status = DownloadStatus.PAUSED
                self._notify_task_update(task)
                return True

        return False

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

            return True

    def cancel_task(self, task_id: str) -> bool:
        """取消指定任务"""
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
            return True

    def toggle_global_pause(self) -> bool:
        """切换全局暂停状态"""
        self.global_pause = not self.global_pause
        logger.info(f"Global pause: {self.global_pause}")
        return self.global_pause

    def get_stats(self) -> dict:
        """获取队列统计信息"""
        with self._lock:
            stats = {
                "total": len(self.tasks),
                "queued": sum(1 for t in self.tasks.values() if t.status == DownloadStatus.QUEUED),
                "downloading": sum(1 for t in self.tasks.values() if t.status == DownloadStatus.DOWNLOADING),
                "paused": sum(1 for t in self.tasks.values() if t.status == DownloadStatus.PAUSED),
                "completed": sum(1 for t in self.tasks.values() if t.status == DownloadStatus.COMPLETED),
                "failed": sum(1 for t in self.tasks.values() if t.status == DownloadStatus.FAILED),
                "cancelled": sum(1 for t in self.tasks.values() if t.status == DownloadStatus.CANCELLED),
            }
            return stats

    def clear_completed(self):
        """清理已完成/已取消/已失败的任务"""
        with self._lock:
            to_remove = [
                task_id for task_id, task in self.tasks.items()
                if task.status in (
                    DownloadStatus.COMPLETED,
                    DownloadStatus.CANCELLED,
                    DownloadStatus.FAILED
                )
            ]
            for task_id in to_remove:
                del self.tasks[task_id]
                if task_id in self.queue:
                    self.queue.remove(task_id)


class ComicDownloadManager(DownloadManager):
    """漫画下载管理器 - 集成 ComicDownloader"""

    def __init__(self, downloader, cbz_builder, output_dir: str):
        super().__init__()
        self.downloader = downloader
        self.cbz_builder = cbz_builder
        self.output_dir = output_dir

    def set_output_dir(self, output_dir: str):
        """设置输出目录"""
        self.output_dir = output_dir

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
            # 下载图片
            def progress_callback(current: int, total: int, status: str, comic_info: dict = None):
                task.progress_current = current
                task.progress_total = total
                self._notify_task_update(task)

            temp_dir = self.downloader.download_comic(
                task.comic,
                self.output_dir,
                progress_callback=progress_callback,
            )

            # 检查是否被取消
            if task._cancel_requested:
                raise Exception("Download cancelled")

            task.temp_dir = temp_dir
            self._notify_task_update(task)

            # 打包为 CBZ
            output_path = self.cbz_builder.build_cbz(temp_dir, task.comic)

            # 清理临时目录
            self.downloader.cleanup_temp_dir(temp_dir)

            task.status = DownloadStatus.COMPLETED
            logger.info(f"Task {task_id} completed: {output_path}")

        except Exception as e:
            logger.error(f"Task {task_id} failed: {e}")
            task.status = DownloadStatus.FAILED
            task.error_message = str(e)

            if temp_dir and os.path.exists(temp_dir):
                self.downloader.cleanup_temp_dir(temp_dir)

        finally:
            self.current_task_id = None
            self._notify_task_update(task)
