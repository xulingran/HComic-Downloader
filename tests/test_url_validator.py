"""UrlValidator 安全防护测试。

验证 SSRF 防线（IP 黑名单、DNS 解析、TOCTOU 防护、域名白名单）在各类攻击向量下
正确拦截或放行。对应 ssrf-protection 能力规范。

网络层全部用注入而非真实请求：
- DNS 解析：monkeypatch socket.getaddrinfo 注入可控解析结果
- 重定向链：monkeypatch Session.get 注入可控重定向响应
"""

from __future__ import annotations

import ipaddress
import socket
from unittest.mock import MagicMock

import pytest
import requests

from url_validator import DownloadError, UrlValidator


# ── fixtures ──────────────────────────────────────────────────────────


@pytest.fixture
def validator() -> UrlValidator:
    """默认配置的 UrlValidator 实例。"""
    return UrlValidator()


def _make_resolver(ips: list[str]):
    """构造一个假的 getaddrinfo，对任意 hostname 解析为指定 IP 列表。

    Args:
        ips: 解析结果 IP 地址字符串列表

    Returns:
        模拟 socket.getaddrinfo 的可调用对象
    """

    def _resolve(host, port, family, type_, *args, **kwargs):  # noqa: ANN001
        results = []
        for ip in ips:
            sockaddr = (ip, port or 0)
            results.append((socket.AF_INET, socket.SOCK_STREAM, 0, "", sockaddr))
        return results

    return _resolve


def _make_unresolvable():
    """构造一个对任意 hostname 都抛 socket.gaierror 的假 getaddrinfo。"""

    def _resolve(*args, **kwargs):  # noqa: ANN001
        raise socket.gaierror("DNS resolution failed")

    return _resolve


# ── IPv4/IPv6 内网与保留 IP 拦截 ─────────────────────────────────────


class TestBlockedIPValidation:
    """验证各类内网与保留 IP 被正确拦截。"""

    @pytest.mark.parametrize(
        "url",
        [
            "http://127.0.0.1/",
            "http://127.0.0.1:8080/",
            "http://10.0.0.1/",
            "http://10.255.255.255/",
            "http://169.254.1.1/",  # link-local
            "http://192.168.1.1/",
            "http://172.16.0.1/",
            "http://172.31.255.255/",
            "http://100.64.0.1/",  # CGNAT
        ],
    )
    def test_ipv4_private_and_reserved_blocked(self, validator, url):
        with pytest.raises(DownloadError, match="(?i)private|reserved|blocked"):
            validator.validate_url(url)

    @pytest.mark.parametrize(
        "url",
        [
            "http://[::1]/",
            "http://[fe80::1]/",
            "http://[fc00::1]/",
            "http://[ff00::1]/",
        ],
    )
    def test_ipv6_local_and_reserved_blocked(self, validator, url):
        with pytest.raises(DownloadError):
            validator.validate_url(url)

    @pytest.mark.parametrize(
        "hostname",
        ["localhost", "0.0.0.0", "::1"],
    )
    def test_localhost_and_zero_addresses_blocked(self, validator, hostname):
        with pytest.raises(DownloadError):
            validator.validate_url(f"http://{hostname}/")


# ── DNS 解析路径 ──────────────────────────────────────────────────────


