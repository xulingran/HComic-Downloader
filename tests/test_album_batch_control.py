"""tests/test_album_batch_control.py

专辑级批量控制（pause/resume/cancel）测试。
覆盖 DownloadManager.pause_album_tasks / resume_album_tasks / cancel_album_tasks，
以及通过 coordinator 查询任务 ID 的路径。
"""

from __future__ import annotations

from download_manager import DownloadManager
from models import ComicInfo, DownloadStatus


def _make_album_chapter_comic(chap_id: str, album_id: str = "100", total: int = 3) -> ComicInfo:
    return ComicInfo(
        id=chap_id,
        title=f"Album - {chap_id}",
        source_site="jmcomic",
        comic_source="JMCOMIC",
        album_id=album_id,
        album_total_chapters=total,
        album_title="Album",
        pages=2,
    )


class FakeCoordinator:
    """轻量 coordinator 桩，仅实现 get_task_ids / is_tracked。"""

    def __init__(self, task_ids_map: dict[tuple[str, str], set[str]] | None = None):
        self._map = task_ids_map or {}

    def get_task_ids(self, album_key: tuple[str, str]) -> set[str]:
        return set(self._map.get(album_key, set()))

    def is_tracked(self, album_key: tuple[str, str]) -> bool:
        return album_key in self._map


def _setup_album_dm(
    album_id: str = "100",
    total: int = 3,
    statuses: list[DownloadStatus] | None = None,
) -> tuple[DownloadManager, list[str], FakeCoordinator]:
    """创建一个含多章专辑任务的 DownloadManager（基类即可）。

    Args:
        statuses: 每个章节任务的初始状态（按顺序）。默认全 QUEUED。

    Returns:
        (dm, task_ids, coordinator)
    """
    dm = DownloadManager()
    statuses = statuses or [DownloadStatus.QUEUED] * total
    task_ids = []
    for i in range(total):
        comic = _make_album_chapter_comic(f"chap{i + 1}", album_id=album_id, total=total)
        tid = dm.add_task(comic)
        task_ids.append(tid)
        dm.tasks[tid].status = statuses[i]
    # 阻止 worker 启动，纯状态机测试
    dm.is_running = True
    coord = FakeCoordinator({("jmcomic", album_id): set(task_ids)})
    dm._album_coordinator = coord
    return dm, task_ids, coord


class TestPauseAlbumTasks:
    def test_pauses_all_queued_and_downloading(self):
        dm, task_ids, _ = _setup_album_dm(
            statuses=[DownloadStatus.QUEUED, DownloadStatus.DOWNLOADING, DownloadStatus.PAUSED]
        )
        result = dm.pause_album_tasks(("jmcomic", "100"))

        assert result["affected"] == 2  # queued + downloading
        assert result["skipped"] == 1  # paused 不可再暂停
        assert result["notFound"] is False
        # QUEUED → PAUSED, DOWNLOADING → PAUSING
        assert dm.tasks[task_ids[0]].status == DownloadStatus.PAUSED
        assert dm.tasks[task_ids[1]].status == DownloadStatus.PAUSING
        # 原本 PAUSED 的保持不变
        assert dm.tasks[task_ids[2]].status == DownloadStatus.PAUSED

    def test_unknown_album_returns_not_found(self):
        dm, _, _ = _setup_album_dm()
        result = dm.pause_album_tasks(("jmcomic", "nonexistent"))
        assert result["notFound"] is True
        assert result["affected"] == 0


class TestResumeAlbumTasks:
    def test_resumes_all_paused_and_pausing(self):
        dm, task_ids, _ = _setup_album_dm(
            statuses=[DownloadStatus.PAUSED, DownloadStatus.PAUSING, DownloadStatus.QUEUED]
        )
        result = dm.resume_album_tasks(("jmcomic", "100"))

        assert result["affected"] == 2  # paused + pausing
        assert result["skipped"] == 1  # queued 不可恢复
        assert dm.tasks[task_ids[0]].status == DownloadStatus.QUEUED
        assert dm.tasks[task_ids[1]].status == DownloadStatus.QUEUED
        assert dm.tasks[task_ids[2]].status == DownloadStatus.QUEUED

    def test_unknown_album_returns_not_found(self):
        dm, _, _ = _setup_album_dm()
        result = dm.resume_album_tasks(("jmcomic", "nonexistent"))
        assert result["notFound"] is True


class TestCancelAlbumTasks:
    def test_cancels_all_incomplete_skips_completed(self):
        """取消专辑时跳过 completed 任务，保留已下载文件。"""
        dm, task_ids, _ = _setup_album_dm(
            statuses=[DownloadStatus.DOWNLOADING, DownloadStatus.COMPLETED, DownloadStatus.QUEUED]
        )
        result = dm.cancel_album_tasks(("jmcomic", "100"))

        assert result["affected"] == 2  # downloading + queued
        assert result["skipped"] == 1  # completed 被跳过（保留）
        assert result["notFound"] is False
        assert dm.tasks[task_ids[0]].status == DownloadStatus.CANCELLED
        # completed 保持不变 —— 已下载文件保留
        assert dm.tasks[task_ids[1]].status == DownloadStatus.COMPLETED
        assert dm.tasks[task_ids[2]].status == DownloadStatus.CANCELLED

    def test_unknown_album_returns_not_found(self):
        dm, _, _ = _setup_album_dm()
        result = dm.cancel_album_tasks(("jmcomic", "nonexistent"))
        assert result["notFound"] is True

    def test_all_completed_returns_zero_affected(self):
        """专辑全部完成时取消不影响任何任务。"""
        dm, task_ids, _ = _setup_album_dm(
            statuses=[DownloadStatus.COMPLETED, DownloadStatus.COMPLETED, DownloadStatus.COMPLETED]
        )
        result = dm.cancel_album_tasks(("jmcomic", "100"))
        assert result["affected"] == 0
        assert result["skipped"] == 3
        for tid in task_ids:
            assert dm.tasks[tid].status == DownloadStatus.COMPLETED


class TestFallbackWithoutCoordinator:
    """coordinator 未跟踪该专辑时，遍历 tasks 按 (source_site, album_id) 兜底匹配。"""

    def test_cancel_falls_back_to_tasks_scan(self):
        dm, task_ids, _ = _setup_album_dm(total=2, statuses=[DownloadStatus.QUEUED, DownloadStatus.QUEUED])
        # 注入一个不跟踪该专辑的 coordinator（模拟跨进程重启后状态丢失）
        dm._album_coordinator = FakeCoordinator({})

        result = dm.cancel_album_tasks(("jmcomic", "100"))
        assert result["notFound"] is False
        assert result["affected"] == 2
        for tid in task_ids:
            assert dm.tasks[tid].status == DownloadStatus.CANCELLED

    def test_pause_falls_back_to_tasks_scan(self):
        dm, task_ids, _ = _setup_album_dm(total=2, statuses=[DownloadStatus.DOWNLOADING, DownloadStatus.QUEUED])
        # 无 coordinator（基类 DownloadManager 默认无 _album_coordinator）
        del dm._album_coordinator

        result = dm.pause_album_tasks(("jmcomic", "100"))
        assert result["affected"] == 2
        assert dm.tasks[task_ids[0]].status == DownloadStatus.PAUSING
        assert dm.tasks[task_ids[1]].status == DownloadStatus.PAUSED
