"""Tests for tag enrichment logic in SearchMixin."""

import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models import ComicInfo
from python.ipc.favourite_tags_mixin import FavouriteTagsDB
from python.ipc.search_mixin import SearchMixin


def _make_db(tmp_path):
    return FavouriteTagsDB(str(tmp_path / "ft.db"))


def _make_comic(comic_id: str, title: str = "Test", tags: list[str] | None = None) -> ComicInfo:
    return ComicInfo(
        id=comic_id,
        title=title,
        tags=tags or [],
        source_site="moeimg",
        comic_source="MOEIMG",
    )


class _FakeSearchMixin(SearchMixin):
    """Minimal SearchMixin with injected dependencies for testing."""

    def __init__(self, db: FavouriteTagsDB, parser_mock: MagicMock):
        self._favourite_tags_db = db
        self.parser = parser_mock


def test_collect_empty_false_skips_empty_tags(tmp_path):
    """collect_empty=False (default): comics with no tags are silently skipped."""
    db = _make_db(tmp_path)
    parser_mock = MagicMock()
    mixin = _FakeSearchMixin(db, parser_mock)

    comics = [_make_comic("c1", tags=[]), _make_comic("c2", tags=["tag:A"])]
    result = mixin._update_tags_from_favourites_page(comics, "moeimg")

    assert result == []
    tags = db.get_tags("moeimg")
    assert len(tags) == 1
    assert tags[0]["tag"] == "tag:A"


def test_collect_empty_true_collects_empty_comics(tmp_path):
    """collect_empty=True: comics with no tags are collected for enrichment."""
    db = _make_db(tmp_path)
    parser_mock = MagicMock()
    mixin = _FakeSearchMixin(db, parser_mock)

    empty_comic = _make_comic("c1", tags=[])
    tagged_comic = _make_comic("c2", tags=["tag:A"])
    result = mixin._update_tags_from_favourites_page([empty_comic, tagged_comic], "moeimg", collect_empty=True)

    assert len(result) == 1
    assert result[0].id == "c1"
    # tagged comic should still be indexed
    tags = db.get_tags("moeimg")
    assert len(tags) == 1
    assert tags[0]["tag"] == "tag:A"


def test_collect_empty_skips_already_indexed(tmp_path):
    """collect_empty=True: comics already in the DB are not re-collected."""
    db = _make_db(tmp_path)
    # Pre-index comic c1 with empty tags
    db.upsert_comic("c1", "moeimg", ["existing"])

    parser_mock = MagicMock()
    mixin = _FakeSearchMixin(db, parser_mock)

    comics = [_make_comic("c1", tags=[])]
    result = mixin._update_tags_from_favourites_page(comics, "moeimg", collect_empty=True)

    assert result == []


def test_enrich_tags_for_comics_success(tmp_path):
    """_enrich_tags_for_comics writes tags from get_comic_detail."""
    db = _make_db(tmp_path)
    parser_mock = MagicMock()
    mixin = _FakeSearchMixin(db, parser_mock)

    detail_comic = _make_comic("c1", tags=["enriched:tag1", "enriched:tag2"])
    parser_mock.get_comic_detail.return_value = detail_comic

    comics = [_make_comic("c1", tags=[])]
    with patch("time.sleep"):
        count = mixin._enrich_tags_for_comics(comics, "moeimg")

    assert count == 1
    tags = db.get_tags("moeimg")
    tag_map = {t["tag"]: t["count"] for t in tags}
    assert tag_map["enriched:tag1"] == 1
    assert tag_map["enriched:tag2"] == 1


def test_enrich_tags_skips_failed_detail(tmp_path):
    """_enrich_tags_for_comics skips comics where get_comic_detail fails."""
    db = _make_db(tmp_path)
    parser_mock = MagicMock()
    mixin = _FakeSearchMixin(db, parser_mock)

    parser_mock.get_comic_detail.side_effect = Exception("network error")

    comics = [_make_comic("c1", tags=[])]
    with patch("time.sleep"):
        count = mixin._enrich_tags_for_comics(comics, "moeimg")

    assert count == 0
    assert db.get_tags("moeimg") == []


def test_enrich_tags_skips_detail_with_no_tags(tmp_path):
    """_enrich_tags_for_comics skips comics where detail returns no tags."""
    db = _make_db(tmp_path)
    parser_mock = MagicMock()
    mixin = _FakeSearchMixin(db, parser_mock)

    detail_comic = _make_comic("c1", tags=[])
    parser_mock.get_comic_detail.return_value = detail_comic

    comics = [_make_comic("c1", tags=[])]
    with patch("time.sleep"):
        count = mixin._enrich_tags_for_comics(comics, "moeimg")

    assert count == 0


def test_enrich_tags_returns_none_detail(tmp_path):
    """_enrich_tags_for_comics handles get_comic_detail returning None."""
    db = _make_db(tmp_path)
    parser_mock = MagicMock()
    mixin = _FakeSearchMixin(db, parser_mock)

    parser_mock.get_comic_detail.return_value = None

    comics = [_make_comic("c1", tags=[])]
    with patch("time.sleep"):
        count = mixin._enrich_tags_for_comics(comics, "moeimg")

    assert count == 0
