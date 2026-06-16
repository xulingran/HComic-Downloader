"""downloader 来源相关测试"""

import pytest
import requests

from downloader import ComicDownloader
from models import ComicInfo
from url_validator import DownloadError, UrlValidator


def test_download_resume_uses_source_specific_temp_dir_and_referer(tmp_path, monkeypatch):
    downloader = ComicDownloader(concurrent_downloads=1, timeout=5)
    comic = ComicInfo(
        id="123",
        title="Moe",
        source_site="moeimg",
        pages=1,
        image_urls=["https://nvme1.cdndelivers.cloud/data/example/001.webp"],
    )

    # referer is now passed as per-request header, not stored in session
    monkeypatch.setattr(downloader.image_downloader, "download_task", lambda url, path, referer="": True)
    result = downloader.download_comic_resume(comic, str(tmp_path))

    assert result.success is True
    assert result.temp_dir.endswith("temp_moeimg_123")


def test_download_resume_defaults_hcomic_referer(tmp_path, monkeypatch):
    downloader = ComicDownloader(concurrent_downloads=1, timeout=5)
    comic = ComicInfo(
        id="456",
        title="H",
        source_site="hcomic",
        pages=1,
        media_id="m1",
        comic_source="NH",
    )

    monkeypatch.setattr(downloader.image_downloader, "download_task", lambda url, path, referer="": True)
    result = downloader.download_comic_resume(comic, str(tmp_path))

    assert result.success is True
    assert result.temp_dir.endswith("temp_hcomic_456")


def test_configure_auth_resets_user_agent_when_empty():
    downloader = ComicDownloader(concurrent_downloads=1, timeout=5)
    default_ua = downloader.default_user_agent

    downloader.configure_auth(cookie="a=1", user_agent="Custom-UA/1.0")
    assert downloader.session.headers.get("User-Agent") == "Custom-UA/1.0"
    assert downloader.session.headers.get("Cookie") == "a=1"

    downloader.configure_auth(cookie="", user_agent="")
    assert downloader.session.headers.get("User-Agent") == default_ua
    assert "Cookie" not in downloader.session.headers


def test_download_resume_single_page_failure_keeps_other_pages(tmp_path, monkeypatch):
    downloader = ComicDownloader(concurrent_downloads=2, timeout=5)
    comic = ComicInfo(
        id="789",
        title="Partial",
        source_site="hcomic",
        pages=3,
        media_id="m1",
        comic_source="NH",
    )

    def fake_download(url, path, referer=""):
        # 仅让第 2 页失败，其它页成功
        return not str(path).endswith("002.jpg")

    monkeypatch.setattr(downloader.image_downloader, "download_task", fake_download)
    result = downloader.download_comic_resume(comic, str(tmp_path))

    assert result.success is False
    assert sorted(result.completed_pages) == [1, 3]
    assert result.failed_pages == [2]


# ── SSRF / redirect validation tests ──


def _make_redirect_response(status_code: int, location: str):
    """Build a fake redirect response."""
    resp = requests.Response()
    resp.status_code = status_code
    resp.headers["Location"] = location
    resp._content_consumed = True
    return resp


def _make_final_response():
    """Build a fake 200 response for the final hop."""
    resp = requests.Response()
    resp.status_code = 200
    resp._content = b"\x00"
    resp._content_consumed = True
    return resp


# 注：已移除 8 个 UrlValidator.validate_url 的类调用用例（localhost/private IP/scheme/
# DNS 解析拦截），它们与 tests/test_url_validator.py 完全重复且新测试覆盖更全（含全部
# IPv4/IPv6 网段、自定义白名单、resolve_redirects 逐跳校验）。此处保留 resolve_redirects
# 与 is_hcomic_url 用例（它们用实例调用，且聚焦 downloader 集成场景，非纯 SSRF 单元）。
# 移除理由遵循 test-discipline：同义反复（重复覆盖同一行为的 SSRF 拦截）。


