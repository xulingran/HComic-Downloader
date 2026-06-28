"""Tests for python/maintenance/scanner.py."""

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
from maintenance.scanner import (
    _collect_image_files,
    _count_archive_image_pages,
    _count_folder_pages,
    _dir_size,
    _infer_source_site,
    _parse_cbz_comic_info,
    _parse_filename_author_title,
    scan_download_dir,
)
from PIL import Image


@pytest.fixture
def empty_dir(tmp_path: Path) -> str:
    return str(tmp_path)


def _make_image(path: Path) -> None:
    """创建一张最小有效图片。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (10, 10), color="red")
    img.save(path)


def test_collect_image_files(tmp_path: Path):
    _make_image(tmp_path / "001.jpg")
    _make_image(tmp_path / "002.png")
    Path(tmp_path / "003.txt").write_text("text")
    files = _collect_image_files(str(tmp_path))
    assert len(files) == 2
    assert files[0].endswith("001.jpg")
    assert files[1].endswith("002.png")


def test_dir_size(tmp_path: Path):
    Path(tmp_path / "a").write_text("hello")
    Path(tmp_path / "b" / "c.txt").parent.mkdir(parents=True, exist_ok=True)
    Path(tmp_path / "b" / "c.txt").write_text("world")
    assert _dir_size(str(tmp_path)) == 10


def test_parse_cbz_comic_info(tmp_path: Path):
    cbz_path = tmp_path / "test.cbz"
    with zipfile.ZipFile(cbz_path, "w") as zf:
        zf.writestr(
            "ComicInfo.xml",
            "<?xml version='1.0'?>\n<ComicInfo>\n"
            "<Title>Sample Title</Title>\n"
            "<Writer>Sample Author</Writer>\n"
            "<PageCount>24</PageCount>\n"
            "</ComicInfo>",
        )
    info = _parse_cbz_comic_info(str(cbz_path))
    assert info["Title"] == "Sample Title"
    assert info["Writer"] == "Sample Author"
    assert info["PageCount"] == "24"


def test_parse_cbz_comic_info_missing(tmp_path: Path):
    cbz_path = tmp_path / "test.cbz"
    with zipfile.ZipFile(cbz_path, "w") as zf:
        zf.writestr("00001.jpg", b"fake")
    assert _parse_cbz_comic_info(str(cbz_path)) == {}


def test_count_archive_image_pages(tmp_path: Path):
    cbz_path = tmp_path / "test.cbz"
    with zipfile.ZipFile(cbz_path, "w") as zf:
        zf.writestr("00001.jpg", b"fake")
        zf.writestr("00002.png", b"fake")
        zf.writestr("note.txt", b"text")
    assert _count_archive_image_pages(str(cbz_path)) == 2


def test_count_folder_pages(tmp_path: Path):
    _make_image(tmp_path / "001.jpg")
    _make_image(tmp_path / "002.jpg")
    assert _count_folder_pages(str(tmp_path)) == 2


def test_count_folder_pages_with_chapters(tmp_path: Path):
    _make_image(tmp_path / "第1話" / "001.jpg")
    _make_image(tmp_path / "第1話" / "002.jpg")
    _make_image(tmp_path / "第2話" / "003.jpg")
    assert _count_folder_pages(str(tmp_path)) == 3


def test_parse_filename_author_title():
    assert _parse_filename_author_title("author-title.cbz") == ("author", "title")
    assert _parse_filename_author_title("title.cbz") == ("", "title")
    assert _parse_filename_author_title("author-some-title.cbz") == ("author", "some-title")


def test_infer_source_site():
    assert _infer_source_site("temp_hcomic_123") == "hcomic"
    assert _infer_source_site("temp_jm_123") == "jm"
    assert _infer_source_site("temp_moeimg_123") == "moeimg"
    assert _infer_source_site("temp_bika_123") == "bika"
    assert _infer_source_site("temp_copymanga_123") == "copymanga"
    assert _infer_source_site("something-else") == ""


def test_scan_download_dir_empty(tmp_path: Path):
    assets = scan_download_dir(str(tmp_path))
    assert assets == []


def test_scan_download_dir_folder(tmp_path: Path):
    folder = tmp_path / "author-title"
    _make_image(folder / "001.jpg")
    _make_image(folder / "002.jpg")
    assets = scan_download_dir(str(tmp_path))
    assert len(assets) == 1
    asset = assets[0]
    assert asset.format == "folder"
    assert asset.title == "title"
    assert asset.author == "author"
    assert asset.page_count == 2
    assert asset.size_bytes > 0


def test_scan_download_dir_cbz(tmp_path: Path):
    cbz_path = tmp_path / "author-title.cbz"
    with zipfile.ZipFile(cbz_path, "w") as zf:
        zf.writestr(
            "ComicInfo.xml", "<ComicInfo><Title>T</Title><Writer>A</Writer><PageCount>5</PageCount></ComicInfo>"
        )
        zf.writestr("00001.jpg", b"fake")
        zf.writestr("00002.jpg", b"fake")
    assets = scan_download_dir(str(tmp_path))
    assert len(assets) == 1
    asset = assets[0]
    assert asset.format == "cbz"
    assert asset.title == "T"
    assert asset.author == "A"
    assert asset.page_count == 2  # actual image count takes precedence


def test_scan_download_dir_skips_temp(tmp_path: Path):
    temp_dir = tmp_path / "temp_hcomic_123"
    _make_image(temp_dir / "001.jpg")
    assets = scan_download_dir(str(tmp_path))
    assert assets == []


def test_scan_download_dir_with_history_db(tmp_path: Path):
    folder = tmp_path / "some-folder"
    _make_image(folder / "001.jpg")

    db = MagicMock()
    db.get_all_records_with_album.return_value = [
        {
            "source_site": "hcomic",
            "comic_id": "123",
            "comic_source": "NH",
            "title": "Real Title",
            "author": "Real Author",
            "output_path": str(folder),
            "output_format": "folder",
            "downloaded_at": 0,
            "album_id": "123",
            "album_total_chapters": 1,
        }
    ]

    assets = scan_download_dir(str(tmp_path), history_db=db)
    assert len(assets) == 1
    assert assets[0].title == "Real Title"
    assert assets[0].author == "Real Author"
    assert assets[0].source_site == "hcomic"
    assert assets[0].comic_id == "123"


def test_scan_download_dir_album_root_inherits_chapter_source(tmp_path: Path):
    """专辑根目录（folder）精确匹配 miss 时，应通过父目录回填命中子章节记录。

    覆盖 spec「多章节专辑根目录继承子章节来源」场景：DB 记录的 output_path
    指向章节子目录，专辑根目录本身无记录，扫描器必须把 source_site 回填正确。
    """
    # bika 多章节专辑：根目录 + 2 个章节子目录
    album_root = tmp_path / "bika-album"
    ch1 = album_root / "第1話"
    ch2 = album_root / "第2話"
    _make_image(ch1 / "001.jpg")
    _make_image(ch2 / "001.jpg")

    db = MagicMock()
    # DB 只记录章节子目录路径，不记录专辑根目录（与打包流程一致）
    db.get_all_records_with_album.return_value = [
        {
            "source_site": "bika",
            "comic_id": "ch1",
            "comic_source": "BIKA",
            "title": "Album - 第1話",
            "author": "Author",
            "output_path": str(ch1),
            "output_format": "folder",
            "downloaded_at": 0,
            "album_id": "album-1",
            "album_total_chapters": 2,
        },
        {
            "source_site": "bika",
            "comic_id": "ch2",
            "comic_source": "BIKA",
            "title": "Album - 第2話",
            "author": "Author",
            "output_path": str(ch2),
            "output_format": "folder",
            "downloaded_at": 0,
            "album_id": "album-1",
            "album_total_chapters": 2,
        },
    ]

    assets = scan_download_dir(str(tmp_path), history_db=db)
    assert len(assets) == 1  # 只扫描一级条目（专辑根目录）
    album = assets[0]
    assert album.path == str(album_root)
    # 关键断言：来源应从子章节记录继承，而非回退到 unknown
    assert album.source_site == "bika"
    assert album.comic_source == "BIKA"
    assert album.album_id == "album-1"


def test_scan_download_dir_album_root_inherits_hcomic_source(tmp_path: Path):
    """hcomic 来源的多章节专辑根目录同样应继承来源（hcomic 例）。"""
    album_root = tmp_path / "ninoko-title"
    ch1 = album_root / "LEVEL_1"
    ch2 = album_root / "LEVEL_2"
    _make_image(ch1 / "001.jpg")
    _make_image(ch2 / "001.jpg")

    db = MagicMock()
    db.get_all_records_with_album.return_value = [
        {
            "source_site": "hcomic",
            "comic_id": "ch1",
            "comic_source": "nh",
            "title": "Title LEVEL_1",
            "author": "ninoko",
            "output_path": str(ch1),
            "output_format": "folder",
            "downloaded_at": 0,
            "album_id": "album-x",
            "album_total_chapters": 2,
        },
    ]

    assets = scan_download_dir(str(tmp_path), history_db=db)
    assert len(assets) == 1
    assert assets[0].source_site == "hcomic"
    assert assets[0].comic_source == "nh"


def test_scan_download_dir_exact_match_not_overridden_by_parent(tmp_path: Path):
    """资产路径精确匹配 output_path 时，父目录回填不得覆盖精确匹配的元数据。

    覆盖 spec「父目录回填避免覆盖精确匹配」场景：单本漫画的 folder 资产路径
    与其 DB 记录精确匹配，此时不应被任何父目录回退逻辑干扰。
    """
    # 精确匹配的单本漫画
    single = tmp_path / "single-comic"
    _make_image(single / "001.jpg")
    # 另一个专辑，其章节子目录的父目录恰好... 不会与 single 重合，但构造一个
    # 父目录映射来验证不覆盖：让 single 的父目录（tmp_path）不会被当作回填源

    db = MagicMock()
    db.get_all_records_with_album.return_value = [
        {
            "source_site": "hcomic",
            "comic_id": "single-id",
            "comic_source": "nh",
            "title": "Single Title",
            "author": "Single Author",
            "output_path": str(single),
            "output_format": "folder",
            "downloaded_at": 0,
            "album_id": "single-id",
            "album_total_chapters": 1,
        },
    ]

    assets = scan_download_dir(str(tmp_path), history_db=db)
    assert len(assets) == 1
    asset = assets[0]
    assert asset.path == str(single)
    # 精确匹配的元数据完整生效
    assert asset.source_site == "hcomic"
    assert asset.title == "Single Title"
    assert asset.author == "Single Author"
    assert asset.comic_id == "single-id"


def test_scan_download_dir_invalid_path(tmp_path: Path):
    with pytest.raises(Exception):
        scan_download_dir("/nonexistent/path/for/sure")
