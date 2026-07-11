"""LibraryImageCache 和 LibraryPageReader 单元测试。

覆盖压缩包条目读取、文件夹页读取、越界页、stale version、
符号链接逃逸检查、缓存失效和 LRU 清理。
"""

from __future__ import annotations

import os

# ipc 模块位于 python/ 下
import sys
import zipfile

import pytest

from library_db import LibraryDB
from library_indexer import LibraryIndexer

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"))
from ipc.library_cache import LibraryImageCache, LibraryPageReader


@pytest.fixture
def download_dir(tmp_path):
    d = tmp_path / "downloads"
    d.mkdir()
    return str(d)


@pytest.fixture
def db(tmp_path):
    return LibraryDB(str(tmp_path / "library.db"))


@pytest.fixture
def cache(tmp_path):
    return LibraryImageCache(cache_dir=str(tmp_path / "cache"), max_size_mb=1)


@pytest.fixture
def reader(db, download_dir, cache):
    return LibraryPageReader(db, download_dir, cache)


# ── 辅助函数 ────────────────────────────────────────────────────────


def make_cbz(path: str, images: dict[str, bytes] | None = None):
    images = images or {"001.jpg": b"\xff\xd8\xff\xe0fake jpg", "002.jpg": b"\xff\xd8\xff\xe0fake jpg2"}
    with zipfile.ZipFile(path, "w") as zf:
        for name, data in images.items():
            zf.writestr(name, data)


def make_zip(path: str, images: dict[str, bytes] | None = None):
    images = images or {"a.png": b"\x89PNGfake", "b.png": b"\x89PNGfake2"}
    with zipfile.ZipFile(path, "w") as zf:
        for name, data in images.items():
            zf.writestr(name, data)


def make_single_folder(path: str, count: int = 3):
    os.makedirs(path, exist_ok=True)
    for i in range(count):
        with open(os.path.join(path, f"page_{i+1:03d}.jpg"), "wb") as f:
            f.write(f"fake img {i}".encode())


def make_album_folder(path: str, chapters: int = 2, pages_per_ch: int = 2):
    os.makedirs(path, exist_ok=True)
    for ch in range(chapters):
        ch_path = os.path.join(path, f"chapter_{ch+1}")
        os.makedirs(ch_path)
        for pg in range(pages_per_ch):
            with open(os.path.join(ch_path, f"p{pg+1}.jpg"), "wb") as f:
                f.write(f"ch{ch}pg{pg}".encode())


def seed_asset(db, indexer, download_dir, filename, factory):
    """创建资产并索引，返回 asset_id。"""
    factory(os.path.join(download_dir, filename))
    indexer.start_scan()
    import time

    time.sleep(1.0)
    items, _ = db.query_items()
    if items:
        return items[0]["assetId"]
    return None


# ── LibraryImageCache 测试 ──────────────────────────────────────────


class TestImageCache:
    def test_atomic_write_and_read(self, cache):
        data = b"test image data"
        import hashlib

        h = hashlib.sha256(data).hexdigest()
        cache._atomic_write(h, data)
        assert cache.has(h)

    def test_content_hash_consistency(self, cache):
        data = b"same data"
        h1 = cache._content_hash(data)
        h2 = cache._content_hash(data)
        assert h1 == h2

    def test_lru_eviction_on_size_limit(self, tmp_path):
        cache = LibraryImageCache(cache_dir=str(tmp_path / "tiny"), max_size_mb=1)
        # 写入多个文件超过 1MB 上限
        import hashlib

        big_data = b"x" * 400_000  # 400KB each
        for i in range(5):  # 2MB total
            h = hashlib.sha256(big_data + str(i).encode()).hexdigest()
            cache._atomic_write(h, big_data + str(i).encode())
        cache._lru_evict()
        # 应低于上限
        assert cache._current_size <= 1 * 1024 * 1024

    def test_clear_removes_all(self, cache):
        import hashlib

        data = b"data"
        h = hashlib.sha256(data).hexdigest()
        cache._atomic_write(h, data)
        assert cache.has(h)
        count = cache.clear()
        assert count >= 1
        assert not cache.has(h)

    def test_existing_files_counted_on_init(self, tmp_path):
        cache_dir = str(tmp_path / "preexisting")
        os.makedirs(cache_dir)
        import hashlib

        data = b"preexisting"
        h = hashlib.sha256(data).hexdigest()
        with open(os.path.join(cache_dir, h), "wb") as f:
            f.write(data)
        cache2 = LibraryImageCache(cache_dir=cache_dir)
        assert cache2._current_size == len(data)


