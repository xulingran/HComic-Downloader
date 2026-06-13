import os
import shutil
import threading
import time

from download_manager import ComicDownloadManager, DownloadManager
from downloader import DownloadResult
from models import ComicInfo, DownloadStatus, DownloadTask


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
    comic = ComicInfo(id="123", title="Test Comic", pages=10, media_id="abc123")
    task = DownloadTask(comic=comic, status=DownloadStatus.QUEUED)

    assert task.comic == comic
    assert task.status == DownloadStatus.QUEUED
    assert task.progress_current == 0
    assert task.progress_total == 0
    assert task.temp_dir is None
    assert task.error_message is None
    assert task.started_at is None
    assert task.download_speed == 0.0
    assert task.current_downloading_page == 0


def test_download_task_progress_update():
    """测试更新进度"""
    comic = ComicInfo(id="123", title="Test")
    task = DownloadTask(comic=comic, status=DownloadStatus.DOWNLOADING)

    task.progress_current = 5
    task.progress_total = 10

    assert task.progress_current == 5
    assert task.progress_total == 10


def test_download_manager_init():
    """测试 DownloadManager 初始化"""
    dm = DownloadManager()

    assert dm.tasks == {}
    assert dm.queue == []
    assert dm.is_running is False
    assert dm.global_pause is False
    assert dm.current_task_id is None
    assert isinstance(dm._lock, type(threading.Lock()))
    assert isinstance(dm._stop_event, type(threading.Event()))


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

    # 暂停（DOWNLOADING → PAUSING，表示正在等待当前批次完成）
    assert dm.pause_task(task_id) is True
    assert dm.tasks[task_id].status == DownloadStatus.PAUSING
    assert dm.tasks[task_id]._pause_requested is True

    # 继续（阻止处理器启动，仅测试状态转移）
    dm.is_running = True
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
    assert dm.tasks[task_id]._cancel_requested is True
    assert task_id not in dm.queue


def test_cancel_paused_task_sets_cancel_requested():
    dm = DownloadManager()
    task_id = dm.add_task(ComicInfo(id="paused_cancel", title="Paused Cancel", pages=1))

    dm.tasks[task_id].status = DownloadStatus.PAUSED

    assert dm.cancel_task(task_id) is True
    assert dm.tasks[task_id].status == DownloadStatus.CANCELLED
    assert dm.tasks[task_id]._cancel_requested is True


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
    task_id_map = {task.comic.id: task_id for task_id, task in dm.tasks.items()}
    dm.tasks[task_id_map["1"]].status = DownloadStatus.DOWNLOADING
    dm.tasks[task_id_map["2"]].status = DownloadStatus.PAUSED
    dm.tasks[task_id_map["3"]].status = DownloadStatus.COMPLETED

    stats = dm.get_stats()

    assert stats["total"] == 3
    assert stats["downloading"] == 1
    assert stats["paused"] == 1
    assert stats["completed"] == 1


def test_start_with_only_paused_tasks_does_not_complete_queue():
    """全部任务都暂停时，不应触发队列完成"""
    dm = DownloadManager()
    queue_complete_called = []

    dm.set_callbacks(on_queue_complete=lambda: queue_complete_called.append(True))

    comic = ComicInfo(id="123", title="Test", pages=10)
    task_id = dm.add_task(comic)
    assert dm.pause_task(task_id) is True

    dm.start()
    time.sleep(0.2)

    assert dm.is_running is True
    assert queue_complete_called == []

    dm.stop()
    deadline = time.time() + 1
    while dm.is_running and time.time() < deadline:
        time.sleep(0.01)
    assert dm.is_running is False


