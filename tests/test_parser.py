"""测试 parser.py 页面解析功能"""

import pytest
import requests

from models import ComicInfo
from sources.hcomic import HComicParser
from sources.hcomic.parser import ParserResponseError


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
        assert result == {
            "id": 123,
            "name": "test",
            "nested": {"key": "value", "num": 42},
        }

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
                {"type": "tag", "name_zh": "中文标签"},
            ],
            "upload_date": 1704067200,
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
        data = {
            "id": "999",
            "media_id": "minimal",
            "comic_source": "MMCG_LONG",
            "title": {},
            "num_pages": 0,
            "tags": [],
        }
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
        assert (
            HComicParser._build_search_url("关键词", 2) == "https://h-comic.com/?q=%E5%85%B3%E9%94%AE%E8%AF%8D&page=2"
        )

    def test_build_favourites_url(self):
        assert HComicParser._build_favourites_url() == "https://h-comic.com/favourites"
        assert HComicParser._build_favourites_url(3) == "https://h-comic.com/favourites?page=3"

    def test_build_cover_url(self):
        assert (
            HComicParser._build_cover_url({"media_id": "abc123", "comic_source": "MMCG_SHORT"})
            == "https://h-comic.link/api/mms/abc123"
        )
        assert (
            HComicParser._build_cover_url({"media_id": "xyz789", "comic_source": "MMCG_LONG"})
            == "https://h-comic.link/api/mml/xyz789"
        )
        assert (
            HComicParser._build_cover_url({"media_id": "def456", "comic_source": "UNKNOWN"})
            == "https://h-comic.link/api/nh/def456"
        )

    def test_build_cover_url_no_media_id(self):
        assert HComicParser._build_cover_url({"comic_source": "MMCG_SHORT"}) is None

    def test_format_public_date(self):
        ts = 1704067200
        assert HComicParser._format_public_date(ts) == "2024-01-01"
        assert HComicParser._format_public_date(None) is None
        assert HComicParser._format_public_date("invalid") is None


