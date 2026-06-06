"""Bika 解析器单元测试。"""

import pytest
import requests

from models import ChapterInfo
from sources.bika.parser import BikaParser, ParserResponseError

# ---------------------------------------------------------------------------
# 辅助工具
# ---------------------------------------------------------------------------


def _make_json_response(payload: dict, status_code: int = 200) -> requests.Response:
    """构建一个带有 JSON payload 的真实 requests.Response。"""
    import json

    resp = requests.Response()
    resp.status_code = status_code
    resp._content = json.dumps(payload).encode("utf-8")
    resp.headers["Content-Type"] = "application/json"
    return resp


def _make_http_error(
    status_code: int, payload: dict | None = None
) -> requests.HTTPError:
    """构建带有 status_code 的 HTTPError。"""
    resp = _make_json_response(payload or {}, status_code)
    return requests.HTTPError(response=resp)


# ---------------------------------------------------------------------------
# 签名测试
# ---------------------------------------------------------------------------


class TestBikaSignature:
    """测试 HMAC-SHA256 签名计算。"""

    def test_signature_basic(self):
        url = "comics/advanced-search?page=1"
        timestamp = "1234567890"
        nonce = "4ce7a7aa759b40f794d189a88b84aba8"
        method = "POST"

        signature = BikaParser._get_signature(url, timestamp, nonce, method)

        assert len(signature) == 64
        assert all(c in "0123456789abcdef" for c in signature)

    def test_signature_case_insensitive(self):
        url1 = "comics/advanced-search?page=1"
        url2 = "COMICS/ADVANCED-SEARCH?PAGE=1"
        timestamp = "1234567890"
        nonce = "4ce7a7aa759b40f794d189a88b84aba8"
        method = "POST"

        sig1 = BikaParser._get_signature(url1, timestamp, nonce, method)
        sig2 = BikaParser._get_signature(url2, timestamp, nonce, method)

        assert sig1 == sig2

    def test_signature_different_methods(self):
        url = "comics/123"
        timestamp = "1234567890"
        nonce = "4ce7a7aa759b40f794d189a88b84aba8"

        sig_get = BikaParser._get_signature(url, timestamp, nonce, "GET")
        sig_post = BikaParser._get_signature(url, timestamp, nonce, "POST")

        assert sig_get != sig_post

    def test_signature_different_timestamps(self):
        url = "comics/123"
        nonce = "4ce7a7aa759b40f794d189a88b84aba8"
        method = "GET"

        sig1 = BikaParser._get_signature(url, "1000000000", nonce, method)
        sig2 = BikaParser._get_signature(url, "2000000000", nonce, method)

        assert sig1 != sig2


# ---------------------------------------------------------------------------
# 初始化与认证配置
# ---------------------------------------------------------------------------


class TestBikaParser:
    """测试 BikaParser 基本功能。"""

    def test_init(self):
        parser = BikaParser(timeout=15)
        assert parser.timeout == 15
        assert parser._token == ""

    def test_configure_auth(self):
        parser = BikaParser()
        parser.configure_auth(bearer_token="test_token_123")
        assert parser._token == "test_token_123"

    def test_configure_auth_strips_whitespace(self):
        parser = BikaParser()
        parser.configure_auth(bearer_token="  test_token  ")
        assert parser._token == "test_token"

    def test_verify_login_status_no_token(self):
        parser = BikaParser()
        valid, message = parser.verify_login_status()
        assert valid is False
        assert "未登录" in message


# ---------------------------------------------------------------------------
# 登录流程
# ---------------------------------------------------------------------------


