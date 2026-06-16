"""ImageDownloader 真实路径集成测试。

验证图片下载核心链路（URL 校验 → 代理注入 Session → 流式下载 → 格式检测 → 落盘 → 临时文件清理）
的真实行为。网络层用注入的 Response 字节（monkeypatch Session.get），不发起真实 HTTP，
保留 ImageDownloader.download 的全部真实逻辑。对应 download-core-integrity 能力规范。
"""

from __future__ import annotations

import threading
from unittest.mock import MagicMock

import pytest
import requests

from image_downloader import ImageDownloader
from url_validator import DownloadError

# ── 最小有效图片字节 ──────────────────────────────────────────────────

# 最小有效 JPEG（1x1 像素）
_MIN_JPEG = (
    b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    b"\xff\xdb\x00C\x00\x03\x02\x02\x03\x02\x02\x03\x03\x03\x03\x04\x03\x03"
    b"\x04\x05\x08\x05\x05\x04\x04\x05\n\x07\x07\x06\x08\x0c\n\x0c\x0c\x0b"
    b"\n\x0b\x0b\r\x0e\x12\x10\r\x0e\x11\x0e\x0b\x0b\x10\x16\x10\x11\x13\x14"
    b"\x15\x15\x15\x0c\x0f\x17\x18\x16\x14\x18\x12\x14\x15\x14\xff\xc0\x00"
    b"\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x14\x00\x01\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\n\xff\xc4\x00"
    b"\x14\x10\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\xff\xda\x00\x08\x01\x01\x00\x00?\x00T\x9f\xff\xd9"
)

# 最小有效 PNG（1x1 像素）— PNG 签名 + IHDR + IDAT + IEND
_MIN_PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
    b"\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01\x5d\xcc\xdb\xd2\x00"
    b"\x00\x00\x00IEND\xaeB`\x82"
)

_NON_IMAGE_BYTES = b"This is not an image, just plain text data"


# ── Response 注入工具 ────────────────────────────────────────────────


def _make_stream_response(
    content: bytes,
    content_type: str = "image/jpeg",
    status_code: int = 200,
) -> MagicMock:
    """构造一个模拟的流式 requests.Response。

    支持被用作 context manager（with 语句），且 iter_content 返回 chunk。
    注意：每次调用返回新实例，因 iter_content 迭代器会耗尽。
    """
    resp = MagicMock(spec=requests.Response)
    resp.status_code = status_code
    resp.headers = {"Content-Type": content_type} if content_type else {}
    resp.is_redirect = False
    # iter_content 返回新的迭代器（每次 MagicMock 调用都新建）
    resp.iter_content = MagicMock(return_value=iter([content]))
    resp.raise_for_status = MagicMock()
    if status_code >= 400:
        resp.raise_for_status.side_effect = requests.HTTPError(f"{status_code} Error")
    # context manager 支持
    resp.__enter__ = MagicMock(return_value=resp)
    resp.__exit__ = MagicMock(return_value=False)
    return resp


# ── 正常下载落盘 ──────────────────────────────────────────────────────


class TestNormalDownload:
    """验证正常下载的落盘、扩展名、内容匹配、临时文件清理。"""

    def test_download_jpeg_writes_file_with_correct_extension(self, tmp_path, monkeypatch):
        """JPEG + Content-Type: image/jpeg → 落盘 .jpg，内容匹配。"""
        downloader = ImageDownloader(timeout=5, pool_size=1)

        # resolve_redirects 与 download 都调 session.get，每次返回新非重定向响应
        monkeypatch.setattr(
            requests.Session,
            "get",
            lambda self, url, **kw: _make_stream_response(_MIN_JPEG, content_type="image/jpeg"),
        )

        output = str(tmp_path / "page_001")
        downloader.download("https://h-comic.com/img/001.jpg", output)

        # 落盘文件应为 .jpg
        written = tmp_path / "page_001.jpg"
        assert written.exists(), f"预期文件 {written} 不存在"
        assert written.read_bytes() == _MIN_JPEG, "写入内容与注入字节不一致"

    def test_download_png_detected_via_content_type(self, tmp_path, monkeypatch):
        """PNG + Content-Type: image/png → 落盘 .png。"""
        downloader = ImageDownloader(timeout=5, pool_size=1)
        monkeypatch.setattr(
            requests.Session,
            "get",
            lambda self, url, **kw: _make_stream_response(_MIN_PNG, content_type="image/png"),
        )

        output = str(tmp_path / "page_001")
        downloader.download("https://h-comic.com/img/001.png", output)

        written = tmp_path / "page_001.png"
        assert written.exists(), "预期 .png 文件不存在"

    def test_temp_file_cleaned_after_success(self, tmp_path, monkeypatch):
        """下载成功后临时 .tmp 文件必须被清理。"""
        downloader = ImageDownloader(timeout=5, pool_size=1)
        monkeypatch.setattr(
            requests.Session,
            "get",
            lambda self, url, **kw: _make_stream_response(_MIN_JPEG, content_type="image/jpeg"),
        )

        downloader.download("https://h-comic.com/img/001.jpg", str(tmp_path / "page_001"))

        # 不应残留 .tmp 文件
        tmp_files = list(tmp_path.glob("*.tmp"))
        assert not tmp_files, f"残留临时文件: {tmp_files}"


