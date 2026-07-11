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


def _create_test_server(tmp_path):
    with (
        patch("config.Config.load", return_value=Config()),
        patch("sources.MultiSourceParser", return_value=MagicMock()),
        patch("downloader.ComicDownloader", return_value=MagicMock()),
        patch("cbz_builder.CBZBuilder", return_value=MagicMock()),
        patch("download_manager.ComicDownloadManager", return_value=MagicMock()),
        patch("download_history.DownloadHistoryDB", return_value=MagicMock()),
        patch("concurrent.futures.ThreadPoolExecutor", MagicMock()),
        patch("python.ipc_server.CoverCacheDB", return_value=MagicMock()),
        patch("album_coordinator.AlbumStagingCoordinator", return_value=MagicMock()),
        patch("ipc.library_mixin.get_default_library_db_path", return_value=str(tmp_path / "library.db")),
    ):
        return IPCServer()


def test_download_with_chapter_ids_creates_task_per_chapter(monkeypatch, tmp_path):
    server = _create_test_server(tmp_path)
    fake_jm = SimpleNamespace(
        get_chapter_images=lambda cid: (
            [f"https://cdn/media/photos/{cid}/00001.webp"],
            "220980",
        )
    )
    server.parser.parsers = {"jm": fake_jm}

    created = []

    def fake_add_task(comic, overwrite=False):
        created.append(comic)
        return comic.id

    server._download_manager = SimpleNamespace(add_task=fake_add_task, tasks={})

    comic_data = {
        "id": "999001",
        "title": "多章漫画",
        "sourceSite": "jm",
        "source": "JM",
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


def test_download_chapters_partial_failure_returns_created_and_failed(monkeypatch, tmp_path):
    """中途某章请求失败时，返回已创建的 task 与失败章节，不整体抛出。"""

    def flaky_get_chapter_images(cid):
        if cid == "999002":
            raise RuntimeError("CDN 503")
        return ([f"https://cdn/media/photos/{cid}/00001.webp"], "220980")

    server = _create_test_server(tmp_path)
    server.parser.parsers = {"jm": SimpleNamespace(get_chapter_images=flaky_get_chapter_images)}

    created = []

    def fake_add_task(comic, overwrite=False):
        created.append(comic)
        return comic.id

    server._download_manager = SimpleNamespace(add_task=fake_add_task, tasks={})

    comic_data = {
        "id": "999001",
        "title": "多章漫画",
        "sourceSite": "jm",
        "source": "JM",
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


def test_download_chapters_all_failed_reports_error(monkeypatch, tmp_path):
    """所有章节都失败时，taskIds 为空且 status 为 error。"""
    server = _create_test_server(tmp_path)
    server.parser.parsers = {
        "jm": SimpleNamespace(get_chapter_images=lambda cid: (_ for _ in ()).throw(RuntimeError("boom")))
    }
    server._download_manager = SimpleNamespace(add_task=lambda comic, overwrite=False: comic.id, tasks={})

    comic_data = {
        "id": "999001",
        "title": "多章漫画",
        "sourceSite": "jm",
        "source": "JM",
        "albumTotalChapters": 1,
        "chapters": [{"id": "999001", "name": "第 1 話", "index": 1}],
    }
    result = server.handle_download("999001", comic_data, chapter_ids=["999001"])

    assert result["taskIds"] == []
    assert result["status"] == "error"
    assert result["failedChapters"] == [{"id": "999001", "name": "第 1 話", "error": "boom"}]


def test_download_chapters_sets_album_title(monkeypatch, tmp_path):
    """章节 ComicInfo.album_title 应被正确填入。"""
    server = _create_test_server(tmp_path)
    fake_jm = SimpleNamespace(
        get_chapter_images=lambda cid: (
            [f"https://cdn/media/photos/{cid}/00001.webp"],
            "220980",
        )
    )
    server.parser.parsers = {"jm": fake_jm}

    created = []

    def fake_add_task(comic, overwrite=False):
        created.append(comic)
        return comic.id

    server._download_manager = SimpleNamespace(add_task=fake_add_task, tasks={})

    comic_data = {
        "id": "999001",
        "title": "多章漫画",
        "sourceSite": "jm",
        "source": "JM",
        "albumTotalChapters": 2,
        "chapters": [
            {"id": "999001", "name": "第 1 話", "index": 1},
            {"id": "999002", "name": "第 2 話", "index": 2},
        ],
    }
    result = server.handle_download("999001", comic_data, chapter_ids=["999001", "999002"])

    assert created[0].album_title == "多章漫画"
    assert created[1].album_title == "多章漫画"
    assert result.get("albumKey") == {"sourceSite": "jm", "albumId": "999001"}


def test_handle_force_pack_album_no_coordinator(tmp_path):
    """没有 coordinator 时应返回 error。"""
    server = _create_test_server(tmp_path)
    # 删除 coordinator 模拟不可用场景
    del server._album_coordinator
    result = server.handle_force_pack_album("jm", "999001")
    assert result["status"] == "error"


def test_download_batch_as_album_preserves_source_site_and_returns_task_mapping(monkeypatch, tmp_path):
    """批量虚拟专辑不应覆盖原始 source_site，且返回 task 与漫画的映射。"""
    server = _create_test_server(tmp_path)
    created = []
    registered = []

    def fake_prepare(comic_data, comic_id=None):
        return SimpleNamespace(image_urls=[f"https://cdn.example/{comic_id}/001.jpg"])

    def fake_add_task(comic, overwrite=False):
        created.append(comic)
        return comic.task_id if hasattr(comic, "task_id") else f"{comic.source_site}_{comic.comic_source}_{comic.id}"

    server._build_and_prepare_comic = fake_prepare
    server._download_manager = SimpleNamespace(add_task=fake_add_task, tasks={})
    server._album_coordinator = SimpleNamespace(
        register_album_tasks=lambda album_key, task_ids, total: registered.append((album_key, task_ids, total))
    )

    result = server.handle_download_batch_as_album(
        [
            {
                "id": "a",
                "title": "A",
                "sourceSite": "jm",
                "source": "JM",
                "mediaId": "ma",
                "pages": 1,
            },
            {
                "id": "b",
                "title": "B",
                "sourceSite": "bika",
                "source": "BIKA",
                "mediaId": "mb",
                "pages": 1,
            },
        ],
        "自定义专辑",
    )

    assert [comic.source_site for comic in created] == ["jm", "bika"]
    assert result["taskIds"] == ["jm_JM_a", "bika_BIKA_b"]
    assert result["queuedTasks"] == [
        {"taskId": "jm_JM_a", "comicId": "a", "sourceSite": "jm", "source": "JM"},
        {"taskId": "bika_BIKA_b", "comicId": "b", "sourceSite": "bika", "source": "BIKA"},
    ]
    assert registered == [
        (("jm", result["albumKey"]["albumId"]), ["jm_JM_a"], 2),
        (("bika", result["albumKey"]["albumId"]), ["bika_BIKA_b"], 2),
    ]


def test_download_batch_as_album_partial_failure_uses_actual_total(monkeypatch, tmp_path):
    """部分漫画入队失败时，album_total_chapters 应按实际入队数回填，
    否则进度条/历史状态永远无法达到 100%（P1 回归）。"""
    server = _create_test_server(tmp_path)
    created = []
    registered = []

    # 第二本（id="b"）解析失败，模拟网络/反爬异常
    def fake_prepare(comic_data, comic_id=None):
        if comic_id == "b":
            raise RuntimeError("prepare failed for b")
        return SimpleNamespace(image_urls=[f"https://cdn.example/{comic_id}/001.jpg"])

    def fake_add_task(comic, overwrite=False):
        created.append(comic)
        return f"{comic.source_site}_{comic.comic_source}_{comic.id}"

    server._build_and_prepare_comic = fake_prepare
    server._download_manager = SimpleNamespace(add_task=fake_add_task, tasks={})
    server._album_coordinator = SimpleNamespace(
        register_album_tasks=lambda album_key, task_ids, total: registered.append((album_key, task_ids, total))
    )

    result = server.handle_download_batch_as_album(
        [
            {"id": "a", "title": "A", "sourceSite": "hcomic", "source": "NH", "pages": 1},
            {"id": "b", "title": "B", "sourceSite": "hcomic", "source": "NH", "pages": 1},
            {"id": "c", "title": "C", "sourceSite": "hcomic", "source": "NH", "pages": 1},
        ],
        "部分失败专辑",
    )

    # 只有 a、c 入队成功
    assert result["taskIds"] == ["hcomic_NH_a", "hcomic_NH_c"]
    assert result["status"] == "queued"
    assert len(result["failedComics"]) == 1
    assert result["failedComics"][0]["id"] == "b"

    # 关键断言：实际入队数 = 2，故 album_total_chapters 应回填为 2（而非原始 3）
    assert all(
        comic.album_total_chapters == 2 for comic in created
    ), f"expected album_total_chapters=2 after partial failure, got {[c.album_total_chapters for c in created]}"

    # coordinator 注册也应使用实际入队数 2
    assert len(registered) == 1
    _album_key, task_ids, total = registered[0]
    assert task_ids == ["hcomic_NH_a", "hcomic_NH_c"]
    assert total == 2


def test_download_batch_as_album_all_failure_returns_error(monkeypatch, tmp_path):
    """全部入队失败时不应回填 total，返回 error 状态且无 albumKey。"""
    server = _create_test_server(tmp_path)
    created = []

    def fake_prepare(comic_data, comic_id=None):
        raise RuntimeError("always fails")

    def fake_add_task(comic, overwrite=False):
        created.append(comic)
        return f"{comic.source_site}_{comic.comic_source}_{comic.id}"

    server._build_and_prepare_comic = fake_prepare
    server._download_manager = SimpleNamespace(add_task=fake_add_task, tasks={})
    server._album_coordinator = SimpleNamespace(register_album_tasks=lambda *a, **k: None)

    result = server.handle_download_batch_as_album(
        [
            {"id": "a", "title": "A", "sourceSite": "hcomic", "source": "NH"},
            {"id": "b", "title": "B", "sourceSite": "hcomic", "source": "NH"},
        ],
        "全失败专辑",
    )

    assert result["status"] == "error"
    assert result["taskIds"] == []
    assert "albumKey" not in result
    assert created == []