class TestBikaLogin:
    """测试 Bika 登录获取 JWT token 的完整流程。"""

    def test_login_success_sets_token(self, bika_parser, monkeypatch, json_fixture):
        login_payload = json_fixture("bika_login_success.json")
        captured = {}

        def fake_request(method, url, **kwargs):
            captured["method"] = method
            captured["url"] = url
            captured["json"] = kwargs.get("json")
            captured["headers"] = kwargs.get("headers", {})
            return _make_json_response(login_payload)

        monkeypatch.setattr(bika_parser.session, "request", fake_request)

        token = bika_parser.login("user@example.com", "password123")

        assert token == login_payload["data"]["token"]
        assert bika_parser._token == token
        assert captured["method"] == "POST"
        assert "auth/sign-in" in captured["url"]
        assert captured["json"] == {
            "email": "user@example.com",
            "password": "password123",
        }
        # 验证签名 headers 存在
        assert "signature" in captured["headers"]
        assert len(captured["headers"]["signature"]) == 64

    def test_login_failure_no_token_in_response(self, bika_parser, monkeypatch):
        payload = {"code": 401, "message": "Email or password wrong", "data": ""}

        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: _make_json_response(payload),
        )

        with pytest.raises(ParserResponseError, match="登录失败"):
            bika_parser.login("bad@example.com", "wrong")

    def test_login_failure_empty_data(self, bika_parser, monkeypatch):
        payload = {"code": 200, "data": {}}

        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: _make_json_response(payload),
        )

        with pytest.raises(ParserResponseError, match="登录失败"):
            bika_parser.login("user@example.com", "password")

    def test_login_network_timeout(self, bika_parser, monkeypatch):
        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: (_ for _ in ()).throw(requests.Timeout("timed out")),
        )

        with pytest.raises(ParserResponseError, match="请求超时"):
            bika_parser.login("user@example.com", "password")

    def test_login_connection_error(self, bika_parser, monkeypatch):
        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: (_ for _ in ()).throw(
                requests.ConnectionError("conn refused")
            ),
        )

        with pytest.raises(ParserResponseError, match="连接失败"):
            bika_parser.login("user@example.com", "password")


# ---------------------------------------------------------------------------
# _request 错误路径
# ---------------------------------------------------------------------------


class TestBikaRequest:
    """测试 _request 的签名注入和各种错误处理。"""

    def test_request_adds_signature_headers(self, bika_parser, monkeypatch):
        captured = {}

        def fake_request(method, url, **kwargs):
            captured["headers"] = kwargs.get("headers", {})
            return _make_json_response({"code": 200, "data": {}})

        monkeypatch.setattr(bika_parser.session, "request", fake_request)

        bika_parser._request("GET", "comics/123")

        h = captured["headers"]
        assert "signature" in h
        assert len(h["signature"]) == 64
        assert "time" in h
        assert h["time"].isdigit()
        assert "api-key" in h
        assert "nonce" in h

    def test_request_adds_authorization_with_token(self, bika_parser, monkeypatch):
        bika_parser._token = "jwt_token_abc"
        captured = {}

        def fake_request(method, url, **kwargs):
            captured["headers"] = kwargs.get("headers", {})
            return _make_json_response({"code": 200, "data": {}})

        monkeypatch.setattr(bika_parser.session, "request", fake_request)

        bika_parser._request("GET", "users/profile")

        assert captured["headers"].get("authorization") == "jwt_token_abc"

    def test_request_401_raises_auth_error(self, bika_parser, monkeypatch):
        bika_parser._token = "expired_token"

        def fake_request(*a, **kw):
            raise _make_http_error(401)

        monkeypatch.setattr(bika_parser.session, "request", fake_request)

        with pytest.raises(ParserResponseError, match="认证已失效"):
            bika_parser._request("GET", "users/profile")

    def test_request_403_raises_auth_error(self, bika_parser, monkeypatch):
        bika_parser._token = "forbidden_token"

        def fake_request(*a, **kw):
            raise _make_http_error(403)

        monkeypatch.setattr(bika_parser.session, "request", fake_request)

        with pytest.raises(ParserResponseError, match="认证已失效"):
            bika_parser._request("GET", "users/profile")

    def test_request_500_raises_generic_error(self, bika_parser, monkeypatch):
        def fake_request(*a, **kw):
            raise _make_http_error(500)

        monkeypatch.setattr(bika_parser.session, "request", fake_request)

        with pytest.raises(ParserResponseError, match="HTTP 500"):
            bika_parser._request("GET", "comics/123")

    def test_request_timeout(self, bika_parser, monkeypatch):
        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: (_ for _ in ()).throw(requests.Timeout("timeout")),
        )

        with pytest.raises(ParserResponseError, match="请求超时"):
            bika_parser._request("GET", "comics/123")

    def test_request_connection_error(self, bika_parser, monkeypatch):
        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: (_ for _ in ()).throw(requests.ConnectionError("conn")),
        )

        with pytest.raises(ParserResponseError, match="连接失败"):
            bika_parser._request("GET", "comics/123")

    def test_request_invalid_json(self, bika_parser, monkeypatch):
        resp = requests.Response()
        resp.status_code = 200
        resp._content = b"not json at all"

        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: resp,
        )

        # requests.JSONDecodeError 继承自 RequestException，被通用处理器捕获
        with pytest.raises(ParserResponseError, match="请求失败"):
            bika_parser._request("GET", "comics/123")


