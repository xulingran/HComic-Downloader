"""下载管理器核心模块"""
import logging
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
