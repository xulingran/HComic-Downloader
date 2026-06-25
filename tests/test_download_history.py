"""Tests for download_history.py DownloadHistoryDB"""

import os
import time

import pytest

from models import ComicInfo


@pytest.fixture
def db(tmp_path):
    from download_history import DownloadHistoryDB

    db_path = str(tmp_path / "test_history.db")
    history_db = DownloadHistoryDB(db_path)
    yield history_db
    history_db.close()


@pytest.fixture
def sample_comic():
    return ComicInfo(
        id="12345",
        title="Test Comic",
        author="Test Author",
        pages=24,
        source_site="hcomic",
        comic_source="MMCG_SHORT",
        media_id="media123",
    )


def test_init_creates_database(db, tmp_path):
    db_path = str(tmp_path / "test_history.db")
    assert os.path.exists(db_path)


def test_init_creates_table(db):
    import sqlite3

    conn = sqlite3.connect(db._db_path)
    cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='download_history'")
    assert cursor.fetchone() is not None
    conn.close()


def test_record_download_inserts_row(db, sample_comic, tmp_path):
    output_path = str(tmp_path / "Test Author-Test Comic.cbz")
    db.record_download(sample_comic, output_path, "cbz")

    import sqlite3

    conn = sqlite3.connect(db._db_path)
    cursor = conn.execute(
        "SELECT title, author, output_path, output_format FROM download_history "
        "WHERE source_site=? AND comic_id=? AND comic_source=?",
        ("hcomic", "12345", "MMCG_SHORT"),
    )
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "Test Comic"
    assert row[1] == "Test Author"
    assert row[2] == output_path
    assert row[3] == "cbz"
    conn.close()


def test_record_download_upsert(db, sample_comic, tmp_path):
    path1 = str(tmp_path / "old_path.cbz")
    path2 = str(tmp_path / "new_path.cbz")
    db.record_download(sample_comic, path1, "cbz")
    db.record_download(sample_comic, path2, "cbz")

    import sqlite3

    conn = sqlite3.connect(db._db_path)
    cursor = conn.execute(
        "SELECT output_path FROM download_history WHERE source_site=? AND comic_id=? AND comic_source=?",
        ("hcomic", "12345", "MMCG_SHORT"),
    )
    row = cursor.fetchone()
    assert row[0] == path2
    conn.close()


def test_record_download_stores_timestamp(db, sample_comic, tmp_path):
    before = time.time()
    db.record_download(sample_comic, str(tmp_path / "out.cbz"), "cbz")
    after = time.time()

    import sqlite3

    conn = sqlite3.connect(db._db_path)
    cursor = conn.execute(
        "SELECT downloaded_at FROM download_history WHERE source_site=? AND comic_id=? AND comic_source=?",
        ("hcomic", "12345", "MMCG_SHORT"),
    )
    row = cursor.fetchone()
    assert row is not None
    assert int(before) <= row[0] <= int(after) + 1
    conn.close()


def test_check_batch_returns_downloaded_when_file_exists(db, sample_comic, tmp_path):
    output_path = str(tmp_path / "Test Author-Test Comic.cbz")
    with open(output_path, "w") as f:
        f.write("fake cbz")
    db.record_download(sample_comic, output_path, "cbz")

    keys = [("hcomic", "12345", "MMCG_SHORT")]
    result = db.check_downloaded_batch(keys, str(tmp_path), "cbz", "{author}-{title}.cbz")
    assert result[("hcomic", "12345", "MMCG_SHORT")] == "downloaded"


def test_check_batch_returns_unknown_when_no_record(db, tmp_path):
    keys = [("hcomic", "99999", "MMCG_SHORT")]
    result = db.check_downloaded_batch(keys, str(tmp_path), "cbz", "{author}-{title}.cbz")
    assert result[("hcomic", "99999", "MMCG_SHORT")] == "unknown"


def test_check_batch_returns_unknown_when_file_missing(db, sample_comic, tmp_path):
    output_path = str(tmp_path / "deleted.cbz")
    db.record_download(sample_comic, output_path, "cbz")

    keys = [("hcomic", "12345", "MMCG_SHORT")]
    result = db.check_downloaded_batch(keys, str(tmp_path), "cbz", "{author}-{title}.cbz")
    assert result[("hcomic", "12345", "MMCG_SHORT")] == "unknown"


