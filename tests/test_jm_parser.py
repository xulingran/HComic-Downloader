"""jm parser 单元测试。"""

from pathlib import Path

import pytest

from sources.jm.constants import RANKING_MAPPINGS
from sources.jm.parser import JmParser

FIXTURES = Path(__file__).parent / "fixtures" / "html"


def _make_parser() -> JmParser:
    parser = JmParser.__new__(JmParser)
    parser._domain = "test.one"
    parser._cdn_domain = None
    return parser


def test_build_search_url_keyword():
    parser = JmParser.__new__(JmParser)
    parser._domain = "18comic.vip"
    url = parser._build_search_url("test", page=1)
    assert "18comic.vip" in url
    assert "search_query=test" in url


def test_build_search_url_page():
    parser = JmParser.__new__(JmParser)
    parser._domain = "18comic.vip"
    url = parser._build_search_url("test", page=3)
    assert "page=3" in url


def test_ranking_mappings_complete():
    assert len(RANKING_MAPPINGS) == 20  # 4 time periods × 5 order types
    assert "周更新" in RANKING_MAPPINGS
    assert "月点击" in RANKING_MAPPINGS
    assert RANKING_MAPPINGS["周更新"] == {"t": "w", "o": "mr"}


def test_is_ranking_keyword():
    parser = JmParser.__new__(JmParser)
    assert parser._is_ranking_keyword("周更新") is True
    assert parser._is_ranking_keyword("月点击") is True
    assert parser._is_ranking_keyword("总收藏") is True
    assert parser._is_ranking_keyword("普通搜索") is False
    assert parser._is_ranking_keyword("") is False


def test_configure_auth():
    parser = JmParser(timeout=5)
    parser.configure_auth(cookie="test=1", user_agent="UA", bearer_token="")
    assert parser._cookie == "test=1"


def test_parse_detail_extracts_metadata():
    """详情页应提取作者、页数、标签、作品、登场人物、日期、scramble_id。"""
    html = (FIXTURES / "jm_album_detail.html").read_text(encoding="utf-8")
    parser = _make_parser()
    comic = parser._parse_detail(html, comic_id="430371", domain="test.one")

    assert comic.title == "[MANA] 神里綾華 1–4 (原神) [中国語] [無修正]"
    assert comic.author == "MANA"
    assert comic.pages == 31
    assert comic.scramble_id == "220980"
    assert comic.media_id == "430371"
    assert comic.source_site == "jm"
    assert comic.comic_source == "JM"
    # 上架日期优先于更新日期
    assert comic.publish_date == "2023-03-08"
    # 作品 → category
    assert comic.category == "原神"


def test_parse_detail_merges_tags_works_actors():
    """标签应合并分类标签、作品、登场人物，去重并保持顺序。"""
    html = (FIXTURES / "jm_album_detail.html").read_text(encoding="utf-8")
    parser = _make_parser()
    comic = parser._parse_detail(html, comic_id="430371", domain="test.one")

    assert comic.tags == [
        "無修正",
        "全彩",
        "劇情向",
        "馬尾",
        "巨乳",
        "中文",
        "原神",
        "神里綾華",
    ]
    # 无重复
    assert len(comic.tags) == len(set(comic.tags))


def test_parse_detail_generates_image_urls():
    """详情页应生成与页数一致的图片 URL 列表。"""
    html = (FIXTURES / "jm_album_detail.html").read_text(encoding="utf-8")
    parser = _make_parser()
    comic = parser._parse_detail(html, comic_id="430371", domain="test.one")

    assert comic.cover_url.startswith("https://cdn-msp2.test.one/media/albums/430371.jpg")


def test_parse_detail_multi_chapter():
    """多章节专辑应解析出章节列表与总章数。"""
    html = (FIXTURES / "jm_album_multi_chapter.html").read_text(encoding="utf-8")
    parser = _make_parser()
    comic = parser._parse_detail(html, comic_id="999001", domain="test.one")
    assert len(comic.chapters) == 3
    assert comic.chapters[0].id == "999001"
    assert comic.chapters[0].name == "第 1 話"
    assert comic.chapters[0].index == 1
    assert comic.chapters[2].index == 3
    assert comic.album_total_chapters == 3
    assert comic.album_id == "999001"


