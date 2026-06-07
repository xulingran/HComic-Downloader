"""Tests for FavouriteTagsDB (favourite tag index persistence)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from python.ipc.favourite_tags_mixin import FavouriteTagsDB


def _make_db(tmp_path):
    return FavouriteTagsDB(str(tmp_path / "ft.db"))


def test_add_comic_and_get_tags(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_comic("c1", "hcomic", ["tag:A", "tag:B", "tag:C"])
    tags = db.get_tags("hcomic")
    assert len(tags) == 3
    assert tags[0]["tag"] == "tag:A"
    assert tags[0]["count"] == 1


def test_add_multiple_comics_aggregates_counts(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_comic("c1", "hcomic", ["tag:A", "tag:B"])
    db.upsert_comic("c2", "hcomic", ["tag:A", "tag:C"])
    tags = db.get_tags("hcomic")
    tag_map = {t["tag"]: t["count"] for t in tags}
    assert tag_map["tag:A"] == 2
    assert tag_map["tag:B"] == 1
    assert tag_map["tag:C"] == 1


def test_remove_comic_decrements_counts(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_comic("c1", "hcomic", ["tag:A", "tag:B"])
    db.upsert_comic("c2", "hcomic", ["tag:A"])
    db.remove_comic("c1", "hcomic")
    tags = db.get_tags("hcomic")
    tag_map = {t["tag"]: t["count"] for t in tags}
    assert tag_map["tag:A"] == 1
    assert len(tags) == 1  # tag:B count went to 0 and was cleaned up


def test_upsert_comic_updates_snapshot(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_comic("c1", "hcomic", ["tag:A"])
    db.upsert_comic("c1", "hcomic", ["tag:B"])
    tags = db.get_tags("hcomic")
    tag_map = {t["tag"]: t["count"] for t in tags}
    # tag:A should be decremented (old snapshot), tag:B incremented (new)
    assert tag_map.get("tag:A", 0) == 0
    assert tag_map["tag:B"] == 1


def test_remove_tag_by_name(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_comic("c1", "hcomic", ["tag:A", "tag:B"])
    db.remove_tag("tag:A", "hcomic")
    tags = db.get_tags("hcomic")
    tag_names = [t["tag"] for t in tags]
    assert "tag:A" not in tag_names
    assert "tag:B" in tag_names


def test_get_tags_sorted_by_count_desc(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_comic("c1", "hcomic", ["rare", "common", "other"])
    db.upsert_comic("c2", "hcomic", ["common", "other"])
    db.upsert_comic("c3", "hcomic", ["common"])
    tags = db.get_tags("hcomic")
    counts = [t["count"] for t in tags]
    assert counts == sorted(counts, reverse=True)


def test_different_sources_isolated(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_comic("c1", "hcomic", ["tag:A"])
    db.upsert_comic("c1", "jmcomic", ["tag:X"])
    hcomic_tags = db.get_tags("hcomic")
    jmcomic_tags = db.get_tags("jmcomic")
    assert len(hcomic_tags) == 1
    assert len(jmcomic_tags) == 1
    assert hcomic_tags[0]["tag"] == "tag:A"
    assert jmcomic_tags[0]["tag"] == "tag:X"


def test_clear_all(tmp_path):
    db = _make_db(tmp_path)
    db.upsert_comic("c1", "hcomic", ["tag:A", "tag:B"])
    db.clear("hcomic")
    tags = db.get_tags("hcomic")
    assert len(tags) == 0


def test_get_tags_empty_db(tmp_path):
    db = _make_db(tmp_path)
    tags = db.get_tags("hcomic")
    assert tags == []


def test_remove_comic_not_exist(tmp_path):
    db = _make_db(tmp_path)
    # Should not raise
    db.remove_comic("nonexistent", "hcomic")
    tags = db.get_tags("hcomic")
    assert tags == []


def test_bika_source_isolated(tmp_path):
    """Bika tag data is isolated from other sources."""
    db = _make_db(tmp_path)
    db.upsert_comic("c1", "hcomic", ["tag:A"])
    db.upsert_comic("c1", "jmcomic", ["tag:X"])
    db.upsert_comic("c1", "bika", ["全彩", "紳士"])
    hcomic_tags = db.get_tags("hcomic")
    jmcomic_tags = db.get_tags("jmcomic")
    bika_tags = db.get_tags("bika")
    assert len(hcomic_tags) == 1
    assert len(jmcomic_tags) == 1
    assert len(bika_tags) == 2
    assert hcomic_tags[0]["tag"] == "tag:A"
    assert jmcomic_tags[0]["tag"] == "tag:X"
    bika_tag_names = {t["tag"] for t in bika_tags}
    assert bika_tag_names == {"全彩", "紳士"}


def test_bika_upsert_and_get_tags(tmp_path):
    """Bika source full CRUD flow: upsert, get, remove, clear."""
    db = _make_db(tmp_path)
    # Upsert multiple comics
    db.upsert_comic("b1", "bika", ["全彩", "長篇"])
    db.upsert_comic("b2", "bika", ["全彩", "完結"])
    tags = db.get_tags("bika")
    tag_map = {t["tag"]: t["count"] for t in tags}
    assert tag_map["全彩"] == 2
    assert tag_map["長篇"] == 1
    assert tag_map["完結"] == 1

    # Remove a comic
    db.remove_comic("b1", "bika")
    tags = db.get_tags("bika")
    tag_map = {t["tag"]: t["count"] for t in tags}
    assert tag_map["全彩"] == 1
    assert "長篇" not in tag_map  # count went to 0 and was cleaned up

    # Clear
    db.clear("bika")
    assert db.get_tags("bika") == []