class _FakeDownloader:
    def download_comic_resume(
        self,
        comic,
        output_dir,
        options=None,
        progress_callback=None,
        delay_after=0,
        comic_info=None,
        completed_pages=None,
        failed_pages=None,
        cancel_event=None,
        pause_event=None,
    ):
        total = 3
        temp_dir = os.path.join(output_dir, f"temp_{comic.id}")
        os.makedirs(temp_dir, exist_ok=True)

        completed = list(completed_pages or [])
        for i in range(1, total + 1):
            if i in completed:
                continue
            time.sleep(0.08)
            completed.append(i)
            if progress_callback:
                progress_callback(len(completed), total, "downloading", comic_info)

        return DownloadResult(
            success=True,
            completed_pages=completed,
            failed_pages=[],
            temp_dir=temp_dir,
        )

    def download_comic(self, comic, output_dir, progress_callback=None):
        result = self.download_comic_resume(
            comic=comic,
            output_dir=output_dir,
            progress_callback=progress_callback,
        )
        return result.temp_dir

    def cleanup_temp_dir(self, temp_dir):
        shutil.rmtree(temp_dir, ignore_errors=True)


class _FakeCBZBuilder:
    def __init__(self):
        self.calls = []

    def _record_call(self, kind, output_path):
        self.calls.append((kind, output_path))

    def build_cbz(self, temp_dir, comic, output_path=None, overwrite=False):
        self._record_call("cbz", output_path)
        os.makedirs(temp_dir, exist_ok=True)
        output_path = output_path or os.path.join(temp_dir, f"{comic.id}.cbz")
        with open(output_path, "wb") as f:
            f.write(b"")
        return output_path

    def build_zip(self, temp_dir, comic, output_path=None, overwrite=False):
        self._record_call("zip", output_path)
        os.makedirs(temp_dir, exist_ok=True)
        output_path = output_path or os.path.join(temp_dir, f"{comic.id}.zip")
        with open(output_path, "wb") as f:
            f.write(b"")
        return output_path

    def save_as_folder(self, temp_dir, comic, output_dir=None, overwrite=False):
        self._record_call("folder", output_dir)
        output_dir = output_dir or temp_dir
        target_dir = os.path.join(output_dir, f"{comic.id}")
        os.makedirs(target_dir, exist_ok=True)
        return target_dir

    def get_output_path_for_format(self, comic, output_format, output_dir):
        ext = ".zip" if output_format == "zip" else ".cbz"
        return os.path.join(output_dir, f"{comic.id}{ext}")

    def get_output_path(self, comic, output_dir):
        return self.get_output_path_for_format(comic, "cbz", output_dir)


class _InstantDownloader:
    def download_comic_resume(self, comic, output_dir, progress_callback=None, options=None, **kwargs):
        if options and options.progress_callback:
            progress_callback = progress_callback or options.progress_callback
        temp_dir = os.path.join(output_dir, f"temp_{comic.id}")
        os.makedirs(temp_dir, exist_ok=True)
        with open(os.path.join(temp_dir, "001.jpg"), "wb") as f:
            f.write(b"image")
        if progress_callback:
            progress_callback(1, 1, "done", None)
        return DownloadResult(
            success=True,
            completed_pages=[1],
            failed_pages=[],
            temp_dir=temp_dir,
        )

    def cleanup_temp_dir(self, temp_dir):
        shutil.rmtree(temp_dir, ignore_errors=True)


class _BlockingCBZBuilder(_FakeCBZBuilder):
    def __init__(self, final_path):
        super().__init__()
        self.final_path = final_path
        self.entered = threading.Event()
        self.release = threading.Event()

    def get_output_path_for_format(self, comic, output_format, output_dir):
        return self.final_path

    def build_cbz(self, temp_dir, comic, output_path=None, overwrite=False):
        self.entered.set()
        assert output_path != self.final_path
        assert overwrite is True
        self.release.wait(timeout=2)
        with open(output_path, "wb") as f:
            f.write(b"new-output")
        return output_path