def test_resolve_redirects_strips_cookie_on_cross_domain_redirect(monkeypatch):
    """Cookie must be removed when redirecting from hcomic to external domain."""
    downloader = ComicDownloader(concurrent_downloads=1, timeout=5)
    downloader.configure_auth(cookie="session=abc", user_agent="TestUA")

    session = downloader._create_session()
    session.headers["Cookie"] = "session=abc"

    call_count = {"n": 0}

    def fake_get(url, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return _make_redirect_response(302, "https://evil.com/image.jpg")
        return _make_final_response()

    monkeypatch.setattr(session, "get", fake_get)
    final_url, session_out = downloader.url_validator.resolve_redirects(
        "https://h-comic.link/api/nh/123/pages/1", session, downloader.timeout
    )
    assert final_url == "https://evil.com/image.jpg"
    assert "Cookie" not in session_out.headers


def test_resolve_redirects_keeps_cookie_within_hcomic(monkeypatch):
    """Cookie preserved when redirecting within hcomic domains."""
    downloader = ComicDownloader(concurrent_downloads=1, timeout=5)
    downloader.configure_auth(cookie="session=abc", user_agent="TestUA")

    session = downloader._create_session()
    session.headers["Cookie"] = "session=abc"

    call_count = {"n": 0}

    def fake_get(url, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return _make_redirect_response(302, "https://h-comic.com/api/other")
        return _make_final_response()

    monkeypatch.setattr(session, "get", fake_get)
    final_url, session_out = downloader.url_validator.resolve_redirects(
        "https://h-comic.link/api/nh/123/pages/1", session, downloader.timeout
    )
    assert final_url == "https://h-comic.com/api/other"
    assert session_out.headers.get("Cookie") == "session=abc"


def test_resolve_redirects_blocks_redirect_to_localhost(monkeypatch):
    """Redirect to localhost must be blocked."""
    downloader = ComicDownloader(concurrent_downloads=1, timeout=5)
    session = downloader._create_session()

    def fake_get(url, **kwargs):
        return _make_redirect_response(302, "http://127.0.0.1/secret")

    monkeypatch.setattr(session, "get", fake_get)
    with pytest.raises(DownloadError, match="Blocked"):
        downloader.url_validator.resolve_redirects(
            "https://h-comic.link/api/nh/123/pages/1", session, downloader.timeout
        )


def test_resolve_redirects_blocks_redirect_to_private_ip(monkeypatch):
    """Redirect to private IP must be blocked."""
    import socket

    downloader = ComicDownloader(concurrent_downloads=1, timeout=5)
    session = downloader._create_session()

    def fake_get(url, **kwargs):
        return _make_redirect_response(301, "http://10.0.0.1/internal")

    def fake_getaddrinfo(host, *args, **kwargs):
        if host == "cdn.example.com":
            return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("93.184.216.34", 0))]
        return socket.getaddrinfo(host, *args, **kwargs)

    monkeypatch.setattr(session, "get", fake_get)
    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(DownloadError, match="Blocked"):
        downloader.url_validator.resolve_redirects("https://cdn.example.com/img.jpg", session, downloader.timeout)


def test_resolve_redirects_too_many_hops(monkeypatch):
    """More than 10 redirects raises error."""
    downloader = ComicDownloader(concurrent_downloads=1, timeout=5)
    session = downloader._create_session()

    def fake_get(url, **kwargs):
        return _make_redirect_response(302, url + "/r")

    monkeypatch.setattr(session, "get", fake_get)
    with pytest.raises(DownloadError, match="Too many redirects"):
        downloader.url_validator.resolve_redirects("https://example.com/img.jpg", session, downloader.timeout)


def test_is_hcomic_url():
    # is_hcomic_url 现为实例方法（读取实例属性），需实例化后调用
    v = UrlValidator()
    assert v.is_hcomic_url("https://h-comic.com/page")
    assert v.is_hcomic_url("https://h-comic.link/api/nh/1")
    assert v.is_hcomic_url("https://cdn.h-comic.link/img")
    assert not v.is_hcomic_url("https://evil.com/img")
    assert not v.is_hcomic_url("https://moeimg.fan/img")
