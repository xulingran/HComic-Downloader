"""MoeImgParser 单元测试"""

from typing import Any

import pytest
import requests as _requests

from sources.moeimg import MoeImgParser


class _MockResponse:
    def __init__(self, payload: Any, status_code: int = 200, text: str = ""):
        self._payload = payload
        self.status_code = status_code
        self.text = text

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


def test_search_success_maps_comic_fields(monkeypatch):
    parser = MoeImgParser(timeout=5)
    payload = {
        "manga_list": [
            {
                "manga_name": "测试漫画",
                "manga_cover_img": "https://moeimg.fan/img/thumb/1.webp",
                "manga_id": 123,
                "language": "chinese",
            }
        ],
        "pagi": {
            "cur_page": 2,
            "pages": [{"page": 1}, {"page": 2}, {"page": 3}],
            "offset": 40,
        },
    }

    monkeypatch.setattr(
        parser.session, "get", lambda *args, **kwargs: _MockResponse(payload)
    )

    comics, pagination = parser.search("test", page=2)
    assert len(comics) == 1
    comic = comics[0]
    assert comic.id == "123"
    assert comic.title == "测试漫画"
    assert comic.source_site == "moeimg"
    assert comic.preview_url.endswith("/post/fa123")
    assert comic.cover_url == "https://moeimg.fan/img/thumb/1.webp"
    assert comic.tags == []
    assert pagination is not None
    assert pagination.current_page == 2
    assert pagination.total_pages == 3


def test_search_empty_keyword_uses_latest_manga_endpoint(monkeypatch):
    parser = MoeImgParser(timeout=5)
    payload = {
        "manga_list": [
            {
                "manga_name": "最新漫画",
                "manga_cover_img": "https://moeimg.fan/img/thumb/latest.webp",
                "manga_id": 555,
                "language": "japanese",
            }
        ],
        "pagi": {
            "cur_page": 1,
            "pages": [{"page": 1}, {"page": 2}],
            "offset": 0,
        },
    }
    called_urls = []
    called_params = []

    def fake_get(url, params=None, timeout=30):
        called_urls.append(url)
        called_params.append(params)
        return _MockResponse(payload)

    monkeypatch.setattr(parser.session, "get", fake_get)

    comics, pagination = parser.search("   ", page=1)
    assert len(comics) == 1
    assert comics[0].id == "555"
    assert comics[0].author is None
    assert comics[0].category is None
    assert comics[0].publish_date is None
    assert comics[0].tags == []
    assert pagination is not None
    assert pagination.total_pages == 2
    assert called_urls == [f"{parser.BASE_URL}/spa/latest-manga"]
    assert called_params == [{"page": 1}]


def test_search_does_not_request_detail_immediately(monkeypatch):
    parser = MoeImgParser(timeout=5)
    search_payload = {
        "manga_list": [
            {
                "manga_name": "补全测试",
                "manga_cover_img": "https://moeimg.fan/img/thumb/e.webp",
                "manga_id": 666,
                "language": "chinese",
            }
        ],
        "pagi": {"cur_page": 1, "pages": [{"page": 1}], "offset": 0},
    }
    called_urls = []

    def fake_get(url, params=None, timeout=30):
        called_urls.append(url)
        if url.endswith("/spa/search"):
            return _MockResponse(search_payload)
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(parser.session, "get", fake_get)

    comics, _ = parser.search("补全", page=1)
    assert len(comics) == 1
    comic = comics[0]
    assert comic.author is None
    assert comic.category is None
    assert comic.publish_date is None
    assert comic.pages == 0
    assert comic.tags == []
    assert called_urls == [f"{parser.BASE_URL}/spa/search"]