class TestHComicParserNetworkMethods:
    """测试涉及网络请求的方法（使用 mock）"""

    def test_search_success(self, parser, monkeypatch):
        """测试搜索成功"""

        mock_response = requests.Response()
        mock_response._content = b'data: [null, {"data": {"comics": [{"id": "1", "media_id": "m1", "comic_source": "NH", "title": {"display": "Test"}, "num_pages": 10, "tags": [], "upload_date": 1704067200}], "pages": {"pages": 1, "total": 1, "limit": 10}}}], form:'
        mock_response.status_code = 200
        mock_response.encoding = "utf-8"

        def mock_get(*args, **kwargs):
            return mock_response

        monkeypatch.setattr(parser.session, "get", mock_get)

        comics, pagination = parser.search("test keyword")
        assert len(comics) == 1
        assert comics[0].id == "1"
        assert pagination.total_pages == 1

    def test_search_empty_result(self, parser, monkeypatch):
        """测试搜索无结果"""

        mock_response = requests.Response()
        mock_response._content = (
            b'data: [null, {"data": {"comics": [], "pages": {"pages": 1, "total": 0, "limit": 10}}}], form:'
        )
        mock_response.status_code = 200
        mock_response.encoding = "utf-8"

        def mock_get(*args, **kwargs):
            return mock_response

        monkeypatch.setattr(parser.session, "get", mock_get)

        comics, pagination = parser.search("nonexistent")
        assert len(comics) == 0
        assert pagination.total_items == 0

    def test_search_network_error(self, parser, monkeypatch):
        """测试搜索网络错误"""

        def mock_get(*args, **kwargs):
            raise requests.RequestException("Network error")

        monkeypatch.setattr(parser.session, "get", mock_get)

        comics, pagination = parser.search("test")
        assert comics == []
        assert pagination is None

    def test_favourites_success(self, parser, monkeypatch):
        """测试获取收藏夹成功"""
        import requests

        mock_response = requests.Response()
        mock_response._content = b'data: [null, {"data": {"favourites": {"docs": [{"comic": {"id": "1", "media_id": "m1", "comic_source": "NH", "title": {"display": "Fav"}, "num_pages": 5, "tags": [], "upload_date": 1704067200}}], "pages": 2, "total": 15, "limit": 10}}}], form:'
        mock_response.status_code = 200
        mock_response.encoding = "utf-8"

        def mock_get(*args, **kwargs):
            return mock_response

        monkeypatch.setattr(parser.session, "get", mock_get)

        comics, pagination, need_login = parser.favourites()
        assert len(comics) == 1
        assert pagination.total_pages == 2
        assert not need_login

    def test_favourites_need_login(self, parser, monkeypatch):
        """测试收藏夹需要登录"""
        import requests

        mock_response = requests.Response()
        mock_response._content = b'data: [null, {"data": {"favourites": null}}], form:'
        mock_response.status_code = 200
        mock_response.encoding = "utf-8"

        def mock_get(*args, **kwargs):
            return mock_response

        monkeypatch.setattr(parser.session, "get", mock_get)

        comics, pagination, need_login = parser.favourites()
        assert len(comics) == 0
        assert need_login

    def test_get_comic_detail_success(self, parser, monkeypatch):
        """测试获取漫画详情成功"""
        import requests

        mock_response = requests.Response()
        mock_response._content = b'data: [null, {"data": {"comic": {"id": "123", "media_id": "abc", "comic_source": "NH", "title": {"display": "Detail"}, "num_pages": 20, "tags": [], "upload_date": 1704067200}}}], form:'
        mock_response.status_code = 200
        mock_response.encoding = "utf-8"

        def mock_get(*args, **kwargs):
            return mock_response

        monkeypatch.setattr(parser.session, "get", mock_get)

        comic = parser.get_comic_detail("123")
        assert comic is not None
        assert comic.id == "123"
        assert comic.title == "Detail"

    def test_get_comic_detail_not_found(self, parser, monkeypatch):
        """测试获取漫画详情失败"""
        import requests

        def mock_get(*args, **kwargs):
            raise requests.RequestException("404")

        monkeypatch.setattr(parser.session, "get", mock_get)

        comic = parser.get_comic_detail("999")
        assert comic is None

    def test_favourites_network_error(self, parser, monkeypatch):
        """测试获取收藏夹网络错误"""
        import requests

        def mock_get(*args, **kwargs):
            raise requests.RequestException("Network error")

        monkeypatch.setattr(parser.session, "get", mock_get)

        comics, pagination, need_login = parser.favourites()
        assert comics == []
        assert pagination is None
        assert need_login is False


