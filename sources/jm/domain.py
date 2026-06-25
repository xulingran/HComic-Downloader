"""jm 域名发现模块。"""

from __future__ import annotations

import logging
import os
import re

import requests
from lxml import etree

from utils import apply_system_proxy_to_session

from .constants import DEFAULT_DOMAIN, HEADERS, PUBLISH_URL
from .session import create_session

logger = logging.getLogger(__name__)


class JmDomainResolver:
    """从发布页获取可用域名，带本地缓存。"""

    PUBLISH_URL = PUBLISH_URL
    CACHE_FILENAME = "jm_domain.txt"
    TEST_TIMEOUT = 5

    def __init__(self, cache_dir: str | None = None):
        self._cache_dir = cache_dir or os.path.join(os.path.expanduser("~"), ".hcomic_downloader")
        self._cache_path = os.path.join(self._cache_dir, self.CACHE_FILENAME)
        self._session = create_session()
        apply_system_proxy_to_session(self._session)

    def _fetch_publish_domains(self) -> list[str]:
        """从发布页解析域名列表。"""
        resp = self._session.get(
            self.PUBLISH_URL,
            headers={
                "User-Agent": HEADERS["User-Agent"],
                "Accept": HEADERS["Accept"],
            },
            timeout=10,
            allow_redirects=True,
        )
        resp.raise_for_status()
        html_doc = etree.HTML(resp.text)
        ps = html_doc.xpath('//div[@class="wrap"]//p')
        domains: list[str] = []

        def get_text(p):
            return "".join(p.xpath(".//text()"))

        idx_start = next((i for i, p in enumerate(ps) if "內地" in get_text(p)), None)
        idx_end = next(
            (i for i, p in enumerate(ps) if get_text(p).strip().lower().startswith("app")),
            len(ps),
        )
        if idx_start is not None:
            if idx_end <= idx_start:
                idx_end = len(ps)
            for p in ps[idx_start:idx_end]:
                for raw_domain in p.xpath("./following-sibling::div//text()"):
                    domain = raw_domain.strip()
                    if "." in domain and not bool(re.search(r"discord|\.work|@|＠|<", domain)):
                        domain = re.sub(r"^https?://", "", domain).split("/", 1)[0]
                        if domain:
                            domains.append(domain)
        return domains

    def _test_domain(self, domain: str) -> bool:
        """测试域名是否可用。"""
        try:
            resp = self._session.head(
                f"https://{domain}",
                headers={"User-Agent": HEADERS["User-Agent"]},
                timeout=self.TEST_TIMEOUT,
                allow_redirects=True,
            )
            return resp.status_code < 500
        except Exception:
            return False

    def fetch_available_domains(self) -> list[str]:
        """从发布页获取域名列表（不自动选择，纯列表供设置页展示）。"""
        try:
            domains = self._fetch_publish_domains()
        except (requests.RequestException, ValueError) as e:
            logger.warning("Failed to fetch publish domains: %s", e)
            domains = []
        # 默认域名始终排在第一位
        result: list[str] = []
        if DEFAULT_DOMAIN not in domains:
            result.append(DEFAULT_DOMAIN)
        for d in domains:
            if d not in result:
                result.append(d)
        return result


def get_jm_domain_list() -> list[str]:
    """获取 jm 可用域名列表，供设置页展示。"""
    resolver = JmDomainResolver()
    return resolver.fetch_available_domains()
