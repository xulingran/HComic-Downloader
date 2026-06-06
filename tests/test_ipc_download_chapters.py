"""Tests for per-chapter download via chapter_ids."""

import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"),
)

from config import Config
from python.ipc_server import IPCServer


def _create_test_server():
    with (
        patch("config.Config.load", return_value=Config()),
        patch("sources.MultiSourceParser", return_value=MagicMock()),
        patch("downloader.ComicDownloader", return_value=MagicMock()),
        patch("cbz_builder.CBZBuilder", return_value=MagicMock()),
        patch("download_manager.ComicDownloadManager", return_value=MagicMock()),
        patch("download_history.DownloadHistoryDB", return_value=MagicMock()),
        patch("concurrent.futures.ThreadPoolExecutor", MagicMock()),
        patch("python.ipc_server.CoverCacheDB", return_value=MagicMock()),
    ):
        return IPCServer()


def test_download_with_chapter_ids_creates_task_per_chapter(monkeypatch):
    server = _create_test_server()
    fake_jm = SimpleNamespace(
        get_chapter_images=lambda cid: (
            [f"https://cdn/media/photos/{cid}/00001.webp"],
            "220980",
        )
    )
    server.parser.parsers = {"jmcomic": fake_jm}

    created = []

    def fake_add_task(comic, overwrite=False):
        created.append(comic)
        return comic.id

    server._download_manager = SimpleNamespace(add_task=fake_add_task, tasks={})

    comic_data = {
        "id": "999001",
        "title": "多章漫画",
        "sourceSite": "jmcomic",
        "source": "JMCOMIC",
        "albumTotalChapters": 2,
        "chapters": [
            {"id": "999001", "name": "第 1 話", "index": 1},
            {"id": "999002", "name": "第 2 話", "index": 2},
        ],
    }
    result = server.handle_download("999001", comic_data, chapter_ids=["999001", "999002"])

    assert len(created) == 2
    assert created[0].id == "999001"
    assert created[0].album_id == "999001"
    assert created[0].album_total_chapters == 2
    assert "多章漫画" in created[0].title
    assert "第 1 話" in created[0].title
    assert result["taskIds"] == ["999001", "999002"]
    assert result["status"] == "queued"


def test_download_chapters_partial_failure_returns_created_and_failed(monkeypatch):
    """中途某章请求失败时，返回已创建的 task 与失败章节，不整体抛出。"""

    def flaky_get_chapter_images(cid):
        if cid == "999002":
            raise RuntimeError("CDN 503")
        return ([f"https://cdn/media/photos/{cid}/00001.webp"], "220980")

    server = _create_test_server()
    server.parser.parsers = {"jmcomic": SimpleNamespace(get_chapter_images=flaky_get_chapter_images)}

    created = []

    def fake_add_task(comic, overwrite=False):
        created.append(comic)
        return comic.id

    server._download_manager = SimpleNamespace(add_task=fake_add_task, tasks={})

    comic_data = {
        "id": "999001",
        "title": "多章漫画",
        "sourceSite": "jmcomic",
        "source": "JMCOMIC",
        "albumTotalChapters": 3,
        "chapters": [
            {"id": "999001", "name": "第 1 話", "index": 1},
            {"id": "999002", "name": "第 2 話", "index": 2},
            {"id": "999003", "name": "第 3 話", "index": 3},
        ],
    }
    result = server.handle_download("999001", comic_data, chapter_ids=["999001", "999002", "999003"])

    # 第 1、3 章成功建任务，第 2 章失败被记录而非中断
    assert result["taskIds"] == ["999001", "999003"]
    assert [c.id for c in created] == ["999001", "999003"]
    assert result["failedChapters"] == [{"id": "999002", "name": "第 2 話", "error": "CDN 503"}]
    assert result["status"] == "queued"


def test_download_chapters_all_failed_reports_error(monkeypatch):
    """所有章节都失败时，taskIds 为空且 status 为 error。"""
    server = _create_test_server()
    server.parser.parsers = {
        "jmcomic": SimpleNamespace(get_chapter_images=lambda cid: (_ for _ in ()).throw(RuntimeError("boom")))
    }
    server._download_manager = SimpleNamespace(add_task=lambda comic, overwrite=False: comic.id, tasks={})

    comic_data = {
        "id": "999001",
        "title": "多章漫画",
        "sourceSite": "jmcomic",
        "source": "JMCOMIC",
        "albumTotalChapters": 1,
        "chapters": [{"id": "999001", "name": "第 1 話", "index": 1}],
    }
    result = server.handle_download("999001", comic_data, chapter_ids=["999001"])

    assert result["taskIds"] == []
    assert result["status"] == "error"
    assert result["failedChapters"] == [{"id": "999001", "name": "第 1 話", "error": "boom"}]