def test_check_batch_fallback_to_expected_path(db, sample_comic, tmp_path):
    stale_path = str(tmp_path / "old_dir" / "old.cbz")
    db.record_download(sample_comic, stale_path, "cbz")

    from cbz_builder import CBZBuilder

    builder = CBZBuilder(filename_template="{author}-{title}.cbz")
    expected_path = builder.get_output_path_for_format(sample_comic, "cbz", str(tmp_path))
    os.makedirs(os.path.dirname(expected_path), exist_ok=True)
    with open(expected_path, "w") as f:
        f.write("fake cbz")

    keys = [("hcomic", "12345", "MMCG_SHORT")]
    result = db.check_downloaded_batch(keys, str(tmp_path), "cbz", "{author}-{title}.cbz")
    assert result[("hcomic", "12345", "MMCG_SHORT")] == "downloaded"


def test_check_batch_multiple_keys(db, sample_comic, tmp_path):
    output_path = str(tmp_path / "out.cbz")
    with open(output_path, "w") as f:
        f.write("fake")
    db.record_download(sample_comic, output_path, "cbz")

    keys = [
        ("hcomic", "12345", "MMCG_SHORT"),
        ("hcomic", "99999", "MMCG_SHORT"),
    ]
    result = db.check_downloaded_batch(keys, str(tmp_path), "cbz", "{author}-{title}.cbz")
    assert result[("hcomic", "12345", "MMCG_SHORT")] == "downloaded"
    assert result[("hcomic", "99999", "MMCG_SHORT")] == "unknown"


def test_check_batch_fallback_uses_comic_data_map(db, tmp_path):
    """When no DB record exists, comic_data_map provides title/author for path computation."""
    from cbz_builder import CBZBuilder

    comic = ComicInfo(
        id="67890",
        title="Fallback Comic",
        author="Fallback Author",
        source_site="hcomic",
        comic_source="MMCG_LONG",
    )

    builder = CBZBuilder(filename_template="{author}-{title}.cbz")
    expected_path = builder.get_output_path_for_format(comic, "cbz", str(tmp_path))
    os.makedirs(os.path.dirname(expected_path), exist_ok=True)
    with open(expected_path, "w") as f:
        f.write("fake cbz")

    key = ("hcomic", "67890", "MMCG_LONG")
    keys = [key]
    comic_data_map = {key: {"title": "Fallback Comic", "author": "Fallback Author"}}

    # Without comic_data_map, fallback uses empty title/author → wrong path → unknown
    result_without = db.check_downloaded_batch(keys, str(tmp_path), "cbz", "{author}-{title}.cbz")
    assert result_without[key] == "unknown"

    # With comic_data_map, fallback uses correct title/author → finds file → downloaded
    result_with = db.check_downloaded_batch(
        keys,
        str(tmp_path),
        "cbz",
        "{author}-{title}.cbz",
        comic_data_map=comic_data_map,
    )
    assert result_with[key] == "downloaded"


def test_get_all_records_returns_all_rows(db, sample_comic, tmp_path):
    db.record_download(sample_comic, str(tmp_path / "a.cbz"), "cbz")
    comic2 = ComicInfo(id="67890", title="Comic 2", source_site="hcomic", comic_source="NH")
    db.record_download(comic2, str(tmp_path / "b.cbz"), "cbz")

    records = db.get_all_records()
    assert len(records) == 2
    keys = {(r["source_site"], r["comic_id"], r["comic_source"]) for r in records}
    assert ("hcomic", "12345", "MMCG_SHORT") in keys
    assert ("hcomic", "67890", "NH") in keys


def test_get_all_records_includes_output_path_and_metadata(db, sample_comic, tmp_path):
    output_path = str(tmp_path / "Test.cbz")
    db.record_download(sample_comic, output_path, "cbz")

    records = db.get_all_records()
    assert len(records) == 1
    r = records[0]
    assert r["output_path"] == output_path
    assert r["output_format"] == "cbz"
    assert r["title"] == "Test Comic"
    assert r["author"] == "Test Author"


def test_update_output_path_changes_stored_path(db, sample_comic, tmp_path):
    old_path = str(tmp_path / "old.cbz")
    new_path = str(tmp_path / "new.cbz")
    db.record_download(sample_comic, old_path, "cbz")

    db.update_output_path(("hcomic", "12345", "MMCG_SHORT"), new_path)

    import sqlite3

    conn = sqlite3.connect(db._db_path)
    cursor = conn.execute(
        "SELECT output_path FROM download_history WHERE source_site=? AND comic_id=? AND comic_source=?",
        ("hcomic", "12345", "MMCG_SHORT"),
    )
    assert cursor.fetchone()[0] == new_path
    conn.close()


