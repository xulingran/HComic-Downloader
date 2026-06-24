"""Tests for SearchMixin._comic_to_dict serialization contract."""

from models import ComicInfo
from python.ipc.search_mixin import SearchMixin


def _mixin() -> SearchMixin:
    """SearchMixin._comic_to_dict only reads the comic arg, so a bare instance suffices."""
    return SearchMixin()


def test_comic_to_dict_includes_metadata_fields():
    """category/language/publishDate must be serialized so the drawer & CBZ can read them."""
    comic = ComicInfo(
        id="1",
        title="t",
        author="au",
        category="artist cg",
        language="chinese",
        publish_date="2026-06-01",
        comic_source="MOEIMG",
        source_site="moeimg",
        media_id="1",
        pages=5,
    )

    data = _mixin()._comic_to_dict(comic)

    assert data["category"] == "artist cg"
    assert data["language"] == "chinese"
    assert data["publishDate"] == "2026-06-01"


def test_comic_to_dict_null_when_metadata_missing():
    """Missing metadata must serialize to null (keys present), never be omitted."""
    comic = ComicInfo(id="2", title="t", comic_source="MOEIMG", source_site="moeimg", media_id="2")

    data = _mixin()._comic_to_dict(comic)

    assert "category" in data and data["category"] is None
    assert "language" in data and data["language"] is None
    assert "publishDate" in data and data["publishDate"] is None
