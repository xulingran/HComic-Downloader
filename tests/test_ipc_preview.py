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


def _create_test_server(tmp_path):
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
        patch("ipc.library_mixin.get_default_library_db_path", return_value=str(tmp_path / "library.db")),
    ):
        return IPCServer()


def test_fetch_preview_image_returns_url_hash(monkeypatch, tmp_path):
    server = _create_test_server(tmp_path)
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
def test_fetch_preview_image_rejects_invalid_urls(url, tmp_path):
    server = _create_test_server(tmp_path)

    with pytest.raises(ValueError):
        server.handle_fetch_preview_image(url)


def test_get_preview_urls_uses_download_metadata_preparation(tmp_path):
    server = _create_test_server(tmp_path)
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


def test_fetch_preview_image_uses_downloader_auth_and_referer(tmp_path):
    server = _create_test_server(tmp_path)
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
    from sources.jm.descrambler import _resolve_eps_id

    url = "https://cdn.test.one/media/photos/999002/00001.webp"
    # comic_id 传专辑 id 999001，但图片属于章节 999002
    assert _resolve_eps_id(url, comic_id="999001") == 999002


def test_resolve_eps_id_falls_back_to_comic_id():
    """URL 无 eps_id 时回退到 comic_id。"""
    from sources.jm.descrambler import _resolve_eps_id

    assert _resolve_eps_id("https://cdn.test.one/cover.jpg", comic_id="430371") == 430371
    assert _resolve_eps_id("https://cdn.test.one/cover.jpg", comic_id="") == 0


def test_get_preview_urls_returns_chapters(monkeypatch, tmp_path):
    """多章节专辑：不预取图片，返回章节列表。"""
    from models import ChapterInfo

    server = _create_test_server(tmp_path)
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


def test_get_chapter_preview_urls(monkeypatch, tmp_path):
    """get_chapter_preview_urls 取单章图片与 scramble_id。"""
    server = _create_test_server(tmp_path)
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


# ---------------------------------------------------------------------------
# _do_fetch_preview_image: 写盘失败必须抛错（禁止返回伪成功 hash）
# 协议层 app-image:// 只读磁盘、无 on-demand 回源 fallback，
# 因此任何未落盘的 hash 必然 404，必须以 IPC error 暴露真实根因。
# ---------------------------------------------------------------------------

_PREVIEW_URL = "https://h-comic.link/api/nh/media123/pages/1"
_PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


def _stub_fetch_image_bytes(server, monkeypatch):
    """Bypass network: _fetch_image_bytes returns fixed PNG bytes."""
    monkeypatch.setattr(server, "_fetch_image_bytes", lambda url, max_size, image_quality="": _PNG_BYTES)


def test_do_fetch_preview_image_raises_when_write_cache_returns_none(monkeypatch, tmp_path):
    """写盘失败（_write_preview_cache 返回 None）必须抛 RuntimeError，禁止返回 hash。"""
    server = _create_test_server(tmp_path)
    _stub_fetch_image_bytes(server, monkeypatch)
    monkeypatch.setattr(server, "_write_preview_cache", lambda url, raw: None)

    with pytest.raises(RuntimeError, match="Failed to persist preview image"):
        server._do_fetch_preview_image(_PREVIEW_URL)


def test_do_fetch_preview_image_raises_when_no_preview_cache_attribute(monkeypatch, tmp_path):
    """运行时缺少 _preview_cache 属性（_write_preview_cache 直接返回 None）也必须抛错。"""
    server = _create_test_server(tmp_path)
    _stub_fetch_image_bytes(server, monkeypatch)
    # _write_preview_cache 在无 _preview_cache 属性时返回 None
    if hasattr(server, "_preview_cache"):
        monkeypatch.delattr(server, "_preview_cache")

    with pytest.raises(RuntimeError, match="Failed to persist preview image"):
        server._do_fetch_preview_image(_PREVIEW_URL)


def test_do_fetch_preview_image_returns_cached_hash(monkeypatch, tmp_path):
    """缓存命中路径仍返回 hash（写盘不触发）。"""
    server = _create_test_server(tmp_path)
    expected_hash = "a1b2c3d4" * 8
    write_called = False

    def _write_should_not_be_called(url, raw):
        nonlocal write_called
        write_called = True
        return "should-not-reach"

    monkeypatch.setattr(server, "_read_preview_cache", lambda url: expected_hash)
    monkeypatch.setattr(server, "_write_preview_cache", _write_should_not_be_called)

    result = server._do_fetch_preview_image(_PREVIEW_URL)
    assert result == expected_hash
    assert write_called is False


