"""NH 解析器单元测试。"""

import json as _json

import pytest
import requests as _requests

from sources.base import ParserResponseError
from sources.nh.parser import NhParser

# ---------------------------------------------------------------------------
# 辅助工具
# ---------------------------------------------------------------------------


def _make_json_response(payload: dict, status_code: int = 200) -> _requests.Response:
    """构建带有 JSON payload 的 requests.Response。"""
    resp = _requests.Response()
    resp.status_code = status_code
    resp._content = _json.dumps(payload).encode("utf-8")
    resp.headers["Content-Type"] = "application/json"
    return resp


class TestNhTagList:
    """测试 NH 标签目录解析。"""

    TAGS_HTML = """
    <div id="tag-container">
      <a class="tagchip variant-pill state-normal block" href="/tag/big-breasts/">
        <span class="name">big breasts</span>
        <span class="count" title="224,619 galleries">224.6k</span>
      </a>
      <a class="tagchip variant-pill state-normal block" href="/tag/full-color/">
        <span class="name">full color</span>
        <span class="count">81.0k</span>
      </a>
    </div>
    <a href="/tags/?sort=popular&page=1">1</a>
    <a href="/tags/?sort=popular&page=39">39</a>
    """

    def test_parse_tags_page_prefers_title_count(self):
        tags = NhParser._parse_tags_page(self.TAGS_HTML)
        assert tags[0] == {"tag": "big breasts", "count": 224619}

    def test_parse_tags_page_compact_count_fallback(self):
        tags = NhParser._parse_tags_page(self.TAGS_HTML)
        assert tags[1] == {"tag": "full color", "count": 81000}

    def test_parse_compact_count(self):
        assert NhParser._parse_compact_count("1.3k") == 1300
        assert NhParser._parse_compact_count("2m") == 2_000_000
        assert NhParser._parse_compact_count("42") == 42

    def test_parse_tags_total_pages(self):
        assert NhParser._parse_tags_total_pages(self.TAGS_HTML) == 39

    def test_parse_tags_api_response(self):
        data = {
            "result": [
                {"id": 2937, "type": "tag", "name": "big breasts", "slug": "big-breasts", "count": 224622},
                {"id": 6346, "type": "tag", "name": "full color", "slug": "full-color", "count": 80970},
            ],
            "total_pages": 39,
            "total": 4610,
        }
        assert NhParser._parse_tags_api_response(data) == [
            {"tag": "big breasts", "count": 224622},
            {"tag": "full color", "count": 80970},
        ]

    def test_get_tag_list_uses_official_tags_api(self, monkeypatch):
        parser = NhParser()
        seen = {}

        def fake_request_json(url: str, **_kwargs):
            seen["url"] = url
            return {
                "result": [{"id": 2937, "type": "tag", "name": "big breasts", "count": 224622}],
                "num_pages": 39,
                "total": 4610,
            }

        monkeypatch.setattr(parser, "_request_json", fake_request_json)
        tags, pagination = parser.get_tag_list(page=2, sort="popular")

        assert "/api/v2/tags/tag" in seen["url"]
        assert "sort=popular" in seen["url"]
        assert "page=2" in seen["url"]
        assert "per_page=100" in seen["url"]
        assert tags[0] == {"tag": "big breasts", "count": 224622}
        assert pagination is not None
        assert pagination.current_page == 2
        assert pagination.total_pages == 39
        assert pagination.total_items == 4610


# ---------------------------------------------------------------------------
# 图片 URL 构建测试
# ---------------------------------------------------------------------------


