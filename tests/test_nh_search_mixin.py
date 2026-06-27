"""Tests for NH-specific SearchMixin behavior."""

from types import SimpleNamespace

from models import ComicInfo
from python.ipc.search_mixin import SearchMixin


class _FakeSearchMixin(SearchMixin):
    def __init__(self):
        self.config = SimpleNamespace(default_source="hcomic", source_auth={})
        self.calls = []
        self.parser = SimpleNamespace(search=self._search)
        self._tag_list_db = SimpleNamespace(upsert_tags=lambda *_args, **_kwargs: None)

    def _search(self, keyword: str, page: int = 1, source: str | None = None, tag: str = ""):
        self.calls.append({"keyword": keyword, "page": page, "source": source, "tag": tag})
        comic = ComicInfo(id="1", title="Test", source_site="nh", comic_source="NH", tags=["big breasts"])
        return [comic], SimpleNamespace(current_page=page, total_pages=1, total_items=1)

    def _collect_tags_from_comics(self, *_args, **_kwargs):
        pass


def test_nh_ranking_popular_maps_to_popular_tag():
    mixin = _FakeSearchMixin()

    mixin.handle_search(query="popular", mode="ranking", page=2, source="nh")

    assert mixin.calls[-1] == {"keyword": "", "page": 2, "source": "nh", "tag": "popular"}


def test_nh_single_tag_maps_to_exact_tag_query():
    mixin = _FakeSearchMixin()

    mixin.handle_search(query="big breasts", mode="tag", page=1, source="nh")

    assert mixin.calls[-1]["keyword"] == 'tag:"big breasts"'
    assert mixin.calls[-1]["tag"] == ""


def test_nh_multi_tag_maps_to_exact_tag_query_and_escapes_quotes():
    mixin = _FakeSearchMixin()

    mixin.handle_search(query='big "quote"', mode="tag", page=1, source="nh", tag="full color")

    assert mixin.calls[-1]["keyword"] == 'tag:"big \\"quote\\"" tag:"full color"'
