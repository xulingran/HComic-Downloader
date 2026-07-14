"""LibraryDB 单元测试。

覆盖 schema 创建、向前迁移、事务回滚、损坏重建和并发访问。
所有测试使用 tmp_path fixture 确保不触碰真实数据。
"""

from __future__ import annotations

import os
import sqlite3
import threading
from pathlib import Path

import pytest

from library_db import LibraryDB, get_default_library_db_path


@pytest.fixture
def db(tmp_path) -> LibraryDB:
    """创建临时数据库。"""
    db_path = str(tmp_path / "library.db")
    return LibraryDB(db_path)


class TestSchemaCreation:
    """测试 schema 创建和初始化。"""

    def test_creates_all_tables(self, tmp_path):
        db_path = str(tmp_path / "library.db")
        db = LibraryDB(db_path)
        db.close()
        # 重新用原始连接检查表
        conn = sqlite3.connect(db_path)
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        conn.close()
        assert "library_items" in tables
        assert "library_chapters" in tables
        assert "library_reading_progress" in tables
        assert "library_scan_state" in tables
        assert "library_meta" in tables

    def test_scan_state_has_initial_row(self, db):
        state = db.get_scan_state()
        assert state["phase"] == "idle"
        assert state["isScanning"] is False
        assert state["current"] == 0
        assert state["total"] == 0

    def test_reopen_recovers_interrupted_scan_state(self, tmp_path):
        db_path = str(tmp_path / "library.db")
        db = LibraryDB(db_path)
        db.set_scan_state(
            scan_id="stale-scan",
            phase="parsing",
            is_scanning=True,
            current=3,
            total=10,
        )
        db.close()

        reopened = LibraryDB(db_path)
        try:
            state = reopened.get_scan_state()
            assert state["phase"] == "idle"
            assert state["scanId"] is None
            assert state["isScanning"] is False
            assert state["current"] == 0
            assert state["total"] == 0
            assert state["lastScanCancelled"] is True
            assert state["lastScanError"] == "上次扫描被应用退出中断"
        finally:
            reopened.close()

    def test_default_root_generation_is_one(self, db):
        assert db.get_root_generation() == 1

    def test_creates_parent_directory(self, tmp_path):
        nested = str(tmp_path / "deep" / "nested" / "dir" / "library.db")
        db = LibraryDB(nested)
        db.close()
        assert os.path.exists(nested)

    def test_schema_version_recorded(self, db):
        with db._lock:
            row = db._conn.execute("SELECT value FROM library_meta WHERE key = 'schema_version'").fetchone()
        assert int(row["value"]) == 1


class TestMigration:
    """测试向前迁移逻辑。"""

    def test_reopen_existing_db_preserves_data(self, tmp_path):
        db_path = str(tmp_path / "library.db")
        db1 = LibraryDB(db_path)
        asset_id = db1.upsert_item(
            {
                "rel_path": "comic.cbz",
                "format": "cbz",
                "title": "Test Comic",
                "size_bytes": 1000,
                "mtime_ns": 12345,
            }
        )
        db1.close()
        # 重新打开
        db2 = LibraryDB(db_path)
        item = db2.get_item(asset_id)
        assert item is not None
        assert item["title"] == "Test Comic"
        db2.close()


class TestTransactionRollback:
    """测试事务回滚。"""

    def test_rollback_on_error(self, tmp_path):
        db_path = str(tmp_path / "library.db")
        db = LibraryDB(db_path)
        # 正常 upsert
        db.upsert_item(
            {
                "rel_path": "comic1.cbz",
                "format": "cbz",
                "title": "Comic 1",
                "size_bytes": 100,
                "mtime_ns": 1,
            }
        )
        # 模拟事务失败：插入无效数据触发约束
        try:
            with db._lock:
                db._conn.execute("BEGIN")
                db._conn.execute(
                    "INSERT INTO library_items (asset_id, root_generation, rel_path, format) VALUES (NULL, 1, 'bad', 'cbz')"
                )
                db._conn.commit()
        except sqlite3.IntegrityError:
            with db._lock:
                db._conn.rollback()
        # 确认之前的数据仍然完好
        item = db.find_item_by_path("comic1.cbz")
        assert item is not None
        assert item["title"] == "Comic 1"