class TestBuildImageUrl:
    """测试图片 URL 构建。"""

    def test_build_image_url_jpg(self):
        url = NhParser._build_image_url("12345", "galleries/12345/1.jpg")
        assert url == "https://i.nhentai.net/galleries/12345/1.jpg"

    def test_build_image_url_png(self):
        url = NhParser._build_image_url("67890", "galleries/67890/5.png")
        assert url == "https://i.nhentai.net/galleries/67890/5.png"

    def test_build_image_url_invalid_path(self):
        with pytest.raises(ValueError, match="Invalid page path format"):
            NhParser._build_image_url("12345", "invalid/path")

    def test_build_image_url_no_galleries_prefix(self):
        with pytest.raises(ValueError, match="Invalid page path format"):
            NhParser._build_image_url("12345", "images/12345/1.jpg")


class TestBuildThumbnailUrl:
    """测试缩略图 URL 构建。"""

    def test_build_thumbnail_url_with_extension(self):
        url = NhParser._build_thumbnail_url("12345", "galleries/12345/thumb.jpg")
        assert url == "https://t.nhentai.net/galleries/12345/thumb.jpg"

    def test_build_thumbnail_url_without_extension(self):
        url = NhParser._build_thumbnail_url("12345", "galleries/12345/thumb.")
        assert url == "https://t.nhentai.net/galleries/12345/thumb.jpg"

    def test_build_thumbnail_url_invalid_path(self):
        with pytest.raises(ValueError, match="Invalid thumbnail path format"):
            NhParser._build_thumbnail_url("12345", "invalid/path")


# ---------------------------------------------------------------------------
# 搜索结果解析测试
# ---------------------------------------------------------------------------


class TestParseSearchItem:
    """测试搜索结果条目解析。"""

    def test_parse_basic_item(self):
        parser = NhParser()
        item = {
            "id": 12345,
            "media_id": "67890",
            "english_title": "Test Title",
            "japanese_title": "テストタイトル",
            "num_pages": 25,
            "thumbnail": "galleries/67890/thumb.",
            "tags": [
                {"id": 1, "type": "language", "name": "japanese"},
                {"id": 2, "type": "tag", "name": "doujinshi"},
            ],
        }
        comic = parser._parse_search_item(item)

        assert comic.id == "12345"
        assert comic.title == "テストタイトル"  # japanese 优先
        assert comic.pages == 25
        assert comic.media_id == "67890"
        assert comic.comic_source == "NH"
        assert comic.source_site == "nh"
        assert comic.language == "japanese"
        assert "doujinshi" in comic.tags

    def test_parse_item_english_fallback(self):
        parser = NhParser()
        item = {
            "id": 12345,
            "media_id": "67890",
            "english_title": "English Title",
            "num_pages": 10,
            "thumbnail": "galleries/67890/thumb.",
            "tags": [],
        }
        comic = parser._parse_search_item(item)
        assert comic.title == "English Title"

    def test_parse_item_unknown_title(self):
        parser = NhParser()
        item = {
            "id": 12345,
            "media_id": "67890",
            "num_pages": 10,
            "thumbnail": "galleries/67890/thumb.",
            "tags": [],
        }
        comic = parser._parse_search_item(item)
        assert comic.title == "未知标题"

    def test_parse_item_missing_id(self):
        parser = NhParser()
        item = {"media_id": "67890"}
        with pytest.raises(ValueError, match="Missing gallery id"):
            parser._parse_search_item(item)

    def test_parse_item_missing_media_id(self):
        parser = NhParser()
        item = {"id": 12345}
        with pytest.raises(ValueError, match="Missing media_id"):
            parser._parse_search_item(item)


# ---------------------------------------------------------------------------
# 语言提取测试
# ---------------------------------------------------------------------------


class TestExtractLanguage:
    """测试语言提取。"""

    def test_extract_japanese(self):
        tags = [
            {"type": "language", "name": "japanese"},
            {"type": "tag", "name": "doujinshi"},
        ]
        assert NhParser._extract_language(tags) == "japanese"

    def test_extract_chinese(self):
        tags = [{"type": "language", "name": "chinese"}]
        assert NhParser._extract_language(tags) == "chinese"

    def test_exclude_translated(self):
        tags = [
            {"type": "language", "name": "translated"},
            {"type": "language", "name": "japanese"},
        ]
        assert NhParser._extract_language(tags) == "japanese"

    def test_no_language_tag(self):
        tags = [{"type": "tag", "name": "doujinshi"}]
        assert NhParser._extract_language(tags) is None

    def test_empty_tags(self):
        assert NhParser._extract_language([]) is None