class TestDNSResolutionValidation:
    """验证域名 DNS 解析结果指向内网时被拦截，可信 CDN 跳过解析。"""

    def test_domain_resolving_to_private_ip_blocked(self, validator, monkeypatch):
        """非可信 CDN 域名解析到内网 IP 必须被拦截。"""
        monkeypatch.setattr(socket, "getaddrinfo", _make_resolver(["127.0.0.1"]))
        with pytest.raises(DownloadError, match="resolves to blocked IP"):
            validator.validate_url("http://evil-example.com/")

    def test_domain_resolving_to_public_ip_allowed(self, validator, monkeypatch):
        """非可信 CDN 域名解析到公网 IP 必须放行。"""
        monkeypatch.setattr(socket, "getaddrinfo", _make_resolver(["93.184.216.34"]))
        # 不抛异常即通过
        validator.validate_url("http://public-example.com/")

    @pytest.mark.parametrize(
        "cdn_domain",
        ["h-comic.com", "jmcomic.me", "picacg.com", "moeimg.fan", "18comic.vip"],
    )
    def test_trusted_cdn_skips_dns_resolution(self, validator, monkeypatch, cdn_domain):
        """可信 CDN 域名必须跳过 DNS 解析验证，防止 TOCTOU 攻击。"""
        # 即使 DNS 解析到内网 IP，可信 CDN 也必须放行（因为跳过了解析）
        call_count = 0
        original = socket.getaddrinfo

        def _counting_resolver(*args, **kwargs):  # noqa: ANN001
            nonlocal call_count
            call_count += 1
            return original(*args, **kwargs)

        monkeypatch.setattr(socket, "getaddrinfo", _counting_resolver)
        # 不抛异常即通过，且 DNS 不应被调用
        validator.validate_url(f"http://{cdn_domain}/path")
        assert call_count == 0, f"可信 CDN {cdn_domain} 不应触发 DNS 解析"

    def test_unresolvable_domain_raises_error(self, validator, monkeypatch):
        """非可信且无法解析的域名必须报错。"""
        monkeypatch.setattr(socket, "getaddrinfo", _make_unresolvable())
        with pytest.raises(DownloadError, match="Cannot resolve"):
            validator.validate_url("http://nonexistent-invalid-domain-xyz.invalid/")


# ── URL scheme 与 hostname 校验 ───────────────────────────────────────


class TestSchemeAndHostnameValidation:
    """验证非法 scheme、空 hostname 等异常输入被拒绝。"""

    @pytest.mark.parametrize("scheme", ["file", "ftp", "gopher", "dict", "ldap"])
    def test_non_http_schemes_rejected(self, validator, scheme):
        with pytest.raises(DownloadError, match="scheme"):
            validator.validate_url(f"{scheme}://example.com/")

    def test_empty_hostname_rejected(self, validator):
        with pytest.raises(DownloadError, match="hostname"):
            validator.validate_url("http:///path")

    def test_https_scheme_allowed_for_trusted_cdn(self, validator):
        # 不抛异常即通过
        validator.validate_url("https://h-comic.com/path")


# ── 可信 CDN 白名单实例配置生效（含 classmethod 脱节 bug）────────────


class TestTrustedCDNConfigEffectiveness:
    """验证实例化时传入的自定义可信 CDN 白名单在 validate_url 中实际生效。

    此测试组复现并锁定 url_validator 的 classmethod/实例属性脱节 bug：
    __init__ 写 self._trusted_cdn_domains（实例属性），但 validate_url 作为
    classmethod 读 cls._TRUSTED_CDN_DOMAINS（类属性），两者脱节导致自定义白名单静默失效。
    """

    def test_custom_trusted_domain_is_allowed(self, monkeypatch):
        """实例化时传入的自定义可信域名必须被放行，且跳过 DNS 解析。

        这是脱节 bug 的回归守护：修复前，自定义白名单因 classmethod 读类属性而静默失效，
        此用例会失败（DNS 被错误调用或域名被拦截）。
        """
        custom_domain = "my-custom-cdn.test"
        v = UrlValidator(trusted_cdn_domains={custom_domain})

        call_count = 0

        def _counting_resolver(*args, **kwargs):  # noqa: ANN001
            nonlocal call_count
            call_count += 1
            # 即使解析到内网，自定义可信域名也不应走 DNS
            return _make_resolver(["127.0.0.1"])(*args, **kwargs)

        monkeypatch.setattr(socket, "getaddrinfo", _counting_resolver)
        v.validate_url(f"http://{custom_domain}/path")
        assert call_count == 0, f"自定义可信域名 {custom_domain} 不应触发 DNS 解析"

    def test_non_custom_domain_still_resolves(self, monkeypatch):
        """实例化时传入自定义白名单后，不在白名单的域名仍须执行 DNS 校验。"""
        v = UrlValidator(trusted_cdn_domains={"my-custom-cdn.test"})

        resolved = False

        def _tracking_resolver(*args, **kwargs):  # noqa: ANN001
            nonlocal resolved
            resolved = True
            return _make_resolver(["93.184.216.34"])(*args, **kwargs)

        monkeypatch.setattr(socket, "getaddrinfo", _tracking_resolver)
        v.validate_url("http://other-public-domain.test/")
        assert resolved, "非可信域名必须触发 DNS 解析校验"


