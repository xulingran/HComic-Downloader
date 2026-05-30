"""Tests for preview image IPC helpers."""
import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"))

from config import Config
from models import ComicInfo
from python.ipc_server import IPCServer


def _create_test_server():
    """Create an IPCServer instance with all constructor dependencies mocked.

    Uses unittest.mock.patch to avoid side effects (file I/O, network,
    thread pools) so the constructor can run to completion.
    """
    with patch("config.Config.load", return_value=Config()), \
         patch("sources.MultiSourceParser", return_value=MagicMock()), \
         patch("downloader.ComicDownloader", return_value=MagicMock()), \
         patch("cbz_builder.CBZBuilder", return_value=MagicMock()), \
         patch("download_manager.ComicDownloadManager", return_value=MagicMock()), \
         patch("download_history.DownloadHistoryDB", return_value=MagicMock()), \
         patch("concurrent.futures.ThreadPoolExecutor", MagicMock()), \
         patch("python.ipc_server.CoverCacheDB", return_value=MagicMock()):
        return IPCServer()


def test_fetch_preview_image_returns_data_uri(monkeypatch):
    server = _create_test_server()
    monkeypatch.setattr(server, "_do_fetch_preview_image", lambda url, **kw: "data:image/webp;base64,abc")

    result = server.handle_fetch_preview_image("https://h-comic.link/api/nh/media123/pages/1")

    assert result == {"dataUri": "data:image/webp;base64,abc"}


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

    result = server.handle_get_preview_urls({
        "id": "123",
        "title": "From search",
        "sourceSite": "hcomic",
        "source": "NH",
        "pages": 0,
        "mediaId": "",
    })

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
            resolve_redirects=lambda url, session, timeout: ("https://h-comic.com/api/nh/media123/pages/1", session),
        ),
    )

    data_uri = server._fetch_image_as_data_uri(
        "https://h-comic.link/api/nh/media123/pages/1",
        1024,
    )

    assert data_uri.startswith("data:image/png;base64,")
    assert captured["url"] == "https://h-comic.com/api/nh/media123/pages/1"
    assert captured["headers"] == {"Cookie": "sid=abc", "User-Agent": "Downloader-UA"}
    assert captured["kwargs"]["timeout"] == 17
    assert captured["kwargs"]["headers"]["Referer"] == "https://h-comic.com/"
    assert captured["closed"] is True


def test_detect_image_type_supports_avif():
    avif_bytes = b"\x00\x00\x00\x20ftypavif" + b"\x00" * 20

    assert IPCServer._detect_image_type(avif_bytes) == "image/avif"


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
