"""jmcomic parser 单元测试。"""
from sources.jmcomic.constants import RANKING_MAPPINGS
from sources.jmcomic.parser import JmParser


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