# ── 格式检测 ──────────────────────────────────────────────────────────


class TestFormatDetection:
    """验证 Content-Type 缺失时按 PIL 检测，非图片字节回退默认扩展名。"""

    def test_format_detected_via_pil_when_no_content_type(self, tmp_path, monkeypatch):
        """无 Content-Type 时按 PIL 检测格式为 PNG。"""
        downloader = ImageDownloader(timeout=5, pool_size=1)
        monkeypatch.setattr(
            requests.Session,
            "get",
            lambda self, url, **kw: _make_stream_response(_MIN_PNG, content_type=""),
        )

        output = str(tmp_path / "page_001")
        downloader.download("https://h-comic.com/img/001", output)

        # PIL 应检测为 PNG
        written = tmp_path / "page_001.png"
        assert written.exists(), "无 Content-Type 时 PIL 应检测为 .png"

    def test_non_image_bytes_falls_back_to_default_extension(self, tmp_path, monkeypatch):
        """非图片字节回退默认扩展名 .jpg，不崩溃。"""
        downloader = ImageDownloader(timeout=5, pool_size=1)
        monkeypatch.setattr(
            requests.Session,
            "get",
            lambda self, url, **kw: _make_stream_response(_NON_IMAGE_BYTES, content_type=""),
        )

        output = str(tmp_path / "page_001")
        downloader.download("https://h-comic.com/img/001", output)

        # 回退默认扩展名 .jpg
        written = tmp_path / "page_001.jpg"
        assert written.exists(), "非图片字节应回退 .jpg"


# ── 大小上限防护 ─────────────────────────────────────────────────────


class TestSizeLimit:
    """验证超过 100MB 上限的响应被拦截。"""

    def test_oversize_response_raises_download_error(self, tmp_path, monkeypatch):
        """累计字节数超过 MAX_IMAGE_SIZE (100MB) 必须抛 DownloadError。"""
        downloader = ImageDownloader(timeout=5, pool_size=1)

        # 构造一个超过 100MB 的流：单个 chunk > 100MB 会很慢，用多 chunk 累积
        chunk_size = 8192
        # 需要超过 100MB，约 12801 个 chunk（12801 * 8192 = 104,865,792 > 100MB）
        chunk_count = ImageDownloader.MAX_IMAGE_SIZE // chunk_size + 2
        big_chunk = b"\x00" * chunk_size

        def _fake_get(self, url, **kwargs):
            resp = _make_stream_response(b"", content_type="image/jpeg")
            resp.iter_content = MagicMock(return_value=iter([big_chunk] * chunk_count))
            return resp

        monkeypatch.setattr(requests.Session, "get", _fake_get)

        with pytest.raises(DownloadError, match="(?i)too large|exceeded"):
            downloader.download("https://h-comic.com/img/big.jpg", str(tmp_path / "big"))

        # 临时文件必须被清理
        tmp_files = list(tmp_path.glob("*.tmp"))
        assert not tmp_files, f"超限失败后应清理临时文件，残留: {tmp_files}"


# ── 网络错误路径 ─────────────────────────────────────────────────────