class TestHComicParserParseMethods:
    """测试页面解析方法"""

    def test_parse_search_page_with_results(self, parser):
        """测试解析有结果的搜索页面"""
        html = 'data: [null, {"data": {"comics": [{"id": "1", "media_id": "m1", "comic_source": "NH", "title": {"display": "Test"}, "num_pages": 10, "tags": [], "upload_date": 1704067200}], "pages": {"pages": 3, "total": 25, "limit": 10}}}], form:'
        comics, pagination = parser.parse_search_page(html, requested_page=2)
        assert len(comics) == 1
        assert pagination.current_page == 2
        assert pagination.total_pages == 3

    def test_parse_search_page_invalid_payload(self, parser):
        """测试解析无效的搜索页面"""
        html = "invalid html without payload"
        comics, pagination = parser.parse_search_page(html, requested_page=1)
        assert comics == []
        assert pagination is None

    def test_parse_favourites_page_with_results(self, parser):
        """测试解析有结果的收藏夹页面"""
        html = 'data: [null, {"data": {"favourites": {"docs": [{"comic": {"id": "1", "media_id": "m1", "comic_source": "NH", "title": {"display": "Fav"}, "num_pages": 5, "tags": [], "upload_date": 1704067200}}], "pages": 2, "total": 15, "limit": 10}}}], form:'
        comics, pagination, need_login = parser.parse_favourites_page(html, requested_page=1)
        assert len(comics) == 1
        assert not need_login

    def test_parse_favourites_page_invalid_items(self, parser):
        """测试解析收藏夹页面时跳过无效项"""
        html = 'data: [null, {"data": {"favourites": {"docs": [{"invalid": "item"}, {"comic": null}, {"comic": {"id": "1", "media_id": "m1", "comic_source": "NH", "title": {"display": "Valid"}, "num_pages": 5, "tags": [], "upload_date": 1704067200}}], "pages": 1, "total": 1, "limit": 10}}}], form:'
        comics, pagination, need_login = parser.parse_favourites_page(html, requested_page=1)
        assert len(comics) == 1  # 只有有效的那个
        assert comics[0].title == "Valid"

    def test_parse_comic_detail_page(self, parser):
        """测试解析漫画详情页"""
        html = 'data: [null, {"data": {"comic": {"id": "123", "media_id": "abc", "comic_source": "NH", "title": {"display": "Detail Comic"}, "num_pages": 30, "tags": [{"type": "artist", "name": "Artist"}], "upload_date": 1704067200}}}], form:'
        comic = parser.parse_comic_detail(html)
        assert comic.id == "123"
        assert comic.title == "Detail Comic"
        assert comic.author == "Artist"

    def test_parse_comic_detail_missing_comic(self, parser):
        """测试解析缺少 comic 字段的详情页"""
        html = 'data: [null, {"data": {"other": "data"}}], form:'
        with pytest.raises(ValueError, match="Comic payload missing"):
            parser.parse_comic_detail(html)


