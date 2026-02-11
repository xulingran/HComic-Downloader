"""测试 parser.py 页面解析功能"""
import pytest
from parser import HComicParser
from models import ComicInfo, PaginationInfo


class TestHComicParser:
    def test_extract_payload_data_success(self, parser):
        html = 'data: [null, {"data": {"comics": [], "pages": {"pages": 1, "total": 0}}}], form:'
        result = parser._extract_payload_data(html)
        assert "comics" in result
        assert result["comics"] == []

    def test_extract_payload_data_missing(self, parser):
        html = "<html><body>No data here</body></html>"
        with pytest.raises(ValueError, match="h-comic payload not found"):
            parser._extract_payload_data(html)

    def test_extract_payload_data_missing_data_key(self, parser):
        html = 'data: [null, {"something": {}}], form:'
        with pytest.raises(ValueError, match="h-comic payload missing `data` object"):
            parser._extract_payload_data(html)

    def test_jsobj_to_dict_with_unquoted_keys(self, parser):
        js_text = '{id: 123, name: "test", nested: {key: "value", num: 42}}'
        result = parser._jsobj_to_dict(js_text)
        assert result == {"id": 123, "name": "test", "nested": {"key": "value", "num": 42}}

    def test_jsobj_to_dict_preserves_strings_with_colon(self, parser):
        js_text = '{url: "http://example.com", time: "12:30"}'
        result = parser._jsobj_to_dict(js_text)
        assert result["url"] == "http://example.com"
        assert result["time"] == "12:30"

    def test_quote_unquoted_js_keys(self, parser):
        js_text = '{id: 123, name: "test", _private: true}'
        result = parser._quote_unquoted_js_keys(js_text)
        assert '"id": 123' in result
        assert '"name": "test"' in result
        assert '"_private": true' in result

    def test_parse_comic_item_full_data(self, parser):
        data = {
            "id": "12345",
            "media_id": "abcde",
            "comic_source": "MMCG_SHORT",
            "title": {"display": "测试标题", "japanese": "テスト", "english": "Test"},
            "num_pages": 20,
            "tags": [
                {"type": "artist", "name": "作者A"},
                {"type": "category", "name_zh": "分类B"},
                {"type": "tag", "name": "标签C"},
                {"type": "tag", "name_zh": "中文标签"}
            ],
            "upload_date": 1704067200
        }
        comic = parser._parse_comic_item(data)
        assert comic.id == "12345"
        assert comic.title == "测试标题"
        assert comic.author == "作者A"
        assert comic.pages == 20
        assert comic.category == "分类B"
        assert "标签C" in comic.tags
        assert "中文标签" in comic.tags
        assert comic.publish_date == "2024-01-01"

    def test_parse_comic_item_minimal_data(self, parser):
        data = {"id": "999", "media_id": "minimal", "comic_source": "MMCG_LONG", "title": {}, "num_pages": 0, "tags": []}
        comic = parser._parse_comic_item(data)
        assert comic.id == "999"
        assert comic.title == "未知标题"
        assert comic.author is None
        assert comic.pages == 0

    def test_parse_pagination_info(self, parser):
        data = {"pages": {"pages": 5, "total": 48, "limit": 10}}
        pagination = parser._parse_pagination_info(data, requested_page=3)
        assert pagination.current_page == 3
        assert pagination.total_pages == 5
        assert pagination.total_items == 48
        assert pagination.limit == 10

    def test_parse_pagination_info_clamps_page(self, parser):
        data = {"pages": {"pages": 3, "total": 25, "limit": 10}}
        pagination = parser._parse_pagination_info(data, requested_page=10)
        assert pagination.current_page == 3

    def test_build_search_url(self):
        assert HComicParser._build_search_url("keyword") == "https://h-comic.com/?q=keyword"
        assert HComicParser._build_search_url("关键词", 2) == "https://h-comic.com/?q=%E5%85%B3%E9%94%AE%E8%AF%8D&page=2"

    def test_build_favourites_url(self):
        assert HComicParser._build_favourites_url() == "https://h-comic.com/favourites"
        assert HComicParser._build_favourites_url(3) == "https://h-comic.com/favourites?page=3"

    def test_build_cover_url(self):
        assert HComicParser._build_cover_url({"media_id": "abc123", "comic_source": "MMCG_SHORT"}) == "https://h-comic.link/api/mms/abc123"
        assert HComicParser._build_cover_url({"media_id": "xyz789", "comic_source": "MMCG_LONG"}) == "https://h-comic.link/api/mml/xyz789"
        assert HComicParser._build_cover_url({"media_id": "def456", "comic_source": "UNKNOWN"}) == "https://h-comic.link/api/nh/def456"

    def test_build_cover_url_no_media_id(self):
        assert HComicParser._build_cover_url({"comic_source": "MMCG_SHORT"}) is None

    def test_format_public_date(self):
        ts = 1704067200
        assert HComicParser._format_public_date(ts) == "2024-01-01"
        assert HComicParser._format_public_date(None) is None
        assert HComicParser._format_public_date("invalid") is None