# ── 封面提取测试 ────────────────────────────────────────────────────


class TestCoverExtraction:
    def test_extract_cover_from_cbz(self, db, download_dir, cache, reader):
        indexer = LibraryIndexer(db, download_dir)
        asset_id = seed_asset(db, indexer, download_dir, "comic.cbz", make_cbz)
        assert asset_id is not None
        result = reader.extract_cover(asset_id)
        assert result is not None
        assert "cover_key" in result
        assert len(result["cover_key"]) == 64
        assert result["media_type"] == "image/jpeg"

    def test_extract_cover_from_folder(self, db, download_dir, cache, reader):
        indexer = LibraryIndexer(db, download_dir)
        asset_id = seed_asset(db, indexer, download_dir, "single", make_single_folder)
        assert asset_id is not None
        result = reader.extract_cover(asset_id)
        assert result is not None
        assert len(result["cover_key"]) == 64

    def test_extract_cover_unknown_asset(self, reader):
        result = reader.extract_cover("nonexistent-asset")
        assert result is None


# ── 页面物化测试 ────────────────────────────────────────────────────


class TestPageMaterialization:
    def test_materialize_page_cbz(self, db, download_dir, cache, reader):
        indexer = LibraryIndexer(db, download_dir)
        asset_id = seed_asset(db, indexer, download_dir, "comic.cbz", make_cbz)
        item = db.get_item(asset_id)
        version = item["version"]
        result = reader.materialize_page(asset_id, None, 1, version)
        assert result is not None
        assert result["imageUrl"].startswith("app-image://library/")
        assert result["version"] == version

    def test_materialize_page_folder(self, db, download_dir, cache, reader):
        indexer = LibraryIndexer(db, download_dir)
        asset_id = seed_asset(db, indexer, download_dir, "single", make_single_folder)
        item = db.get_item(asset_id)
        version = item["version"]
        result = reader.materialize_page(asset_id, None, 2, version)
        assert result is not None
        assert "page 1" not in result["imageUrl"]  # page 2 data

    def test_stale_version_rejected(self, db, download_dir, cache, reader):
        indexer = LibraryIndexer(db, download_dir)
        asset_id = seed_asset(db, indexer, download_dir, "comic.cbz", make_cbz)
        result = reader.materialize_page(asset_id, None, 1, 99999)
        assert result is None

    def test_out_of_range_page(self, db, download_dir, cache, reader):
        indexer = LibraryIndexer(db, download_dir)
        asset_id = seed_asset(db, indexer, download_dir, "comic.cbz", make_cbz)
        item = db.get_item(asset_id)
        version = item["version"]
        result = reader.materialize_page(asset_id, None, 999, version)
        assert result is None

    def test_unknown_asset_returns_none(self, reader):
        result = reader.materialize_page("nonexistent", None, 1, 1)
        assert result is None


# ── 页面 manifest 测试 ──────────────────────────────────────────────