class TestHComicParserAdditionalCoverage:
    """补充测试以达到更高覆盖率"""

    def test_verify_login_status_success(self, parser, monkeypatch):
        """测试登录验证成功 — 收藏夹接口返回完整数据"""
        monkeypatch.setattr(
            parser,
            "_request_text",
            lambda url: 'data: [null, {"data": {"favourites": {"docs": [], "pages": 1, "total": 0}}}], form:',
        )

        success, msg = parser.verify_login_status()
        assert success is True
        assert "登录校验通过" in msg

    def test_verify_login_status_need_login(self, parser, monkeypatch):
        """测试登录验证失败 — 收藏夹接口返回无效数据"""
        monkeypatch.setattr(
            parser,
            "_request_text",
            lambda url: 'data: [null, {"data": {"other": "no favourites here"}}], form:',
        )

        success, msg = parser.verify_login_status()
        assert success is False
        assert "登录已失效" in msg

    def test_verify_login_status_incomplete_favourites(self, parser, monkeypatch):
        """测试登录验证 — favourites 字段不完整（缺少 key）"""
        monkeypatch.setattr(
            parser,
            "_request_text",
            lambda url: 'data: [null, {"data": {"favourites": {"docs": []}}}], form:',
        )

        success, msg = parser.verify_login_status()
        assert success is False
        assert "登录已失效" in msg

    def test_verify_login_status_network_error(self, parser, monkeypatch):
        """测试登录验证网络错误"""
        from sources.hcomic import ParserResponseError

        def mock_request_text(url):
            raise ParserResponseError("Connection failed")

        monkeypatch.setattr(parser, "_request_text", mock_request_text)

        success, msg = parser.verify_login_status()
        assert success is False
        assert "登录已失效" in msg

    def test_get_response_text_with_iso_encoding(self, parser):
        """测试响应文本编码处理 - ISO 编码"""
        import requests

        mock_response = requests.Response()
        mock_response._content = b"test content"
        mock_response.status_code = 200
        mock_response.encoding = "ISO-8859-1"

        result = parser._get_response_text(mock_response)
        assert result == "test content"
        assert mock_response.encoding == "utf-8"

    def test_get_response_text_no_encoding(self, parser):
        """测试响应文本编码处理 - 无编码"""
        import requests

        mock_response = requests.Response()
        mock_response._content = b"test content"
        mock_response.status_code = 200
        mock_response.encoding = None

        result = parser._get_response_text(mock_response)
        assert result == "test content"
        assert mock_response.encoding == "utf-8"

    def test_parse_search_page_comics_not_list(self, parser):
        """测试解析搜索页面时 comics 不是列表"""
        html = 'data: [null, {"data": {"comics": "not_a_list", "pages": {"pages": 1, "total": 0, "limit": 10}}}], form:'
        comics, pagination = parser.parse_search_page(html, requested_page=1)
        assert comics == []
        assert pagination.total_pages == 1

    def test_parse_search_page_invalid_items(self, parser):
        """测试解析搜索页面时跳过无效项"""
        html = 'data: [null, {"data": {"comics": ["not_a_dict", {"id": "1", "media_id": "m1", "comic_source": "NH", "title": {"display": "Valid"}, "num_pages": 5, "tags": [], "upload_date": 1704067200}], "pages": {"pages": 1, "total": 1, "limit": 10}}}], form:'
        comics, pagination = parser.parse_search_page(html, requested_page=1)
        assert len(comics) == 1
        assert comics[0].title == "Valid"

    def test_parse_pagination_info_not_dict(self, parser):
        """测试解析分页信息时 pages 不是字典"""
        data = {"pages": "not_a_dict"}
        pagination = parser._parse_pagination_info(data, requested_page=1)
        assert pagination is None

    def test_parse_favourites_page_not_dict(self, parser):
        """测试解析收藏夹页面时 favourites 不是字典"""
        html = 'data: [null, {"data": {"favourites": "not_a_dict"}}], form:'
        comics, pagination, need_login = parser.parse_favourites_page(html, requested_page=1)
        assert len(comics) == 0
        assert need_login is True

    def test_parse_favourites_page_missing_keys(self, parser):
        """测试解析收藏夹页面时缺少必要字段"""
        html = 'data: [null, {"data": {"favourites": {"docs": []}}}], form:'
        comics, pagination, need_login = parser.parse_favourites_page(html, requested_page=1)
        assert len(comics) == 0
        assert need_login is True

    def test_parse_favourites_page_docs_not_list(self, parser):
        """测试解析收藏夹页面时 docs 不是列表"""
        html = (
            'data: [null, {"data": {"favourites": {"docs": "not_a_list", "pages": 1, "total": 0, "limit": 10}}}], form:'
        )
        comics, pagination, need_login = parser.parse_favourites_page(html, requested_page=1)
        assert len(comics) == 0
        assert need_login is True

    def test_parse_favourites_page_invalid_page_values(self, parser):
        """测试解析收藏夹页面时页面值为无效类型"""
        html = 'data: [null, {"data": {"favourites": {"docs": [], "pages": "invalid", "total": "invalid", "limit": "invalid"}}}], form:'
        comics, pagination, need_login = parser.parse_favourites_page(html, requested_page=1)
        assert len(comics) == 0
        assert not need_login
        assert pagination.total_pages == 1
        assert pagination.total_items == 0
        assert pagination.limit == 10

    def test_quote_unquoted_js_keys_with_nested_quotes(self, parser):
        """测试引号处理 - 嵌套引号"""
        js_text = '{key: "value with \\"quotes\\"", other: 123}'
        result = parser._quote_unquoted_js_keys(js_text)
        assert '"key":' in result
        assert '"other":' in result

    def test_quote_unquoted_js_keys_empty_string(self, parser):
        """测试引号处理 - 空字符串"""
        js_text = ""
        result = parser._quote_unquoted_js_keys(js_text)
        assert result == ""

    def test_extract_image_urls(self, parser):
        """测试提取图片 URL"""
        comic = ComicInfo(
            id="123",
            title="Test",
            author="Author",
            pages=3,
            category="Test",
            tags=[],
            publish_date="2024-01-01",
            cover_url="http://example.com/cover.jpg",
            preview_url="http://example.com/preview",
            media_id="abc123",
            comic_source="NH",
        )
        urls = comic.get_all_image_urls()
        assert len(urls) == 3
        assert all("h-comic.link/api/nh/abc123/pages/" in url for url in urls)