def test_search_author_mode_resolves_id_and_uses_author_endpoint(monkeypatch):
    parser = MoeImgParser(timeout=5)
    lookup_payload = {
        "manga_list": [
            {
                "manga_id": 11,
                "manga_name": "候选1",
                "manga_cover_img": "",
                "language": "japanese",
            },
        ],
        "pagi": {"cur_page": 1, "pages": [{"page": 1}], "offset": 0},
    }
    detail_payload = {
        "authors": [{"author_name": "horn-wood", "author_id": 1963}],
        "tags": [],
    }
    author_payload = {
        "manga_list": [
            {
                "manga_id": 123,
                "manga_name": "作者结果",
                "manga_cover_img": "https://moeimg.fan/a.webp",
                "language": "chinese",
            },
        ],
        "pagi": {"cur_page": 2, "pages": [{"page": 1}, {"page": 2}], "offset": 40},
    }
    called = []

    def fake_get(url, params=None, timeout=30):
        called.append((url, params))
        if url.endswith("/spa/search"):
            assert params == {"query": "horn-wood", "page": 1}
            return _MockResponse(lookup_payload)
        if url.endswith("/spa/manga/11"):
            return _MockResponse(detail_payload)
        if url.endswith("/spa/author/1963"):
            assert params == {"page": 2}
            return _MockResponse(author_payload)
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(parser.session, "get", fake_get)

    comics, pagination = parser.search("Author: horn-wood", page=2)
    assert len(comics) == 1
    assert comics[0].id == "123"
    assert comics[0].title == "作者结果"
    assert pagination is not None
    assert pagination.current_page == 2
    assert called == [
        (f"{parser.BASE_URL}/spa/search", {"query": "horn-wood", "page": 1}),
        (f"{parser.BASE_URL}/spa/manga/11", None),
        (f"{parser.BASE_URL}/spa/author/1963", {"page": 2}),
    ]


def test_search_tag_mode_resolves_id_and_uses_genre_endpoint(monkeypatch):
    parser = MoeImgParser(timeout=5)
    lookup_payload = {
        "manga_list": [
            {
                "manga_id": 22,
                "manga_name": "候选2",
                "manga_cover_img": "",
                "language": "english",
            },
        ],
        "pagi": {"cur_page": 1, "pages": [{"page": 1}], "offset": 0},
    }
    detail_payload = {
        "authors": [],
        "tags": [{"tag_name": "big breasts", "tag_id": 145}],
    }
    genre_payload = {
        "manga_list": [
            {
                "manga_id": 456,
                "manga_name": "标签结果",
                "manga_cover_img": "https://moeimg.fan/t.webp",
                "language": "japanese",
            },
        ],
        "pagi": {
            "cur_page": 3,
            "pages": [{"page": 1}, {"page": 2}, {"page": 3}],
            "offset": 80,
        },
    }

    def fake_get(url, params=None, timeout=30):
        if url.endswith("/spa/search"):
            assert params == {"query": "big breasts", "page": 1}
            return _MockResponse(lookup_payload)
        if url.endswith("/spa/manga/22"):
            return _MockResponse(detail_payload)
        if url.endswith("/spa/genre/145"):
            assert params == {"page": 3}
            return _MockResponse(genre_payload)
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(parser.session, "get", fake_get)

    comics, pagination = parser.search("Tag: big breasts", page=3)
    assert len(comics) == 1
    assert comics[0].id == "456"
    assert comics[0].title == "标签结果"
    assert pagination is not None
    assert pagination.current_page == 3


def test_get_comic_detail_builds_download_urls(monkeypatch):
    parser = MoeImgParser(timeout=5)
    detail_payload = {
        "detail": {
            "manga_id": 187476,
            "manga_name": "标题A",
            "manga_cover_img": "https://moeimg.fan/img/thumb/a.webp",
            "category": "doujinshi",
            "manga_date_published": "2025-10-18T03:02:56.000Z",
        },
        "authors": [{"author_name": "作者A"}],
        "tags": [{"tag_name": "tag1"}, {"tag_name": "tag2"}],
        "parody": [{"tag_name": "parody1"}],
        "characters": [{"tag_name": "char1"}],
    }
    read_payload = {
        "chapter_detail": {
            "manga_id": 187476,
            "chapter_id": "189904",
            "chapter_date_published": "2025-10-18T03:03:13.000Z",
            "total": 2,
            "server": "https://nvme1.cdndelivers.cloud/",
            "tags": [{"tag_name": "chapter-tag"}],
            "chapter_content": (
                '<img data-url="data/a5/0c/187476/189904/000-979x1331.webp">'
                '<img data-url="data/a5/0c/187476/189904/001-979x1331.webp">'
            ),
        }
    }

    def fake_get(url, params=None, timeout=30):
        if url.endswith("/spa/manga/187476/read"):
            return _MockResponse(read_payload)
        if url.endswith("/spa/manga/187476"):
            return _MockResponse(detail_payload)
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(parser.session, "get", fake_get)

    comic = parser.get_comic_detail("187476")
    assert comic is not None
    assert comic.id == "187476"
    assert comic.title == "标题A"
    assert comic.author == "作者A"
    assert comic.category == "doujinshi"
    assert comic.pages == 2
    assert comic.publish_date == "2025-10-18"
    assert comic.source_site == "moeimg"
    assert comic.tags == ["tag1", "tag2", "parody1", "char1", "chapter-tag"]
    assert len(comic.image_urls) == 2
    assert (
        comic.image_urls[0]
        == "https://nvme1.cdndelivers.cloud/data/a5/0c/187476/189904/000-979x1331.webp"
    )


