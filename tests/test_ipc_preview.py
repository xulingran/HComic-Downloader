"""Tests for preview image IPC helpers."""

import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"),
)

from config import Config
from models import ComicInfo
from python.ipc_server import IPCServer


def _create_test_server():
    """Create an IPCServer instance with all constructor dependencies mocked.

    Uses unittest.mock.patch to avoid side effects (file I/O, network,
    thread pools) so the constructor can run to completion.
    """
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


def test_fetch_preview_image_returns_url_hash(monkeypatch):
    server = _create_test_server()
    monkeypatch.setattr(
        server,
        "_do_fetch_preview_image",
        lambda url, **kw: "a1b2c3d4" * 8,  # 64-char hex url_hash
    )

    result = server.handle_fetch_preview_image("https://h-comic.link/api/nh/media123/pages/1")

    assert result == {"urlHash": "a1b2c3d4" * 8}


@pytest.mark.parametrize(
    "url",
    [
        "http://h-comic.link/api/nh/media123/pages/1",
        "https://example.com/image.webp",
        "",
    ],
)
def test_fetch_preview_image_rejects_invalid_urls(url):
    server = _create_test_server()

    with pytest.raises(ValueError):
        server.handle_fetch_preview_image(url)


def test_get_preview_urls_uses_download_metadata_preparation():
    server = _create_test_server()
    prepared = ComicInfo(
        id="123",
        title="Prepared",
        source_site="hcomic",
        comic_source="NH",
        media_id="media123",
        pages=2,
    )
    server._download_manager = SimpleNamespace(prepare_comic=lambda comic: prepared)

    result = server.handle_get_preview_urls(
        {
            "id": "123",
            "title": "From search",
            "sourceSite": "hcomic",
            "source": "NH",
            "pages": 0,
            "mediaId": "",
        }
    )

    assert result == {
        "imageUrls": [
            "https://h-comic.link/api/nh/media123/pages/1",
            "https://h-comic.link/api/nh/media123/pages/2",
        ],
        "totalPages": 2,
    }


def test_fetch_preview_image_uses_downloader_auth_and_referer():
    server = _create_test_server()
    captured = {}
    png_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def raise_for_status(self):
            return None

        def iter_content(self, chunk_size=8192):
            yield png_bytes

    class FakeSession:
        def __init__(self):
            self.headers = {}
            self.closed = False

        def get(self, url, **kwargs):
            captured["url"] = url
            captured["kwargs"] = kwargs
            captured["headers"] = dict(self.headers)
            return FakeResponse()

        def close(self):
            self.closed = True
            captured["closed"] = True

    fake_session = FakeSession()
    server.downloader = SimpleNamespace(
        timeout=17,
        session=SimpleNamespace(headers={"Cookie": "sid=abc", "User-Agent": "Downloader-UA"}),
        create_isolated_session=lambda: fake_session,
        url_validator=SimpleNamespace(
            resolve_redirects=lambda url, session, timeout: (
                "https://h-comic.com/api/nh/media123/pages/1",
                session,
            ),
        ),
    )

    raw_bytes = server._fetch_image_bytes(
        "https://h-comic.link/api/nh/media123/pages/1",
        1024,
    )

    assert raw_bytes == png_bytes
    assert captured["url"] == "https://h-comic.com/api/nh/media123/pages/1"
    assert captured["headers"] == {"Cookie": "sid=abc", "User-Agent": "Downloader-UA"}
    assert captured["kwargs"]["timeout"] == 17
    assert captured["kwargs"]["headers"]["Referer"] == "https://h-comic.com/"
    assert captured["closed"] is True


def test_resolve_eps_id_prefers_url():
    """多章节：反混淆 eps_id 应取自图片 URL，而非传入的专辑 comic_id。"""
    from python.ipc.preview_mixin import _resolve_eps_id

    url = "https://cdn.test.one/media/photos/999002/00001.webp"
    # comic_id 传专辑 id 999001，但图片属于章节 999002
    assert _resolve_eps_id(url, comic_id="999001") == 999002


def test_resolve_eps_id_falls_back_to_comic_id():
    """URL 无 eps_id 时回退到 comic_id。"""
    from python.ipc.preview_mixin import _resolve_eps_id

    assert _resolve_eps_id("https://cdn.test.one/cover.jpg", comic_id="430371") == 430371
    assert _resolve_eps_id("https://cdn.test.one/cover.jpg", comic_id="") == 0


def test_get_preview_urls_returns_chapters(monkeypatch):
    """多章节专辑：不预取图片，返回章节列表。"""
    from models import ChapterInfo

    server = _create_test_server()
    comic = ComicInfo(
        id="999001",
        title="多章",
        source_site="jm",
        comic_source="JM",
        album_id="999001",
        album_total_chapters=2,
        chapters=[
            ChapterInfo(id="999001", name="第 1 話", index=1),
            ChapterInfo(id="999002", name="第 2 話", index=2),
        ],
    )
    monkeypatch.setattr(server, "_build_and_prepare_comic", lambda d, comic_id=None: comic)
    result = server.handle_get_preview_urls({"id": "999001", "sourceSite": "jm"})
    assert result["imageUrls"] == []
    assert len(result["chapters"]) == 2
    assert result["chapters"][0]["id"] == "999001"
    assert result["chapters"][0]["name"] == "第 1 話"
    assert result["albumId"] == "999001"
    assert result["albumTotalChapters"] == 2


def test_get_chapter_preview_urls(monkeypatch):
    """get_chapter_preview_urls 取单章图片与 scramble_id。"""
    server = _create_test_server()
    fake_jm = SimpleNamespace(
        get_chapter_images=lambda cid: (
            ["https://cdn/media/photos/999002/00001.webp"],
            "220980",
        )
    )
    server.parser.parsers = {"jm": fake_jm}
    result = server.handle_get_chapter_preview_urls(chapter_id="999002", album_id="999001")
    assert result["imageUrls"][0].endswith("00001.webp")
    assert result["scrambleId"] == "220980"
    assert result["comicId"] == "999002"
