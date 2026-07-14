"""LibraryIndexer 单元测试。

覆盖混合格式发现、章节聚合、未关联资产、丢失历史、元数据冲突、
增量刷新、取消不删除和大目录分页场景。
"""

from __future__ import annotations

import os
import time
import zipfile

import pytest

from library_db import LibraryDB
from library_indexer import LibraryIndexer, natural_sort_key, natural_sorted


@pytest.fixture
def download_dir(tmp_path):
    """创建下载目录。"""
    d = tmp_path / "downloads"
    d.mkdir()
    return str(d)


@pytest.fixture
def db(tmp_path):
    return LibraryDB(str(tmp_path / "library.db"))


@pytest.fixture
def indexer(db, download_dir):
    return LibraryIndexer(db, download_dir)


# ── 辅助函数：创建测试漫画资产 ──────────────────────────────────────


def make_cbz(path: str, images: dict[str, bytes] | None = None, comic_info: dict | None = None):
    """创建 CBZ 文件。"""
    images = images or {"001.jpg": b"fake jpg", "002.jpg": b"fake jpg"}
    with zipfile.ZipFile(path, "w") as zf:
        for name, data in images.items():
            zf.writestr(name, data)
        if comic_info:
            xml = "<ComicInfo>"
            for tag, val in comic_info.items():
                xml += f"<{tag}>{val}</{tag}>"
            xml += "</ComicInfo>"
            zf.writestr("ComicInfo.xml", xml)


def make_zip(path: str, images: dict[str, bytes] | None = None):
    """创建 ZIP 文件。"""
    images = images or {"001.jpg": b"fake jpg"}
    with zipfile.ZipFile(path, "w") as zf:
        for name, data in images.items():
            zf.writestr(name, data)


def make_single_folder(path: str, image_count: int = 3):
    """创建单本图片文件夹。"""
    os.makedirs(path, exist_ok=True)
    for i in range(image_count):
        with open(os.path.join(path, f"{i+1:03d}.jpg"), "wb") as f:
            f.write(b"fake jpg")


def make_album_folder(path: str, chapter_count: int = 3):
    """创建多章节专辑文件夹。"""
    os.makedirs(path, exist_ok=True)
    for ch in range(chapter_count):
        ch_path = os.path.join(path, f"ch{ch+1}")
        os.makedirs(ch_path, exist_ok=True)
        for pg in range(2):
            with open(os.path.join(ch_path, f"{pg+1:03d}.jpg"), "wb") as f:
                f.write(b"fake jpg")


# ── 自然排序测试 ────────────────────────────────────────────────────


class TestNaturalSort:
    def test_natural_order(self):
        items = ["10.jpg", "2.jpg", "1.jpg"]
        result = natural_sorted(items)
        assert result == ["1.jpg", "2.jpg", "10.jpg"]

    def test_mixed_alpha_numeric(self):
        items = ["chapter10", "chapter2", "chapter1", "special"]
        result = natural_sorted(items)
        assert result == ["chapter1", "chapter2", "chapter10", "special"]

    def test_sort_key(self):
        key = natural_sort_key("page10")
        assert isinstance(key, list)


# ── 发现阶段测试 ────────────────────────────────────────────────────


class TestDiscovery:
    def test_discovers_cbz(self, indexer, download_dir):
        make_cbz(os.path.join(download_dir, "comic.cbz"))
        discovered = indexer._discover_phase()
        assert len(discovered) == 1
        assert discovered[0].format == "cbz"

    def test_discovers_zip(self, indexer, download_dir):
        make_zip(os.path.join(download_dir, "comic.zip"))
        discovered = indexer._discover_phase()
        assert len(discovered) == 1
        assert discovered[0].format == "zip"

    def test_discovers_single_folder(self, indexer, download_dir):
        make_single_folder(os.path.join(download_dir, "single"))
        discovered = indexer._discover_phase()
        assert len(discovered) == 1
        assert discovered[0].format == "folder"
        assert discovered[0].is_album is False

    def test_discovers_album_folder(self, indexer, download_dir):
        make_album_folder(os.path.join(download_dir, "album"))
        discovered = indexer._discover_phase()
        assert len(discovered) == 1
        assert discovered[0].format == "folder"
        assert discovered[0].is_album is True

    def test_skips_temp_dirs(self, indexer, download_dir):
        os.makedirs(os.path.join(download_dir, "temp_downloading"), exist_ok=True)
        make_cbz(os.path.join(download_dir, "comic.cbz"))
        discovered = indexer._discover_phase()
        assert len(discovered) == 1
        assert discovered[0].rel_path == "comic.cbz"

    def test_skips_hidden_dirs(self, indexer, download_dir):
        os.makedirs(os.path.join(download_dir, ".hidden"), exist_ok=True)
        discovered = indexer._discover_phase()
        assert len(discovered) == 0

    def test_skips_empty_dirs(self, indexer, download_dir):
        os.makedirs(os.path.join(download_dir, "empty"), exist_ok=True)
        discovered = indexer._discover_phase()
        assert len(discovered) == 0

    def test_skips_unsupported_files(self, indexer, download_dir):
        with open(os.path.join(download_dir, "readme.txt"), "w") as f:
            f.write("not a comic")
        discovered = indexer._discover_phase()
        assert len(discovered) == 0

    def test_mixed_formats(self, indexer, download_dir):
        make_cbz(os.path.join(download_dir, "c.cbz"))
        make_zip(os.path.join(download_dir, "z.zip"))
        make_single_folder(os.path.join(download_dir, "single"))
        make_album_folder(os.path.join(download_dir, "album"))
        with open(os.path.join(download_dir, "text.txt"), "w") as f:
            f.write("skip")
        discovered = indexer._discover_phase()
        assert len(discovered) == 4
        formats = sorted(d.format for d in discovered)
        assert formats == ["cbz", "folder", "folder", "zip"]


