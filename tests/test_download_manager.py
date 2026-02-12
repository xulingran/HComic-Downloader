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


def test_pause_resume_task():
    """测试暂停和继续任务"""
    dm = DownloadManager()
    comic = ComicInfo(id="123", title="Test", pages=10)
    task_id = dm.add_task(comic)

    # 模拟任务开始
    dm.tasks[task_id].status = DownloadStatus.DOWNLOADING

    # 暂停
    assert dm.pause_task(task_id) is True
    assert dm.tasks[task_id].status == DownloadStatus.PAUSED
    assert dm.tasks[task_id]._pause_requested is True

    # 继续
    assert dm.resume_task(task_id) is True
    assert dm.tasks[task_id].status == DownloadStatus.QUEUED
    assert dm.tasks[task_id]._pause_requested is False


def test_cancel_task():
    """测试取消任务"""
    dm = DownloadManager()
    comic = ComicInfo(id="123", title="Test", pages=10)
    task_id = dm.add_task(comic)

    assert dm.cancel_task(task_id) is True
    assert dm.tasks[task_id].status == DownloadStatus.CANCELLED
    assert task_id not in dm.queue


def test_get_stats():
    """测试统计信息"""
    dm = DownloadManager()
    comics = [
        ComicInfo(id="1", title="C1", pages=10),
        ComicInfo(id="2", title="C2", pages=10),
        ComicInfo(id="3", title="C3", pages=10),
    ]
    dm.add_tasks(comics)

    # 修改状态
    dm.tasks["_1"].status = DownloadStatus.DOWNLOADING
    dm.tasks["_2"].status = DownloadStatus.PAUSED
    dm.tasks["_3"].status = DownloadStatus.COMPLETED

    stats = dm.get_stats()

    assert stats["total"] == 3
    assert stats["downloading"] == 1
    assert stats["paused"] == 1
    assert stats["completed"] == 1