def test_cancel_during_packaging_preserves_existing_overwrite_target(tmp_path):
    final_path = tmp_path / "existing.cbz"
    final_path.write_bytes(b"old-output")
    builder = _BlockingCBZBuilder(str(final_path))
    dm = ComicDownloadManager(
        downloader=_InstantDownloader(),
        cbz_builder=builder,
        output_dir=str(tmp_path),
        output_format="cbz",
    )
    dm.set_auto_retry_max_attempts(0)

    task_id = dm.add_task(
        ComicInfo(id="pack_cancel", title="Pack Cancel", pages=1),
        overwrite=True,
    )
    assert builder.entered.wait(timeout=2)

    assert dm.cancel_task(task_id) is True
    builder.release.set()

    deadline = time.time() + 3
    while dm.is_running and time.time() < deadline:
        time.sleep(0.02)

    assert dm.tasks[task_id].status == DownloadStatus.CANCELLED
    assert final_path.read_bytes() == b"old-output"
    assert not list(tmp_path.glob("*.stage.*"))


def test_pause_downloading_task_keeps_paused_state(tmp_path):
    """下载中暂停后，任务不应被置为 COMPLETED"""
    dm = ComicDownloadManager(
        downloader=_FakeDownloader(),
        cbz_builder=_FakeCBZBuilder(),
        output_dir=str(tmp_path),
    )
    task_id = dm.add_task(ComicInfo(id="123", title="Test", pages=3))

    dm.start()

    deadline = time.time() + 1
    while dm.tasks[task_id].status == DownloadStatus.QUEUED and time.time() < deadline:
        time.sleep(0.01)
    assert dm.tasks[task_id].status == DownloadStatus.DOWNLOADING

    assert dm.pause_task(task_id) is True

    time.sleep(0.4)
    assert dm.tasks[task_id].status == DownloadStatus.PAUSED
    assert dm.tasks[task_id].completed_pages == [1, 2, 3]
    assert dm.tasks[task_id].failed_pages == []
    assert dm.tasks[task_id].temp_dir is not None

    dm.stop()
    deadline = time.time() + 1
    while dm.is_running and time.time() < deadline:
        time.sleep(0.01)
    assert dm.is_running is False


class _MixedExtensionFailureDownloader:
    def download_comic_resume(self, comic, output_dir, progress_callback=None, options=None, **kwargs):
        if options and options.progress_callback:
            progress_callback = progress_callback or options.progress_callback
        temp_dir = os.path.join(output_dir, f"temp_{comic.id}")
        os.makedirs(temp_dir, exist_ok=True)
        for index, ext in enumerate((".jpg", ".png", ".webp", ".ico"), start=1):
            with open(os.path.join(temp_dir, f"{index:03d}{ext}"), "wb") as f:
                f.write(b"data")
        return DownloadResult(
            success=True,
            completed_pages=[1, 2, 3, 4],
            failed_pages=[],
            temp_dir=temp_dir,
        )

    def cleanup_temp_dir(self, temp_dir):
        shutil.rmtree(temp_dir, ignore_errors=True)


class _RaisingCBZBuilder:
    def build_cbz(self, temp_dir, comic, output_path=None):
        raise RuntimeError("pack failed")

    def get_output_path_for_format(self, comic, output_format, output_dir):
        return os.path.join(output_dir, f"{comic.id}.cbz")


def test_failed_output_scans_all_supported_image_extensions(tmp_path):
    dm = ComicDownloadManager(
        downloader=_MixedExtensionFailureDownloader(),
        cbz_builder=_RaisingCBZBuilder(),
        output_dir=str(tmp_path),
    )
    dm.set_auto_retry_max_attempts(0)
    task_id = dm.add_task(ComicInfo(id="scan_1", title="Scan", pages=3))

    deadline = time.time() + 5
    while dm.tasks[task_id].status != DownloadStatus.FAILED and time.time() < deadline:
        time.sleep(0.05)

    task = dm.tasks[task_id]
    assert task.status == DownloadStatus.FAILED
    assert task.completed_pages == [1, 2, 3, 4]
    assert task.failed_pages == []


def test_prepare_comic_hook_called_before_download(tmp_path):
    prepared = []

    def prepare_comic(comic):
        prepared.append(comic.id)
        comic.pages = 3
        return comic

    dm = ComicDownloadManager(
        downloader=_FakeDownloader(),
        cbz_builder=_FakeCBZBuilder(),
        output_dir=str(tmp_path),
        prepare_comic=prepare_comic,
    )
    task_id = dm.add_task(ComicInfo(id="hook", title="Need Prepare", pages=0))
    dm._process_task(task_id)

    assert prepared == ["hook"]
    assert dm.tasks[task_id].comic.pages == 3