# ---------------------------------------------------------------------------
# 搜索
# ---------------------------------------------------------------------------


class TestBikaSearch:
    """测试 Bika 搜索 API 的完整解析流程。"""

    def test_search_parses_comic_list_and_pagination(
        self, bika_parser, monkeypatch, json_fixture
    ):
        payload = json_fixture("bika_search_response.json")

        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: _make_json_response(payload),
        )

        comics, pagination = bika_parser.search("test keyword")

        assert len(comics) == 2

        c1 = comics[0]
        assert c1.id == "5f6a1b2c3d4e5f6a7b8c9d0e"
        assert c1.title == "Test Comic Title"
        assert c1.author == "TestAuthor"
        assert c1.pages == 24
        assert c1.source_site == "bika"
        assert c1.comic_source == "BIKA"
        assert c1.album_total_chapters == 3
        # 封面 URL 应由 fileServer + /static/ + path 拼接
        assert (
            c1.cover_url
            == "https://storage1.picacomic.com/static/tobe/5f6a1b2c/thumb.jpg"
        )
        # categories + tags 去重合并
        assert "Doujinshi" in c1.tags
        assert "School" in c1.tags
        assert "full color" in c1.tags
        assert "Chinese" in c1.tags

        c2 = comics[1]
        # trailing slash 处理
        assert (
            c2.cover_url
            == "https://storage1.picacomic.com/static/tobe/5f6a1b2d/thumb.jpg"
        )

        assert pagination is not None
        assert pagination.current_page == 1
        assert pagination.total_pages == 5
        assert pagination.total_items == 92
        assert pagination.limit == 20

    def test_search_empty_result(self, bika_parser, monkeypatch):
        payload = {
            "code": 200,
            "data": {
                "comics": {
                    "docs": [],
                    "page": 1,
                    "pages": 1,
                    "total": 0,
                    "limit": 20,
                }
            },
        }

        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: _make_json_response(payload),
        )

        comics, pagination = bika_parser.search("nonexistent")
        assert comics == []
        assert pagination is not None
        assert pagination.total_items == 0

    def test_search_network_error_returns_empty(self, bika_parser, monkeypatch):
        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: (_ for _ in ()).throw(requests.Timeout("t")),
        )

        comics, pagination = bika_parser.search("test")
        assert comics == []
        assert pagination is None


# ---------------------------------------------------------------------------
# 漫画详情
# ---------------------------------------------------------------------------


