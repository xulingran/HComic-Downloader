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