def test_get_next_task_locked_all_paused_returns_none():
    dm = DownloadManager()
    t1 = dm.add_task(ComicInfo(id="p1", title="P1", pages=1))
    t2 = dm.add_task(ComicInfo(id="p2", title="P2", pages=1))
    dm.tasks[t1].status = DownloadStatus.PAUSED
    dm.tasks[t2].status = DownloadStatus.PAUSED

    with dm._lock:
        assert dm._get_next_task_locked() is None


def test_get_next_task_locked_all_failed_returns_none():
    dm = DownloadManager()
    t1 = dm.add_task(ComicInfo(id="f1", title="F1", pages=1))
    t2 = dm.add_task(ComicInfo(id="f2", title="F2", pages=1))
    dm.tasks[t1].status = DownloadStatus.FAILED
    dm.tasks[t2].status = DownloadStatus.FAILED

    with dm._lock:
        assert dm._get_next_task_locked() is None


def test_get_next_task_locked_mixed_states_finds_queued():
    dm = DownloadManager()
    t1 = dm.add_task(ComicInfo(id="m1", title="M1", pages=1))
    t2 = dm.add_task(ComicInfo(id="m2", title="M2", pages=1))
    t3 = dm.add_task(ComicInfo(id="m3", title="M3", pages=1))
    dm.tasks[t1].status = DownloadStatus.PAUSED
    dm.tasks[t2].status = DownloadStatus.FAILED
    dm.tasks[t3].status = DownloadStatus.QUEUED

    with dm._lock:
        assert dm._get_next_task_locked() == t3


class _AlwaysFailDownloader:
    def download_comic_resume(self, comic, output_dir, progress_callback=None, options=None, **kwargs):
        if options and options.progress_callback:
            progress_callback = progress_callback or options.progress_callback
        if progress_callback:
            progress_callback(1, 3, "downloading", None)
        temp_dir = os.path.join(output_dir, f"temp_{comic.id}")
        os.makedirs(temp_dir, exist_ok=True)
        return DownloadResult(
            success=False,
            completed_pages=[1],
            failed_pages=[2, 3],
            temp_dir=temp_dir,
            error_message="mock failure",
        )

    def cleanup_temp_dir(self, temp_dir):
        shutil.rmtree(temp_dir, ignore_errors=True)


class _SlowSuccessDownloader:
    def download_comic_resume(self, comic, output_dir, progress_callback=None, options=None, **kwargs):
        if options and options.progress_callback:
            progress_callback = progress_callback or options.progress_callback
        temp_dir = os.path.join(output_dir, f"temp_{comic.id}")
        os.makedirs(temp_dir, exist_ok=True)
        total = max(1, comic.pages)
        for i in range(1, total + 1):
            time.sleep(0.05)
            if progress_callback:
                progress_callback(i, total, "downloading", None)
        return DownloadResult(
            success=True,
            completed_pages=list(range(1, total + 1)),
            failed_pages=[],
            temp_dir=temp_dir,
        )

    def cleanup_temp_dir(self, temp_dir):
        shutil.rmtree(temp_dir, ignore_errors=True)


def test_task_lifecycle_queued_to_completed(tmp_path):
    dm = ComicDownloadManager(
        downloader=_SlowSuccessDownloader(),
        cbz_builder=_FakeCBZBuilder(),
        output_dir=str(tmp_path),
    )
    task_id = dm.add_task(ComicInfo(id="life_ok", title="Lifecycle OK", pages=3))

    deadline = time.time() + 5
    while dm.tasks[task_id].status not in (DownloadStatus.COMPLETED, DownloadStatus.FAILED) and time.time() < deadline:
        time.sleep(0.05)

    task = dm.tasks[task_id]
    assert task.status == DownloadStatus.COMPLETED
    assert task.progress_current == 3
    assert task.progress_total == 3
    assert task.download_speed > 0