class TestBikaComicDetail:
    """测试 get_comic_detail 获取详情 + 章节的流程。"""

    def test_get_comic_detail_with_chapters(
        self, bika_parser, monkeypatch, json_fixture
    ):
        detail_payload = json_fixture("bika_comic_detail.json")
        chapters_payload = json_fixture("bika_chapters_page1.json")

        def fake_request(method, url, **kwargs):
            if "eps" in url:
                return _make_json_response(chapters_payload)
            return _make_json_response(detail_payload)

        monkeypatch.setattr(bika_parser.session, "request", fake_request)

        comic = bika_parser.get_comic_detail("comic123")

        assert comic is not None
        assert comic.id == "comic123"
        assert comic.title == "Detail Comic"
        assert comic.author == "DetailAuthor"
        assert comic.pages == 30
        assert comic.album_total_chapters == 2
        assert comic.source_site == "bika"
        assert len(comic.chapters) == 3
        assert comic.chapters[0] == ChapterInfo(id="ep001", name="Chapter 1", index=1)
        assert comic.chapters[2] == ChapterInfo(id="ep003", name="Chapter 3", index=3)

    def test_get_comic_detail_returns_none_on_error(self, bika_parser, monkeypatch):
        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: (_ for _ in ()).throw(requests.Timeout("t")),
        )

        assert bika_parser.get_comic_detail("bad_id") is None

    def test_get_comic_detail_empty_comic_data(self, bika_parser, monkeypatch):
        payload = {"code": 200, "data": {"comic": {}}}

        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: _make_json_response(payload),
        )

        assert bika_parser.get_comic_detail("empty_id") is None


# ---------------------------------------------------------------------------
# 章节列表
# ---------------------------------------------------------------------------


class TestBikaChapters:
    """测试 get_chapters 分页获取章节。"""

    def test_get_chapters_single_page(self, bika_parser, monkeypatch, json_fixture):
        payload = json_fixture("bika_chapters_page1.json")

        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: _make_json_response(payload),
        )

        chapters = bika_parser.get_chapters("comic123")

        assert len(chapters) == 3
        assert all(isinstance(c, ChapterInfo) for c in chapters)
        assert chapters[0].id == "ep001"
        assert chapters[0].name == "Chapter 1"
        assert chapters[0].index == 1

    def test_get_chapters_multi_page(self, bika_parser, monkeypatch):
        page1 = {
            "code": 200,
            "data": {
                "eps": {
                    "docs": [
                        {"_id": "ep001", "title": "Ch 1", "order": 1},
                        {"_id": "ep002", "title": "Ch 2", "order": 2},
                    ],
                    "page": 1,
                    "pages": 2,
                    "total": 3,
                    "limit": 2,
                }
            },
        }
        page2 = {
            "code": 200,
            "data": {
                "eps": {
                    "docs": [{"_id": "ep003", "title": "Ch 3", "order": 3}],
                    "page": 2,
                    "pages": 2,
                    "total": 3,
                    "limit": 2,
                }
            },
        }
        call_count = []

        def fake_request(method, url, **kwargs):
            call_count.append(url)
            if "page=2" in url:
                return _make_json_response(page2)
            return _make_json_response(page1)

        monkeypatch.setattr(bika_parser.session, "request", fake_request)

        chapters = bika_parser.get_chapters("comic123")

        assert len(chapters) == 3
        assert chapters[2].id == "ep003"
        assert len(call_count) == 2

    def test_get_chapters_error_returns_empty(self, bika_parser, monkeypatch):
        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: (_ for _ in ()).throw(requests.ConnectionError("c")),
        )

        assert bika_parser.get_chapters("comic123") == []


# ---------------------------------------------------------------------------
# 章节图片
# ---------------------------------------------------------------------------