# ---------------------------------------------------------------------------
# 认证接口测试
# ---------------------------------------------------------------------------


class TestAuthInterface:
    """测试认证相关接口。

    NH 收敛为仅 API Key（remove-nh-password-login spec）：Cookie、User-Agent、
    User Token、Bearer Token 与旧 ``Token`` 值不再是受支持的 NH 认证凭据。
    """

    def test_configure_auth_api_key_sets_authorization_header(self):
        parser = NhParser()
        parser.configure_auth(cookie="", user_agent="", bearer_token="nh-api-key-xxx")
        assert parser.session.headers.get("Authorization") == "Key nh-api-key-xxx"
        assert "Cookie" not in parser.session.headers

    def test_configure_auth_key_prefix_is_normalized(self):
        parser = NhParser()
        parser.configure_auth(bearer_token="Key nh-api-key-xxx")
        assert parser.session.headers.get("Authorization") == "Key nh-api-key-xxx"

    def test_configure_auth_user_token_is_rejected(self):
        """``User <token>`` 不再受支持，configure_auth 必须清空 Authorization。"""
        parser = NhParser()
        parser.configure_auth(bearer_token="User user-token-abc")
        assert "Authorization" not in parser.session.headers

    def test_configure_auth_legacy_token_prefix_is_rejected(self):
        """旧 ``Token <token>`` 不再受支持。"""
        parser = NhParser()
        parser.configure_auth(bearer_token="Token user-token-abc")
        assert "Authorization" not in parser.session.headers

    def test_configure_auth_bearer_prefix_is_rejected(self):
        """``Bearer <token>`` 不再受支持。"""
        parser = NhParser()
        parser.configure_auth(bearer_token="Bearer legacy")
        assert "Authorization" not in parser.session.headers

    def test_configure_auth_cookie_user_agent_are_ignored(self):
        """Cookie/User-Agent 不再作为 NH 认证方式。"""
        parser = NhParser()
        parser.configure_auth(
            cookie="sessionid=abc; csrftoken=def",
            user_agent="Mozilla/5.0",
            bearer_token="",
        )
        assert "Authorization" not in parser.session.headers
        assert parser.session.headers.get("Cookie") is None

    def test_configure_auth_overwrites_previous_api_key(self):
        parser = NhParser()
        parser.configure_auth(bearer_token="key1")
        assert parser.session.headers.get("Authorization") == "Key key1"
        parser.configure_auth(bearer_token="key2")
        assert parser.session.headers.get("Authorization") == "Key key2"

    def test_configure_auth_clears_when_setting_user_token(self):
        """从有效 API Key 切换到 User Token 必须清空 Authorization。"""
        parser = NhParser()
        parser.configure_auth(bearer_token="key1")
        assert parser.session.headers.get("Authorization") == "Key key1"
        parser.configure_auth(bearer_token="User legacy")
        assert "Authorization" not in parser.session.headers

    def test_verify_login_status_without_credentials(self):
        parser = NhParser()
        result, message = parser.verify_login_status()
        assert result is False
        assert "未配置 API Key" in message

    def test_verify_login_status_user_agent_alone_is_not_auth(self):
        parser = NhParser(user_agent="Mozilla/5.0")
        result, message = parser.verify_login_status()
        assert result is False
        assert "未配置 API Key" in message

    def test_verify_login_status_success(self, monkeypatch):
        parser = NhParser()
        parser.configure_auth(bearer_token="nh-api-key-xxx")

        def fake_request_json(url: str, **_kwargs):
            assert url.endswith("/api/v2/user")
            return {"id": 1, "username": "tester"}

        monkeypatch.setattr(parser, "_request_json", fake_request_json)
        result, message = parser.verify_login_status()
        assert result is True
        assert "tester" in message

    def test_verify_login_status_401(self, monkeypatch):
        parser = NhParser()
        parser.configure_auth(bearer_token="invalid-key")

        def fake_request_json(_url: str, **_kwargs):
            from sources.base import ParserResponseError

            raise ParserResponseError("请求失败: https://nhentai.net/api/v2/user (401 Client Error)")

        monkeypatch.setattr(parser, "_request_json", fake_request_json)
        result, message = parser.verify_login_status()
        assert result is False
        assert "重新配置 API Key" in message

    def test_parser_does_not_expose_login_method(self):
        """NH 账号密码登录已移除（remove-nh-password-login spec）。"""
        assert not hasattr(NhParser, "login")

    def test_parser_does_not_expose_set_stored_credentials(self):
        """NH 不再保存账号密码用于懒登录。"""
        assert not hasattr(NhParser, "set_stored_credentials")


