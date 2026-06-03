"""jmcomic 域名发现模块。"""

from __future__ import annotations

import logging
import os
import re
import time

import requests
from lxml import etree

from .constants import DEFAULT_DOMAIN, HEADERS, PUBLISH_URL
from .session import create_session

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 86400  # 24h


class JmDomainResolver:
    """从发布页获取可用域名，带本地缓存。"""

    FALLBACK_DOMAIN = DEFAULT_DOMAIN
    PUBLISH_URL = PUBLISH_URL
    CACHE_FILENAME = "jm_domain.txt"
    TEST_TIMEOUT = 5

    def __init__(self, cache_dir: str | None = None):
        self._cache_dir = cache_dir or os.path.join(
            os.path.expanduser("~"), ".hcomic_downloader"
        )
        self._cache_path = os.path.join(self._cache_dir, self.CACHE_FILENAME)
        self._session = create_session()

    def resolve(self) -> str:
        """返回当前可用域名。优先缓存，其次发布页，最后 fallback。"""
        cached = self._read_cache()
        if cached:
            return cached

        try:
            domains = self._fetch_publish_domains()
        except (requests.RequestException, ValueError) as e:
            logger.warning("Failed to fetch publish domains: %s", e)
            domains = []

        for domain in domains:
            if self._test_domain(domain):
                self._write_cache(domain)
                return domain

        logger.warning(
            "No available domain found, using fallback: %s", self.FALLBACK_DOMAIN
        )
        return self.FALLBACK_DOMAIN

    def _read_cache(self) -> str | None:
        """读取缓存，未过期则返回域名。"""
        try:
            if not os.path.exists(self._cache_path):
                return None
            with open(self._cache_path, encoding="utf-8") as f:
                lines = f.read().strip().split("\n")
            if len(lines) < 2:
                return None
            domain = lines[0].strip()
            timestamp = float(lines[1].strip())
            if time.time() - timestamp > CACHE_TTL_SECONDS:
                return None
            if domain:
                return domain
        except (OSError, ValueError):
            pass
        return None

    def _write_cache(self, domain: str) -> None:
        """写入域名缓存。"""
        try:
            os.makedirs(self._cache_dir, exist_ok=True)
            with open(self._cache_path, "w", encoding="utf-8") as f:
                f.write(f"{domain}\n{time.time()}\n")
        except OSError as e:
            logger.warning("Failed to write domain cache: %s", e)

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
            (
                i
                for i, p in enumerate(ps)
                if get_text(p).strip().lower().startswith("app")
            ),
            len(ps),
        )
        if idx_start is not None:
            if idx_end <= idx_start:
                idx_end = len(ps)
            for p in ps[idx_start:idx_end]:
                for raw_domain in p.xpath("./following-sibling::div//text()"):
                    domain = raw_domain.strip()
                    if "." in domain and not bool(
                        re.search(r"discord|\.work|@|＠|<", domain)
                    ):
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


def get_jmcomic_domain_list() -> list[str]:
    """获取 jmcomic 可用域名列表，供设置页展示。"""
    resolver = JmDomainResolver()
    return resolver.fetch_available_domains()
