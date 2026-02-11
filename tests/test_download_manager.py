import pytest
from models import DownloadTask, DownloadStatus, ComicInfo


def test_download_status_enum():
    """测试下载状态枚举"""
    assert DownloadStatus.QUEUED.value == "queued"
    assert DownloadStatus.DOWNLOADING.value == "downloading"
    assert DownloadStatus.PAUSED.value == "paused"
    assert DownloadStatus.COMPLETED.value == "completed"
    assert DownloadStatus.FAILED.value == "failed"
    assert DownloadStatus.CANCELLED.value == "cancelled"


def test_download_task_creation():
    """测试创建下载任务"""
    comic = ComicInfo(
        id="123",
        title="Test Comic",
        pages=10,
        media_id="abc123"
    )
    task = DownloadTask(comic=comic, status=DownloadStatus.QUEUED)

    assert task.comic == comic
    assert task.status == DownloadStatus.QUEUED
    assert task.progress_current == 0
    assert task.progress_total == 0
    assert task.temp_dir is None
    assert task.error_message is None
    assert task.started_at is None


def test_download_task_progress_update():
    """测试更新进度"""
    comic = ComicInfo(id="123", title="Test")
    task = DownloadTask(comic=comic, status=DownloadStatus.DOWNLOADING)

    task.progress_current = 5
    task.progress_total = 10

    assert task.progress_current == 5
    assert task.progress_total == 10


import threading
from download_manager import DownloadManager


def test_download_manager_init():
    """测试 DownloadManager 初始化"""
    dm = DownloadManager()

    assert dm.tasks == {}
    assert dm.queue == []
    assert dm.is_running is False
    assert dm.global_pause is False
    assert dm.current_task_id is None
    assert isinstance(dm._lock, threading.Lock)
    assert isinstance(dm._stop_event, threading.Event)


def test_add_single_task():
    """测试添加单个任务"""
    dm = DownloadManager()
    comic = ComicInfo(id="123", title="Test Comic", pages=10)

    dm.add_task(comic)

    assert len(dm.tasks) == 1
    assert len(dm.queue) == 1
    task_id = dm.queue[0]
    assert task_id in dm.tasks
    assert dm.tasks[task_id].status == DownloadStatus.QUEUED


def test_add_multiple_tasks():
    """测试添加多个任务"""
    dm = DownloadManager()
    comics = [
        ComicInfo(id="1", title="Comic 1", pages=10),
        ComicInfo(id="2", title="Comic 2", pages=20),
    ]

    dm.add_tasks(comics)

    assert len(dm.tasks) == 2
    assert len(dm.queue) == 2