def test_update_output_path_no_match_does_nothing(db):
    db.update_output_path(("hcomic", "nonexist", "NH"), "/some/path.cbz")


def _jm_chapter(chap_id, album_id, total):
    return ComicInfo(
        id=chap_id,
        title="多章漫画",
        source_site="jm",
        comic_source="JM",
        album_id=album_id,
        album_total_chapters=total,
    )


def test_multi_chapter_partial_not_downloaded(db, tmp_path):
    """只下载了 1/2 章 → 专辑视角未完成 → unknown。"""
    out = tmp_path / "ch1"
    out.mkdir()
    db.record_download(_jm_chapter("999001", "999001", 2), str(out), "folder")

    key = ("jm", "999001", "JM")
    result = db.check_downloaded_batch([key], str(tmp_path), "folder", "{title}")
    assert result[key] == "unknown"


def test_multi_chapter_complete_downloaded(db, tmp_path):
    """两章齐全 → 专辑视角已完成 → downloaded。"""
    o1 = tmp_path / "c1"
    o1.mkdir()
    o2 = tmp_path / "c2"
    o2.mkdir()
    db.record_download(_jm_chapter("999001", "999001", 2), str(o1), "folder")
    db.record_download(_jm_chapter("999002", "999001", 2), str(o2), "folder")

    key = ("jm", "999001", "JM")
    result = db.check_downloaded_batch([key], str(tmp_path), "folder", "{title}")
    assert result[key] == "downloaded"


def test_legacy_single_record_still_downloaded(db, sample_comic, tmp_path):
    """迁移后旧单本记录(album_id 补齐为 comic_id)仍按存储路径判定为已下载。"""
    output_path = str(tmp_path / "legacy.cbz")
    with open(output_path, "w") as f:
        f.write("fake")
    # 模拟旧记录：album_id 为空，迁移逻辑应补齐
    db.record_download(sample_comic, output_path, "cbz")
    db._conn.execute("UPDATE download_history SET album_id = '', album_total_chapters = 1")
    db._conn.commit()
    db._migrate_album_ids()

    key = ("hcomic", "12345", "MMCG_SHORT")
    result = db.check_downloaded_batch([key], str(tmp_path), "cbz", "{author}-{title}.cbz")
    assert result[key] == "downloaded"


def test_update_output_path_by_album(tmp_path):
    from download_history import DownloadHistoryDB
    from models import ComicInfo

    db = DownloadHistoryDB(str(tmp_path / "test.db"))

    # 录入 3 条同专辑记录
    for i in range(1, 4):
        comic = ComicInfo(
            id=f"chap{i}",
            title=f"Album - Ch{i}",
            source_site="jm",
            comic_source="JM",
            album_id="album1",
            album_total_chapters=3,
        )
        db.record_download(comic, f"/tmp/ch{i}/", "folder")

    # 批量更新为 cbz 路径
    count = db.update_output_path_by_album(
        source_site="jm",
        comic_source="JM",
        album_id="album1",
        new_path="/downloads/Album.cbz",
    )
    assert count == 3

    # 验证每条记录都已更新
    records = db.get_all_records()
    for rec in records:
        assert rec["output_path"] == "/downloads/Album.cbz"

    db.close()


def test_update_output_path_by_album_no_match(tmp_path):
    from download_history import DownloadHistoryDB

    db = DownloadHistoryDB(str(tmp_path / "test.db"))
    count = db.update_output_path_by_album(
        source_site="jm",
        comic_source="JM",
        album_id="nonexistent",
        new_path="/x.cbz",
    )
    assert count == 0
    db.close()


