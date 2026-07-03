"""JM 搜索/首页 DOM 快照解析测试。

验证 parse_search_snapshot / parse_home_snapshot 复用现有解析逻辑、
不发起网络请求、并严格校验来源 URL 与参数。
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from sources.base import AntiBotChallengeError
from sources.jm.parser import JmParser

FIXTURES = Path(__file__).parent / "fixtures" / "html"


def _make_snapshot_parser() -> JmParser:
    """构造一个 domain=18comic.vip 的解析器，用于快照校验。"""
    parser = JmParser(timeout=5)
    parser._domain = "18comic.vip"
    return parser


# ── 搜索快照 ──────────────────────────────────────────────────────────────────


def test_parse_search_snapshot_extracts_results_without_network():
    """搜索快照复用 _parse_search_results，不发起网络请求。"""
    html = (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")
    parser = _make_snapshot_parser()
    parser.session.get = MagicMock()

    comics, pagination = parser.parse_search_snapshot(
        html,
        "https://18comic.vip/search/photos?main_tag=0&search_query=test",
        query="test",
        page=1,
    )

    assert len(comics) == 2
    assert comics[0].id == "1442910"
    assert comics[0].title == "心甘晴愿的美食大赛"
    assert pagination is not None
    assert pagination.current_page == 2
    parser.session.get.assert_not_called()


def test_parse_search_snapshot_accepts_page_param():
    """带 page 参数的搜索 URL 应通过校验。"""
    html = (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")
    parser = _make_snapshot_parser()

    comics, _ = parser.parse_search_snapshot(
        html,
        "https://18comic.vip/search/photos?main_tag=0&search_query=test&page=2",
        query="test",
        page=2,
    )

    assert len(comics) == 2


def test_parse_search_snapshot_accepts_empty_query():
    """空搜索词（search_query=）应通过校验。"""
    html = (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")
    parser = _make_snapshot_parser()

    comics, _ = parser.parse_search_snapshot(
        html,
        "https://18comic.vip/search/photos?main_tag=0&search_query=",
        query="",
        page=1,
    )

    assert len(comics) == 2


def test_parse_search_snapshot_rejects_challenge_page():
    """挑战页 HTML 应抛出 AntiBotChallengeError。"""
    parser = _make_snapshot_parser()
    html = '<html><script src="/cdn-cgi/challenge-platform/h/g/cv/result"></script></html>'

    with pytest.raises(AntiBotChallengeError):
        parser.parse_search_snapshot(
            html,
            "https://18comic.vip/search/photos?main_tag=0&search_query=test",
            query="test",
            page=1,
        )


def test_parse_search_snapshot_rejects_untrusted_url():
    """非可信域名应抛出 ValueError。"""
    parser = _make_snapshot_parser()
    html = (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")

    with pytest.raises(ValueError, match="不受信任"):
        parser.parse_search_snapshot(
            html,
            "https://evil.example/search/photos?main_tag=0&search_query=test",
            query="test",
            page=1,
        )


def test_parse_search_snapshot_rejects_wrong_path():
    """非 /search/photos 路径应抛出 ValueError。"""
    parser = _make_snapshot_parser()
    html = (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")

    with pytest.raises(ValueError, match="不受信任"):
        parser.parse_search_snapshot(
            html,
            "https://18comic.vip/albums?main_tag=0&search_query=test",
            query="test",
            page=1,
        )


def test_parse_search_snapshot_rejects_search_query_mismatch():
    """URL 中 search_query 解码后不等于传入 query 应抛出 ValueError。"""
    parser = _make_snapshot_parser()
    html = (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")

    with pytest.raises(ValueError, match="搜索词不匹配"):
        parser.parse_search_snapshot(
            html,
            "https://18comic.vip/search/photos?main_tag=0&search_query=other",
            query="test",
            page=1,
        )


def test_parse_search_snapshot_rejects_page_mismatch():
    """URL 中 page 参数与传入 page 不匹配应抛出 ValueError。"""
    parser = _make_snapshot_parser()
    html = (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")

    with pytest.raises(ValueError, match="页码不匹配"):
        parser.parse_search_snapshot(
            html,
            "https://18comic.vip/search/photos?main_tag=0&search_query=test&page=3",
            query="test",
            page=2,
        )


def test_parse_search_snapshot_rejects_missing_page_when_page_gt_1():
    """page > 1 但 URL 无 page 参数应抛出 ValueError。"""
    parser = _make_snapshot_parser()
    html = (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")

    with pytest.raises(ValueError, match="页码不匹配"):
        parser.parse_search_snapshot(
            html,
            "https://18comic.vip/search/photos?main_tag=0&search_query=test",
            query="test",
            page=2,
        )


def test_parse_search_snapshot_rejects_oversized_html():
    """超过 5 MiB 的 HTML 应抛出 ValueError。"""
    parser = _make_snapshot_parser()
    html = "x" * (5 * 1024 * 1024 + 1)

    with pytest.raises(ValueError, match="5 MiB"):
        parser.parse_search_snapshot(
            html,
            "https://18comic.vip/search/photos?main_tag=0&search_query=test",
            query="test",
            page=1,
        )


def test_parse_search_snapshot_rejects_missing_main_tag():
    """缺少 main_tag 参数应抛出 ValueError。"""
    parser = _make_snapshot_parser()
    html = (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")

    with pytest.raises(ValueError, match="查询参数无效"):
        parser.parse_search_snapshot(
            html,
            "https://18comic.vip/search/photos?search_query=test",
            query="test",
            page=1,
        )


def test_parse_search_snapshot_rejects_duplicate_params():
    """重复参数应抛出 ValueError。"""
    parser = _make_snapshot_parser()
    html = (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")

    with pytest.raises(ValueError, match="查询参数无效"):
        parser.parse_search_snapshot(
            html,
            "https://18comic.vip/search/photos?main_tag=0&main_tag=0&search_query=test",
            query="test",
            page=1,
        )


def test_parse_search_snapshot_rejects_unknown_param():
    """未知参数名应抛出 ValueError。"""
    parser = _make_snapshot_parser()
    html = (FIXTURES / "jm_search_results.html").read_text(encoding="utf-8")

    with pytest.raises(ValueError, match="查询参数无效"):
        parser.parse_search_snapshot(
            html,
            "https://18comic.vip/search/photos?main_tag=0&search_query=test&evil=1",
            query="test",
            page=1,
        )


# ── 首页快照 ──────────────────────────────────────────────────────────────────


def test_parse_home_snapshot_extracts_sections_without_network():
    """首页快照复用 _parse_home_sections，不发起网络请求。"""
    html = (FIXTURES / "jm_home_sections.html").read_text(encoding="utf-8")
    parser = _make_snapshot_parser()
    parser.session.get = MagicMock()

    sections = parser.parse_home_snapshot(html, "https://18comic.vip/")

    assert len(sections) == 5
    assert sections[0][0] == "周五連載更新"
    assert len(sections[0][1]) == 10
    parser.session.get.assert_not_called()


def test_parse_home_snapshot_rejects_challenge_page():
    """挑战页 HTML 应抛出 AntiBotChallengeError。"""
    parser = _make_snapshot_parser()
    html = '<html><script src="/cdn-cgi/challenge-platform/h/g/cv/result"></script></html>'

    with pytest.raises(AntiBotChallengeError):
        parser.parse_home_snapshot(html, "https://18comic.vip/")


def test_parse_home_snapshot_rejects_untrusted_url():
    """非可信域名应抛出 ValueError。"""
    parser = _make_snapshot_parser()
    html = (FIXTURES / "jm_home_sections.html").read_text(encoding="utf-8")

    with pytest.raises(ValueError, match="不受信任"):
        parser.parse_home_snapshot(html, "https://evil.example/")


def test_parse_home_snapshot_rejects_search_path():
    """搜索路径不可作为首页快照。"""
    parser = _make_snapshot_parser()
    html = (FIXTURES / "jm_home_sections.html").read_text(encoding="utf-8")

    with pytest.raises(ValueError, match="不受信任"):
        parser.parse_home_snapshot(html, "https://18comic.vip/search/photos?main_tag=0&search_query=test")


def test_parse_home_snapshot_rejects_query_params():
    """根路径带 query 参数应抛出 ValueError。"""
    parser = _make_snapshot_parser()
    html = (FIXTURES / "jm_home_sections.html").read_text(encoding="utf-8")

    with pytest.raises(ValueError, match="不受信任"):
        parser.parse_home_snapshot(html, "https://18comic.vip/?foo=1")


def test_parse_home_snapshot_rejects_oversized_html():
    """超过 5 MiB 的 HTML 应抛出 ValueError。"""
    parser = _make_snapshot_parser()
    html = "x" * (5 * 1024 * 1024 + 1)

    with pytest.raises(ValueError, match="5 MiB"):
        parser.parse_home_snapshot(html, "https://18comic.vip/")