def test_get_comic_detail_supports_single_quote_data_url_and_preview_count(monkeypatch):
    parser = MoeImgParser(timeout=5)
    detail_payload = {
        "detail": {
            "manga_id": 9,
            "manga_name": "标题B",
        },
        "authors": [{"author_name": "作者B"}],
        "preview_imgs": {
            "pages": {
                "1": [
                    "https://moeimg.fan/preview/1.webp",
                    "https://moeimg.fan/preview/2.webp",
                    "https://moeimg.fan/preview/3.webp",
                ]
            }
        },
    }
    read_payload = {
        "chapter_detail": {
            "total": "invalid",
            "server": "https://cdn.example/",
            "chapter_content": (
                "<img data-url='data/path/001.webp'>"
                "<img data-url='data/path/002.webp'>"
            ),
        }
    }

    def fake_get(url, params=None, timeout=30):
        if url.endswith("/spa/manga/9/read"):
            return _MockResponse(read_payload)
        if url.endswith("/spa/manga/9"):
            return _MockResponse(detail_payload)
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(parser.session, "get", fake_get)

    comic = parser.get_comic_detail("9")
    assert comic is not None
    assert comic.author == "作者B"
    assert comic.pages == 3
    assert comic.image_urls == [
        "https://cdn.example/data/path/001.webp",
        "https://cdn.example/data/path/002.webp",
    ]


def test_get_comic_detail_falls_back_to_html_on_spa_failure(monkeypatch):
    parser = MoeImgParser(timeout=5)

    html_page = """
    <html><body>
    <div class="manga-detail">
        <h1 class="manga-title">HTML标题</h1>
        <ul>
            <li class="br">
                <div class="md-title">Category:</div>
                <div class="md-content"><a href="/category/artist%20cg">artist cg</a></div>
            </li>
            <li class="br">
                <div class="md-title">Language:</div>
                <div class="md-content"><a href="/language/chinese">chinese</a></div>
            </li>
            <li class="br">
                <div class="md-title">Author:</div>
                <div class="md-content"><a href="/artist/fa5888/lemon%20tea">lemon tea</a></div>
            </li>
            <li class="br">
                <div class="md-title">Tags:</div>
                <div class="md-content">
                    <a href="/genre/fa1/tag1">tag1</a>
                    <a href="/genre/fa2/tag2">tag2</a>
                </div>
            </li>
        </ul>
    </div>
    <div class="manga-img">
        <img src="https://moeimg.fan/img/thumb/test.webp">
    </div>
    <div class="preview-imgs">
        <ul>
            <li><img data-src="https://preview/1.webp"></li>
            <li><img data-src="https://preview/2.webp"></li>
            <li><img data-src="https://preview/3.webp"></li>
        </ul>
    </div>
    </body></html>
    """

    def fake_get(url, params=None, timeout=30):
        if "/spa/manga/999" in url and "/read" not in url:
            raise _requests.ConnectionError("SPA API down")
        if url.endswith("/post/fa999"):
            return _MockResponse({}, text=html_page)
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(parser.session, "get", fake_get)

    comic = parser.get_comic_detail("999")
    assert comic is not None
    assert comic.title == "HTML标题"
    assert comic.author == "lemon tea"
    assert comic.category == "artist cg"
    assert comic.tags == ["tag1", "tag2"]
    assert comic.pages == 3
    assert comic.source_site == "moeimg"
    assert "chinese" not in comic.tags