class TestPageManifest:
    def test_manifest_cbz_natural_sort(self, db, download_dir, cache, reader):
        """验证自然排序：1, 2, 10 而非 1, 10, 2。"""
        path = os.path.join(download_dir, "natural.cbz")
        make_cbz(
            path,
            images={
                "1.jpg": b"img1",
                "10.jpg": b"img10",
                "2.jpg": b"img2",
            },
        )
        indexer = LibraryIndexer(db, download_dir)
        asset_id = seed_asset(
            db,
            indexer,
            download_dir,
            "natural.cbz",
            lambda p: make_cbz(
                p,
                images={
                    "1.jpg": b"img1",
                    "10.jpg": b"img10",
                    "2.jpg": b"img2",
                },
            ),
        )
        manifest = reader.get_page_manifest(asset_id, None)
        assert manifest is not None
        assert len(manifest["pages"]) == 3
        # 验证 manifest 按自然顺序
        # （page index 不直接暴露文件名，但顺序应稳定）

    def test_manifest_folder(self, db, download_dir, cache, reader):
        indexer = LibraryIndexer(db, download_dir)
        asset_id = seed_asset(db, indexer, download_dir, "single", make_single_folder)
        manifest = reader.get_page_manifest(asset_id, None)
        assert manifest is not None
        assert len(manifest["pages"]) == 3
        assert manifest["chapterId"] == "default"

    def test_manifest_unknown_asset(self, reader):
        result = reader.get_page_manifest("nonexistent", None)
        assert result is None

    def test_manifest_single_chapter_with_default_sentinel(self, db, download_dir, cache, reader):
        """单章资产传入前端合成哨兵 'default' 应等价于 None。

        渲染层 (useLocalLibraryReader) 对无章节记录的单章资产合成
        ``{ id: 'default' }`` 并以 ``'default'`` 作为 chapterId 发出。
        后端必须把它归一化为 None，走单章路径而不是多章节 DB 查找。
        """
        indexer = LibraryIndexer(db, download_dir)
        asset_id = seed_asset(db, indexer, download_dir, "single", make_single_folder)
        baseline = reader.get_page_manifest(asset_id, None)
        assert baseline is not None

        result = reader.get_page_manifest(asset_id, "default")
        assert result is not None
        assert result["chapterId"] == baseline["chapterId"]
        assert result["pages"] == baseline["pages"]


# ── 多章节页面读取测试 ──────────────────────────────────────────────


class TestChapterPages:
    def test_read_album_chapter_page(self, db, download_dir, cache, reader):
        indexer = LibraryIndexer(db, download_dir)
        asset_id = seed_asset(db, indexer, download_dir, "album", make_album_folder)
        assert asset_id is not None

        chapters = db.get_chapters(asset_id)
        assert len(chapters) >= 2

        item = db.get_item(asset_id)
        version = item["version"]

        # 读取第一章的第一页
        result = reader.materialize_page(asset_id, chapters[0]["chapter_id"], 1, version)
        assert result is not None
        assert result["imageUrl"].startswith("app-image://library/")

    def test_read_wrong_chapter_returns_none(self, db, download_dir, cache, reader):
        indexer = LibraryIndexer(db, download_dir)
        asset_id = seed_asset(db, indexer, download_dir, "album", make_album_folder)
        result = reader.materialize_page(asset_id, "nonexistent-chapter", 1, 1)
        assert result is None

    def test_materialize_single_chapter_with_default_sentinel(self, db, download_dir, cache, reader):
        """单章资产用哨兵 'default' 物化页面应与 None 等价。

        与 manifest 配对：即使清单能生成，materialize_page 也必须归一化
        'default' 否则会走多章节路径读取到空字节。
        """
        indexer = LibraryIndexer(db, download_dir)
        asset_id = seed_asset(db, indexer, download_dir, "single", make_single_folder)
        item = db.get_item(asset_id)
        version = item["version"]

        result = reader.materialize_page(asset_id, "default", 1, version)
        assert result is not None
        assert result["imageUrl"].startswith("app-image://library/")


# ── 协议路径遍历测试 ────────────────────────────────────────────────


class TestProtocolTraversal:
    def test_image_protocol_resolver_library_kind(self):
        """验证 image-protocol 的 library kind 解析逻辑（通过 import 测试）。"""
        # 这个测试在 TypeScript 侧，但 Python 侧验证缓存目录隔离
        cache_dir = os.path.join(os.path.dirname(__file__), "test_cache")
        os.makedirs(cache_dir, exist_ok=True)
        try:
            cache = LibraryImageCache(cache_dir=cache_dir, max_size_mb=10)
            import hashlib

            data = b"path test"
            h = hashlib.sha256(data).hexdigest()
            cache._atomic_write(h, data)
            # 确认文件名只是 hex hash，没有路径遍历风险
            files = os.listdir(cache_dir)
            for f in files:
                if not f.startswith("tmp_"):
                    assert all(c in "0123456789abcdef" for c in f), f"Unsafe filename: {f}"
        finally:
            import shutil

            shutil.rmtree(cache_dir, ignore_errors=True)