def test_task_lifecycle_queued_to_failed_to_retry(tmp_path):
    dm = ComicDownloadManager(
        downloader=_AlwaysFailDownloader(),
        cbz_builder=_FakeCBZBuilder(),
        output_dir=str(tmp_path),
    )
    dm.set_auto_retry_max_attempts(0)
    task_id = dm.add_task(ComicInfo(id="life_fail", title="Lifecycle Fail", pages=3))

    deadline = time.time() + 5
    while dm.tasks[task_id].status != DownloadStatus.FAILED and time.time() < deadline:
        time.sleep(0.05)

    assert dm.tasks[task_id].status == DownloadStatus.FAILED
    assert dm.retry_task(task_id) is True
    assert dm.tasks[task_id].status in (
        DownloadStatus.QUEUED,
        DownloadStatus.DOWNLOADING,
    )
    dm.stop()


def test_task_pause_during_download(tmp_path):
    dm = ComicDownloadManager(
        downloader=_SlowSuccessDownloader(),
        cbz_builder=_FakeCBZBuilder(),
        output_dir=str(tmp_path),
    )
    task_id = dm.add_task(ComicInfo(id="pause_1", title="Pause", pages=5))
    dm.start()

    deadline = time.time() + 1
    while dm.tasks[task_id].status == DownloadStatus.QUEUED and time.time() < deadline:
        time.sleep(0.01)
    assert dm.pause_task(task_id) is True

    time.sleep(0.3)
    assert dm.tasks[task_id].status == DownloadStatus.PAUSED
    dm.stop()


def test_task_cancel_during_download(tmp_path):
    dm = ComicDownloadManager(
        downloader=_SlowSuccessDownloader(),
        cbz_builder=_FakeCBZBuilder(),
        output_dir=str(tmp_path),
    )
    task_id = dm.add_task(ComicInfo(id="cancel_1", title="Cancel", pages=5))
    dm.start()

    deadline = time.time() + 1
    while dm.tasks[task_id].status == DownloadStatus.QUEUED and time.time() < deadline:
        time.sleep(0.01)
    assert dm.cancel_task(task_id) is True

    time.sleep(0.3)
    assert dm.tasks[task_id].status == DownloadStatus.CANCELLED
    dm.stop()


def test_auto_retry_respects_max_attempts(tmp_path):
    dm = ComicDownloadManager(
        downloader=_AlwaysFailDownloader(),
        cbz_builder=_FakeCBZBuilder(),
        output_dir=str(tmp_path),
    )
    dm.set_auto_retry_max_attempts(1)
    task_id = dm.add_task(ComicInfo(id="retry_1", title="Retry", pages=3))
    dm.start()

    deadline = time.time() + 2
    while dm.tasks[task_id].status not in (DownloadStatus.FAILED, DownloadStatus.COMPLETED) and time.time() < deadline:
        time.sleep(0.02)

    task = dm.tasks[task_id]
    assert task.status == DownloadStatus.FAILED
    assert task.retry_count == 1
    dm.stop()


def test_add_task_auto_starts_stopped_manager(tmp_path):
    """add_task on a stopped manager must restart the worker."""
    dm = ComicDownloadManager(
        downloader=_FakeDownloader(),
        cbz_builder=_FakeCBZBuilder(),
        output_dir=str(tmp_path),
    )
    # Start with empty queue — worker exits immediately
    dm.start()
    time.sleep(0.3)
    assert dm.is_running is False

    # Add task — should auto-start
    comic = ComicInfo(id="auto-start-test", title="Auto Start", pages=2)
    task_id = dm.add_task(comic)

    # Wait for completion
    deadline = time.time() + 5
    while time.time() < deadline:
        if dm.tasks[task_id].status in (
            DownloadStatus.COMPLETED,
            DownloadStatus.FAILED,
        ):
            break
        time.sleep(0.05)

    assert dm.tasks[task_id].status == DownloadStatus.COMPLETED