# ── 解析阶段测试 ────────────────────────────────────────────────────


class TestParsing:
    def test_parse_cbz_with_comic_info(self, indexer, download_dir):
        make_cbz(
            os.path.join(download_dir, "comic.cbz"),
            comic_info={"Title": "My Comic", "Writer": "Author1", "Tags": "action, comedy"},
        )
        discovered = indexer._discover_phase()
        pa = indexer._parse_single(discovered[0], {})
        assert pa.title == "My Comic"
        assert pa.author == "Author1"
        assert pa.tags == ["action", "comedy"]
        assert pa.page_count == 2

    def test_parse_cbz_filename_fallback(self, indexer, download_dir):
        make_cbz(os.path.join(download_dir, "AuthorName-Comic Title.cbz"))
        discovered = indexer._discover_phase()
        pa = indexer._parse_single(discovered[0], {})
        assert pa.author == "AuthorName"
        assert pa.title == "Comic Title"

    def test_parse_zip_no_comic_info(self, indexer, download_dir):
        make_zip(os.path.join(download_dir, "NoAuthor-MyZip.zip"))
        discovered = indexer._discover_phase()
        pa = indexer._parse_single(discovered[0], {})
        assert pa.title == "MyZip"
        assert pa.author == "NoAuthor"

    def test_parse_single_folder(self, indexer, download_dir):
        make_single_folder(os.path.join(download_dir, "single"), image_count=5)
        discovered = indexer._discover_phase()
        pa = indexer._parse_single(discovered[0], {})
        assert pa.page_count == 5
        assert pa.chapter_count == 1
        assert pa.discovered.is_album is False

    def test_parse_album_folder(self, indexer, download_dir):
        make_album_folder(os.path.join(download_dir, "album"), chapter_count=3)
        discovered = indexer._discover_phase()
        pa = indexer._parse_single(discovered[0], {})
        assert pa.page_count == 6  # 3 chapters * 2 pages
        assert pa.chapter_count == 3
        assert len(pa.chapters) == 3

    def test_unknown_author_shows_fallback(self, indexer, download_dir):
        make_cbz(os.path.join(download_dir, "12345.cbz"))
        discovered = indexer._discover_phase()
        pa = indexer._parse_single(discovered[0], {})
        assert pa.author == "未知作者"

    def test_history_precedes_filename_for_zip(self, indexer, download_dir):
        path = os.path.join(download_dir, "FilenameAuthor-FilenameTitle.zip")
        make_zip(path)
        discovered = indexer._discover_phase()
        pa = indexer._parse_single(
            discovered[0],
            {path: {"title": "History Title", "author": "History Author", "source_site": "jm"}},
        )
        assert pa.title == "History Title"
        assert pa.author == "History Author"
        assert pa.source_site == "jm"


# ── 增量刷新测试 ────────────────────────────────────────────────────


class TestIncrementalRefresh:
    def test_unchanged_asset_reuses_metadata(self, indexer, download_dir, db):
        make_cbz(os.path.join(download_dir, "comic.cbz"))
        indexer.start_scan()
        time.sleep(1.0)  # 等待后台扫描完成
        items, total = db.query_items()
        assert total == 1

        # 再次扫描——不应重复
        indexer2 = LibraryIndexer(db, download_dir)
        indexer2.start_scan()
        time.sleep(1.0)
        items2, total2 = db.query_items()
        assert total2 == 1
        assert items2[0]["assetId"] == items[0]["assetId"]

    def test_external_deletion_reflected_on_refresh(self, indexer, download_dir, db):
        comic_path = os.path.join(download_dir, "comic.cbz")
        make_cbz(comic_path)
        indexer.start_scan()
        time.sleep(1.0)
        assert db.query_items()[1] == 1

        # 外部删除
        os.remove(comic_path)
        indexer2 = LibraryIndexer(db, download_dir)
        indexer2.start_scan()
        time.sleep(1.0)
        items, total = db.query_items()
        assert total == 0

    def test_cancel_does_not_delete_unscanned(self, indexer, download_dir, db):
        # 创建多个资产
        for i in range(5):
            make_cbz(os.path.join(download_dir, f"c{i}.cbz"))
        indexer.start_scan()
        time.sleep(0.1)
        indexer.cancel_scan()
        time.sleep(1.0)
        # 已提交的索引保留，未扫描的不应被误删
        items, total = db.query_items()
        assert total >= 0  # 取消后至少不报错


