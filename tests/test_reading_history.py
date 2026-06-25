"""Tests for ReadingHistoryDB (reading history persistence)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from python.ipc.history_mixin import ReadingHistoryDB, ReadingHistoryEntry


def _make_db(tmp_path):
    return ReadingHistoryDB(str(tmp_path / "r.db"))


def test_upsert_and_get_history(tmp_path):
    db = _make_db(tmp_path)
    db.upsert(
        ReadingHistoryEntry(
            comic_id="1",
            title="Comic",
            cover_url="",
            source="hcomic",
            source_site="hcomic",
            media_id="",
            source_url="",
            last_page=3,
            total_pages=20,
        )
    )
    items, total = db.get_history(page=1, page_size=20)
    assert total == 1
    assert items[0]["comicId"] == "1"
    assert items[0]["lastPage"] == 3


def test_history_stores_chapter_fields(tmp_path):
    db = _make_db(tmp_path)
    db.upsert(
        ReadingHistoryEntry(
            comic_id="999001",
            title="多章",
            cover_url="",
            source="JM",
            source_site="jm",
            media_id="",
            source_url="",
            last_page=5,
            total_pages=30,
            last_chapter_id="999002",
            last_chapter_name="第 2 話",
        )
    )
    items, total = db.get_history(page=1, page_size=20)
    assert total == 1
    assert items[0]["lastChapterId"] == "999002"
    assert items[0]["lastChapterName"] == "第 2 話"


def test_chapter_fields_default_empty(tmp_path):
    db = _make_db(tmp_path)
    db.upsert(
        ReadingHistoryEntry(
            comic_id="2",
            title="No chapter",
            cover_url="",
            source="hcomic",
            source_site="hcomic",
            media_id="",
            source_url="",
            last_page=1,
            total_pages=10,
        )
    )
    items, _ = db.get_history(page=1, page_size=20)
    assert items[0]["lastChapterId"] == ""
    assert items[0]["lastChapterName"] == ""



def test_legacy_jmcomic_reading_history_migrates_to_jm(tmp_path):
    import sqlite3

    db_path = tmp_path / "legacy.db"
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE reading_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            comic_id TEXT NOT NULL,
            title TEXT NOT NULL,
            cover_url TEXT,
            source TEXT NOT NULL,
            source_site TEXT DEFAULT '',
            media_id TEXT DEFAULT '',
            source_url TEXT,
            last_page INTEGER DEFAULT 0,
            total_pages INTEGER DEFAULT 0,
            last_read_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(comic_id, source)
        )
        """
    )
    conn.execute(
        "INSERT INTO reading_history (comic_id, title, source, source_site, last_page, total_pages, last_read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ("100", "Legacy", "JMCOMIC", "jmcomic", 5, 20, "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"),
    )
    conn.commit()
    conn.close()

    db = ReadingHistoryDB(str(db_path))
    items, total = db.get_history()
    assert total == 1
    assert items[0]["source"] == "JM"
    assert items[0]["sourceSite"] == "jm"


def test_legacy_jmcomic_reading_history_conflict_newest_wins(tmp_path):
    import sqlite3

    db_path = tmp_path / "legacy_conflict.db"
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE reading_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            comic_id TEXT NOT NULL,
            title TEXT NOT NULL,
            cover_url TEXT,
            source TEXT NOT NULL,
            source_site TEXT DEFAULT '',
            media_id TEXT DEFAULT '',
            source_url TEXT,
            last_page INTEGER DEFAULT 0,
            total_pages INTEGER DEFAULT 0,
            last_read_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(comic_id, source)
        )
        """
    )
    conn.execute(
        "INSERT INTO reading_history (comic_id, title, source, source_site, last_page, total_pages, last_read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ("100", "Old", "JMCOMIC", "jmcomic", 5, 20, "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"),
    )
    conn.execute(
        "INSERT INTO reading_history (comic_id, title, source, source_site, last_page, total_pages, last_read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ("100", "New", "JM", "jm", 9, 30, "2026-01-02T00:00:00+00:00", "2026-01-02T00:00:00+00:00"),
    )
    conn.commit()
    conn.close()

    db = ReadingHistoryDB(str(db_path))
    items, total = db.get_history()
    assert total == 1
    assert items[0]["title"] == "New"
    assert items[0]["lastPage"] == 9
    assert items[0]["createdAt"] == "2026-01-01T00:00:00+00:00"
