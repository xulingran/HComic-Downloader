"""Tests for tag list catalog behavior."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from python.ipc.tag_list_mixin import _NH_TAG_LIST_REQUEST_INTERVAL_SECONDS, TagListDB, TagListMixin


def test_tag_list_db_supports_popular_and_name_sort(tmp_path):
    db = TagListDB(str(tmp_path / "tags.db"))
    db.replace_tags({"zeta": 10, "alpha": 1, "beta": 5}, "nh")

    popular, _total = db.get_tags("nh", sort="popular")
    by_name, _total = db.get_tags("nh", sort="name")

    assert [item["tag"] for item in popular] == ["zeta", "beta", "alpha"]
    assert [item["tag"] for item in by_name] == ["alpha", "beta", "zeta"]


def test_tag_list_db_keyword_filter_keeps_requested_sort(tmp_path):
    db = TagListDB(str(tmp_path / "tags.db"))
    db.replace_tags({"zeta tag": 100, "alpha tag": 1, "beta": 5}, "nh")

    by_name, total = db.get_tags("nh", keyword="tag", sort="name")

    assert total == 2
    assert [item["tag"] for item in by_name] == ["alpha tag", "zeta tag"]


class _FakeTagListMixin(TagListMixin):
    def __init__(self, db: TagListDB, parser):
        self._tag_list_db = db
        self.parser = parser
        self._write_response = MagicMock()


def test_refresh_nh_tag_list_replaces_after_collecting(tmp_path):
    db = TagListDB(str(tmp_path / "tags.db"))
    db.replace_tags({"old": 1}, "nh")
    nh_parser = MagicMock()
    nh_parser.get_tag_list.return_value = (
        [{"tag": "new", "count": 7}],
        SimpleNamespace(total_pages=1),
    )
    mixin = _FakeTagListMixin(db, SimpleNamespace(parsers={"nh": nh_parser}))

    result = mixin._do_refresh_nh_tag_list()

    tags, total = db.get_tags("nh")
    assert result["totalTags"] == 1
    assert total == 1
    assert tags == [{"tag": "new", "count": 7}]


def test_refresh_nh_tag_list_respects_api_rate_limit(tmp_path):
    db = TagListDB(str(tmp_path / "tags.db"))
    nh_parser = MagicMock()
    nh_parser.get_tag_list.side_effect = [
        ([{"tag": "page1", "count": 1}], SimpleNamespace(total_pages=3)),
        ([{"tag": "page2", "count": 2}], SimpleNamespace(total_pages=3)),
        ([{"tag": "page3", "count": 3}], SimpleNamespace(total_pages=3)),
    ]
    mixin = _FakeTagListMixin(db, SimpleNamespace(parsers={"nh": nh_parser}))

    with patch("python.ipc.tag_list_mixin.time.sleep") as sleep_mock:
        mixin._do_refresh_nh_tag_list()

    assert sleep_mock.call_args_list == [
        ((_NH_TAG_LIST_REQUEST_INTERVAL_SECONDS,),),
        ((_NH_TAG_LIST_REQUEST_INTERVAL_SECONDS,),),
    ]


def test_refresh_nh_tag_list_keeps_old_data_on_first_page_failure(tmp_path):
    db = TagListDB(str(tmp_path / "tags.db"))
    db.replace_tags({"old": 1}, "nh")
    nh_parser = MagicMock()
    nh_parser.get_tag_list.side_effect = RuntimeError("network")
    mixin = _FakeTagListMixin(db, SimpleNamespace(parsers={"nh": nh_parser}))

    with pytest.raises(RuntimeError):
        mixin._do_refresh_nh_tag_list()

    tags, total = db.get_tags("nh")
    assert total == 1
    assert tags == [{"tag": "old", "count": 1}]