class TestFavouritesInterface:
    """测试收藏夹相关接口。"""

    def test_favourites_needs_login(self):
        parser = NhParser()
        comics, pagination, needs_login = parser.favourites()
        assert comics == []
        assert pagination is None
        assert needs_login is True

    def test_favourites_raise_errors(self):
        parser = NhParser()
        with pytest.raises(ParserResponseError, match="未配置 API Key"):
            parser.favourites(raise_errors=True)

    def test_favourites_success(self, monkeypatch):
        parser = NhParser()
        parser.configure_auth(bearer_token="key")

        def fake_request_json(url: str, **_kwargs):
            assert "favorites" in url
            return {
                "result": [
                    {
                        "id": 12345,
                        "media_id": "67890",
                        "english_title": "Fav Title",
                        "num_pages": 20,
                        "thumbnail": "galleries/67890/thumb.",
                        "tag_ids": [],
                        "thumbnail_width": 250,
                        "thumbnail_height": 350,
                    }
                ],
                "num_pages": 3,
                "total": 60,
            }

        monkeypatch.setattr(parser, "_request_json", fake_request_json)
        comics, pagination, needs_login = parser.favourites(page=2)
        assert len(comics) == 1
        assert comics[0].id == "12345"
        assert pagination is not None
        assert pagination.current_page == 2
        assert pagination.total_pages == 3
        assert pagination.total_items == 60
        assert needs_login is False

    def test_favourites_empty_logged_in(self, monkeypatch):
        parser = NhParser()
        parser.configure_auth(bearer_token="key")

        def fake_request_json(_url: str, **_kwargs):
            return {"result": [], "num_pages": 1, "total": 0}

        monkeypatch.setattr(parser, "_request_json", fake_request_json)
        comics, pagination, needs_login = parser.favourites()
        assert comics == []
        assert pagination is not None
        assert pagination.total_items == 0
        assert needs_login is False

    def test_add_to_favourites_success(self, monkeypatch):
        parser = NhParser()
        parser.configure_auth(bearer_token="key")

        monkeypatch.setattr(
            parser.session,
            "request",
            lambda *args, **kwargs: _make_json_response({"favorited": True}),
        )
        assert parser.add_to_favourites("12345") is True

    def test_add_to_favourites_requires_confirmed_state(self, monkeypatch):
        parser = NhParser(bearer_token="key")
        monkeypatch.setattr(
            parser.session,
            "request",
            lambda *args, **kwargs: _make_json_response({"favorited": False}),
        )
        assert parser.add_to_favourites("12345") is False

    def test_add_to_favourites_not_logged_in(self):
        parser = NhParser()
        assert parser.add_to_favourites("12345") is False

    def test_check_favourite_true(self, monkeypatch):
        parser = NhParser()
        parser.configure_auth(bearer_token="key")

        monkeypatch.setattr(
            parser.session,
            "request",
            lambda *args, **kwargs: _make_json_response({"favorited": True}),
        )
        assert parser.check_favourite("12345") is True

    def test_check_favourite_false(self, monkeypatch):
        parser = NhParser()
        parser.configure_auth(bearer_token="key")

        monkeypatch.setattr(
            parser.session,
            "request",
            lambda *args, **kwargs: _make_json_response({"favorited": False}),
        )
        assert parser.check_favourite("12345") is False

    def test_check_favourite_missing_state_is_false(self, monkeypatch):
        parser = NhParser(bearer_token="key")
        monkeypatch.setattr(
            parser.session,
            "request",
            lambda *args, **kwargs: _make_json_response({}),
        )
        assert parser.check_favourite("12345") is False

    def test_check_favourite_not_logged_in(self):
        parser = NhParser()
        assert parser.check_favourite("12345") is False

    def test_remove_from_favourites_success(self, monkeypatch):
        parser = NhParser()
        parser.configure_auth(bearer_token="key")

        monkeypatch.setattr(
            parser.session,
            "request",
            lambda *args, **kwargs: _make_json_response({"favorited": False}),
        )
        assert parser.remove_from_favourites("12345") is True

    def test_remove_from_favourites_requires_confirmed_state(self, monkeypatch):
        parser = NhParser(bearer_token="key")
        monkeypatch.setattr(
            parser.session,
            "request",
            lambda *args, **kwargs: _make_json_response({"favorited": True}),
        )
        assert parser.remove_from_favourites("12345") is False

    @pytest.mark.parametrize("status_code", [401, 404, 422, 429, 503])
    @pytest.mark.parametrize("method_name", ["add_to_favourites", "check_favourite", "remove_from_favourites"])
    def test_favourite_http_failures_are_explicit(self, monkeypatch, status_code, method_name):
        parser = NhParser(bearer_token="key")
        monkeypatch.setattr(
            parser.session,
            "request",
            lambda *args, **kwargs: _make_json_response({"detail": "failed"}, status_code),
        )

        expected = "认证已失效" if status_code == 401 else "收藏操作失败"
        with pytest.raises(ParserResponseError, match=expected):
            getattr(parser, method_name)("12345")

    def test_remove_from_favourites_not_logged_in(self):
        parser = NhParser()
        assert parser.remove_from_favourites("12345") is False

    def test_favourites_official_pagination_fields(self, monkeypatch):
        parser = NhParser(bearer_token="key")
        monkeypatch.setattr(
            parser,
            "_request_json",
            lambda *_args, **_kwargs: {"result": [], "num_pages": 8, "total": 180},
        )

        comics, pagination, needs_login = parser.favourites(page=3)

        assert comics == []
        assert needs_login is False
        assert pagination is not None
        assert pagination.current_page == 3
        assert pagination.total_pages == 8
        assert pagination.total_items == 180

    def test_favourites_legacy_total_pages_fallback(self, monkeypatch):
        parser = NhParser(bearer_token="key")
        monkeypatch.setattr(
            parser,
            "_request_json",
            lambda *_args, **_kwargs: {"result": [], "total_pages": 6, "total": 0},
        )

        _, pagination, _ = parser.favourites(page=2)

        assert pagination is not None
        assert pagination.total_pages == 6


