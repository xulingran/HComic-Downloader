"""Tests for NH-specific SearchMixin behavior."""

from types import SimpleNamespace

import pytest

from models import ComicInfo
from python.ipc.search_mixin import SearchMixin
from python.ipc.types import AuthRequiredError


class _FakeSearchMixin(SearchMixin):
    def __init__(self):
        self.config = SimpleNamespace(default_source="hcomic", source_auth={})
        self.calls = []
        self.add_result = True
        self.check_result = True
        self.remove_result = True
        self.parser = SimpleNamespace(
            search=self._search,
            random=self._random,
            favourites=self._favourites,
            add_to_favourites=self._add_to_favourites,
            check_favourite=self._check_favourite,
            remove_from_favourites=self._remove_from_favourites,
            get_runtime_auth=lambda source: ("session=valid", "UA") if source == "jm" else ("", ""),
        )
        self._tag_list_db = SimpleNamespace(upsert_tags=lambda *_args, **_kwargs: None)
        self._favourite_tags_db = SimpleNamespace(
            upsert_comic=lambda *_args, **_kwargs: None,
            remove_comic=lambda *_args, **_kwargs: None,
            get_comic_tags=lambda *_args, **_kwargs: [],
        )

    def _search(self, keyword: str, page: int = 1, source: str | None = None, tag: str = ""):
        self.calls.append({"keyword": keyword, "page": page, "source": source, "tag": tag})
        comic = ComicInfo(id="1", title="Test", source_site="nh", comic_source="NH", tags=["big breasts"])
        return [comic], SimpleNamespace(current_page=page, total_pages=1, total_items=1)

    def _favourites(self, page: int = 1, raise_errors: bool = False, source: str | None = None):
        self.calls.append({"method": "favourites", "page": page, "raise_errors": raise_errors, "source": source})
        comic = ComicInfo(id="1", title="Test", source_site="nh", comic_source="NH", tags=[])
        return [comic], SimpleNamespace(current_page=page, total_pages=1, total_items=1), False

    def _random(self, source: str | None = None):
        self.calls.append({"method": "random", "source": source})
        comic = ComicInfo(id="random", title="Random", source_site=source or "", comic_source=(source or "").upper())
        return [comic], None

    def _add_to_favourites(self, comic_id: str, source: str | None = None):
        self.calls.append({"method": "add_to_favourites", "comic_id": comic_id, "source": source})
        return self.add_result

    def _check_favourite(self, comic_id: str, source: str | None = None):
        self.calls.append({"method": "check_favourite", "comic_id": comic_id, "source": source})
        return self.check_result

    def _remove_from_favourites(self, comic_id: str, source: str | None = None):
        self.calls.append({"method": "remove_from_favourites", "comic_id": comic_id, "source": source})
        return self.remove_result

    def _collect_tags_from_comics(self, *_args, **_kwargs):
        pass

    def _update_tags_from_favourites_page(self, *_args, **_kwargs):
        pass

    def _update_tags_on_favourite_add(self, *_args, **_kwargs):
        pass


def test_nh_ranking_popular_maps_to_popular_tag():
    mixin = _FakeSearchMixin()

    mixin.handle_search(query="popular", mode="ranking", page=2, source="nh")

    assert mixin.calls[-1] == {"keyword": "", "page": 2, "source": "nh", "tag": "popular"}


def test_nh_ranking_popular_today_maps_to_tag():
    mixin = _FakeSearchMixin()

    mixin.handle_search(query="popular-today", mode="ranking", page=1, source="nh")

    assert mixin.calls[-1] == {"keyword": "", "page": 1, "source": "nh", "tag": "popular-today"}


def test_nh_ranking_popular_week_maps_to_tag():
    mixin = _FakeSearchMixin()

    mixin.handle_search(query="popular-week", mode="ranking", page=1, source="nh")

    assert mixin.calls[-1] == {"keyword": "", "page": 1, "source": "nh", "tag": "popular-week"}


def test_nh_ranking_popular_month_maps_to_tag():
    mixin = _FakeSearchMixin()

    mixin.handle_search(query="popular-month", mode="ranking", page=1, source="nh")

    assert mixin.calls[-1] == {"keyword": "", "page": 1, "source": "nh", "tag": "popular-month"}


def test_nh_ranking_unknown_query_maps_to_empty_tag():
    mixin = _FakeSearchMixin()

    mixin.handle_search(query="random", mode="ranking", page=1, source="nh")

    assert mixin.calls[-1] == {"keyword": "", "page": 1, "source": "nh", "tag": ""}