# ── 实例配置全面生效（hcomic_domains / blocked_ipv4 / blocked_ipv6）─────────
# 回归守护：is_hcomic_url / is_blocked_ip 曾是 classmethod 读类属性，
# 与 __init__ 写实例属性脱节，导致自定义配置静默失效。现为实例方法，此组锁定修复。


class TestInstanceConfigEffectiveness:
    """验证实例化时传入的自定义 hcomic_domains / blocked 网段在实例方法中生效。

    这组测试锁定 Issue #4 修复：is_hcomic_url / is_blocked_ip 从 classmethod 改为
    实例方法后，自定义配置不再静默失效。
    """

    def test_custom_hcomic_domain_recognized(self):
        """自定义 hcomic 域名必须被 is_hcomic_url 识别为可信域。"""
        v = UrlValidator(hcomic_domains={"my-hcomic.test"})
        assert v.is_hcomic_url("https://my-hcomic.test/page"), "自定义 hcomic 域名应被识别"
        assert v.is_hcomic_url("https://cdn.my-hcomic.test/img"), "自定义 hcomic 子域应被识别"

    def test_default_hcomic_domain_not_recognized_with_custom_only(self):
        """仅传入自定义域名时，默认 hcomic 域名不再被识别（实例属性完全替换）。"""
        v = UrlValidator(hcomic_domains={"my-hcomic.test"})
        assert not v.is_hcomic_url("https://h-comic.com/page"), "实例属性替换后，默认 hcomic 域名不应被识别"

    def test_custom_blocked_ipv4_overrides_default(self):
        """自定义 blocked_ipv4 必须生效，且默认网段不再拦截。"""
        # 仅放行一个公网网段到黑名单，默认的内网网段被替换掉
        import ipaddress

        custom_blocked = [ipaddress.ip_network("203.0.113.0/24")]
        v = UrlValidator(blocked_ipv4=custom_blocked)

        public_ip = ipaddress.ip_address("203.0.113.5")
        private_ip = ipaddress.ip_address("192.168.1.1")

        assert v.is_blocked_ip(public_ip), "自定义黑名单网段内的 IP 必须被拦截"
        assert not v.is_blocked_ip(private_ip), "实例属性替换后，默认内网网段不再拦截"

    def test_custom_blocked_ipv6_overrides_default(self):
        """自定义 blocked_ipv6 必须生效。"""
        import ipaddress

        custom_blocked = [ipaddress.ip_network("2001:db8::/32")]
        v = UrlValidator(blocked_ipv6=custom_blocked)

        test_ip = ipaddress.ip_address("2001:db8::1")
        loopback = ipaddress.ip_address("::1")

        assert v.is_blocked_ip(test_ip), "自定义黑名单 IPv6 网段内的 IP 必须被拦截"
        assert not v.is_blocked_ip(loopback), "实例属性替换后，默认 ::1 不再拦截"

    def test_custom_blocked_ipv4_affects_validate_url(self):
        """自定义 blocked_ipv4 通过 is_blocked_ip 影响 validate_url 的 IP 拦截。"""
        import ipaddress

        # 把一个公网 IP 加入黑名单，验证 validate_url 拦截它
        custom_blocked = [ipaddress.ip_network("93.184.216.0/24")]
        v = UrlValidator(blocked_ipv4=custom_blocked, trusted_cdn_domains={"93.184.216.34"})

        # 93.184.216.34 在自定义黑名单内（但作为可信 CDN 跳过 DNS，直接走 IP 解析分支）
        with pytest.raises(DownloadError, match="(?i)private|reserved|blocked"):
            v.validate_url("http://93.184.216.34/")


# ── 重定向链逐跳校验与 auth 头管理 ───────────────────────────────────