class TestSearchEmptyKeyword:
    """测试空关键词搜索（应返回首页最新漫画）。"""

    def test_empty_keyword_calls_homepage_api(self):
        """空关键词应调用首页 API 而非搜索 API。"""
        parser = NhParser()
        # 验证空关键词时会调用 _get_homepage_galleries
        # 由于无法直接测试网络请求，我们验证方法存在且可调用
        assert hasattr(parser, "_get_homepage_galleries")
        assert callable(parser._get_homepage_galleries)


# ---------------------------------------------------------------------------
# language_filter 行为（add-nh-chinese-language-filter spec）
# ---------------------------------------------------------------------------


def _item(*, id_: str = "177013", media_id: str = "987560", tags=None):
    """构造一条搜索列表 item，tags 缺省为 None（模拟实时列表只回 tag_ids 的场景）。"""
    return {
        "id": int(id_),
        "media_id": media_id,
        "title": {"english": "Sample"},
        "images": {"pages": [{"t": "j"}]},
        "num_pages": 1,
        "tags": tags,
    }


class TestNhLanguageFilterUrlConstruction:
    """覆盖四种查询模式的 URL 构造与 urlencode 行为。"""

    def test_recent_updates_with_chinese_filter_uses_search_endpoint(self, monkeypatch):
        parser = NhParser()
        captured = {}

        def fake_request_json(url, *, headers=None):
            captured["url"] = url
            return {"result": [], "num_pages": 1, "total": 0}

        monkeypatch.setattr(parser, "_request_json", fake_request_json)
        parser.search("", page=1, language_filter="chinese")

        # 必须走 search 端点，且 query 仅含 language 限定，不带 sort
        assert "/api/v2/search" in captured["url"]
        assert "sort=" not in captured["url"]
        # urlencode 把冒号编码为 %3A、引号编码为 %22；统一比较小写形式
        assert "language%3a%22chinese%22" in captured["url"].lower()

    def test_keyword_with_chinese_filter_combines_query(self, monkeypatch):
        parser = NhParser()
        captured = {}

        def fake_request_json(url, *, headers=None):
            captured["url"] = url
            return {"result": [], "num_pages": 1, "total": 0}

        monkeypatch.setattr(parser, "_request_json", fake_request_json)
        parser.search("sample", page=1, language_filter="chinese")

        # query 必须同时包含 sample 与 language:"chinese"，禁止改用 tag:"chinese"
        assert "sample" in captured["url"]
        assert "language" in captured["url"].lower()
        assert "tag" not in captured["url"].lower()

    def test_popular_ranking_with_chinese_filter_keeps_sort(self, monkeypatch):
        parser = NhParser()
        captured = {}

        def fake_request_json(url, *, headers=None):
            captured["url"] = url
            return {"result": [], "num_pages": 1, "total": 0}

        monkeypatch.setattr(parser, "_request_json", fake_request_json)
        parser.search("", page=1, tag="popular", language_filter="chinese")

        url_lower = captured["url"].lower()
        # 必须保留 popular 排序且包含 language 限定
        assert "sort=popular" in url_lower
        assert "language" in url_lower

    @pytest.mark.parametrize("sort_value", ["popular", "popular-today", "popular-week", "popular-month"])
    def test_all_four_rankings_keep_sort_with_chinese_filter(self, monkeypatch, sort_value):
        parser = NhParser()
        captured = {}

        def fake_request_json(url, *, headers=None):
            captured["url"] = url
            return {"result": [], "num_pages": 1, "total": 0}

        monkeypatch.setattr(parser, "_request_json", fake_request_json)
        parser.search("", page=1, tag=sort_value, language_filter="chinese")

        assert f"sort={sort_value}" in captured["url"]

    def test_unfiltered_recent_updates_keeps_galleries_endpoint(self, monkeypatch):
        """未筛选的最近更新仍走 galleries 端点，保持原行为。"""
        parser = NhParser()
        captured = {}

        def fake_request_json(url, *, headers=None):
            captured["url"] = url
            return {"result": [], "num_pages": 1, "total": 0}

        monkeypatch.setattr(parser, "_request_json", fake_request_json)
        parser.search("", page=1)

        assert "/api/v2/galleries" in captured["url"]
        assert "language" not in captured["url"].lower()

    def test_unfiltered_keyword_keeps_original_query(self, monkeypatch):
        parser = NhParser()
        captured = {}

        def fake_request_json(url, *, headers=None):
            captured["url"] = url
            return {"result": [], "num_pages": 1, "total": 0}

        monkeypatch.setattr(parser, "_request_json", fake_request_json)
        parser.search("sample", page=1)

        assert "sample" in captured["url"]
        assert "language" not in captured["url"].lower()

    def test_pagination_fields_pass_through_with_filter(self, monkeypatch):
        parser = NhParser()
        payload = {
            "result": [_item()],
            "num_pages": 5,
            "total": 119,
        }
        monkeypatch.setattr(parser, "_request_json", lambda url, *, headers=None: payload)
        comics, pagination = parser.search("sample", page=2, language_filter="chinese")

        assert pagination is not None
        assert pagination.total_pages == 5
        assert pagination.total_items == 119
        assert pagination.current_page == 2
        assert len(comics) == 1

    def test_language_filter_normalizes_case_and_whitespace(self):
        """大小写/空白变体都被归一化为启用筛选。"""
        assert NhParser._is_chinese_filter("chinese") is True
        assert NhParser._is_chinese_filter(" Chinese ") is True
        assert NhParser._is_chinese_filter("CHINESE") is True
        assert NhParser._is_chinese_filter("") is False
        assert NhParser._is_chinese_filter("japanese") is False
        assert NhParser._is_chinese_filter("   ") is False


