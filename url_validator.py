from __future__ import annotations

import ipaddress
import logging
import re
import socket
from urllib.parse import urljoin, urlparse

import requests

logger = logging.getLogger(__name__)


class DownloadError(Exception):
    pass


class UrlValidator:
    _HCOMIC_DOMAINS: set[str] = {"h-comic.com", "h-comic.link"}

    _BLOCKED_IPV4: list[ipaddress.IPv4Network] = [
        ipaddress.ip_network("0.0.0.0/8"),
        ipaddress.ip_network("10.0.0.0/8"),
        ipaddress.ip_network("100.64.0.0/10"),
        ipaddress.ip_network("127.0.0.0/8"),
        ipaddress.ip_network("169.254.0.0/16"),
        ipaddress.ip_network("172.16.0.0/12"),
        ipaddress.ip_network("192.0.0.0/29"),
        ipaddress.ip_network("192.168.0.0/16"),
        ipaddress.ip_network("192.0.2.0/24"),
        ipaddress.ip_network("192.88.99.0/24"),
        ipaddress.ip_network("198.51.100.0/24"),
        ipaddress.ip_network("203.0.113.0/24"),
        ipaddress.ip_network("224.0.0.0/4"),
        ipaddress.ip_network("240.0.0.0/4"),
    ]
    _BLOCKED_IPV6: list[ipaddress.IPv6Network] = [
        ipaddress.ip_network("::1/128"),
        ipaddress.ip_network("fe80::/10"),
        ipaddress.ip_network("fc00::/7"),
        ipaddress.ip_network("ff00::/8"),
        ipaddress.ip_network("::/128"),
        ipaddress.ip_network("::ffff:0:0/96"),
    ]
    # 已知可信 CDN 域名，跳过 DNS 解析验证以防止 TOCTOU 攻击
    _TRUSTED_CDN_DOMAINS: set[str] = {
        "h-comic.com",
        "h-comic.link",
        "moeimg.fan",
        "18comic.vip",
        "18comic.org",
        "jmcomic.me",
        "jm-comic.me",
        "jm-comic1.me",
        "jm-comic2.me",
        "jmcomic-zzz.one",
        "picacg.com",
        "picacomic.com",
        "picaapi.picacomic.com",
    }

    def __init__(
        self,
        hcomic_domains: set[str] | None = None,
        blocked_ipv4: list[ipaddress.IPv4Network] | None = None,
        blocked_ipv6: list[ipaddress.IPv6Network] | None = None,
        trusted_cdn_domains: set[str] | None = None,
    ):
        if hcomic_domains is not None:
            self._HCOMIC_DOMAINS = hcomic_domains
        if blocked_ipv4 is not None:
            self._BLOCKED_IPV4 = blocked_ipv4
        if blocked_ipv6 is not None:
            self._BLOCKED_IPV6 = blocked_ipv6
        if trusted_cdn_domains is not None:
            self._trusted_cdn_domains = trusted_cdn_domains
        else:
            self._trusted_cdn_domains = self._TRUSTED_CDN_DOMAINS

    @classmethod
    def is_hcomic_url(cls, url: str) -> bool:
        try:
            host = url.split("://", 1)[1].split("/", 1)[0].split(":")[0].lower()
            return host in cls._HCOMIC_DOMAINS or any(host.endswith("." + d) for d in cls._HCOMIC_DOMAINS)
        except (IndexError, ValueError):
            return False

    @classmethod
    def is_blocked_ip(cls, ip) -> bool:
        networks = cls._BLOCKED_IPV4 if ip.version == 4 else cls._BLOCKED_IPV6
        return any(ip in net for net in networks)

    @classmethod
    def validate_url(cls, url: str):
        # 需要实例来检查 trusted_cdn，但作为类方法被外部直接调用
        # 使用类属性作为默认白名单
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            raise DownloadError(f"Blocked URL scheme: {parsed.scheme}")
        hostname = (parsed.hostname or "").lower()
        if not hostname:
            raise DownloadError("Blocked URL: empty hostname")
        blocked_hosts = ("localhost", "127.0.0.1", "::1", "0.0.0.0")
        if hostname in blocked_hosts:
            raise DownloadError(f"Blocked localhost URL: {hostname}")
        try:
            ip = ipaddress.ip_address(hostname)
            if cls.is_blocked_ip(ip):
                raise DownloadError(f"Blocked private/reserved IP: {hostname}")
            return
        except ValueError:
            pass
        # 已知可信 CDN 域名跳过 DNS 解析验证，防止 TOCTOU 攻击
        if hostname in cls._TRUSTED_CDN_DOMAINS or any(hostname.endswith("." + d) for d in cls._TRUSTED_CDN_DOMAINS):
            return
        try:
            addrs = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
        except socket.gaierror:
            raise DownloadError(f"Cannot resolve hostname: {hostname}") from None
        for _family, _type, _proto, _canon, sockaddr in addrs:
            ip = ipaddress.ip_address(sockaddr[0])
            if cls.is_blocked_ip(ip):
                raise DownloadError(f"Hostname {hostname} resolves to blocked IP: {ip}")

    def resolve_redirects(
        self, url: str, session: requests.Session, timeout: int, max_hops: int = 10
    ) -> tuple[str, requests.Session]:
        current_url = url
        ever_was_hcomic = self.is_hcomic_url(url)
        # Save original auth headers so we can restore them if redirecting back to hcomic
        saved_cookie = session.headers.get("Cookie")
        saved_authorization = session.headers.get("Authorization")
        is_hcomic = ever_was_hcomic
        for _ in range(max_hops):
            self.validate_url(current_url)
            resp = session.get(current_url, timeout=timeout, allow_redirects=False, stream=True)
            resp.close()
            if resp.is_redirect or resp.status_code in (301, 302, 303, 307, 308):
                location = resp.headers.get("Location", "")
                if not location:
                    raise DownloadError(f"Redirect with no Location header from {current_url}")
                current_url = urljoin(current_url, location)
                is_now_hcomic = self.is_hcomic_url(current_url)
                if is_hcomic and not is_now_hcomic:
                    # Leaving hcomic domain; strip auth headers
                    session.headers.pop("Cookie", None)
                    session.headers.pop("Authorization", None)
                    is_hcomic = False
                elif ever_was_hcomic and is_now_hcomic and not is_hcomic:
                    # Redirected back to hcomic; restore auth headers
                    if saved_cookie:
                        session.headers["Cookie"] = saved_cookie
                    if saved_authorization:
                        session.headers["Authorization"] = saved_authorization
                    is_hcomic = True
                continue
            break
        else:
            raise DownloadError(f"Too many redirects for {url}")
        self.validate_url(current_url)
        return current_url, session

    @staticmethod
    def safe_source_site(source_site: str) -> str:
        site = (source_site or "hcomic").strip().lower()
        site = re.sub(r"[^a-z0-9_-]+", "_", site)
        return site or "hcomic"