def _make_redirect_response(status: int, location: str | None = None) -> MagicMock:
    """构造一个模拟的重定向响应。"""
    resp = MagicMock(spec=requests.Response)
    resp.is_redirect = status in (301, 302, 303, 307, 308)
    resp.status_code = status
    resp.headers = {}
    if location is not None:
        resp.headers["Location"] = location
    resp.close = MagicMock()
    return resp


def _make_final_response(status: int = 200) -> MagicMock:
    """构造一个模拟的最终（非重定向）响应。"""
    resp = MagicMock(spec=requests.Response)
    resp.is_redirect = False
    resp.status_code = status
    resp.headers = {}
    resp.close = MagicMock()
    return resp


class TestResolveRedirects:
    """验证 resolve_redirects 逐跳校验、auth 头动态管理、跳数与 Location 处理。"""

    def test_redirect_to_private_ip_blocked_per_hop(self, validator):
        """重定向链中某一跳指向内网地址必须被拦截。"""
        responses = [_make_redirect_response(302, "http://127.0.0.1/evil")]

        session = MagicMock(spec=requests.Session)
        session.headers = {}
        session.get = MagicMock(side_effect=lambda url, **kw: responses.pop(0))

        with pytest.raises(DownloadError, match="(?i)private|reserved|blocked"):
            validator.resolve_redirects("https://h-comic.com/start", session, timeout=5)

    def test_auth_headers_stripped_when_leaving_trusted_domain(self, validator):
        """从 hcomic（可信域）重定向到非可信域时，auth 头必须被剥离。"""
        # 链路: h-comic.com/start →(302)→ public-example.com/dest →(200)
        responses = [
            _make_redirect_response(302, "https://public-example.com/dest"),
            _make_final_response(200),
        ]

        session = MagicMock(spec=requests.Session)
        session.headers = {"Cookie": "auth=secret", "Authorization": "Bearer token"}
        session.get = MagicMock(side_effect=lambda url, **kw: responses.pop(0))

        validator.resolve_redirects("https://h-comic.com/start", session, timeout=5)

        # 离开可信域后，auth 头必须被剥离
        assert "Cookie" not in session.headers, "离开可信域后 Cookie 必须被剥离"
        assert "Authorization" not in session.headers, "离开可信域后 Authorization 必须被剥离"

    def test_auth_headers_restored_when_redirecting_back(self, validator):
        """从非可信域重定向回可信域时，先前剥离的 auth 头必须被恢复。"""
        # 链路: h-comic.com/start →(302)→ public-example.com/intermediate →(302)→ h-comic.com/back →(200)
        responses = [
            _make_redirect_response(302, "https://public-example.com/intermediate"),
            _make_redirect_response(302, "https://h-comic.com/back"),
            _make_final_response(200),
        ]

        session = MagicMock(spec=requests.Session)
        session.headers = {"Cookie": "auth=secret", "Authorization": "Bearer token"}
        session.get = MagicMock(side_effect=lambda url, **kw: responses.pop(0))

        validator.resolve_redirects("https://h-comic.com/start", session, timeout=5)

        assert session.headers.get("Cookie") == "auth=secret", "跳回可信域后 Cookie 必须恢复"
        assert session.headers.get("Authorization") == "Bearer token", "跳回可信域后 Authorization 必须恢复"

    def test_too_many_redirects_raises_error(self, validator):
        """超过最大跳数限制必须报错。"""
        # 构造一个无限重定向循环（>10 跳）
        responses = [_make_redirect_response(302, "https://h-comic.com/hop") for _ in range(15)]

        session = MagicMock(spec=requests.Session)
        session.headers = {}
        session.get = MagicMock(side_effect=lambda url, **kw: responses.pop(0))

        with pytest.raises(DownloadError, match="(?i)redirect|too many"):
            validator.resolve_redirects("https://h-comic.com/start", session, timeout=5)

    def test_redirect_without_location_raises_error(self, validator):
        """收到重定向状态码但无 Location 头必须报错。"""
        responses = [_make_redirect_response(302, location=None)]

        session = MagicMock(spec=requests.Session)
        session.headers = {}
        session.get = MagicMock(side_effect=lambda url, **kw: responses.pop(0))

        with pytest.raises(DownloadError, match="(?i)location"):
            validator.resolve_redirects("https://h-comic.com/start", session, timeout=5)
