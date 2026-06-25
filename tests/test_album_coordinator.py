"""tests/test_album_coordinator.py"""

import os
from pathlib import Path

from album_coordinator import AlbumKey, AlbumStagingCoordinator
from cbz_builder import CBZBuilder
from models import ComicInfo, DownloadStatus, DownloadTask


def _make_task(chap_id: str, album_id: str = "100", total: int = 3, title: str = "Album") -> DownloadTask:
    comic = ComicInfo(
        id=chap_id,
        title=f"{title} - Ch{chap_id}",
        source_site="jm",
        comic_source="JM",
        album_id=album_id,
        album_total_chapters=total,
        album_title=title,
        pages=2,
    )
    return DownloadTask(comic=comic, status=DownloadStatus.QUEUED)


class TestAlbumStagingCoordinator:
    def _make_coordinator(self, tmp_path, output_format="cbz"):
        download_dir = str(tmp_path / "downloads")
        os.makedirs(download_dir)

        events = []

        def on_event(key, event, **kwargs):
            events.append((key, event, kwargs))

        coord = AlbumStagingCoordinator(
            download_dir_provider=lambda: download_dir,
            output_format_provider=lambda: output_format,
            cbz_builder=CBZBuilder(),
            history_db=None,
            on_album_event=on_event,
        )
        return coord, events, download_dir

    def test_register_and_get_progress(self, tmp_path):
        coord, events, dd = self._make_coordinator(tmp_path)
        key: AlbumKey = ("jm", "100")
        coord.register_album_tasks(key, ["t1", "t2", "t3"], album_total_chapters=3)

        prog = coord.get_progress(key)
        assert prog.total_chapters == 3
        assert prog.chapters_in_queue == 3

    def test_get_progress_unknown_album(self, tmp_path):
        coord, _, _ = self._make_coordinator(tmp_path)
        prog = coord.get_progress(("jm", "999"))
        assert prog.total_chapters == 0

    def test_on_chapter_complete_notifies_event(self, tmp_path):
        coord, events, dd = self._make_coordinator(tmp_path)
        key: AlbumKey = ("jm", "100")
        coord.register_album_tasks(key, ["t1"], album_total_chapters=1)

        album_dir = os.path.join(dd, "Author-Album")
        ch_dir = os.path.join(album_dir, "Ch1")
        os.makedirs(ch_dir)
        Path(ch_dir, "001.jpg").write_bytes(b"\xff\xd8\xff\xd9")

        task = _make_task("100", total=1, title="Album")
        coord.on_chapter_complete(task, album_dir)

        assert len(events) >= 1
        assert events[0][1] == "chapter_done"

    def test_force_pack_no_chapters(self, tmp_path):
        coord, events, dd = self._make_coordinator(tmp_path)
        result = coord.force_pack_album(("jm", "100"))
        assert result.status == "no_chapters"

    def test_force_pack_conflict_when_exists(self, tmp_path):
        coord, events, dd = self._make_coordinator(tmp_path)
        existing = os.path.join(dd, "Author-Album.cbz")
        Path(existing).write_bytes(b"fake")

        album_dir = os.path.join(dd, "Author-Album")
        ch1 = os.path.join(album_dir, "Ch1")
        os.makedirs(ch1)
        Path(ch1, "001.jpg").write_bytes(b"\xff\xd8\xff\xd9")

        comic = ComicInfo(
            id="100",
            title="Album - Ch1",
            source_site="jm",
            comic_source="JM",
            album_id="100",
            album_title="Album",
            album_total_chapters=1,
            author="Author",
            pages=1,
        )

        key: AlbumKey = ("jm", "100")
        result = coord.force_pack_album(key, overwrite=False, comic=comic)
        assert result.status == "conflict"
        assert result.existing_path == existing

    def test_force_pack_packs_cbz(self, tmp_path):
        coord, events, dd = self._make_coordinator(tmp_path)
        album_dir = os.path.join(dd, "Auth-Album")
        ch1 = os.path.join(album_dir, "Ch1")
        os.makedirs(ch1)
        Path(ch1, "001.jpg").write_bytes(b"\xff\xd8\xff\xd9")

        comic = ComicInfo(
            id="100",
            title="Album - Ch1",
            source_site="jm",
            comic_source="JM",
            album_id="100",
            album_title="Album",
            album_total_chapters=1,
            author="Auth",
            pages=1,
        )

        key: AlbumKey = ("jm", "100")
        coord.register_album_tasks(key, ["t1"], album_total_chapters=1)
        result = coord.force_pack_album(key, overwrite=False, comic=comic)

        assert result.status == "packed"
        assert result.output_path.endswith(".cbz")
        assert os.path.exists(result.output_path)
        assert not os.path.exists(album_dir)

    def test_force_pack_folder_no_packing(self, tmp_path):
        coord, events, dd = self._make_coordinator(tmp_path, output_format="folder")
        album_dir = os.path.join(dd, "Auth-Album")
        ch1 = os.path.join(album_dir, "Ch1")
        os.makedirs(ch1)
        Path(ch1, "001.jpg").write_bytes(b"\xff\xd8\xff\xd9")

        comic = ComicInfo(
            id="100",
            title="Album - Ch1",
            source_site="jm",
            comic_source="JM",
            album_id="100",
            album_title="Album",
            album_total_chapters=1,
            author="Auth",
            pages=1,
        )

        key: AlbumKey = ("jm", "100")
        coord.register_album_tasks(key, ["t1"], album_total_chapters=1)
        result = coord.force_pack_album(key, overwrite=False, comic=comic)

        assert result.status == "packed"
        assert result.output_path == album_dir
        assert os.path.exists(album_dir)


class TestAlbumCoordinatorQueries:
    """专辑 coordinator 公开查询方法（用于专辑级批量控制）。"""

    def _make_coordinator(self, tmp_path):
        coord, events, dd = TestAlbumStagingCoordinator._make_coordinator(self, tmp_path)
        return coord, dd

    def test_get_task_ids_returns_registered_set(self, tmp_path):
        coord, _ = self._make_coordinator(tmp_path)
        key: AlbumKey = ("jm", "100")
        coord.register_album_tasks(key, ["t1", "t2", "t3"], album_total_chapters=3)

        ids = coord.get_task_ids(key)
        assert ids == {"t1", "t2", "t3"}

    def test_get_task_ids_unknown_album_returns_empty(self, tmp_path):
        coord, _ = self._make_coordinator(tmp_path)
        assert coord.get_task_ids(("jm", "unknown")) == set()

    def test_get_task_ids_returns_copy(self, tmp_path):
        """返回的集合修改不应影响 coordinator 内部状态。"""
        coord, _ = self._make_coordinator(tmp_path)
        key: AlbumKey = ("jm", "100")
        coord.register_album_tasks(key, ["t1"], album_total_chapters=1)

        ids = coord.get_task_ids(key)
        ids.add("injected")
        assert "injected" not in coord.get_task_ids(key)

    def test_is_tracked_true_after_register(self, tmp_path):
        coord, _ = self._make_coordinator(tmp_path)
        key: AlbumKey = ("jm", "100")
        coord.register_album_tasks(key, ["t1"], album_total_chapters=1)
        assert coord.is_tracked(key) is True

    def test_is_tracked_false_for_unknown(self, tmp_path):
        coord, _ = self._make_coordinator(tmp_path)
        assert coord.is_tracked(("jm", "unknown")) is False
