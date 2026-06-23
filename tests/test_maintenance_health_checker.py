"""Tests for python/maintenance/health_checker.py."""

from __future__ import annotations

import os
import sys
import zipfile
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"),
)

import pytest
from maintenance.health_checker import HealthChecker
from PIL import Image


def _make_image(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (10, 10), color="red")
    img.save(path)


def _make_valid_image_bytes() -> bytes:
    img = Image.new("RGB", (10, 10), color="red")
    from io import BytesIO

    buf = BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _make_cbz(path: Path, images: list[bytes] | None = None, comic_info: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    valid = _make_valid_image_bytes()
    with zipfile.ZipFile(path, "w") as zf:
        if comic_info:
            zf.writestr(
                "ComicInfo.xml", "<ComicInfo><Title>T</Title><Writer>A</Writer><PageCount>2</PageCount></ComicInfo>"
            )
        for i, data in enumerate(images or [valid, valid], 1):
            zf.writestr(f"{i:03d}.jpg", data)


@pytest.fixture
def checker(tmp_path: Path):
    db = MagicMock()
    return HealthChecker(db, str(tmp_path))


def test_missing_file(checker: HealthChecker, tmp_path: Path):
    checker.history_db.get_all_records_with_album.return_value = [
        {
            "source_site": "hcomic",
            "comic_id": "1",
            "comic_source": "NH",
            "title": "Missing",
            "author": "",
            "output_path": str(tmp_path / "not-exist.cbz"),
            "output_format": "cbz",
            "downloaded_at": 0,
            "album_id": "1",
            "album_total_chapters": 1,
            "pages": 10,
        }
    ]
    result = checker.check_all()
    assert result["scanned"] == 1
    assert len(result["issues"]) == 1
    assert result["issues"][0]["checks"][0]["kind"] == "missing_file"


def test_path_outside_download_dir_but_exists_is_checked(tmp_path: Path):
    """回归：output_path 在当前 download_dir 之外但文件存在时，应正常检查而非报越界。

    场景：用户曾把下载目录设在 E:\\foo，下载了漫画；后改为 E:\\foo\\hcomic。
    历史记录仍指向 E:\\foo\\comic.cbz，文件还在。健康检查是只读操作，
    应继续检查该文件，不应因"不在当前下载目录"而误报路径越界。
    """
    # download_dir = tmp_path/hcomic；实际文件放在 tmp_path 下（download_dir 的父目录）
    download_dir = tmp_path / "hcomic"
    download_dir.mkdir()
    cbz_in_old_dir = tmp_path / "relocated.cbz"
    _make_cbz(cbz_in_old_dir)  # 文件存在但不在 download_dir 内

    db = MagicMock()
    db.get_all_records_with_album.return_value = [
        {
            "source_site": "hcomic",
            "comic_id": "1",
            "comic_source": "NH",
            "title": "Relocated",
            "author": "",
            "output_path": str(cbz_in_old_dir),
            "output_format": "cbz",
            "downloaded_at": 0,
            "album_id": "1",
            "album_total_chapters": 1,
            "pages": 2,
        }
    ]
    checker = HealthChecker(db, str(download_dir))
    result = checker.check_all()
    assert result["scanned"] == 1
    # 文件存在且页数匹配 → 不应报越界，也不应报任何 issue
    assert result["issues"] == [], "路径在当前 download_dir 之外但文件存在时不应报越界"


def test_valid_cbz_no_issues(checker: HealthChecker, tmp_path: Path):
    cbz = tmp_path / "author-title.cbz"
    _make_cbz(cbz)
    checker.history_db.get_all_records_with_album.return_value = [
        {
            "source_site": "hcomic",
            "comic_id": "1",
            "comic_source": "NH",
            "title": "Valid",
            "author": "",
            "output_path": str(cbz),
            "output_format": "cbz",
            "downloaded_at": 0,
            "album_id": "1",
            "album_total_chapters": 1,
            "pages": 2,
        }
    ]
    result = checker.check_all()
    assert result["scanned"] == 1
    assert result["issues"] == []


def test_invalid_archive(checker: HealthChecker, tmp_path: Path):
    cbz = tmp_path / "bad.cbz"
    cbz.write_bytes(b"not a zip")
    checker.history_db.get_all_records_with_album.return_value = [
        {
            "source_site": "hcomic",
            "comic_id": "1",
            "comic_source": "NH",
            "title": "Bad",
            "author": "",
            "output_path": str(cbz),
            "output_format": "cbz",
            "downloaded_at": 0,
            "album_id": "1",
            "album_total_chapters": 1,
            "pages": 2,
        }
    ]
    result = checker.check_all()
    assert len(result["issues"]) == 1
    assert result["issues"][0]["checks"][0]["kind"] == "invalid_archive"


def test_missing_comic_info(checker: HealthChecker, tmp_path: Path):
    cbz = tmp_path / "no-info.cbz"
    _make_cbz(cbz, comic_info=False)
    checker.history_db.get_all_records_with_album.return_value = [
        {
            "source_site": "hcomic",
            "comic_id": "1",
            "comic_source": "NH",
            "title": "No Info",
            "author": "",
            "output_path": str(cbz),
            "output_format": "cbz",
            "downloaded_at": 0,
            "album_id": "1",
            "album_total_chapters": 1,
            "pages": 2,
        }
    ]
    result = checker.check_all()
    kinds = {c["kind"] for c in result["issues"][0]["checks"]}
    assert "missing_comic_info" in kinds


def test_incomplete_pages(checker: HealthChecker, tmp_path: Path):
    cbz = tmp_path / "incomplete.cbz"
    _make_cbz(cbz, images=[b"fake1"])
    checker.history_db.get_all_records_with_album.return_value = [
        {
            "source_site": "hcomic",
            "comic_id": "1",
            "comic_source": "NH",
            "title": "Incomplete",
            "author": "",
            "output_path": str(cbz),
            "output_format": "cbz",
            "downloaded_at": 0,
            "album_id": "1",
            "album_total_chapters": 1,
            "pages": 3,
        }
    ]
    result = checker.check_all()
    kinds = {c["kind"] for c in result["issues"][0]["checks"]}
    assert "incomplete_pages" in kinds


def test_unreadable_image(checker: HealthChecker, tmp_path: Path):
    cbz = tmp_path / "unreadable.cbz"
    _make_cbz(cbz, images=[b"not-an-image", b"fake2"])
    checker.history_db.get_all_records_with_album.return_value = [
        {
            "source_site": "hcomic",
            "comic_id": "1",
            "comic_source": "NH",
            "title": "Unreadable",
            "author": "",
            "output_path": str(cbz),
            "output_format": "cbz",
            "downloaded_at": 0,
            "album_id": "1",
            "album_total_chapters": 1,
            "pages": 2,
        }
    ]
    result = checker.check_all()
    kinds = {c["kind"] for c in result["issues"][0]["checks"]}
    assert "file_not_readable" in kinds


def test_folder_with_chapters(checker: HealthChecker, tmp_path: Path):
    folder = tmp_path / "album"
    _make_image(folder / "第1話" / "001.jpg")
    _make_image(folder / "第1話" / "002.jpg")
    _make_image(folder / "第2話" / "003.jpg")
    checker.history_db.get_all_records_with_album.return_value = [
        {
            "source_site": "jmcomic",
            "comic_id": "c1",
            "comic_source": "JMCOMIC",
            "title": "Album - 第1話",
            "author": "",
            "output_path": str(folder),
            "output_format": "folder",
            "downloaded_at": 0,
            "album_id": "album",
            "album_total_chapters": 2,
            "pages": 2,
        },
        {
            "source_site": "jmcomic",
            "comic_id": "c2",
            "comic_source": "JMCOMIC",
            "title": "Album - 第2話",
            "author": "",
            "output_path": str(folder),
            "output_format": "folder",
            "downloaded_at": 0,
            "album_id": "album",
            "album_total_chapters": 2,
            "pages": 1,
        },
    ]
    result = checker.check_all()
    assert result["scanned"] == 2
    # Both records point to same folder, both should have no issues
    assert result["issues"] == []


def test_selected_scope(checker: HealthChecker, tmp_path: Path):
    cbz = tmp_path / "selected.cbz"
    _make_cbz(cbz)
    checker.history_db.get_all_records_with_album.return_value = [
        {
            "source_site": "hcomic",
            "comic_id": "1",
            "comic_source": "NH",
            "title": "Selected",
            "author": "",
            "output_path": str(cbz),
            "output_format": "cbz",
            "downloaded_at": 0,
            "album_id": "1",
            "album_total_chapters": 1,
            "pages": 2,
        },
        {
            "source_site": "hcomic",
            "comic_id": "2",
            "comic_source": "NH",
            "title": "Not Selected",
            "author": "",
            "output_path": str(tmp_path / "missing.cbz"),
            "output_format": "cbz",
            "downloaded_at": 0,
            "album_id": "2",
            "album_total_chapters": 1,
            "pages": 2,
        },
    ]
    result = checker.check_all(scope="selected", comic_keys=[("hcomic", "1", "NH")])
    assert result["scanned"] == 1
    assert result["issues"] == []


def test_progress_callback(checker: HealthChecker, tmp_path: Path):
    cbz = tmp_path / "p.cbz"
    _make_cbz(cbz)
    checker.history_db.get_all_records_with_album.return_value = [
        {
            "source_site": "hcomic",
            "comic_id": "1",
            "comic_source": "NH",
            "title": "P",
            "author": "",
            "output_path": str(cbz),
            "output_format": "cbz",
            "downloaded_at": 0,
            "album_id": "1",
            "album_total_chapters": 1,
            "pages": 2,
        }
    ]
    progress_calls = []
    checker.progress_callback = lambda c, t, label: progress_calls.append((c, t, label))
    checker.check_all()
    assert progress_calls
    assert progress_calls[-1] == (1, 1, "检查完成")


# ─── 真实 DB schema 契约测试（防止 Critical #1 回退）────────────────────────
# 上述单元测试用 MagicMock 提供 pages 字段，无法发现生产 schema 缺列问题。
# 以下测试用真实 DownloadHistoryDB，钉死 record_download 持久化 pages 列、
# get_all_records_with_album 返回 pages 键、健康检查在生产 schema 下能真正对账。


@pytest.fixture
def real_db(tmp_path: Path):
    from download_history import DownloadHistoryDB

    db_path = str(tmp_path / "health_contract.db")
    history_db = DownloadHistoryDB(db_path)
    yield history_db
    history_db.close()


def test_pages_persisted_and_health_check_reconciles(real_db, tmp_path: Path):
    """Critical #1 回归：真实 schema 下 expected_pages 来自持久化 pages 列，incomplete_pages 必须可触发。"""
    from models import ComicInfo

    # CBZ 实际只有 1 张图
    cbz = tmp_path / "incomplete.cbz"
    _make_cbz(cbz, images=[_make_valid_image_bytes()])

    comic = ComicInfo(
        id="1",
        title="Incomplete",
        source_site="hcomic",
        comic_source="NH",
    )
    # 持久化期望页数 = 5（远超实际 1 页）
    real_db.record_download(comic, str(cbz), "cbz", pages=5)

    # 契约断言：get_all_records_with_album 必须返回 pages 键
    records = real_db.get_all_records_with_album()
    assert len(records) == 1
    assert "pages" in records[0], "get_all_records_with_album 必须返回 pages 键"
    assert records[0]["pages"] == 5, "record_download 必须持久化 pages 参数"

    checker = HealthChecker(real_db, str(tmp_path))
    result = checker.check_all()
    kinds = {c["kind"] for c in result["issues"][0]["checks"]}
    assert "incomplete_pages" in kinds, "生产 schema 下 incomplete_pages 必须可触发（expected=5 actual=1）"


def test_pages_zero_falls_back_to_comic_info(real_db, tmp_path: Path):
    """pages=0 时回退 ComicInfo.xml PageCount；无 PageCount 时跳过对账不误报。"""
    from models import ComicInfo

    # CBZ 含 ComicInfo.xml PageCount=1，实际 1 张图（匹配，无 issue）
    cbz_with_info = tmp_path / "with_info.cbz"
    _make_cbz(cbz_with_info, images=[_make_valid_image_bytes()], comic_info=True)
    # 覆盖默认 ComicInfo 让 PageCount=1（_make_cbz 默认写 PageCount=2，这里手动重写）
    import zipfile as zf_mod

    with zf_mod.ZipFile(cbz_with_info, "w") as zf:
        zf.writestr("ComicInfo.xml", "<ComicInfo><Title>T</Title><PageCount>1</PageCount></ComicInfo>")
        zf.writestr("001.jpg", _make_valid_image_bytes())

    comic = ComicInfo(id="2", title="WithInfo", source_site="hcomic", comic_source="NH")
    real_db.record_download(comic, str(cbz_with_info), "cbz", pages=0)

    checker = HealthChecker(real_db, str(tmp_path))
    result = checker.check_all()
    # 找到 with_info 这条
    with_info_issues = [i for i in result["issues"] if "with_info" in i["outputPath"]]
    # PageCount=1 与实际 1 页匹配，不应有 incomplete/unexpected_pages
    for issue in with_info_issues:
        kinds = {c["kind"] for c in issue["checks"]}
        assert "incomplete_pages" not in kinds
        assert "unexpected_pages" not in kinds


def test_pages_zero_no_comic_info_skips_reconciliation(real_db, tmp_path: Path):
    """pages=0 且无 ComicInfo.xml PageCount 时跳过页数对账（不误报）。"""
    from models import ComicInfo

    cbz_no_info = tmp_path / "no_info.cbz"
    _make_cbz(cbz_no_info, images=[_make_valid_image_bytes()], comic_info=False)

    comic = ComicInfo(id="3", title="NoInfo", source_site="hcomic", comic_source="NH")
    real_db.record_download(comic, str(cbz_no_info), "cbz", pages=0)

    checker = HealthChecker(real_db, str(tmp_path))
    result = checker.check_all()
    no_info_issues = [i for i in result["issues"] if "no_info" in i["outputPath"]]
    for issue in no_info_issues:
        kinds = {c["kind"] for c in issue["checks"]}
        assert "incomplete_pages" not in kinds
        assert "unexpected_pages" not in kinds
