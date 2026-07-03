"""TLS 指纹一致性测试。

确保 curl_cffi 的 IMPERSONATE_BROWSER、HEADERS 中的 User-Agent 和 Sec-Ch-Ua
三者的浏览器主版本号一致，且项目内不残留硬编码的指纹版本字面量。
Electron 升级后需同步更新这些值。
"""

from __future__ import annotations

import re

import sources.jm.constants as jm_constants
from sources.jm import title_resolver


def _extract_chrome_major(ua: str) -> int | None:
    m = re.search(r"Chrome/(\d+)", ua)
    return int(m.group(1)) if m else None


def _extract_sec_ch_ua_major(sec_ch_ua: str) -> int | None:
    m = re.search(r'v="(\d+)"', sec_ch_ua)
    return int(m.group(1)) if m else None


def test_impersonate_browser_is_chrome142():
    """IMPERSONATE_BROWSER 必须与 Electron 42 (Chromium 142) 对齐。"""
    assert jm_constants.IMPERSONATE_BROWSER == "chrome142"


def test_headers_user_agent_matches_impersonate_major():
    """HEADERS User-Agent 的 Chrome 主版本号必须与 IMPERSONATE_BROWSER 一致。"""
    impersonate_major = int(jm_constants.IMPERSONATE_BROWSER.removeprefix("chrome"))
    ua_major = _extract_chrome_major(jm_constants.HEADERS["User-Agent"])
    assert ua_major == impersonate_major, f"User-Agent Chrome/{ua_major} != impersonate chrome{impersonate_major}"


def test_headers_sec_ch_ua_matches_impersonate_major():
    """HEADERS Sec-Ch-Ua 的主版本号必须与 IMPERSONATE_BROWSER 一致。"""
    impersonate_major = int(jm_constants.IMPERSONATE_BROWSER.removeprefix("chrome"))
    sec_ch_ua_major = _extract_sec_ch_ua_major(jm_constants.HEADERS["Sec-Ch-Ua"])
    assert (
        sec_ch_ua_major == impersonate_major
    ), f"Sec-Ch-Ua v={sec_ch_ua_major} != impersonate chrome{impersonate_major}"


def test_title_resolver_uses_impersonate_constant():
    """title_resolver 不得硬编码 chrome136，必须引用 IMPERSONATE_BROWSER。"""
    import inspect

    source = inspect.getsource(title_resolver._create_thread_session)
    assert "chrome136" not in source, "title_resolver 仍硬编码 chrome136"
    assert "IMPERSONATE_BROWSER" in source, "title_resolver 未引用 IMPERSONATE_BROWSER"


def test_cover_mixin_uses_impersonate_constant():
    """cover_mixin 不得硬编码 chrome136，必须引用 IMPERSONATE_BROWSER。"""
    import inspect

    from python.ipc import cover_mixin

    source = inspect.getsource(cover_mixin.CoverMixin._build_cover_session)
    assert "chrome136" not in source, "cover_mixin 仍硬编码 chrome136"
    assert "IMPERSONATE_BROWSER" in source, "cover_mixin 未引用 IMPERSONATE_BROWSER"
