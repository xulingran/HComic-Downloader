"""downloader 来源相关测试"""
from downloader import ComicDownloader
from models import ComicInfo


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
    monkeypatch.setattr(downloader, "_download_image_task", lambda url, path, referer="": True)
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

    monkeypatch.setattr(downloader, "_download_image_task", lambda url, path, referer="": True)
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

    monkeypatch.setattr(downloader, "_download_image_task", fake_download)
    result = downloader.download_comic_resume(comic, str(tmp_path))

    assert result.success is False
    assert sorted(result.completed_pages) == [1, 3]
    assert result.failed_pages == [2]