def test_check_batch_fallback_to_primary_key_for_album_download(db, tmp_path):
    """模拟批量专辑下载场景：album_id 是 md5 hash 而非 comic_id，
    验证第一轮 album_id 查询无命中后，第二轮主键回退查询能正确返回 downloaded。"""
    # 模拟批量专辑下载：两条漫画属于同一个虚拟专辑（album_id = md5 hash）
    # 记录时 album_id = hash，但收藏夹查询时会将 comic_id 当作 album_id 传入
    album_hash = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
    for chap_id in ("chap001", "chap002"):
        out = tmp_path / chap_id
        out.mkdir()
        comic = ComicInfo(
            id=chap_id,
            title=f"Test Album - Ch{chap_id}",
            source_site="hcomic",
            comic_source="MMCG_SHORT",
            album_id=album_hash,
            album_total_chapters=2,
        )
        db.record_download(comic, str(out), "folder")

    # 收藏夹查询时传入的 key 使用原始 comic_id（不是 album_hash）
    keys = [
        ("hcomic", "chap001", "MMCG_SHORT"),
        ("hcomic", "chap002", "MMCG_SHORT"),
    ]
    result = db.check_downloaded_batch(keys, str(tmp_path), "folder", "{title}")
    assert result[("hcomic", "chap001", "MMCG_SHORT")] == "downloaded"
    assert result[("hcomic", "chap002", "MMCG_SHORT")] == "downloaded"


def test_check_batch_fallback_primary_key_partial_album_individual_comic_downloaded(db, tmp_path):
    """专辑只下载了 1 章，但回退查询以单个漫画为主键匹配时，
    如果该漫画的文件存在则判定为 downloaded（因为主键查询每 key 仅一行，
    不涉及专辑级别的多行聚合）。"""
    album_hash = "partial_hash_abc123"
    out = tmp_path / "chap001"
    out.mkdir()
    comic = ComicInfo(
        id="chap001",
        title="Partial Album - Ch1",
        source_site="hcomic",
        comic_source="MMCG_SHORT",
        album_id=album_hash,
        album_total_chapters=2,
    )
    db.record_download(comic, str(out), "folder")

    keys = [("hcomic", "chap001", "MMCG_SHORT")]
    result = db.check_downloaded_batch(keys, str(tmp_path), "folder", "{title}")
    # 该漫画自身的文件存在 → downloaded
    assert result[("hcomic", "chap001", "MMCG_SHORT")] == "downloaded"


def test_check_batch_fallback_primary_key_missing_file(db, tmp_path):
    """专辑章节文件被删除，回退查询命中但文件不存在 → unknown。"""
    album_hash = "missing_file_hash_456"
    # 记录路径指向不存在的文件
    out = str(tmp_path / "deleted_chapter")
    comic = ComicInfo(
        id="chap001",
        title="Missing Album - Ch1",
        source_site="hcomic",
        comic_source="MMCG_SHORT",
        album_id=album_hash,
        album_total_chapters=1,
    )
    db.record_download(comic, out, "folder")

    keys = [("hcomic", "chap001", "MMCG_SHORT")]
    result = db.check_downloaded_batch(keys, str(tmp_path), "folder", "{title}")
    assert result[("hcomic", "chap001", "MMCG_SHORT")] == "unknown"


def test_check_batch_single_download_still_hits_first_round(db, sample_comic, tmp_path):
    """单本下载场景：第一轮按 album_id 查询应直接命中，不受回退查询影响（回归测试）。"""
    output_path = str(tmp_path / "Test Author-Test Comic.cbz")
    with open(output_path, "w") as f:
        f.write("fake cbz")
    # 单本下载时 album_id 默认为 comic.id（见 record_download 的默认值逻辑）
    db.record_download(sample_comic, output_path, "cbz")

    keys = [("hcomic", "12345", "MMCG_SHORT")]
    result = db.check_downloaded_batch(keys, str(tmp_path), "cbz", "{author}-{title}.cbz")
    assert result[("hcomic", "12345", "MMCG_SHORT")] == "downloaded"


def test_check_batch_fallback_primary_key_with_mixed_sources(db, tmp_path):
    """混合来源场景：同一 source_site 内不同 comic_source 的批量专辑章节。"""
    album_hash = "mixed_src_hash_789"

    for chap_id, comic_src in [("chapA", "MMCG_SHORT"), ("chapB", "MMCG_LONG")]:
        out = tmp_path / chap_id
        out.mkdir()
        comic = ComicInfo(
            id=chap_id,
            title=f"Mixed - {chap_id}",
            source_site="hcomic",
            comic_source=comic_src,
            album_id=album_hash,
            album_total_chapters=2,
        )
        db.record_download(comic, str(out), "folder")

    keys = [
        ("hcomic", "chapA", "MMCG_SHORT"),
        ("hcomic", "chapB", "MMCG_LONG"),
    ]
    result = db.check_downloaded_batch(keys, str(tmp_path), "folder", "{title}")
    assert result[("hcomic", "chapA", "MMCG_SHORT")] == "downloaded"
    assert result[("hcomic", "chapB", "MMCG_LONG")] == "downloaded"


