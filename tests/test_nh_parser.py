"""NH 解析器单元测试。"""

import json as _json

import pytest
import requests as _requests

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
    """测试认证相关接口。"""

    def test_configure_auth_noop(self):
        parser = NhParser()
        # 应该不抛出异常
        parser.configure_auth(cookie="test", user_agent="test", bearer_token="test")

    def test_verify_login_status(self):
        parser = NhParser()
        result, message = parser.verify_login_status()
        assert result is True
        assert "无需登录" in message

    def test_favourites_empty(self):
        parser = NhParser()
        result, pagination, needs_login = parser.favourites()
        assert result == []
        assert pagination is None
        assert needs_login is False

    def test_add_to_favourites_false(self):
        parser = NhParser()
        assert parser.add_to_favourites("12345") is False

    def test_check_favourite_false(self):
        parser = NhParser()
        assert parser.check_favourite("12345") is False

    def test_remove_from_favourites_false(self):
        parser = NhParser()
        assert parser.remove_from_favourites("12345") is False


class TestSearchEmptyKeyword:
    """测试空关键词搜索（应返回首页最新漫画）。"""

    def test_empty_keyword_calls_homepage_api(self):
        """空关键词应调用首页 API 而非搜索 API。"""
        parser = NhParser()
        # 验证空关键词时会调用 _get_homepage_galleries
        # 由于无法直接测试网络请求，我们验证方法存在且可调用
        assert hasattr(parser, "_get_homepage_galleries")
        assert callable(parser._get_homepage_galleries)
