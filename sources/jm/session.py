"""jm 共享会话工厂。"""

from __future__ import annotations

import logging

from .constants import IMPERSONATE_BROWSER

logger = logging.getLogger(__name__)


def create_session():
    """创建支持浏览器指纹模拟的 HTTP 会话。

    优先使用 curl_cffi（支持 TLS 指纹模拟），
    不可用时回退到标准 requests 库。
    """
    try:
        from curl_cffi import requests as cf_requests

        return cf_requests.Session(impersonate=IMPERSONATE_BROWSER)
    except ImportError:
        logger.warning("curl_cffi not available, falling back to requests (may get 403)")
        import requests

        return requests.Session()