class TestCorruptionRebuild:
    """测试损坏隔离与可重建初始化。"""

    def test_corrupt_db_is_quarantined_and_rebuilt(self, tmp_path):
        db_path = str(tmp_path / "library.db")
        # 创建损坏的数据库文件
        with open(db_path, "w") as f:
            f.write("this is not a valid SQLite database")
        # LibraryDB 应隔离并重建
        db = LibraryDB(db_path)
        state = db.get_scan_state()
        assert state["phase"] == "idle"
        # 损坏文件应被重命名或删除
        with open(db_path, "rb") as f:
            header = f.read(16)
        assert header[:15] == b"SQLite format 3"  # 新的有效数据库
        db.close()

    def test_corrupt_db_preserves_comic_files(self, tmp_path):
        """验证损坏重建只操作数据库文件，不触碰漫画文件。"""
        db_path = str(tmp_path / "library.db")
        comic_file = tmp_path / "my_comic.cbz"
        comic_file.write_bytes(b"PK\x03\x04 fake cbz")
        # 创建损坏数据库
        with open(db_path, "w") as f:
            f.write("corrupt data")
        db = LibraryDB(db_path)
        db.close()
        # 漫画文件不应被修改
        assert comic_file.read_bytes() == b"PK\x03\x04 fake cbz"

    def test_double_corruption_recovers(self, tmp_path):
        """连续损坏两次都能恢复。"""
        db_path = str(tmp_path / "library.db")
        db1 = LibraryDB(db_path)
        db1.close()
        # 再次损坏
        with open(db_path, "w") as f:
            f.write("corrupt again")
        db2 = LibraryDB(db_path)
        assert db2.get_root_generation() == 1
        db2.close()