class TestHComicParserEdgeCases:
    """测试边界情况以达到 100% 覆盖率"""

    def test_configure_auth_empty_cookie(self, parser):
        """测试配置认证时传入空 cookie"""
        parser.configure_auth(cookie="", user_agent="")
        assert "Cookie" not in parser.session.headers

    def test_configure_auth_with_cookie(self, parser):
        """测试配置认证时传入有效 cookie"""
        parser.configure_auth(cookie="session=abc123", user_agent="TestAgent")
        assert parser.session.headers["Cookie"] == "session=abc123"
        assert parser.session.headers["User-Agent"] == "TestAgent"

    def test_parse_search_page_json_decode_error(self, parser, monkeypatch):
        """测试搜索页面解析时 JSON 解码错误"""

        def mock_extract(*args, **kwargs):
            import json

            raise json.JSONDecodeError("test", "", 0)

        monkeypatch.setattr(parser, "_extract_payload_data", mock_extract)
        comics, pagination = parser.parse_search_page("invalid", requested_page=1)
        assert comics == []
        assert pagination is None

    def test_parse_search_page_type_error(self, parser, monkeypatch):
        """测试搜索页面解析时类型错误"""

        def mock_extract(*args, **kwargs):
            raise TypeError("test")

        monkeypatch.setattr(parser, "_extract_payload_data", mock_extract)
        comics, pagination = parser.parse_search_page("invalid", requested_page=1)
        assert comics == []
        assert pagination is None

    def test_parse_favourites_page_json_decode_error(self, parser, monkeypatch):
        """测试收藏夹页面解析时 JSON 解码错误"""

        def mock_extract(*args, **kwargs):
            import json

            raise json.JSONDecodeError("test", "", 0)

        monkeypatch.setattr(parser, "_extract_payload_data", mock_extract)
        comics, pagination, need_login = parser.parse_favourites_page("invalid", requested_page=1)
        assert comics == []
        assert pagination is None
        assert need_login is False

    def test_parse_favourites_page_type_error(self, parser, monkeypatch):
        """测试收藏夹页面解析时类型错误"""

        def mock_extract(*args, **kwargs):
            raise TypeError("test")

        monkeypatch.setattr(parser, "_extract_payload_data", mock_extract)
        comics, pagination, need_login = parser.parse_favourites_page("invalid", requested_page=1)
        assert comics == []
        assert pagination is None
        assert need_login is False

    def test_quote_unquoted_js_keys_not_alpha_start(self, parser):
        """测试引号处理 - 键不以字母开头"""
        js_text = '{123: "value", _key: 456}'
        result = parser._quote_unquoted_js_keys(js_text)
        assert '"_key":' in result

    def test_quote_unquoted_js_keys_no_colon(self, parser):
        """测试引号处理 - 没有冒号的情况"""
        js_text = "{key without colon}"
        result = parser._quote_unquoted_js_keys(js_text)
        assert result == "{key without colon}"

    def test_quote_unquoted_js_keys_escape_in_string(self, parser):
        """测试引号处理 - 字符串中的转义"""
        js_text = '{key: "val\\"ue"}'
        result = parser._quote_unquoted_js_keys(js_text)
        assert '"key":' in result

    def test_parse_favourites_page_item_not_dict(self, parser):
        """测试解析收藏夹页面时 item 不是字典"""
        html = 'data: [null, {"data": {"favourites": {"docs": ["not_a_dict"], "pages": 1, "total": 1, "limit": 10}}}], form:'
        comics, pagination, need_login = parser.parse_favourites_page(html, requested_page=1)
        assert len(comics) == 0
        assert not need_login


