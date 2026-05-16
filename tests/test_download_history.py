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
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='download_history'"
    )
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
        "SELECT output_path FROM download_history "
        "WHERE source_site=? AND comic_id=? AND comic_source=?",
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
        "SELECT downloaded_at FROM download_history "
        "WHERE source_site=? AND comic_id=? AND comic_source=?",
        ("hcomic", "12345", "MMCG_SHORT"),
    )
    row = cursor.fetchone()
    assert row is not None
    assert int(before) <= row[0] <= int(after) + 1
    conn.close()


def test_check_batch_returns_downloaded_when_file_exists(db, sample_comic, tmp_path):
    output_path = str(tmp_path / "Test Author-Test Comic.cbz")
    with open(output_path, 'w') as f:
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
    expected_path = builder.get_output_path(sample_comic, str(tmp_path))
    os.makedirs(os.path.dirname(expected_path), exist_ok=True)
    with open(expected_path, 'w') as f:
        f.write("fake cbz")

    keys = [("hcomic", "12345", "MMCG_SHORT")]
    result = db.check_downloaded_batch(keys, str(tmp_path), "cbz", "{author}-{title}.cbz")
    assert result[("hcomic", "12345", "MMCG_SHORT")] == "downloaded"


def test_check_batch_multiple_keys(db, sample_comic, tmp_path):
    output_path = str(tmp_path / "out.cbz")
    with open(output_path, 'w') as f:
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
    expected_path = builder.get_output_path(comic, str(tmp_path))
    os.makedirs(os.path.dirname(expected_path), exist_ok=True)
    with open(expected_path, 'w') as f:
        f.write("fake cbz")

    key = ("hcomic", "67890", "MMCG_LONG")
    keys = [key]
    comic_data_map = {key: {"title": "Fallback Comic", "author": "Fallback Author"}}

    # Without comic_data_map, fallback uses empty title/author → wrong path → unknown
    result_without = db.check_downloaded_batch(keys, str(tmp_path), "cbz", "{author}-{title}.cbz")
    assert result_without[key] == "unknown"

    # With comic_data_map, fallback uses correct title/author → finds file → downloaded
    result_with = db.check_downloaded_batch(
        keys, str(tmp_path), "cbz", "{author}-{title}.cbz",
        comic_data_map=comic_data_map,
    )
    assert result_with[key] == "downloaded"