def test_check_batch_fallback_primary_key_mixed_hit_and_miss(db, tmp_path):
    """部分漫画已专辑下载、部分完全不存在 → 各自状态正确。"""
    album_hash = "mixed_hit_miss_hash"

    # 只有 chap001 被专辑下载了
    out = tmp_path / "chap001"
    out.mkdir()
    comic = ComicInfo(
        id="chap001",
        title="Exist - Ch1",
        source_site="hcomic",
        comic_source="MMCG_SHORT",
        album_id=album_hash,
        album_total_chapters=1,
    )
    db.record_download(comic, str(out), "folder")

    keys = [
        ("hcomic", "chap001", "MMCG_SHORT"),  # 已专辑下载
        ("hcomic", "chap999", "MMCG_SHORT"),  # 从未下载
    ]
    result = db.check_downloaded_batch(keys, str(tmp_path), "folder", "{title}")
    assert result[("hcomic", "chap001", "MMCG_SHORT")] == "downloaded"
    assert result[("hcomic", "chap999", "MMCG_SHORT")] == "unknown"


def test_legacy_jmcomic_history_row_migrates_to_jm(tmp_path):
    import sqlite3

    from download_history import DownloadHistoryDB

    db_path = tmp_path / "legacy.db"
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE download_history (
            source_site TEXT NOT NULL,
            comic_id TEXT NOT NULL,
            comic_source TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            author TEXT NOT NULL DEFAULT '',
            output_path TEXT NOT NULL DEFAULT '',
            output_format TEXT NOT NULL DEFAULT '',
            downloaded_at INTEGER NOT NULL,
            pages INTEGER NOT NULL DEFAULT 0,
            album_id TEXT NOT NULL DEFAULT '',
            album_total_chapters INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (source_site, comic_id, comic_source)
        )
        """
    )
    out = tmp_path / "legacy.cbz"
    out.write_text("fake")
    conn.execute(
        "INSERT INTO download_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("jmcomic", "100", "JMCOMIC", "Legacy", "Author", str(out), "cbz", 10, 24, "100", 1),
    )
    conn.commit()
    conn.close()

    db = DownloadHistoryDB(str(db_path))
    result = db.check_downloaded_batch([("jm", "100", "JM")], str(tmp_path), "cbz", "{title}.cbz")
    assert result[("jm", "100", "JM")] == "downloaded"
    records = db.get_all_records_with_album()
    assert [(r["source_site"], r["comic_source"]) for r in records] == [("jm", "JM")]
    db.close()


def test_legacy_jmcomic_history_conflict_merges_into_canonical(tmp_path):
    import sqlite3

    from download_history import DownloadHistoryDB

    db_path = tmp_path / "legacy_conflict.db"
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE download_history (
            source_site TEXT NOT NULL,
            comic_id TEXT NOT NULL,
            comic_source TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            author TEXT NOT NULL DEFAULT '',
            output_path TEXT NOT NULL DEFAULT '',
            output_format TEXT NOT NULL DEFAULT '',
            downloaded_at INTEGER NOT NULL,
            pages INTEGER NOT NULL DEFAULT 0,
            album_id TEXT NOT NULL DEFAULT '',
            album_total_chapters INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (source_site, comic_id, comic_source)
        )
        """
    )
    conn.execute(
        "INSERT INTO download_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("jmcomic", "100", "JMCOMIC", "Legacy", "", "/legacy", "folder", 10, 12, "100", 1),
    )
    conn.execute(
        "INSERT INTO download_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("jm", "100", "JM", "Canonical", "A", "", "cbz", 20, 8, "100", 2),
    )
    conn.commit()
    conn.close()

    db = DownloadHistoryDB(str(db_path))
    records = db.get_all_records_with_album()
    assert len(records) == 1
    rec = records[0]
    assert (rec["source_site"], rec["comic_source"]) == ("jm", "JM")
    assert rec["title"] == "Canonical"
    assert rec["pages"] == 12
    assert rec["album_total_chapters"] == 2
    db.close()
