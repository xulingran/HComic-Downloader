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
            source="JMCOMIC",
            source_site="jmcomic",
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