def test_get_comic_detail_excludes_language_from_tags(monkeypatch):
    parser = MoeImgParser(timeout=5)
    detail_payload = {
        "detail": {
            "manga_id": 281587,
            "manga_name": "测试漫画",
            "manga_cover_img": "https://moeimg.fan/img/thumb/test.webp",
            "category": "artist cg",
            "language": "chinese",
        },
        "authors": [{"author_name": "lemon tea", "author_id": 5888}],
        "tags": [
            {"tag_name": "rough translation", "tag_id": 5409},
            {"tag_name": "sex toys", "tag_id": 2463},
        ],
    }
    read_payload = {
        "chapter_detail": {
            "manga_id": 281587,
            "total": 57,
            "server": "https://nvme2.bunnyssd.com/",
            "chapter_content": '<img data-url="data/8b/9f/281587/287093/000.webp">',
        }
    }

    def fake_get(url, params=None, timeout=30):
        if url.endswith("/spa/manga/281587/read"):
            return _MockResponse(read_payload)
        if url.endswith("/spa/manga/281587"):
            return _MockResponse(detail_payload)
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(parser.session, "get", fake_get)

    comic = parser.get_comic_detail("281587")
    assert comic is not None
    assert comic.tags == ["rough translation", "sex toys"]
    assert "chinese" not in comic.tags


# ---------------------------------------------------------------------------
# 登录流程
# ---------------------------------------------------------------------------


class TestMoeImgLogin:
    """测试 moeimg 登录获取 session cookie 的流程。"""

    def test_login_success_sets_cookie(self, moeimg_parser, monkeypatch):
        """登录成功后从 session.cookies 中提取 __SESSION 并返回。"""

        def fake_post(url, **kwargs):
            # 模拟服务器设置 cookie
            moeimg_parser.session.cookies.set(
                "__SESSION", "abc123", domain="moeimg.fan"
            )
            return _MockResponse({"success": True})

        monkeypatch.setattr(moeimg_parser.session, "post", fake_post)

        result = moeimg_parser.login("user", "pass")

        assert result == "__SESSION=abc123"

    def test_login_failure_wrong_credentials(self, moeimg_parser, monkeypatch):
        monkeypatch.setattr(
            moeimg_parser.session,
            "post",
            lambda *a, **kw: _MockResponse({"success": False}),
        )

        with pytest.raises(ValueError, match="登录失败"):
            moeimg_parser.login("bad_user", "bad_pass")

    def test_login_success_but_no_cookie(self, moeimg_parser, monkeypatch):
        """登录成功但 session 中未获取到 __SESSION cookie。"""
        monkeypatch.setattr(
            moeimg_parser.session,
            "post",
            lambda *a, **kw: _MockResponse({"success": True}),
        )

        with pytest.raises(ValueError, match="未获取到 session cookie"):
            moeimg_parser.login("user", "pass")

    def test_login_http_error(self, moeimg_parser, monkeypatch):
        monkeypatch.setattr(
            moeimg_parser.session,
            "post",
            lambda *a, **kw: _MockResponse({}, status_code=500),
        )

        with pytest.raises(RuntimeError, match="500"):
            moeimg_parser.login("user", "pass")


# ---------------------------------------------------------------------------
# _ensure_session 懒登录
# ---------------------------------------------------------------------------