class TestBikaChapterImages:
    """测试 get_chapter_images URL 构建逻辑。"""

    def test_get_chapter_images_builds_urls(
        self, bika_parser, monkeypatch, json_fixture
    ):
        payload = json_fixture("bika_chapter_images.json")

        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: _make_json_response(payload),
        )

        images = bika_parser.get_chapter_images("comic123", order=1)

        assert len(images) == 2
        # trailing slash fileServer
        assert (
            images[0]
            == "https://storage1.picacomic.com/static/tobe/comic123/ep1/001.jpg"
        )
        # no trailing slash fileServer
        assert (
            images[1]
            == "https://storage1.picacomic.com/static/tobe/comic123/ep1/002.jpg"
        )

    def test_get_chapter_images_multi_page(self, bika_parser, monkeypatch):
        page1 = {
            "code": 200,
            "data": {
                "pages": {
                    "docs": [
                        {
                            "media": {
                                "fileServer": "https://cdn.example",
                                "path": "p1.jpg",
                            }
                        },
                    ],
                    "page": 1,
                    "pages": 2,
                    "total": 2,
                    "limit": 1,
                }
            },
        }
        page2 = {
            "code": 200,
            "data": {
                "pages": {
                    "docs": [
                        {
                            "media": {
                                "fileServer": "https://cdn.example",
                                "path": "p2.jpg",
                            }
                        },
                    ],
                    "page": 2,
                    "pages": 2,
                    "total": 2,
                    "limit": 1,
                }
            },
        }

        def fake_request(method, url, **kwargs):
            if "page=2" in url:
                return _make_json_response(page2)
            return _make_json_response(page1)

        monkeypatch.setattr(bika_parser.session, "request", fake_request)

        images = bika_parser.get_chapter_images("comic123", order=1)

        assert len(images) == 2
        assert images[0] == "https://cdn.example/static/p1.jpg"
        assert images[1] == "https://cdn.example/static/p2.jpg"

    def test_get_chapter_images_error_returns_empty(self, bika_parser, monkeypatch):
        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: (_ for _ in ()).throw(requests.Timeout("t")),
        )

        assert bika_parser.get_chapter_images("comic123", 1) == []


# ---------------------------------------------------------------------------
# 收藏夹
# ---------------------------------------------------------------------------


class TestBikaFavourites:
    """测试 Bika 收藏夹获取流程，包括自动重登录。"""

    def test_favourites_with_token(self, bika_parser, monkeypatch, json_fixture):
        bika_parser._token = "valid_token"
        payload = json_fixture("bika_favourites.json")

        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: _make_json_response(payload),
        )

        comics, pagination, needs_login = bika_parser.favourites(page=1)

        assert needs_login is False
        assert len(comics) == 1
        assert comics[0].id == "fav001"
        assert comics[0].title == "Favourite Comic"
        assert pagination is not None
        assert pagination.total_items == 1

    def test_favourites_no_token_no_credentials(self, bika_parser):
        comics, pagination, needs_login = bika_parser.favourites()

        assert needs_login is True
        assert comics == []
        assert pagination is None

    def test_favourites_auto_relogin(self, bika_parser, monkeypatch, json_fixture):
        bika_parser.set_stored_credentials("user@example.com", "pass123")
        login_payload = json_fixture("bika_login_success.json")
        fav_payload = json_fixture("bika_favourites.json")
        call_log = []

        def fake_request(method, url, **kwargs):
            call_log.append(url)
            if "auth/sign-in" in url:
                return _make_json_response(login_payload)
            if "favourite" in url:
                return _make_json_response(fav_payload)
            return _make_json_response({"code": 200, "data": {}})

        monkeypatch.setattr(bika_parser.session, "request", fake_request)

        comics, pagination, needs_login = bika_parser.favourites()

        assert needs_login is False
        assert len(comics) == 1
        # 验证先调用了 login，再调用 favourite
        assert any("auth/sign-in" in u for u in call_log)
        assert any("favourite" in u for u in call_log)


# ---------------------------------------------------------------------------
# 登录状态验证
# ---------------------------------------------------------------------------