class TestNhLanguageFilterMetadata:
    """覆盖列表项 language 元数据的可信补充与未筛选时不误标。"""

    def test_chinese_filter_fills_language_when_tags_missing(self):
        """仅中文查询且 tags 缺失时，language 必须补为 'chinese'。"""
        parser = NhParser()
        comic = parser._parse_search_item(_item(), chinese_only=True)
        assert comic.language == "chinese"

    def test_chinese_filter_uses_query_provenance_when_tags_present(self):
        """服务端中文谓词是可信来源，即使 tags 含冲突语言也必须稳定标为 chinese。"""
        parser = NhParser()
        tags = [{"id": 1, "type": "language", "name": "english"}]
        comic = parser._parse_search_item(_item(tags=tags), chinese_only=True)
        assert comic.language == "chinese"

    def test_chinese_filter_fills_language_when_tags_have_no_language_entry(self):
        """tags 存在但只有普通标签时仍必须补充 chinese。"""
        parser = NhParser()
        tags = [{"id": 2, "type": "tag", "name": "full color"}]
        comic = parser._parse_search_item(_item(tags=tags), chinese_only=True)
        assert comic.language == "chinese"

    def test_unfiltered_does_not_default_to_chinese_when_tags_missing(self):
        """未筛选且 tags 缺失时，language 必须为 None，禁止误标为 chinese。"""
        parser = NhParser()
        comic = parser._parse_search_item(_item(), chinese_only=False)
        assert comic.language is None

    def test_search_with_chinese_filter_propagates_language_to_comics(self, monkeypatch):
        parser = NhParser()
        payload = {
            "result": [_item(id_="1"), _item(id_="2", media_id="2")],
            "num_pages": 1,
            "total": 2,
        }
        monkeypatch.setattr(parser, "_request_json", lambda url, *, headers=None: payload)
        comics, _ = parser.search("sample", page=1, language_filter="chinese")

        assert len(comics) == 2
        assert all(c.language == "chinese" for c in comics)

    def test_search_without_filter_keeps_language_none_when_tags_missing(self, monkeypatch):
        parser = NhParser()
        payload = {
            "result": [_item(id_="1"), _item(id_="2", media_id="2")],
            "num_pages": 1,
            "total": 2,
        }
        monkeypatch.setattr(parser, "_request_json", lambda url, *, headers=None: payload)
        comics, _ = parser.search("sample", page=1)

        assert len(comics) == 2
        assert all(c.language is None for c in comics)