class TestNetworkErrorPaths:
    """验证 HTTP 错误、超时被捕获为 DownloadError，且 Session 被归还。"""

    def test_http_error_raises_download_error(self, tmp_path, monkeypatch):
        """HTTP 4xx/5xx 必须抛 DownloadError。"""
        downloader = ImageDownloader(timeout=5, pool_size=1)
        monkeypatch.setattr(
            requests.Session,
            "get",
            lambda self, url, **kw: _make_stream_response(b"", status_code=404),
        )

        with pytest.raises(DownloadError, match="(?i)failed to download"):
            downloader.download("https://h-comic.com/img/missing.jpg", str(tmp_path / "x"))

    def test_timeout_raises_download_error(self, tmp_path, monkeypatch):
        """requests.Timeout 必须被捕获并转为 DownloadError。"""
        downloader = ImageDownloader(timeout=5, pool_size=1)

        def _raise_timeout(self, url, **kwargs):
            raise requests.Timeout("Connection timed out")

        monkeypatch.setattr(requests.Session, "get", _raise_timeout)

        with pytest.raises(DownloadError, match="(?i)failed to download"):
            downloader.download("https://h-comic.com/img/slow.jpg", str(tmp_path / "x"))

    def test_session_returned_to_pool_after_failure(self, tmp_path, monkeypatch):
        """下载失败后借出的 Session 必须归还池中，不泄漏。"""
        downloader = ImageDownloader(timeout=5, pool_size=1)

        # 池初始有 1 个 session
        assert downloader._session_pool.qsize() == 1

        def _raise_timeout(self, url, **kwargs):
            raise requests.Timeout("timed out")

        monkeypatch.setattr(requests.Session, "get", _raise_timeout)

        with pytest.raises(DownloadError):
            downloader.download("https://h-comic.com/img/x.jpg", str(tmp_path / "x"))

        # 失败后 session 应归还池（qsize 恢复为 1）
        assert downloader._session_pool.qsize() == 1, "失败后 Session 未归还池（泄漏）"


# ── 代理注入契约 ─────────────────────────────────────────────────────


class TestProxyInjectionContract:
    """验证 ImageDownloader 创建的 Session 符合 AGENTS.md 代理硬约束。"""

    def test_session_has_system_proxy_applied(self):
        """Session 创建后必须已应用系统代理（trust_env=True）。"""
        downloader = ImageDownloader(timeout=5, pool_size=1)
        session = downloader._create_session()
        # apply_system_proxy_to_session 设置 trust_env=True 以兼容 NO_PROXY
        assert session.trust_env is True, "Session 必须启用 trust_env 以走系统代理"

    def test_all_pooled_sessions_have_proxy_applied(self):
        """池中所有 Session 都必须已应用代理。"""
        downloader = ImageDownloader(timeout=5, pool_size=3)
        for _ in range(downloader._pool_size):
            session = downloader._session_pool.get_nowait()
            assert session.trust_env is True, "池中 Session 未应用代理（trust_env=False）"
            # 归还以免影响后续
            downloader._session_pool.put(session)


# ── 会话池并发一致性 ─────────────────────────────────────────────────


class TestSessionPoolConcurrency:
    """验证会话池在并发 checkout/release 与认证更新下的一致性。"""

    def test_concurrent_checkout_release_no_leak(self):
        """多线程并发获取/归还不丢失 Session（总数守恒）。"""
        pool_size = 4
        downloader = ImageDownloader(timeout=5, pool_size=pool_size)
        checked_out: list = []
        lock = threading.Lock()
        barrier = threading.Barrier(pool_size)

        def _worker():
            barrier.wait()  # 同步所有线程同时获取，最大化竞态
            session = downloader._acquire_session()
            with lock:
                checked_out.append(session)
            # 短暂持有后归还
            downloader._release_session(session)

        threads = [threading.Thread(target=_worker) for _ in range(pool_size)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=5)

        # 不变量：池中 Session 总数守恒（无泄漏、无重复）
        assert (
            downloader._session_pool.qsize() == pool_size
        ), f"池守恒失败：预期 {pool_size}，实际 {downloader._session_pool.qsize()}"
        # 无重复借出（每个 session 唯一）
        assert len(set(id(s) for s in checked_out)) == pool_size, "出现重复 Session 借出"

    def test_configure_auth_does_not_block_checked_out_session(self):
        """configure_auth 更新认证头时不阻塞正在使用的 Session。"""
        downloader = ImageDownloader(timeout=5, pool_size=2)

        # 取出一个 session（模拟正在使用）
        in_use = downloader._acquire_session()
        assert downloader._session_pool.qsize() == 1

        # 此时更新认证头不应阻塞/死锁
        downloader.configure_auth(cookie="new=auth", user_agent="NewUA")

        # 归还正在使用的 session，应正常回到池
        downloader._release_session(in_use)
        assert downloader._session_pool.qsize() == 2

        # 下次 acquire 时应应用新认证头（_apply_pending_auth 在 acquire 时延迟应用）
        reused = downloader._acquire_session()
        assert reused.headers.get("User-Agent") == "NewUA", "acquire 时未应用新 UA"
        assert reused.headers.get("Cookie") == "new=auth", "acquire 时未应用新 Cookie"
