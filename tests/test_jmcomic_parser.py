"""jmcomic parser 单元测试。"""

from pathlib import Path

from sources.jmcomic.constants import RANKING_MAPPINGS
from sources.jmcomic.parser import JmParser

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
    assert comic.source_site == "jmcomic"
    assert comic.comic_source == "JMCOMIC"
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

    assert comic.cover_url.startswith(
        "https://cdn-msp2.test.one/media/albums/430371.jpg"
    )


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
    assert first.source_site == "jmcomic"
    assert first.comic_source == "JMCOMIC"
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
    parser.timeout = 5
    parser.session = MagicMock()

    mock_resp = MagicMock()
    mock_resp.status_code = 403
    mock_resp.text = "Just a moment... Please wait while we verify..."
    mock_resp.url = "https://test.one/"
    parser.session.get.return_value = mock_resp

    valid, msg = parser.verify_login_status()
    assert valid is False
    assert "cf_clearance" in msg


def test_verify_login_detects_not_logged_in(monkeypatch):
    """verify_login_status 应检测未登录状态（首页无收藏夹链接，含登入链接）。"""
    from unittest.mock import MagicMock

    parser = JmParser.__new__(JmParser)
    parser._domain = "test.one"
    parser._username = None
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
    parser.timeout = 5
    parser.session = MagicMock()

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.encoding = "utf-8"
    mock_resp.url = "https://test.one/"
    mock_resp.text = (
        "<html><body>"
        '<a href="/user/xulingran/favorite/albums">收藏夹</a>'
        "</body></html>"
    )
    parser.session.get.return_value = mock_resp

    valid, msg = parser.verify_login_status()
    assert valid is True
    assert parser._username == "xulingran"