def test_parse_detail_single_chapter_no_chapters():
    """单章节专辑：chapters 为空、总章数为 1、album_id 回退到自身。"""
    html = (FIXTURES / "jm_album_detail.html").read_text(encoding="utf-8")
    parser = _make_parser()
    comic = parser._parse_detail(html, comic_id="430371", domain="test.one")
    assert comic.chapters == []
    assert comic.album_total_chapters == 1
    assert comic.album_id == "430371"


def test_get_chapter_images(monkeypatch):
    """get_chapter_images 请求 /photo/{id} 并复用详情解析提取图片与 scramble_id。"""
    html = (FIXTURES / "jm_album_detail.html").read_text(encoding="utf-8")
    parser = _make_parser()
    monkeypatch.setattr(parser, "_ensure_domain", lambda: "test.one")
    captured = {}

    def fake_request_text(url):
        captured["url"] = url
        return html

    monkeypatch.setattr(parser, "_request_text", fake_request_text)
    image_urls, scramble_id = parser.get_chapter_images("430371")
    assert captured["url"] == "https://test.one/photo/430371"
    assert scramble_id == "220980"
    assert isinstance(image_urls, list)


def test_parse_search_results_extracts_cards():
    """搜索页每项应提取 id/标题/作者/标签/分类，且无重复。"""
    html = (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")
    parser = _make_parser()
    comics, pagination = parser._parse_search_results(html, domain="test.one")

    assert len(comics) == 2
    first = comics[0]
    assert first.id == "1442910"
    assert first.title == "心甘晴愿的美食大赛"
    assert first.author == "xieehajimi"
    assert first.tags == ["AI绘图", "百合", "全彩"]
    assert first.category == "同人 汉化"
    assert first.source_site == "jm"
    assert first.comic_source == "JM"
    assert first.cover_url == "https://cdn-msp2.test.one/media/albums/1442910.jpg"

    second = comics[1]
    assert second.author == "尼蝶"
    assert second.tags == ["催眠", "中文"]

    assert pagination is not None
    assert pagination.total_pages == 3
    assert pagination.current_page == 2


def test_parse_search_item_skips_blank_cover():
    """blank.jpg 占位图应被忽略，回退到 data-original。"""
    html = (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")
    parser = _make_parser()
    comics, _ = parser._parse_search_results(html, domain="test.one")
    assert all("blank.jpg" not in (c.cover_url or "") for c in comics)


def test_clean_texts_dedupes_and_strips():
    """_clean_texts 应去除空白并按首次出现顺序去重。"""
    assert JmParser._clean_texts(["  a ", "b", "a", "", "  ", "c"]) == ["a", "b", "c"]


def test_set_custom_domain():
    """set_custom_domain 应当设置 _domain，空字符串清除自定义值。"""
    parser = JmParser.__new__(JmParser)
    parser._domain = None

    parser.set_custom_domain("example.com")
    assert parser._domain == "example.com"

    parser.set_custom_domain("")
    assert parser._domain is None

    parser.set_custom_domain("   trimmed.com   ")
    assert parser._domain == "trimmed.com"


def test_verify_login_detects_cloudflare_challenge(monkeypatch):
    """verify_login_status 应检测 Cloudflare 403 挑战页面。"""
    from unittest.mock import MagicMock

    parser = JmParser.__new__(JmParser)
    parser._domain = "test.one"
    parser._username = None
    parser._cookie = ""  # verify_login_status 经 _auth_headers() 访问 self._cookie
    parser.timeout = 5
    parser.session = MagicMock()

    mock_resp = MagicMock()
    mock_resp.status_code = 403
    mock_resp.headers = {"cf-mitigated": "challenge"}
    mock_resp.text = "x" * 6000
    mock_resp.url = "https://test.one/"
    parser.session.get.return_value = mock_resp

    valid, msg = parser.verify_login_status()
    assert valid is False
    assert "人机验证" in msg
    assert "过期" not in msg


def test_verify_login_detects_not_logged_in(monkeypatch):
    """verify_login_status 应检测未登录状态（首页无收藏夹链接，含登入链接）。"""
    from unittest.mock import MagicMock

    parser = JmParser.__new__(JmParser)
    parser._domain = "test.one"
    parser._username = None
    parser._cookie = ""
    parser.timeout = 5
    parser.session = MagicMock()

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.encoding = "utf-8"
    mock_resp.url = "https://test.one/"
    mock_resp.text = '<html><body><a href="/login">登入</a></body></html>'
    parser.session.get.return_value = mock_resp

    valid, msg = parser.verify_login_status()
    assert valid is False
    assert "登录" in msg


def test_verify_login_succeeds_and_discovers_username(monkeypatch):
    """verify_login_status 成功时应从导航栏提取并缓存用户名。"""
    from unittest.mock import MagicMock

    parser = JmParser.__new__(JmParser)
    parser._domain = "test.one"
    parser._username = None
    parser._cookie = ""  # verify_login_status 经 _auth_headers() 访问 self._cookie
    parser.timeout = 5
    parser.session = MagicMock()

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.encoding = "utf-8"
    mock_resp.url = "https://test.one/"
    mock_resp.text = '<html><body><a href="/user/xulingran/favorite/albums">收藏夹</a></body></html>'
    parser.session.get.return_value = mock_resp

    valid, msg = parser.verify_login_status()
    assert valid is True
    assert parser._username == "xulingran"


def test_ensure_username_stops_on_long_challenge_response():
    """用户名发现遇到现代长挑战页时应直接失败，不尝试解析页面。"""
    from unittest.mock import MagicMock

    parser = _make_parser_with_session()
    resp = MagicMock()
    resp.status_code = 403
    resp.headers = {"cf-mitigated": "challenge"}
    resp.text = "x" * 6000
    resp.url = "https://test.one/"
    parser.session.get.return_value = resp

    assert parser._ensure_username("test.one") is False
    assert parser._username is None


# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------


def _make_parser_with_session(session=None) -> JmParser:
    """创建带完整属性初始化的 parser（用于需要 session 的测试）。"""
    from unittest.mock import MagicMock

    parser = JmParser.__new__(JmParser)
    parser._domain = "test.one"
    parser._cdn_domain = None
    parser._cookie = ""
    parser._cookie_synced = True
    parser._username = None
    parser.timeout = 5
    parser.session = session or MagicMock()
    return parser


# ---------------------------------------------------------------------------
# _is_challenge_page 静态方法
# ---------------------------------------------------------------------------


def test_is_challenge_page_does_not_match_cloudflare_branding_alone():
    assert JmParser._is_challenge_page("Protected by Cloudflare") is False


def test_is_challenge_page_just_a_moment():
    assert JmParser._is_challenge_page("Just a moment, please wait") is True


def test_is_challenge_page_captcha():
    assert JmParser._is_challenge_page("Complete the captcha below") is True


def test_is_challenge_page_cf_prefix():
    assert JmParser._is_challenge_page("cf-challenge loading...") is True


def test_is_challenge_page_long_cloudflare_challenge():
    html = "x" * 6000 + '<script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>'
    assert JmParser._is_challenge_page(html) is True


def test_is_challenge_response_prefers_mitigation_header():
    from types import SimpleNamespace

    resp = SimpleNamespace(headers={"CF-Mitigated": "Challenge"}, text="x" * 6000)
    assert JmParser._is_challenge_response(resp) is True


def test_is_challenge_response_normal_long_page():
    from types import SimpleNamespace

    resp = SimpleNamespace(headers={"server": "cloudflare"}, text="<html>" + "x" * 6000 + "</html>")
    assert JmParser._is_challenge_response(resp) is False


def test_is_challenge_page_normal_html():
    """正常长 HTML (>=500 字符) 不是挑战页。"""
    html = "x" * 600
    assert JmParser._is_challenge_page(html) is False


def test_is_challenge_page_short_no_keywords():
    """短 HTML 但不含关键词 → 不是挑战页。"""
    assert JmParser._is_challenge_page("<html>ok</html>") is False


# ---------------------------------------------------------------------------
# _fix_encoding 静态方法
# ---------------------------------------------------------------------------


def test_fix_encoding_iso8859_to_utf8():
    from types import SimpleNamespace

    resp = SimpleNamespace(encoding="iso-8859-1")
    JmParser._fix_encoding(resp)
    assert resp.encoding == "utf-8"


def test_fix_encoding_latin1_to_utf8():
    from types import SimpleNamespace

    resp = SimpleNamespace(encoding="latin-1")
    JmParser._fix_encoding(resp)
    assert resp.encoding == "utf-8"


def test_fix_encoding_none_to_utf8():
    from types import SimpleNamespace

    resp = SimpleNamespace(encoding=None)
    JmParser._fix_encoding(resp)
    assert resp.encoding == "utf-8"


def test_fix_encoding_utf8_unchanged():
    from types import SimpleNamespace

    resp = SimpleNamespace(encoding="utf-8")
    JmParser._fix_encoding(resp)
    assert resp.encoding == "utf-8"


def test_fix_encoding_gbk_unchanged():
    from types import SimpleNamespace

    resp = SimpleNamespace(encoding="gbk")
    JmParser._fix_encoding(resp)
    assert resp.encoding == "gbk"


# ---------------------------------------------------------------------------
# _expand_image_urls 静态方法
# ---------------------------------------------------------------------------


def test_expand_image_urls_generates_full_list():
    images = [
        "https://cdn.test.one/media/photos/430371/00001.webp",
        "https://cdn.test.one/media/photos/430371/00002.webp",
    ]
    result = JmParser._expand_image_urls(images, total_pages=5, comic_id="430371")
    assert len(result) == 5
    assert result[0] == "https://cdn.test.one/media/photos/430371/00001.webp"
    assert result[4] == "https://cdn.test.one/media/photos/430371/00005.webp"


def test_expand_image_urls_no_expansion_when_enough():
    images = [f"https://cdn.test.one/media/photos/123/{i:05d}.webp" for i in range(1, 6)]
    result = JmParser._expand_image_urls(images, total_pages=5, comic_id="123")
    assert result is images  # 不扩展，返回原列表


def test_expand_image_urls_no_expansion_when_empty():
    result = JmParser._expand_image_urls([], total_pages=5, comic_id="123")
    assert result == []


def test_expand_image_urls_bad_pattern_returns_original():
    images = ["https://other-domain.com/img/abc.jpg"]
    result = JmParser._expand_image_urls(images, total_pages=5, comic_id="123")
    assert result == images  # 不匹配正则，返回原列表


# ---------------------------------------------------------------------------
# set_username
# ---------------------------------------------------------------------------


def test_set_username_strips_whitespace():
    parser = JmParser.__new__(JmParser)
    parser._username = None
    parser.set_username("  testuser  ")
    assert parser._username == "testuser"


def test_set_username_ignores_empty():
    parser = JmParser.__new__(JmParser)
    parser._username = "existing"
    parser.set_username("")
    assert parser._username == "existing"
    parser.set_username("   ")
    assert parser._username == "existing"


def test_set_username_affects_favourites_url():
    parser = JmParser.__new__(JmParser)
    parser._username = None
    parser.set_username("myuser")
    url = parser._build_favourites_url("test.one", 1)
    assert "/user/myuser/favorite/albums" in url


# ---------------------------------------------------------------------------
# _sync_cookies_to_jar
# ---------------------------------------------------------------------------


def test_sync_cookies_to_jar_basic():
    import requests as _requests

    parser = _make_parser_with_session(session=_requests.Session())
    parser._cookie = "test_cookie=abc123; other=xyz789"
    parser._cookie_synced = False

    parser._sync_cookies_to_jar()

    assert parser._cookie_synced is True
    # 生产行为：每个 cookie 写入 domain（host-only）与 .domain（domain-cookie，覆盖子域）两条 jar 条目。
    # 必须用 domain= 参数查询，否则无参 get 命中重复条目抛 CookieConflictError。
    assert parser.session.cookies.get("test_cookie", domain="test.one") == "abc123"
    assert parser.session.cookies.get("other", domain="test.one") == "xyz789"
    # 遍历 jar 验证双域名不变量：同名 cookie 在两种域形式下均存在
    test_one_domains = sorted(c.domain for c in parser.session.cookies if c.name == "test_cookie")
    assert test_one_domains == [".test.one", "test.one"]


def test_sync_cookies_skips_when_already_synced():
    parser = _make_parser_with_session()
    parser._cookie = "a=1"
    parser._cookie_synced = True

    parser._sync_cookies_to_jar()

    assert parser._cookie_synced is True


def test_sync_cookies_skips_when_no_cookie():
    parser = _make_parser_with_session()
    parser._cookie = ""
    parser._cookie_synced = False

    parser._sync_cookies_to_jar()

    assert parser._cookie_synced is False


def test_sync_cookies_skips_when_no_domain():
    parser = _make_parser_with_session()
    parser._cookie = "a=1"
    parser._cookie_synced = False
    parser._domain = None

    parser._sync_cookies_to_jar()

    assert parser._cookie_synced is False


def test_sync_cookies_curl_cffi_jar_compatibility():
    """当 session.cookies 有 .jar 属性时使用 .jar.set_cookie()。"""
    from unittest.mock import MagicMock

    mock_jar = MagicMock()
    mock_cookies = MagicMock(spec=[])
    mock_cookies.jar = mock_jar

    parser = _make_parser_with_session()
    parser._cookie = "ck=val"
    parser._cookie_synced = False
    parser.session = MagicMock()
    parser.session.cookies = mock_cookies

    parser._sync_cookies_to_jar()

    # 生产行为：单 cookie × 两个域变体（domain / .domain）= 2 次 set_cookie 调用
    assert mock_jar.set_cookie.call_count == 2
    set_domains = [call.args[0].domain for call in mock_jar.set_cookie.call_args_list]
    set_initial_dot = [call.args[0].domain_initial_dot for call in mock_jar.set_cookie.call_args_list]
    assert set_domains == ["test.one", ".test.one"]
    assert set_initial_dot == [False, True]
    assert parser._cookie_synced is True


def test_sync_cookies_unsupported_jar_warns():
    """session.cookies 既无 set_cookie 也无 .jar → 记录警告不崩溃。"""
    from unittest.mock import MagicMock

    mock_cookies = MagicMock(spec=[])

    parser = _make_parser_with_session()
    parser._cookie = "ck=val"
    parser._cookie_synced = False
    parser.session = MagicMock()
    parser.session.cookies = mock_cookies

    parser._sync_cookies_to_jar()
    assert parser._cookie_synced is False


# ---------------------------------------------------------------------------
# _request_text
# ---------------------------------------------------------------------------


def test_request_text_success(monkeypatch):
    from unittest.mock import MagicMock

    parser = _make_parser_with_session()
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.encoding = "utf-8"
    mock_resp.text = "<html>search results</html>"
    parser.session.get = MagicMock(return_value=mock_resp)

    result = parser._request_text("https://test.one/search")

    assert result == "<html>search results</html>"


def test_request_text_raises_on_http_error(monkeypatch):
    from unittest.mock import MagicMock

    import pytest
    import requests as _requests

    parser = _make_parser_with_session()
    mock_resp = MagicMock()
    mock_resp.status_code = 403
    mock_resp.raise_for_status.side_effect = _requests.HTTPError(response=mock_resp)
    parser.session.get = MagicMock(return_value=mock_resp)

    with pytest.raises(_requests.HTTPError):
        parser._request_text("https://test.one/album/123")


def test_request_text_fixes_encoding(monkeypatch):
    from unittest.mock import MagicMock

    parser = _make_parser_with_session()
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.encoding = "iso-8859-1"
    mock_resp.text = "中文内容"
    parser.session.get = MagicMock(return_value=mock_resp)

    parser._request_text("https://test.one/search")

    assert mock_resp.encoding == "utf-8"


def test_request_text_sets_referer(monkeypatch):
    from unittest.mock import MagicMock

    parser = _make_parser_with_session()
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.encoding = "utf-8"
    mock_resp.text = "ok"
    parser.session.get = MagicMock(return_value=mock_resp)

    parser._request_text("https://test.one/search")

    call_kwargs = parser.session.get.call_args
    headers = call_kwargs[1].get("headers", call_kwargs.kwargs.get("headers", {}))
    assert "test.one" in headers.get("Referer", "")


# ---------------------------------------------------------------------------
# search() 端到端
# ---------------------------------------------------------------------------


def test_search_keyword_end_to_end(monkeypatch):
    """关键词搜索使用 fixture HTML 验证完整解析流程。"""
    html = (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")
    parser = _make_parser_with_session()
    # search() 现在走 _request_text_with_challenge_check（带挑战检测），
    # 而非公共 _request_text（详情页/随机等路径仍用）。
    monkeypatch.setattr(parser, "_request_text_with_challenge_check", lambda url: html)

    comics, pagination = parser.search("心甘晴愿")

    assert len(comics) == 2
    assert comics[0].id == "1442910"
    assert comics[0].source_site == "jm"
    assert pagination is not None
    assert pagination.total_pages == 3


def test_search_ranking_keyword_routes_to_ranking(monkeypatch):
    """排行关键词应路由到 _search_ranking 而非普通搜索。"""
    html = (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")
    parser = _make_parser_with_session()
    captured_urls = []

    def fake_request_text(url):
        captured_urls.append(url)
        return html

    monkeypatch.setattr(parser, "_request_text", fake_request_text)

    parser.search("周更新")

    assert len(captured_urls) == 1
    assert "albums?t=w&o=mr" in captured_urls[0]


def test_search_error_returns_empty(monkeypatch):
    parser = _make_parser_with_session()
    monkeypatch.setattr(parser, "_request_text", lambda url: (_ for _ in ()).throw(Exception("network")))

    comics, pagination = parser.search("test")

    assert comics == []
    assert pagination is None


def test_search_with_tag_parameter():
    """tag 参数不崩溃（当前实现忽略 tag）。"""
    parser = _make_parser_with_session()

    def fake_request_text(url):
        return (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")

    parser._request_text = fake_request_text
    comics, _ = parser.search("test", tag="some_tag")
    assert isinstance(comics, list)


def test_search_by_id_returns_single_comic(monkeypatch):
    """纯数字 keyword 应直接请求 /album/{id} 并返回单条结果。"""
    html = (FIXTURES / "jm_album_detail.html").read_text(encoding="utf-8")
    parser = _make_parser_with_session()
    captured_urls = []

    def fake_request_text(url):
        captured_urls.append(url)
        return html

    monkeypatch.setattr(parser, "_request_text", fake_request_text)

    comics, pagination = parser.search("430371")

    assert len(captured_urls) == 1
    assert captured_urls[0] == "https://test.one/album/430371"
    assert len(comics) == 1
    assert comics[0].id == "430371"
    assert comics[0].title == "[MANA] 神里綾華 1–4 (原神) [中国語] [無修正]"
    assert pagination is not None
    assert pagination.current_page == 1
    assert pagination.total_pages == 1
    assert pagination.total_items == 1


def test_search_by_id_fallback_to_keyword_on_failure(monkeypatch):
    """ID 详情页获取失败时应 fallback 到普通关键词搜索。"""
    html = (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")
    parser = _make_parser_with_session()
    captured_urls = []

    def fake_request_text(url):
        captured_urls.append(url)
        return html

    # 关键词搜索走 _request_text_with_challenge_check；详情页仍走 _request_text。
    monkeypatch.setattr(parser, "_request_text_with_challenge_check", fake_request_text)
    monkeypatch.setattr(parser, "get_comic_detail", lambda comic_id: None)

    comics, pagination = parser.search("430371")

    assert any("/search/photos?" in u and "search_query=430371" in u for u in captured_urls)
    assert len(comics) == 2
    assert pagination is not None
    assert pagination.total_pages == 3


def test_search_results_parses_detail_page():
    """搜索响应为详情页时应解析为单条结果。"""
    html = (FIXTURES / "jm_album_detail.html").read_text(encoding="utf-8")
    parser = _make_parser()

    comics, pagination = parser._parse_search_results(html, domain="test.one")

    assert len(comics) == 1
    assert comics[0].id == "430371"
    assert pagination is not None
    assert pagination.total_pages == 1
    assert pagination.total_items == 1


# ---------------------------------------------------------------------------
# random()
# ---------------------------------------------------------------------------


def test_random_returns_comics(monkeypatch):
    html = (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")
    parser = _make_parser_with_session()
    monkeypatch.setattr(parser, "_request_text", lambda url: html)

    comics, pagination = parser.random()

    assert len(comics) == 2


def test_random_requests_correct_url(monkeypatch):
    html = (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")
    parser = _make_parser_with_session()
    captured_urls = []

    def fake_request_text(url):
        captured_urls.append(url)
        return html

    monkeypatch.setattr(parser, "_request_text", fake_request_text)

    parser.random()

    assert any("/albums/random" in u for u in captured_urls)


def test_random_error_returns_empty(monkeypatch):
    parser = _make_parser_with_session()
    monkeypatch.setattr(parser, "_request_text", lambda url: (_ for _ in ()).throw(Exception("err")))

    comics, pagination = parser.random()

    assert comics == []
    assert pagination is None


# ---------------------------------------------------------------------------
# get_comic_detail() 端到端
# ---------------------------------------------------------------------------


def test_get_comic_detail_end_to_end(monkeypatch):
    html = (FIXTURES / "jm_album_detail.html").read_text(encoding="utf-8")
    parser = _make_parser_with_session()
    monkeypatch.setattr(parser, "_request_text", lambda url: html)

    comic = parser.get_comic_detail("430371")

    assert comic is not None
    assert comic.id == "430371"
    assert comic.title == "[MANA] 神里綾華 1–4 (原神) [中国語] [無修正]"
    assert comic.author == "MANA"
    assert comic.pages == 31


def test_get_comic_detail_correct_url(monkeypatch):
    html = (FIXTURES / "jm_album_detail.html").read_text(encoding="utf-8")
    parser = _make_parser_with_session()
    captured_urls = []

    def fake_request_text(url):
        captured_urls.append(url)
        return html

    monkeypatch.setattr(parser, "_request_text", fake_request_text)

    parser.get_comic_detail("430371")

    assert captured_urls[0] == "https://test.one/album/430371"


def test_get_comic_detail_error_returns_none(monkeypatch):
    parser = _make_parser_with_session()
    monkeypatch.setattr(parser, "_request_text", lambda url: (_ for _ in ()).throw(Exception("err")))

    result = parser.get_comic_detail("430371")

    assert result is None


# ---------------------------------------------------------------------------
# _search_ranking()
# ---------------------------------------------------------------------------


def test_search_ranking_builds_correct_url(monkeypatch):
    html = (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")
    parser = _make_parser_with_session()
    captured_urls = []

    def fake_request_text(url):
        captured_urls.append(url)
        return html

    monkeypatch.setattr(parser, "_request_text", fake_request_text)

    parser._search_ranking("周更新")

    assert "albums?t=w&o=mr" in captured_urls[0]


def test_search_ranking_page2_includes_page_param(monkeypatch):
    html = (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")
    parser = _make_parser_with_session()
    captured_urls = []

    def fake_request_text(url):
        captured_urls.append(url)
        return html

    monkeypatch.setattr(parser, "_request_text", fake_request_text)

    parser._search_ranking("周更新", page=2)

    assert "page=2" in captured_urls[0]


def test_search_ranking_error_returns_empty(monkeypatch):
    parser = _make_parser_with_session()
    monkeypatch.setattr(parser, "_request_text", lambda url: (_ for _ in ()).throw(Exception("err")))

    comics, pagination = parser._search_ranking("周更新")

    assert comics == []
    assert pagination is None


# ---------------------------------------------------------------------------
# search() 反爬挑战检测（_request_text_with_challenge_check）
# ---------------------------------------------------------------------------

from unittest.mock import MagicMock  # noqa: E402

from sources.base import AntiBotChallengeError  # noqa: E402


def _make_search_parser(session=None) -> JmParser:
    """带完整属性的 parser，用于 search() 路径测试。"""
    parser = JmParser.__new__(JmParser)
    parser._domain = "test.one"
    parser._cdn_domain = None
    parser._cookie = ""
    parser._cookie_synced = True
    parser._username = None
    parser.timeout = 5
    parser.session = session or MagicMock()
    return parser


def _make_resp(text: str = "", headers=None, status_code=200):
    resp = MagicMock()
    resp.text = text
    resp.headers = headers or {}
    resp.status_code = status_code
    resp.encoding = "utf-8"
    resp.raise_for_status = MagicMock()
    return resp


def test_search_raises_challenge_on_cf_mitigated_header(monkeypatch):
    """响应头 cf-mitigated: challenge 必须让 search() 抛 AntiBotChallengeError，而非返回空列表。"""
    parser = _make_search_parser()
    monkeypatch.setattr(parser, "_ensure_domain", lambda: "test.one")

    challenge_resp = _make_resp(text="just a moment", headers={"cf-mitigated": "challenge"})
    parser.session.get = MagicMock(return_value=challenge_resp)

    with pytest.raises(AntiBotChallengeError) as exc_info:
        parser.search("普通关键词", page=1)

    assert exc_info.value.challenge_url == parser._build_search_url("普通关键词", page=1)


def test_search_raises_challenge_on_stable_body_markers(monkeypatch):
    """正文含稳定挑战标记（just a moment）时 search() 必须抛 AntiBotChallengeError。"""
    parser = _make_search_parser()
    monkeypatch.setattr(parser, "_ensure_domain", lambda: "test.one")

    body = "x" * 6000 + "<title>Just a moment...</title>"
    challenge_resp = _make_resp(text=body, headers={})
    parser.session.get = MagicMock(return_value=challenge_resp)

    with pytest.raises(AntiBotChallengeError):
        parser.search("普通关键词", page=1)


def test_search_normal_page_returns_results(monkeypatch):
    """正常搜索页必须正常解析，不抛挑战。"""
    parser = _make_search_parser()
    monkeypatch.setattr(parser, "_ensure_domain", lambda: "test.one")

    html = (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")
    normal_resp = _make_resp(text=html, headers={})
    parser.session.get = MagicMock(return_value=normal_resp)

    comics, pagination = parser.search("test", page=1)
    assert len(comics) == 2


def test_search_genuinely_empty_not_treated_as_challenge(monkeypatch):
    """真无结果的正常 HTML（无挑战标记）必须返回空列表，不抛挑战。"""
    parser = _make_search_parser()
    monkeypatch.setattr(parser, "_ensure_domain", lambda: "test.one")

    empty_html = "<html><body>没有找到结果</body></html>" + "x" * 600
    normal_resp = _make_resp(text=empty_html, headers={})
    parser.session.get = MagicMock(return_value=normal_resp)

    comics, pagination = parser.search("不存在的词", page=1)
    assert comics == []
    assert pagination is None


def test_search_non_challenge_exception_falls_back_to_empty(monkeypatch):
    """非挑战、非 ParserResponseError 的网络异常必须走兜底返回空列表。"""
    parser = _make_search_parser()
    monkeypatch.setattr(parser, "_ensure_domain", lambda: "test.one")

    parser.session.get = MagicMock(side_effect=ConnectionError("network down"))

    comics, pagination = parser.search("test", page=1)
    assert comics == []
    assert pagination is None


def test_request_text_with_challenge_check_not_used_by_detail(monkeypatch):
    """公共 _request_text 不抛挑战错误（详情页/随机等路径行为不变）。"""
    parser = _make_search_parser()
    monkeypatch.setattr(parser, "_ensure_domain", lambda: "test.one")

    challenge_resp = _make_resp(text="just a moment", headers={"cf-mitigated": "challenge"})
    parser.session.get = MagicMock(return_value=challenge_resp)

    # _request_text 不做挑战检测，直接返回正文（保持向后兼容）
    text = parser._request_text("https://test.one/photo/123")
    assert "just a moment" in text
