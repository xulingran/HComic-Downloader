"""Tests for python/maintenance/storage_analyzer.py."""

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

from maintenance.storage_analyzer import analyze_storage
from PIL import Image


def _make_image(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (10, 10), color="red")
    img.save(path)


def _make_cbz(path: Path, size: int = 2) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (10, 10), color="blue")
    from io import BytesIO

    buf = BytesIO()
    img.save(buf, format="JPEG")
    data = buf.getvalue()
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("ComicInfo.xml", "<ComicInfo><Title>T</Title><Writer>A</Writer></ComicInfo>")
        for i in range(size):
            zf.writestr(f"{i:03d}.jpg", data)


def test_analyze_empty(tmp_path: Path):
    result = analyze_storage(str(tmp_path))
    assert result["totalSizeBytes"] == 0
    assert result["totalFiles"] == 0


def test_analyze_by_format(tmp_path: Path):
    folder = tmp_path / "author-title"
    _make_image(folder / "001.jpg")
    cbz = tmp_path / "author-title.cbz"
    _make_cbz(cbz)
    zip_file = tmp_path / "author-title.zip"
    _make_cbz(zip_file)

    result = analyze_storage(str(tmp_path))
    assert result["totalFiles"] == 3
    assert result["byFormat"]["folder"] > 0
    assert result["byFormat"]["cbz"] > 0
    assert result["byFormat"]["zip"] > 0


def test_analyze_by_source(tmp_path: Path):
    folder = tmp_path / "some-folder"
    _make_image(folder / "001.jpg")

    db = MagicMock()
    db.get_all_records_with_album.return_value = [
        {
            "source_site": "hcomic",
            "comic_id": "1",
            "comic_source": "NH",
            "title": "T",
            "author": "",
            "output_path": str(folder),
            "output_format": "folder",
            "downloaded_at": 0,
            "album_id": "1",
            "album_total_chapters": 1,
        }
    ]

    result = analyze_storage(str(tmp_path), history_db=db)
    assert result["bySource"].get("hcomic", 0) > 0


def test_analyze_by_author(tmp_path: Path):
    cbz = tmp_path / "author-title.cbz"
    _make_cbz(cbz)

    result = analyze_storage(str(tmp_path))
    authors = {a["name"]: a for a in result["byAuthor"]}
    assert "A" in authors
    assert authors["A"]["itemCount"] == 1


def test_analyze_orphan_files_counts_temp_dirs_only(tmp_path: Path):
    """Critical #4 回归：orphanFiles 仅统计 temp_* 目录，非 temp 资产计入 untrackedFiles。"""
    # temp 目录（应计入 orphanFiles）
    temp_dir = tmp_path / "temp_hcomic_orphan"
    temp_dir.mkdir()
    (temp_dir / "001.jpg").write_bytes(b"x" * 100)

    # 非 temp 的 CBZ，不在历史中（应计入 untrackedFiles，不是 orphanFiles）
    untracked_cbz = tmp_path / "untracked.cbz"
    _make_cbz(untracked_cbz)

    db = MagicMock()
    db.get_all_records.return_value = []  # 历史为空

    result = analyze_storage(str(tmp_path), history_db=db)
    assert result["orphanFiles"]["count"] == 1, "temp_* 目录计入 orphanFiles"
    assert result["orphanFiles"]["sizeBytes"] >= 100
    assert result["untrackedFiles"]["count"] == 1, "非 temp 未记录资产计入 untrackedFiles"
    assert result["untrackedFiles"]["sizeBytes"] > 0


def test_analyze_untracked_excludes_tracked_assets(tmp_path: Path):
    """在历史中的资产不计入 untrackedFiles。"""
    tracked_cbz = tmp_path / "tracked.cbz"
    _make_cbz(tracked_cbz)

    db = MagicMock()
    db.get_all_records.return_value = [{"output_path": str(tracked_cbz)}]

    result = analyze_storage(str(tmp_path), history_db=db)
    assert result["untrackedFiles"]["count"] == 0
    assert result["orphanFiles"]["count"] == 0


def test_analyze_filename_strips_brackets(tmp_path: Path):
    """Important #10 回归：[Author] Title [1] 文件名解析后 author 不含括号。"""
    from maintenance.scanner import _parse_filename_author_title

    # [Author] 前缀被剥离后按 - 分隔
    author, title = _parse_filename_author_title("[AuthorGroup] RealAuthor-RealTitle [1].cbz")
    assert "[" not in author
    assert "]" not in author
    assert author == "RealAuthor"
    assert title == "RealTitle [1]"

    # 圆括号前缀同样剥离
    author2, _ = _parse_filename_author_title("(Circle) Author2-Title2.zip")
    assert "(" not in author2
    assert author2 == "Author2"


def test_analyze_top_items(tmp_path: Path):
    cbz = tmp_path / "author-title.cbz"
    _make_cbz(cbz, size=5)

    result = analyze_storage(str(tmp_path))
    assert len(result["topItems"]) == 1
    assert result["topItems"][0]["pageCount"] == 5