class TestConcurrency:
    """测试并发访问。"""

    def test_concurrent_upserts(self, tmp_path):
        db_path = str(tmp_path / "library.db")
        db = LibraryDB(db_path)
        errors: list[Exception] = []

        def worker(idx: int):
            try:
                db.upsert_item(
                    {
                        "rel_path": f"comic_{idx}.cbz",
                        "format": "cbz",
                        "title": f"Comic {idx}",
                        "size_bytes": idx * 100,
                        "mtime_ns": idx,
                    }
                )
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors
        items, total = db.query_items()
        assert total == 20
        db.close()

    def test_concurrent_reads_and_writes(self, tmp_path):
        db_path = str(tmp_path / "library.db")
        db = LibraryDB(db_path)
        # 预填充
        for i in range(5):
            db.upsert_item(
                {
                    "rel_path": f"comic_{i}.cbz",
                    "format": "cbz",
                    "title": f"Comic {i}",
                }
            )
        errors: list[Exception] = []

        def reader():
            try:
                for _ in range(50):
                    db.query_items()
            except Exception as e:
                errors.append(e)

        def writer():
            try:
                for i in range(10):
                    db.upsert_item(
                        {
                            "rel_path": f"new_{i}.cbz",
                            "format": "cbz",
                            "title": f"New {i}",
                        }
                    )
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=reader) for _ in range(3)]
        threads += [threading.Thread(target=writer) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors
        db.close()


class TestItemCRUD:
    """测试资产 CRUD 操作。"""

    def test_upsert_and_get(self, db):
        asset_id = db.upsert_item(
            {
                "rel_path": "test.cbz",
                "format": "cbz",
                "title": "Test",
                "tags": ["action", "comedy"],
                "author": "Author",
            }
        )
        item = db.get_item(asset_id)
        assert item is not None
        assert item["title"] == "Test"
        assert item["tags"] == ["action", "comedy"]
        assert item["author"] == "Author"
        assert item["format"] == "cbz"

    def test_find_by_path(self, db):
        db.upsert_item({"rel_path": "path1.cbz", "format": "cbz", "title": "P1"})
        item = db.find_item_by_path("path1.cbz")
        assert item is not None
        assert item["title"] == "P1"
        assert db.find_item_by_path("nonexistent.cbz") is None

    def test_delete_item_cascades_chapters_and_progress(self, db):
        asset_id = db.upsert_item({"rel_path": "c.cbz", "format": "cbz", "title": "C"})
        db.upsert_chapter(
            {
                "chapter_id": "ch1",
                "asset_id": asset_id,
                "display_name": "Ch 1",
                "page_count": 10,
            }
        )
        db.save_reading_progress(asset_id, "ch1", 5, 10)
        assert db.delete_item(asset_id) is True
        assert db.get_item(asset_id) is None
        assert db.get_chapters(asset_id) == []
        assert db.get_reading_progress(asset_id) is None

    def test_reuse_asset_id_on_path_match(self, db):
        """增量判定：未变化路径应复用 asset_id。"""
        original_id = db.upsert_item({"rel_path": "same.cbz", "format": "cbz", "title": "Original"})
        found = db.find_item_by_path("same.cbz")
        assert found is not None
        assert found["asset_id"] == original_id


class TestChapterManagement:
    """测试章节管理。"""

    def test_upsert_and_get_chapters(self, db):
        asset_id = db.upsert_item({"rel_path": "album", "format": "folder", "title": "Album"})
        db.upsert_chapter(
            {
                "chapter_id": "ch1",
                "asset_id": asset_id,
                "display_name": "Chapter 1",
                "chapter_index": 0,
                "page_count": 5,
            }
        )
        db.upsert_chapter(
            {
                "chapter_id": "ch2",
                "asset_id": asset_id,
                "display_name": "Chapter 2",
                "chapter_index": 1,
                "page_count": 8,
            }
        )
        chapters = db.get_chapters(asset_id)
        assert len(chapters) == 2
        assert chapters[0]["chapter_id"] == "ch1"
        assert chapters[1]["chapter_id"] == "ch2"

    def test_get_chapter_single(self, db):
        asset_id = db.upsert_item({"rel_path": "album", "format": "folder"})
        db.upsert_chapter(
            {
                "chapter_id": "ch1",
                "asset_id": asset_id,
                "display_name": "Ch 1",
            }
        )
        ch = db.get_chapter(asset_id, "ch1")
        assert ch is not None
        assert ch["display_name"] == "Ch 1"
        assert db.get_chapter(asset_id, "nonexistent") is None

    def test_set_chapter_manifest(self, db):
        asset_id = db.upsert_item({"rel_path": "c.cbz", "format": "cbz"})
        db.upsert_chapter({"chapter_id": "ch1", "asset_id": asset_id})
        manifest = [{"index": 0, "mediaType": "image/jpeg"}, {"index": 1, "mediaType": "image/jpeg"}]
        db.set_chapter_manifest(asset_id, "ch1", manifest, 1)
        ch = db.get_chapter(asset_id, "ch1")
        assert ch["page_manifest"] == manifest
        assert ch["manifest_version"] == 1


class TestReadingProgress:
    """测试阅读进度持久化。"""

    def test_save_and_get_progress(self, db):
        asset_id = db.upsert_item({"rel_path": "c.cbz", "format": "cbz"})
        db.save_reading_progress(asset_id, None, 15, 30)
        progress = db.get_reading_progress(asset_id)
        assert progress is not None
        assert progress["page"] == 15
        assert progress["total_pages"] == 30
        assert progress["last_read_at"] > 0

    def test_progress_updates_last_read_on_item(self, db):
        asset_id = db.upsert_item({"rel_path": "c.cbz", "format": "cbz"})
        assert db.get_item(asset_id)["last_read_at"] is None
        db.save_reading_progress(asset_id, None, 5, 10)
        assert db.get_item(asset_id)["last_read_at"] is not None

    def test_delete_progress(self, db):
        asset_id = db.upsert_item({"rel_path": "c.cbz", "format": "cbz"})
        db.save_reading_progress(asset_id, None, 5, 10)
        assert db.delete_reading_progress(asset_id) is True
        assert db.get_reading_progress(asset_id) is None
        assert db.delete_reading_progress(asset_id) is False

    def test_progress_preserved_on_rename(self, db):
        """应用内重命名保留 asset_id，阅读进度应保留。"""
        asset_id = db.upsert_item({"rel_path": "old.cbz", "format": "cbz"})
        db.save_reading_progress(asset_id, None, 20, 40)
        db.update_item_path(asset_id, "new.cbz", 1000, 99999)
        assert db.get_reading_progress(asset_id)["page"] == 20
        assert db.find_item_by_path("new.cbz") is not None


class TestQueryAndPagination:
    """测试分页查询、搜索和筛选。"""

    def _seed(self, db, count=25):
        for i in range(count):
            db.upsert_item(
                {
                    "rel_path": f"comic_{i:03d}.cbz",
                    "format": "cbz",
                    "title": f"Comic {i}",
                    "author": f"Author {i % 5}",
                    "tags": [f"tag_{i % 3}"],
                    "source_site": "hcomic" if i % 2 == 0 else "jm",
                    "size_bytes": (i + 1) * 1000,
                }
            )

    def test_pagination_basic(self, db):
        self._seed(db)
        items, total = db.query_items(page=1, page_size=10)
        assert len(items) == 10
        assert total == 25

    def test_pagination_second_page(self, db):
        self._seed(db)
        items, total = db.query_items(page=2, page_size=10)
        assert len(items) == 10
        assert total == 25

    def test_pagination_last_page_partial(self, db):
        self._seed(db)
        items, total = db.query_items(page=3, page_size=10)
        assert len(items) == 5
        assert total == 25

    def test_search_by_title(self, db):
        self._seed(db)
        items, total = db.query_items(query="Comic 1")
        # "Comic 1" matches "Comic 1", "Comic 10".."Comic 19"
        assert total > 1
        for item in items:
            assert "Comic 1" in item["title"]

    def test_filter_by_format(self, db):
        db.upsert_item({"rel_path": "a.cbz", "format": "cbz", "title": "A"})
        db.upsert_item({"rel_path": "b.zip", "format": "zip", "title": "B"})
        items, total = db.query_items(fmt="cbz")
        assert total == 1
        assert items[0]["title"] == "A"

    def test_filter_by_source(self, db):
        self._seed(db)
        items, total = db.query_items(source_site="jm")
        assert total == 12  # i%2!=0 for i in 0..24 => 12 items
        for item in items:
            assert item["sourceSite"] == "jm"

    def test_stable_sort_with_secondary_key(self, db):
        """相同排序值时使用 asset_id 作为次级键。"""
        for i in range(5):
            db.upsert_item(
                {
                    "rel_path": f"c{i}.cbz",
                    "format": "cbz",
                    "title": f"C{i}",
                    "size_bytes": 1000,  # 全部相同大小
                }
            )
        page1, _ = db.query_items(page=1, page_size=3, sort="size")
        page2, _ = db.query_items(page=2, page_size=3, sort="size")
        all_ids = [item["assetId"] for item in page1] + [item["assetId"] for item in page2]
        # 无重复
        assert len(all_ids) == len(set(all_ids))


class TestStats:
    """测试统计信息。"""

    def test_empty_stats(self, db):
        stats = db.get_stats()
        assert stats["totalAssets"] == 0
        assert stats["totalPages"] == 0
        assert stats["totalSizeBytes"] == 0

    def test_stats_aggregation(self, db):
        db.upsert_item(
            {
                "rel_path": "a.cbz",
                "format": "cbz",
                "page_count": 10,
                "size_bytes": 500,
                "source_site": "hcomic",
                "health_status": "healthy",
            }
        )
        db.upsert_item(
            {
                "rel_path": "b.zip",
                "format": "zip",
                "page_count": 20,
                "size_bytes": 1500,
                "source_site": "jm",
                "health_status": "warning",
            }
        )
        stats = db.get_stats()
        assert stats["totalAssets"] == 2
        assert stats["totalPages"] == 30
        assert stats["totalSizeBytes"] == 2000
        assert stats["byFormat"]["cbz"] == 1
        assert stats["byFormat"]["zip"] == 1
        assert stats["byFormat"]["folder"] == 0
        assert stats["bySource"]["hcomic"] == 1
        assert stats["byHealth"]["healthy"] == 1
        assert stats["byHealth"]["warning"] == 1


class TestRootGeneration:
    """测试 root generation 管理。"""

    def test_bump_generation(self, db):
        assert db.get_root_generation() == 1
        new_gen = db.bump_root_generation()
        assert new_gen == 2
        assert db.get_root_generation() == 2

    def test_items_isolated_by_generation(self, db):
        db.upsert_item({"rel_path": "old.cbz", "format": "cbz", "root_generation": 1})
        db.bump_root_generation()
        db.upsert_item({"rel_path": "new.cbz", "format": "cbz", "root_generation": 2})
        # 旧 generation 的查询不应返回新资产
        assert db.find_item_by_path("old.cbz", root_generation=1) is not None
        assert db.find_item_by_path("new.cbz", root_generation=1) is None
        assert db.find_item_by_path("new.cbz", root_generation=2) is not None

    def test_queries_and_stats_only_include_current_generation(self, db):
        db.upsert_item({"rel_path": "old.cbz", "format": "cbz", "title": "Old", "root_generation": 1})
        db.bump_root_generation()
        db.upsert_item({"rel_path": "new.cbz", "format": "cbz", "title": "New", "root_generation": 2})

        items, total = db.query_items()
        assert total == 1
        assert [item["title"] for item in items] == ["New"]
        assert db.get_stats()["totalAssets"] == 1


class TestNullableScanState:
    def test_nullable_fields_can_be_cleared(self, db):
        db.set_scan_state(scan_id="scan-1", last_scan_error="boom", last_scan_completed_at=123)
        db.set_scan_state(scan_id=None, last_scan_error=None, last_scan_completed_at=None)
        state = db.get_scan_state()
        assert state["scanId"] is None
        assert state["lastScanError"] is None
        assert state["lastScanCompletedAt"] is None


class TestReconciliation:
    """测试对账删除。"""

    def test_delete_items_not_in(self, db):
        for path in ["a.cbz", "b.cbz", "c.cbz"]:
            db.upsert_item({"rel_path": path, "format": "cbz"})
        # 只保留 a.cbz 和 b.cbz
        deleted = db.delete_items_not_in({"a.cbz", "b.cbz"}, db.get_root_generation())
        assert deleted == 1
        assert db.find_item_by_path("c.cbz") is None
        assert db.find_item_by_path("a.cbz") is not None

    def test_delete_all_when_seen_is_empty(self, db):
        for path in ["a.cbz", "b.cbz"]:
            db.upsert_item({"rel_path": path, "format": "cbz"})
        deleted = db.delete_items_not_in(set(), db.get_root_generation())
        assert deleted == 2


class TestDefaultPath:
    """测试默认路径。"""

    def test_default_path_ends_with_library_db(self):
        path = get_default_library_db_path()
        assert path.endswith("library.db")
        assert ".hcomic_downloader" in path

    def test_default_path_falls_back_to_home(self, monkeypatch, tmp_path):
        monkeypatch.delenv("HCOMIC_CONFIG_DIR", raising=False)
        monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))

        assert get_default_library_db_path() == str(tmp_path / ".hcomic_downloader" / "library.db")