def test_add_duplicate_task_returns_existing_for_active_task():
    """非终态的重复 task_id 不应覆盖，应返回已有 task_id。"""
    dm = DownloadManager()
    comic = ComicInfo(id="dup1", title="Duplicate", pages=3)
    task_id_1 = dm.add_task(comic)
    assert dm.tasks[task_id_1].status == DownloadStatus.QUEUED

    task_id_2 = dm.add_task(comic)
    assert task_id_2 == task_id_1
    assert len(dm.tasks) == 1
    assert len(dm.queue) == 1
    assert dm.tasks[task_id_1].status == DownloadStatus.QUEUED


def test_add_duplicate_task_allows_redownload_for_completed():
    """终态（completed/cancelled/failed）的任务允许重新下载。"""
    dm = DownloadManager()
    comic = ComicInfo(id="redl1", title="Redownload", pages=3)
    task_id_1 = dm.add_task(comic)

    # 模拟任务完成
    dm.tasks[task_id_1].status = DownloadStatus.COMPLETED

    task_id_2 = dm.add_task(comic)
    assert task_id_2 == task_id_1
    assert len(dm.queue) == 2
    assert dm.tasks[task_id_1].status == DownloadStatus.QUEUED


def test_on_download_success_callback(tmp_path):
    """ComicDownloadManager has on_download_success attribute and calls it on completion."""
    dm = ComicDownloadManager(
        downloader=_FakeDownloader(),
        cbz_builder=_FakeCBZBuilder(),
        output_dir=str(tmp_path),
    )
    assert hasattr(dm, "on_download_success")
    assert dm.on_download_success is None


def test_handle_album_chapter_success_moves_to_album_folder(tmp_path):
    """专辑章下载成功后，temp 目录被移动到 专辑文件夹/章节名/。"""
    from unittest.mock import MagicMock

    downloader = MagicMock()
    downloader.download_comic_resume.return_value = DownloadResult(
        success=True,
        completed_pages=[1],
        failed_pages=[],
        temp_dir=str(tmp_path / "temp_jmcomic_100"),
    )
    downloader.cleanup_temp_dir = MagicMock()

    cbz_builder = MagicMock()
    cbz_builder.get_album_folder_name.return_value = "Auth-Album"
    manager = ComicDownloadManager(
        downloader=downloader,
        cbz_builder=cbz_builder,
        output_dir=str(tmp_path / "output"),
        output_format="folder",
    )

    # 注入 coordinator
    from album_coordinator import AlbumStagingCoordinator
    from cbz_builder import CBZBuilder

    coordinator = AlbumStagingCoordinator(
        download_dir_provider=lambda: str(tmp_path / "output"),
        output_format_provider=lambda: "folder",
        cbz_builder=CBZBuilder(),
    )
    manager.set_album_coordinator(coordinator)

    comic = ComicInfo(
        id="100",
        title="Album - Ch1",
        source_site="jmcomic",
        comic_source="JMCOMIC",
        album_id="100",
        album_title="Album",
        album_total_chapters=3,
        author="Auth",
        pages=2,
    )
    task = DownloadTask(comic=comic, status=DownloadStatus.DOWNLOADING)
    manager.tasks[task.task_id] = task

    # 创建 temp 目录
    temp_dir = tmp_path / "temp_jmcomic_100"
    temp_dir.mkdir()
    (temp_dir / "001.jpg").write_bytes(b"\xff\xd8\xff\xd9")
    (temp_dir / "002.jpg").write_bytes(b"\xff\xd8\xff\xd9")

    result = DownloadResult(
        success=True,
        completed_pages=[1, 2],
        failed_pages=[],
        temp_dir=str(temp_dir),
    )

    manager._handle_album_chapter_success(task, result)

    # 章节目录应该在专辑文件夹下
    album_dir = tmp_path / "output" / "Auth-Album"
    chapter_dir = album_dir / "Ch1"
    assert chapter_dir.exists()
    assert (chapter_dir / "001.jpg").exists()
    assert not temp_dir.exists()