def test_do_fetch_preview_image_returns_hash_on_write_success(monkeypatch, tmp_path):
    """写盘成功路径仍返回 hash（来自 _write_preview_cache）。"""
    server = _create_test_server(tmp_path)
    _stub_fetch_image_bytes(server, monkeypatch)
    expected_hash = "b2c3d4e5" * 8
    monkeypatch.setattr(server, "_read_preview_cache", lambda url: None)
    monkeypatch.setattr(server, "_write_preview_cache", lambda url, raw: expected_hash)

    result = server._do_fetch_preview_image(_PREVIEW_URL)
    assert result == expected_hash


def test_async_fetch_preview_image_reports_error_on_write_failure(monkeypatch, tmp_path):
    """写盘失败经 _async_fetch_preview_image 的 except 分支转为 JSON-RPC error 下发。"""
    server = _create_test_server(tmp_path)
    _stub_fetch_image_bytes(server, monkeypatch)
    monkeypatch.setattr(server, "_write_preview_cache", lambda url, raw: None)

    captured = {}
    monkeypatch.setattr(
        server,
        "_write_response",
        lambda payload: captured.setdefault("payload", payload),
    )

    server._async_fetch_preview_image(_PREVIEW_URL, req_id="req-1")

    payload = captured["payload"]
    assert payload["id"] == "req-1"
    assert "error" in payload
    assert payload["error"]["code"] == -32000
    assert "Failed to persist preview image" in payload["error"]["message"]
    assert "result" not in payload


# --- reader-jump-preload-priority: cancel_preview_generations handler ---


def test_handle_cancel_preview_generations_advances_floor(tmp_path):
    """handle_cancel_preview_generations 推进 _preview_executor 的 cancelled_floor。

    守护前端阅读器跳转时通知后端"旧代请求可丢"的契约：handler 必须把 before
    透传给 PriorityPreviewExecutor.advance_cancelled_floor 并回写结果。
    """
    server = _create_test_server(tmp_path)
    try:
        assert server._preview_executor.cancelled_floor == 0
        result = server.handle_cancel_preview_generations(3)
        assert result == {"cancelled_floor": 3}
        assert server._preview_executor.cancelled_floor == 3
        # monotonic: stale before ignored
        result2 = server.handle_cancel_preview_generations(1)
        assert result2 == {"cancelled_floor": 3}
    finally:
        server._preview_executor.shutdown(wait=False, cancel_futures=True)


def test_handle_cancel_preview_generations_rejects_invalid_before(tmp_path):
    """非法 before（负数）必须抛错，防止静默接受污染 floor。"""
    server = _create_test_server(tmp_path)
    try:
        with pytest.raises(ValueError):
            server.handle_cancel_preview_generations(-1)
        with pytest.raises(ValueError):
            server.handle_cancel_preview_generations(1.5)  # type: ignore[arg-type]
    finally:
        server._preview_executor.shutdown(wait=False, cancel_futures=True)


def test_fetch_preview_image_default_generation_is_active(tmp_path):
    """缺省 generation（非阅读器调用，如详情页）视为活跃代（0），不被取消。

    守护向后兼容：旧前端 / 非阅读器路径不传 generation，后端必须当作当前代
    处理，不应被 cancel_preview_generations 误伤。
    """
    from ipc.preview_executor import PriorityPreviewExecutor

    server = _create_test_server(tmp_path)
    try:
        # 验证 _preview_executor 确为新的优先级调度器（非旧 ThreadPoolExecutor）
        assert isinstance(server._preview_executor, PriorityPreviewExecutor)
        # 缺省 generation 经 fast-path 解析后应为 0（活跃代）：
        # advance floor 到 1 会取消 generation<1（即 gen 0）的排队请求，
        # 但缺省路径发出的请求本就携带 generation=0，因此"缺省=活跃"只在
        # floor 未推进时成立。此处只断言 executor 类型 + floor 初始态，
        # generation 解析逻辑由 test_ipc_async_main_loop 的端到端测试守护。
        assert server._preview_executor.cancelled_floor == 0
    finally:
        server._preview_executor.shutdown(wait=False, cancel_futures=True)