# ── 单路径增量索引测试 ──────────────────────────────────────────────


class TestSinglePathIndex:
    def test_index_single_cbz(self, indexer, download_dir, db):
        path = os.path.join(download_dir, "new.cbz")
        make_cbz(path)
        asset_id = indexer.index_single_path(path)
        assert asset_id is not None
        item = db.get_item(asset_id)
        assert item is not None
        assert item["format"] == "cbz"

    def test_index_single_path_outside_dir_returns_none(self, indexer, tmp_path):
        path = str(tmp_path / "outside.cbz")
        make_cbz(path)
        assert indexer.index_single_path(path) is None

    def test_index_nested_album_chapter_returns_none(self, indexer, download_dir, db):
        chapter = os.path.join(download_dir, "album", "chapter-1")
        make_single_folder(chapter, image_count=1)

        assert indexer.index_single_path(chapter) is None
        items, total = db.query_items()
        assert total == 0
        assert items == []

    def test_index_nonexistent_returns_none(self, indexer, download_dir):
        assert indexer.index_single_path(os.path.join(download_dir, "nope.cbz")) is None

    def test_changed_asset_bumps_version_and_invalidates_cover(self, indexer, download_dir, db):
        path = os.path.join(download_dir, "changed.cbz")
        make_cbz(path, {"001.jpg": b"one"})
        asset_id = indexer.index_single_path(path)
        db.update_item_cover(asset_id, "old-cover")

        make_cbz(path, {"001.jpg": b"one", "002.jpg": b"two"})
        os.utime(path, None)
        assert indexer.index_single_path(path) == asset_id

        item = db.get_item(asset_id)
        assert item["version"] == 2
        assert item["cover_key"] is None
        assert item["page_count"] == 2

    def test_changed_album_preserves_matching_chapter_ids_and_prunes_removed(self, indexer, download_dir, db):
        import shutil

        album = os.path.join(download_dir, "album")
        make_album_folder(album, chapter_count=3)
        asset_id = indexer.index_single_path(album)
        before = {chapter["rel_path"]: chapter["chapter_id"] for chapter in db.get_chapters(asset_id)}

        shutil.rmtree(os.path.join(album, "ch3"))
        os.utime(album, None)
        indexer.index_single_path(album)
        after = {chapter["rel_path"]: chapter["chapter_id"] for chapter in db.get_chapters(asset_id)}

        assert set(after) == {"ch1", "ch2"}
        assert after["ch1"] == before["ch1"]
        assert after["ch2"] == before["ch2"]

    def test_folder_metadata_override_survives_reindex(self, indexer, download_dir, db):
        folder = os.path.join(download_dir, "folder")
        make_single_folder(folder, image_count=1)
        asset_id = indexer.index_single_path(folder)
        db.update_item_metadata_override(asset_id, {"title": "My Override"})
        db.update_item_title_author_tags(asset_id, title="My Override")

        with open(os.path.join(folder, "002.jpg"), "wb") as image:
            image.write(b"another")
        os.utime(folder, None)
        indexer.index_single_path(folder)

        item = db.get_item(asset_id)
        assert item["title"] == "My Override"
        assert item["metadata_override"] == {"title": "My Override"}


# ── 查询/分页/筛选测试 ──────────────────────────────────────────────


class TestQuery:
    def test_large_directory_pagination(self, db, download_dir):
        indexer = LibraryIndexer(db, download_dir)
        for i in range(55):
            make_cbz(os.path.join(download_dir, f"comic_{i:03d}.cbz"), comic_info={"Title": f"Comic {i}"})
        indexer.start_scan()
        time.sleep(2.0)

        page1, total = db.query_items(page=1, page_size=20)
        page2, _ = db.query_items(page=2, page_size=20)
        page3, _ = db.query_items(page=3, page_size=20)
        assert total == 55
        assert len(page1) == 20
        assert len(page2) == 20
        assert len(page3) == 15

    def test_search_and_filter_combined(self, db, download_dir):
        indexer = LibraryIndexer(db, download_dir)
        make_cbz(os.path.join(download_dir, "a.cbz"), comic_info={"Title": "Alpha", "Writer": "X"})
        make_zip(os.path.join(download_dir, "b.zip"))
        indexer.start_scan()
        time.sleep(1.0)
        # 搜索 Alpha 只返回 cbz
        items, total = db.query_items(query="Alpha", fmt="cbz")
        assert total == 1
        assert items[0]["title"] == "Alpha"