class TestHComicRandom:
    """测试 random() 方法。"""

    def test_random_success(self, parser, monkeypatch):
        """测试随机漫画成功解析。"""

        mock_response = requests.Response()
        mock_response._content = (
            b'data: [null, {"data": {"comics": ['
            b'{"id": "r1", "media_id": "rm1", "comic_source": "NH", '
            b'"title": {"display": "Random Comic"}, "num_pages": 15, '
            b'"tags": [{"type": "tag", "name": "random_tag"}], "upload_date": 1704067200}'
            b'], "pages": {"pages": 1, "total": 1, "limit": 10}}}], form:'
        )
        mock_response.status_code = 200
        mock_response.encoding = "utf-8"

        monkeypatch.setattr(parser.session, "get", lambda *a, **kw: mock_response)

        comics, pagination = parser.random()

        assert len(comics) == 1
        assert comics[0].title == "Random Comic"
        assert comics[0].pages == 15

    def test_random_network_error(self, parser, monkeypatch):
        """测试随机漫画网络错误返回空列表。"""

        monkeypatch.setattr(
            parser.session,
            "get",
            lambda *a, **kw: (_ for _ in ()).throw(requests.Timeout("t")),
        )

        comics, pagination = parser.random()

        assert comics == []
        assert pagination is None


class TestHComicAuthenticatedRequest:
    """测试 _authenticated_request 的错误处理路径。"""

    def test_authenticated_request_timeout(self, parser, monkeypatch):
        """测试超时异常被正确转换。"""

        monkeypatch.setattr(
            parser.session,
            "request",
            lambda *a, **kw: (_ for _ in ()).throw(requests.Timeout("timeout")),
        )

        with pytest.raises(ParserResponseError, match="请求超时"):
            parser._authenticated_request(
                "POST",
                "https://api.h-comic.com/api/favourites",
                error_prefix="加入收藏夹",
            )

    def test_authenticated_request_auth_error(self, parser, monkeypatch):
        """测试 401 认证失效异常。"""

        resp = requests.Response()
        resp.status_code = 401

        monkeypatch.setattr(
            parser.session,
            "request",
            lambda *a, **kw: (_ for _ in ()).throw(requests.HTTPError(response=resp)),
        )

        with pytest.raises(ParserResponseError, match="认证已失效"):
            parser._authenticated_request(
                "GET",
                "https://api.h-comic.com/api/favourites/123",
                error_prefix="检查收藏",
            )

    def test_authenticated_request_generic_error(self, parser, monkeypatch):
        """测试 500 服务器错误。"""

        resp = requests.Response()
        resp.status_code = 500
        resp._content = b"Internal Server Error"

        monkeypatch.setattr(
            parser.session,
            "request",
            lambda *a, **kw: (_ for _ in ()).throw(requests.HTTPError(response=resp)),
        )

        with pytest.raises(ParserResponseError, match="HTTP 500"):
            parser._authenticated_request(
                "POST",
                "https://api.h-comic.com/api/favourites",
                error_prefix="加入收藏夹",
                log_name="test_add",
            )

    def test_authenticated_request_connection_error(self, parser, monkeypatch):
        """测试连接异常。"""

        monkeypatch.setattr(
            parser.session,
            "request",
            lambda *a, **kw: (_ for _ in ()).throw(requests.ConnectionError("refused")),
        )

        with pytest.raises(ParserResponseError, match="请求失败"):
            parser._authenticated_request(
                "GET",
                "https://api.h-comic.com/api/favourites/123",
                error_prefix="检查收藏",
            )
