"""Tests for favourite tags sync progress notifications.

聚焦 handle_sync_favourite_tags 在各阶段推送的 favourite_tags_progress
事件结构，以及 _enrich_tags_for_comics 的可选进度回调。通过桩 mixin
隔离 SearchMixin 的网络/DB 依赖，仅断言进度契约。
"""

import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from python.ipc.favourite_tags_mixin import FavouriteTagsDB, FavouriteTagsMixin


class _StubSyncMixin(FavouriteTagsMixin):
    """重写 SearchMixin 提供的两个 helper，避免引入网络与完整 DB 链路。"""

    def __init__(self, db: FavouriteTagsDB, parser, update_pages, enrich):
        self._favourite_tags_db = db
        self.parser = parser
        self._write_response = MagicMock()
        self._update_pages_impl = update_pages
        self._enrich_impl = enrich

    # 覆盖 SearchMixin 方法
    def _update_tags_from_favourites_page(self, comics, source, *, collect_empty=False):
        return self._update_pages_impl(comics, source, collect_empty)

    def _enrich_tags_for_comics(self, comics, source, *, progress_callback=None):
        # 仍然回调进度，模拟真实补全过程
        if progress_callback is not None:
            for i, _ in enumerate(comics):
                progress_callback(i + 1)
        return self._enrich_impl(comics, source)


def _notifications(mixin):
    """从 _write_response 收集 method=favourite_tags_progress 的 params。"""
    params_list = []
    for call in mixin._write_response.call_args_list:
        payload = call.args[0]
        if payload.get("method") == "favourite_tags_progress":
            params_list.append(payload["params"])
    return params_list


def test_sync_emits_fetching_completed_progress(tmp_path):
    db = FavouriteTagsDB(str(tmp_path / "ft.db"))
    db.upsert_comic("c1", "hcomic", ["tag:A"])

    page1 = [SimpleNamespace(id="c1", tags=["tag:A"])]
    page2 = [SimpleNamespace(id="c2", tags=["tag:B"])]

    parser = MagicMock()
    parser.favourites.side_effect = [
        (page1, SimpleNamespace(total_pages=2), False),
        (page2, SimpleNamespace(total_pages=2), False),
    ]

    def update_pages(comics, source, collect_empty):
        return []

    def enrich(comics, source):
        return 0

    mixin = _StubSyncMixin(db, parser, update_pages, enrich)

    result = mixin.handle_sync_favourite_tags("hcomic")

    events = _notifications(mixin)
    phases = [e["phase"] for e in events]

    # 收藏页阶段：每页都推送 fetching，含页码与已扫描漫画数
    assert "fetching" in phases
    fetching = [e for e in events if e["phase"] == "fetching"]
    assert fetching[0]["currentPage"] == 1
    assert fetching[0]["totalPages"] == 2
    assert fetching[-1]["currentPage"] == 2
    assert fetching[-1]["totalComics"] == 2

    # 成功路径必须以 completed 结束，且含最终标签数
    assert phases[-1] == "completed"
    completed = events[-1]
    assert completed["totalTags"] == len(result["tags"])

    # 专用通知方法，禁止复用 tag_list_progress
    methods = {c.args[0].get("method") for c in mixin._write_response.call_args_list}
    assert "favourite_tags_progress" in methods
    assert "tag_list_progress" not in methods


def test_sync_emits_enriching_progress_when_empty_comics_exist(tmp_path):
    db = FavouriteTagsDB(str(tmp_path / "ft.db"))

    empty_comic = SimpleNamespace(id="c1", tags=[])
    parser = MagicMock()
    parser.favourites.return_value = (
        [empty_comic],
        SimpleNamespace(total_pages=1),
        False,
    )

    def update_pages(comics, source, collect_empty):
        # collect_empty=True 时返回待补全漫画
        return [empty_comic] if collect_empty else []

    def enrich(comics, source):
        return 1

    mixin = _StubSyncMixin(db, parser, update_pages, enrich)

    mixin.handle_sync_favourite_tags("hcomic")

    events = _notifications(mixin)
    enriching = [e for e in events if e["phase"] == "enriching"]

    # enrichment 必须先发 start（0/1），再发过程中（1/1）
    assert enriching[0]["current"] == 0
    assert enriching[0]["total"] == 1
    assert enriching[-1]["current"] == 1
    assert enriching[-1]["total"] == 1
    # 与 fetching 阶段可区分
    assert enriching[-1]["phase"] == "enriching"


def test_sync_emits_error_and_reraises_on_first_page_failure(tmp_path):
    db = FavouriteTagsDB(str(tmp_path / "ft.db"))
    parser = MagicMock()
    parser.favourites.side_effect = RuntimeError("boom")

    mixin = _StubSyncMixin(db, parser, lambda *a, **k: [], lambda *a, **k: 0)

    # 异常路径必须重新抛出，保持现有 JSON-RPC 错误行为
    with pytest.raises(RuntimeError):
        mixin.handle_sync_favourite_tags("hcomic")

    events = _notifications(mixin)
    assert events
    assert events[-1]["phase"] == "error"
    assert "boom" in events[-1]["message"]
