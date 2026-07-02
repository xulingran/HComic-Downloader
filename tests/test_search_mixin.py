"""Tests for SearchMixin._comic_to_dict serialization contract."""

import pytest

from models import ComicInfo
from python.ipc.search_mixin import SearchMixin
from python.ipc.types import AuthRequiredError
from sources.base import AntiBotChallengeError, ParserResponseError


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


def test_auth_error_guard_does_not_treat_anti_bot_challenge_as_expired_auth():
    """结构化反爬挑战必须绕过宽泛的 403/Cloudflare 认证关键词判断。"""
    with pytest.raises(AntiBotChallengeError, match="人机验证") as exc_info, _mixin()._auth_error_guard("jm"):
        raise AntiBotChallengeError(
            "JM 站点人机验证持续阻断，请稍后重试",
            challenge_url="https://18comic.vip/user/test/favorite/albums",
        )

    assert not isinstance(exc_info.value, AuthRequiredError)
    assert "登录凭证已失效" not in str(exc_info.value)
    assert exc_info.value.challenge_url.endswith("/favorite/albums")


def test_auth_error_guard_keeps_real_auth_failure_semantics():
    """明确的认证失效仍应映射为 AuthRequiredError。"""
    with pytest.raises(AuthRequiredError, match="认证已失效"), _mixin()._auth_error_guard("jm"):
        raise ParserResponseError("认证已失效，请重新登录")


def test_handle_search_lets_jm_challenge_bubble_up():
    """JM 搜索抛 AntiBotChallengeError 时，handle_search 必须经 _auth_error_guard 让其冒泡（不转 AuthRequiredError）。

    这样 ipc_server 顶层捕获可序列化为 -32002 结构化挑战信号，供 Electron 触发恢复。
    """
    from unittest.mock import MagicMock

    mixin = SearchMixin()
    mixin.config = MagicMock()
    mixin.config.default_source = "jm"
    # 绕过来源鉴权检查
    mixin._check_source_auth = lambda source: None  # type: ignore[method-assign]

    mixin.parser = MagicMock()
    # handle_search 调 MultiSourceParser.search → JM parser 抛 AntiBotChallengeError。
    # 模拟分发层透传该异常。
    mixin.parser.search.side_effect = AntiBotChallengeError(
        "JM 搜索遇到站点人机验证",
        challenge_url="https://18comic.vip/search?search_query=test",
    )

    with pytest.raises(AntiBotChallengeError, match="人机验证") as exc_info:
        mixin.handle_search("test", mode="keyword", page=1, source="jm")

    assert not isinstance(exc_info.value, AuthRequiredError)
    assert exc_info.value.challenge_url.startswith("https://18comic.vip/search")


def test_handle_search_non_jm_source_unaffected_by_challenge_logic():
    """非 JM 来源搜索不受挑战检测改动影响（其 parser 不抛 AntiBotChallengeError，行为不变）。"""
    from unittest.mock import MagicMock

    from models import ComicInfo, PaginationInfo

    mixin = SearchMixin()
    mixin.config = MagicMock()
    mixin.config.default_source = "hcomic"
    mixin._check_source_auth = lambda source: None  # type: ignore[method-assign]
    mixin._collect_tags_from_comics = lambda comics, source: None  # type: ignore[method-assign]

    comic = ComicInfo(id="1", title="t", comic_source="HCOMIC", source_site="hcomic", media_id="1")
    mixin.parser = MagicMock()
    mixin.parser.search.return_value = ([comic], PaginationInfo(current_page=1, total_pages=1, total_items=1))

    result = mixin.handle_search("test", mode="keyword", page=1, source="hcomic")

    assert len(result["comics"]) == 1
    assert result["pagination"]["currentPage"] == 1