def test_nh_single_tag_maps_to_exact_tag_query():
    mixin = _FakeSearchMixin()

    mixin.handle_search(query="big breasts", mode="tag", page=1, source="nh")

    assert mixin.calls[-1]["keyword"] == 'tag:"big breasts"'
    assert mixin.calls[-1]["tag"] == ""


def test_nh_multi_tag_maps_to_exact_tag_query_and_escapes_quotes():
    mixin = _FakeSearchMixin()

    mixin.handle_search(query='big "quote"', mode="tag", page=1, source="nh", tag="full color")

    assert mixin.calls[-1]["keyword"] == 'tag:"big \\"quote\\"" tag:"full color"'


def test_nh_tag_query_deduplicates_case_insensitively():
    mixin = _FakeSearchMixin()

    mixin.handle_search(
        query="Big Breasts,big breasts",
        mode="tag",
        page=1,
        source="nh",
        tag="Full Color,FULL COLOR",
    )

    assert mixin.calls[-1]["keyword"] == 'tag:"Big Breasts" tag:"Full Color"'


def test_nh_get_favourites_routes_to_parser():
    mixin = _FakeSearchMixin()
    mixin.config.source_auth = {"nh": {"cookie": "", "user_agent": "", "bearer_token": "key"}}

    result = mixin.handle_get_favourites(page=2, source="nh")

    assert any(c.get("method") == "favourites" and c.get("source") == "nh" for c in mixin.calls)
    assert result["needsLogin"] is False
    assert result["pagination"]["currentPage"] == 2


def test_nh_add_to_favourites_routes_to_parser():
    mixin = _FakeSearchMixin()
    mixin.config.source_auth = {"nh": {"bearer_token": "key"}}

    result = mixin.handle_add_to_favourites(comic_id="12345", source="nh")

    assert any(c.get("method") == "add_to_favourites" and c.get("source") == "nh" for c in mixin.calls)
    assert result["success"] is True


def test_nh_check_favourite_routes_to_parser():
    mixin = _FakeSearchMixin()
    mixin.config.source_auth = {"nh": {"bearer_token": "key"}}

    result = mixin.handle_check_favourite(comic_id="12345", source="nh")

    assert any(c.get("method") == "check_favourite" and c.get("source") == "nh" for c in mixin.calls)
    assert result["isFavourited"] is True


def test_nh_remove_from_favourites_routes_to_parser():
    mixin = _FakeSearchMixin()
    mixin.config.source_auth = {"nh": {"bearer_token": "key"}}

    result = mixin.handle_remove_from_favourites(comic_id="12345", source="nh")

    assert any(c.get("method") == "remove_from_favourites" and c.get("source") == "nh" for c in mixin.calls)
    assert result["success"] is True


@pytest.mark.parametrize(
    ("handler", "kwargs"),
    [
        ("handle_get_favourites", {"page": 1, "source": "nh"}),
        ("handle_add_to_favourites", {"comic_id": "12345", "source": "nh"}),
        ("handle_check_favourite", {"comic_id": "12345", "source": "nh"}),
        ("handle_remove_from_favourites", {"comic_id": "12345", "source": "nh"}),
    ],
)
def test_nh_favourite_ipc_requires_real_credentials(handler, kwargs):
    mixin = _FakeSearchMixin()
    mixin.config.source_auth = {"nh": {"user_agent": "UA only"}}

    with pytest.raises(AuthRequiredError, match="NH 未登录"):
        getattr(mixin, handler)(**kwargs)


def test_nh_add_failure_is_not_reported_as_success():
    mixin = _FakeSearchMixin()
    mixin.config.source_auth = {"nh": {"bearer_token": "key"}}
    mixin.add_result = False

    result = mixin.handle_add_to_favourites(comic_id="12345", source="nh")

    assert result == {"success": False}


def test_nh_remove_failure_is_not_reported_as_success():
    mixin = _FakeSearchMixin()
    mixin.config.source_auth = {"nh": {"bearer_token": "key"}}
    mixin.remove_result = False

    result = mixin.handle_remove_from_favourites(comic_id="12345", source="nh")

    assert result == {"success": False}


def test_nh_random_is_rejected_without_hcomic_fallback():
    mixin = _FakeSearchMixin()

    with pytest.raises(ValueError, match="not supported.*nh"):
        mixin.handle_random(source="nh")

    assert not any(call.get("method") == "random" for call in mixin.calls)


@pytest.mark.parametrize("source", ["hcomic", "jm", "bika"])
def test_supported_random_sources_keep_their_source(source):
    mixin = _FakeSearchMixin()

    mixin.handle_random(source=source)

    assert mixin.calls[-1] == {"method": "random", "source": source}