class TestBikaVerifyLoginStatus:
    """测试 verify_login_status 的 token 验证和自动重登录。"""

    def test_verify_valid_token(self, bika_parser, monkeypatch, json_fixture):
        bika_parser._token = "valid_token"
        profile_payload = json_fixture("bika_user_profile.json")

        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: _make_json_response(profile_payload),
        )

        valid, message = bika_parser.verify_login_status()

        assert valid is True
        assert "TestBikaUser" in message

    def test_verify_expired_token_auto_relogin(
        self, bika_parser, monkeypatch, json_fixture
    ):
        bika_parser._token = "expired_token"
        bika_parser.set_stored_credentials("user@example.com", "pass123")
        login_payload = json_fixture("bika_login_success.json")
        profile_payload = json_fixture("bika_user_profile.json")
        call_log = []

        def fake_request(method, url, **kwargs):
            call_log.append(url)
            # 第一次 profile 请求返回 401（token 过期）
            if (
                "users/profile" in url
                and len([u for u in call_log if "profile" in u]) == 1
            ):
                raise _make_http_error(401)
            # login 请求
            if "auth/sign-in" in url:
                return _make_json_response(login_payload)
            # 第二次 profile 请求成功
            return _make_json_response(profile_payload)

        monkeypatch.setattr(bika_parser.session, "request", fake_request)

        valid, message = bika_parser.verify_login_status()

        assert valid is True
        assert "TestBikaUser" in message

    def test_verify_expired_relogin_fails(self, bika_parser, monkeypatch):
        bika_parser._token = "expired_token"
        bika_parser.set_stored_credentials("user@example.com", "wrong")

        def fake_request(method, url, **kwargs):
            if "users/profile" in url:
                raise _make_http_error(401)
            # login 也失败
            return _make_json_response(
                {"code": 401, "message": "wrong password", "data": ""}
            )

        monkeypatch.setattr(bika_parser.session, "request", fake_request)

        valid, message = bika_parser.verify_login_status()

        assert valid is False
        assert "自动重新登录失败" in message

    def test_verify_no_token_no_credentials(self, bika_parser):
        valid, message = bika_parser.verify_login_status()

        assert valid is False
        assert "未登录" in message

    def test_ensure_token_auto_login(self, bika_parser, monkeypatch, json_fixture):
        bika_parser.set_stored_credentials("user@example.com", "pass123")
        login_payload = json_fixture("bika_login_success.json")

        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: _make_json_response(login_payload),
        )

        assert bika_parser._token == ""
        bika_parser._ensure_token()
        assert bika_parser._token == login_payload["data"]["token"]


# ---------------------------------------------------------------------------
# 收藏操作 (toggle)
# ---------------------------------------------------------------------------


class TestBikaFavouriteToggle:
    """测试 Bika 收藏/取消收藏的 toggle API。"""

    def test_add_to_favourites_success(self, bika_parser, monkeypatch):
        bika_parser._token = "valid_token"

        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: _make_json_response({"code": 200}),
        )

        assert bika_parser.add_to_favourites("comic123") is True

    def test_add_to_favourites_failure(self, bika_parser, monkeypatch):
        bika_parser._token = "valid_token"

        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: (_ for _ in ()).throw(requests.Timeout("t")),
        )

        assert bika_parser.add_to_favourites("comic123") is False

    def test_check_favourite_true(self, bika_parser, monkeypatch):
        bika_parser._token = "valid_token"
        payload = {"code": 200, "data": {"comic": {"_id": "c1", "isFavourite": True}}}

        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: _make_json_response(payload),
        )

        assert bika_parser.check_favourite("c1") is True

    def test_check_favourite_false(self, bika_parser, monkeypatch):
        bika_parser._token = "valid_token"
        payload = {"code": 200, "data": {"comic": {"_id": "c1", "isFavourite": False}}}

        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: _make_json_response(payload),
        )

        assert bika_parser.check_favourite("c1") is False

    def test_remove_from_favourites_success(self, bika_parser, monkeypatch):
        bika_parser._token = "valid_token"

        monkeypatch.setattr(
            bika_parser.session,
            "request",
            lambda *a, **kw: _make_json_response({"code": 200}),
        )

        assert bika_parser.remove_from_favourites("comic123") is True
