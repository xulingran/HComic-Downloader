"""tests/test_album_integration.py — 专辑下载端到端集成测试。"""

import os
from pathlib import Path
from unittest.mock import MagicMock

from album_coordinator import AlbumStagingCoordinator
from cbz_builder import CBZBuilder
from download_manager import ComicDownloadManager
from downloader import DownloadResult
from models import ComicInfo, DownloadStatus, DownloadTask


class TestAlbumFolderIntegration:
    """output_format=folder 模式：专辑文件夹/章节文件夹/图片。"""

    def test_chapter_lands_in_album_folder(self, tmp_path):
        output_dir = str(tmp_path / "output")
        os.makedirs(output_dir)

        downloader = MagicMock()
        cbz_builder = CBZBuilder()
        manager = ComicDownloadManager(
            downloader=downloader,
            cbz_builder=cbz_builder,
            output_dir=output_dir,
            output_format="folder",
        )
        coordinator = AlbumStagingCoordinator(
            download_dir_provider=lambda: output_dir,
            output_format_provider=lambda: "folder",
            cbz_builder=cbz_builder,
        )
        manager.set_album_coordinator(coordinator)

        comic = ComicInfo(
            id="ch1",
            title="Album - Ch1",
            source_site="jmcomic",
            comic_source="JMCOMIC",
            album_id="album1",
            album_title="Album",
            album_total_chapters=3,
            author="Auth",
            pages=2,
        )
        task = DownloadTask(comic=comic, status=DownloadStatus.DOWNLOADING)
        manager.tasks[task.task_id] = task

        temp_dir = tmp_path / "temp_jmcomic_ch1"
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

        album_dir = Path(output_dir) / "Auth-Album"
        chapter_dir = album_dir / "Ch1"
        assert chapter_dir.exists()
        assert (chapter_dir / "001.jpg").exists()
        assert (chapter_dir / "002.jpg").exists()
        assert not temp_dir.exists()


class TestAlbumCbzIntegration:
    """output_format=cbz 模式：齐套后自动打包为专辑 cbz。"""

    def test_auto_pack_on_completion(self, tmp_path):
        output_dir = str(tmp_path / "output")
        os.makedirs(output_dir)

        downloader = MagicMock()
        cbz_builder = CBZBuilder()
        manager = ComicDownloadManager(
            downloader=downloader,
            cbz_builder=cbz_builder,
            output_dir=output_dir,
            output_format="cbz",
        )
        coordinator = AlbumStagingCoordinator(
            download_dir_provider=lambda: output_dir,
            output_format_provider=lambda: "cbz",
            cbz_builder=cbz_builder,
        )
        manager.set_album_coordinator(coordinator)

        base_comic_kwargs = dict(
            source_site="jmcomic",
            comic_source="JMCOMIC",
            album_id="album1",
            album_title="Album",
            album_total_chapters=2,
            author="Auth",
            pages=1,
        )

        # 注册专辑任务，使 coordinator 能追踪齐套状态
        album_key = ("jmcomic", "album1")
        coordinator.register_album_tasks(album_key, ["ch1", "ch2"], album_total_chapters=2)

        for chap_num, chap_name in [(1, "Ch1"), (2, "Ch2")]:
            comic = ComicInfo(
                id=f"ch{chap_num}",
                title=f"Album - {chap_name}",
                **base_comic_kwargs,
            )
            task = DownloadTask(comic=comic, status=DownloadStatus.DOWNLOADING)
            manager.tasks[task.task_id] = task

            temp_dir = tmp_path / f"temp_jmcomic_ch{chap_num}"
            temp_dir.mkdir()
            (temp_dir / "001.jpg").write_bytes(b"\xff\xd8\xff\xd9")

            result = DownloadResult(
                success=True,
                completed_pages=[1],
                failed_pages=[],
                temp_dir=str(temp_dir),
            )
            manager._handle_album_chapter_success(task, result)

        # 第 2 章完成后应自动打包
        cbz_path = Path(output_dir) / "Auth-Album.cbz"
        assert cbz_path.exists()
        # 工作目录应被删除
        assert not (Path(output_dir) / "Auth-Album").is_dir()