class TestMoeImgEnsureSession:
    """测试 _ensure_session 三级回退逻辑。"""

    def test_ensure_session_with_cookie_in_jar(self, moeimg_parser):
        """cookie jar 中已有 __SESSION，直接返回。"""
        moeimg_parser.session.cookies.set("__SESSION", "existing", domain="moeimg.fan")

        # 不应抛出异常
        moeimg_parser._ensure_session()

    def test_ensure_session_restores_from_cookie_header(self, moeimg_parser):
        """从 Cookie header 中解析 __SESSION 并注入到 jar。"""
        moeimg_parser.session.headers["Cookie"] = "__SESSION=from_header; other=val"

        moeimg_parser._ensure_session()

        assert moeimg_parser.session.cookies.get("__SESSION") == "from_header"

    def test_ensure_session_fallback_to_stored_credentials(
        self, moeimg_parser, monkeypatch
    ):
        """无 cookie 时使用存储的用户名密码登录。"""
        moeimg_parser.set_stored_credentials("user", "pass")
        login_called = []

        def fake_login(username, password):
            login_called.append((username, password))
            moeimg_parser.session.cookies.set(
                "__SESSION", "new_session", domain="moeimg.fan"
            )
            return "__SESSION=new_session"

        monkeypatch.setattr(moeimg_parser, "login", fake_login)

        moeimg_parser._ensure_session()

        assert login_called == [("user", "pass")]

    def test_ensure_session_raises_auth_required(self, moeimg_parser):
        """无任何认证信息时抛出 AuthRequiredError。"""
        from sources.moeimg.parser import AuthRequiredError

        with pytest.raises(AuthRequiredError, match="需要登录"):
            moeimg_parser._ensure_session()


# ---------------------------------------------------------------------------
# 登录状态验证
# ---------------------------------------------------------------------------


class TestMoeImgVerifyLoginStatus:
    """测试 verify_login_status 验证流程。"""

    def test_verify_success(self, moeimg_parser, monkeypatch):
        moeimg_parser.session.cookies.set("__SESSION", "valid", domain="moeimg.fan")

        def fake_get(url, **kwargs):
            return _MockResponse({}, text='<div class="u-fav-item"></div>')

        monkeypatch.setattr(moeimg_parser.session, "get", fake_get)

        valid, message = moeimg_parser.verify_login_status()

        assert valid is True
        assert "已登录" in message

    def test_verify_expired(self, moeimg_parser, monkeypatch):
        moeimg_parser.session.cookies.set("__SESSION", "expired", domain="moeimg.fan")

        monkeypatch.setattr(
            moeimg_parser.session,
            "get",
            lambda *a, **kw: _MockResponse({}, text="<html>no bookmarks here</html>"),
        )

        valid, message = moeimg_parser.verify_login_status()

        assert valid is False
        assert "登录已过期" in message

    def test_verify_network_error(self, moeimg_parser, monkeypatch):
        moeimg_parser.session.cookies.set("__SESSION", "valid", domain="moeimg.fan")

        def fake_get(*a, **kw):
            raise _requests.ConnectionError("network down")

        monkeypatch.setattr(moeimg_parser.session, "get", fake_get)

        valid, message = moeimg_parser.verify_login_status()

        assert valid is False
        assert "网络错误" in message

    def test_verify_no_session(self, moeimg_parser):
        valid, message = moeimg_parser.verify_login_status()

        assert valid is False
        assert "未登录" in message


# ---------------------------------------------------------------------------
# 收藏夹
# ---------------------------------------------------------------------------


class TestMoeImgFavourites:
    """测试 moeimg 收藏夹 HTML 解析流程。"""

    def test_favourites_parses_bookmarks_html(
        self, moeimg_parser, monkeypatch, html_sample
    ):
        moeimg_parser.session.cookies.set("__SESSION", "valid", domain="moeimg.fan")
        bookmarks_html = html_sample("moeimg_bookmarks.html")

        def fake_get(url, **kwargs):
            return _MockResponse({}, text=bookmarks_html)

        monkeypatch.setattr(moeimg_parser.session, "get", fake_get)

        comics, pagination, needs_login = moeimg_parser.favourites(page=1)

        assert needs_login is False
        assert len(comics) == 2

        c1 = comics[0]
        assert c1.id == "12345"
        assert c1.title == "Bookmark Comic 1"
        assert c1.cover_url == "https://moeimg.fan/img/thumb/12345.webp"
        assert c1.source_site == "moeimg"
        assert c1.preview_url == "https://moeimg.fan/post/fa12345"

        c2 = comics[1]
        assert c2.id == "67890"
        assert c2.title == "Bookmark Comic 2"

        assert pagination is not None
        assert pagination.total_pages == 3

    def test_favourites_empty_page(self, moeimg_parser, monkeypatch):
        moeimg_parser.session.cookies.set("__SESSION", "valid", domain="moeimg.fan")

        monkeypatch.setattr(
            moeimg_parser.session,
            "get",
            lambda *a, **kw: _MockResponse({}, text="<html><body>empty</body></html>"),
        )

        comics, pagination, needs_login = moeimg_parser.favourites()

        assert comics == []
        assert needs_login is False

    def test_favourites_needs_login(self, moeimg_parser):
        comics, pagination, needs_login = moeimg_parser.favourites()

        assert needs_login is True
        assert comics == []

    def test_favourites_network_error(self, moeimg_parser, monkeypatch):
        moeimg_parser.session.cookies.set("__SESSION", "valid", domain="moeimg.fan")

        def fake_get(*a, **kw):
            raise _requests.ConnectionError("network")

        monkeypatch.setattr(moeimg_parser.session, "get", fake_get)

        comics, pagination, needs_login = moeimg_parser.favourites()

        assert comics == []
        assert needs_login is False


