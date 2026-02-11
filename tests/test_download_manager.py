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