# ---------------------------------------------------------------------------
# 收藏操作 (toggle)
# ---------------------------------------------------------------------------


class TestMoeImgFavouriteToggle:
    """测试 moeimg 收藏/取消收藏的 toggle 逻辑。"""

    def _set_session(self, parser):
        parser.session.cookies.set("__SESSION", "valid", domain="moeimg.fan")

    def test_check_favourite_true(self, moeimg_parser, monkeypatch):
        self._set_session(moeimg_parser)

        monkeypatch.setattr(
            moeimg_parser.session,
            "get",
            lambda *a, **kw: _MockResponse({"status": 1}),
        )

        assert moeimg_parser.check_favourite("12345") is True

    def test_check_favourite_false(self, moeimg_parser, monkeypatch):
        self._set_session(moeimg_parser)

        monkeypatch.setattr(
            moeimg_parser.session,
            "get",
            lambda *a, **kw: _MockResponse({"status": 0}),
        )

        assert moeimg_parser.check_favourite("12345") is False

    def test_add_when_not_favourited(self, moeimg_parser, monkeypatch):
        self._set_session(moeimg_parser)
        call_log = []

        def fake_get(url, **kwargs):
            call_log.append(url)
            if "bookmark-status" in url:
                return _MockResponse({"status": 0})
            if "bookmark" in url:
                return _MockResponse({"status": 1})
            raise AssertionError(f"Unexpected URL: {url}")

        monkeypatch.setattr(moeimg_parser.session, "get", fake_get)

        assert moeimg_parser.add_to_favourites("12345") is True
        assert len(call_log) == 2  # check + toggle

    def test_add_already_favourited(self, moeimg_parser, monkeypatch):
        self._set_session(moeimg_parser)
        call_log = []

        def fake_get(url, **kwargs):
            call_log.append(url)
            return _MockResponse({"status": 1})

        monkeypatch.setattr(moeimg_parser.session, "get", fake_get)

        assert moeimg_parser.add_to_favourites("12345") is True
        assert len(call_log) == 1  # 只 check，不 toggle

    def test_remove_when_favourited(self, moeimg_parser, monkeypatch):
        self._set_session(moeimg_parser)
        call_log = []

        def fake_get(url, **kwargs):
            call_log.append(url)
            if "bookmark-status" in url:
                return _MockResponse({"status": 1})
            if "bookmark" in url:
                return _MockResponse({"status": -1})
            raise AssertionError(f"Unexpected URL: {url}")

        monkeypatch.setattr(moeimg_parser.session, "get", fake_get)

        assert moeimg_parser.remove_from_favourites("12345") is True
        assert len(call_log) == 2  # check + toggle

    def test_remove_already_not_favourited(self, moeimg_parser, monkeypatch):
        self._set_session(moeimg_parser)
        call_log = []

        def fake_get(url, **kwargs):
            call_log.append(url)
            return _MockResponse({"status": 0})

        monkeypatch.setattr(moeimg_parser.session, "get", fake_get)

        assert moeimg_parser.remove_from_favourites("12345") is True
        assert len(call_log) == 1  # 只 check，不 toggle
