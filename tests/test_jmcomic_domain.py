"""jmcomic 域名发现模块测试。"""

import time
from unittest.mock import patch

from sources.jmcomic.domain import JmDomainResolver


def test_resolve_from_cache(tmp_path):
    """缓存有效时直接返回缓存域名。"""
    cache_file = tmp_path / "jm_domain.txt"
    cache_file.write_text(f"18comic.vip\n{time.time()}\n")
    resolver = JmDomainResolver(cache_dir=str(tmp_path))
    domain = resolver.resolve()
    assert domain == "18comic.vip"


def test_resolve_cache_expired_falls_back(tmp_path):
    """缓存过期时尝试发布页，失败则用 fallback。"""
    cache_file = tmp_path / "jm_domain.txt"
    cache_file.write_text(f"old-domain.com\n{time.time() - 100000}\n")
    resolver = JmDomainResolver(cache_dir=str(tmp_path))
    with patch.object(resolver, "_fetch_publish_domains", return_value=[]):
        domain = resolver.resolve()
    assert domain == JmDomainResolver.FALLBACK_DOMAIN


def test_resolve_no_cache_fallback(tmp_path):
    """无缓存且发布页失败时使用 fallback。"""
    resolver = JmDomainResolver(cache_dir=str(tmp_path))
    with patch.object(resolver, "_fetch_publish_domains", return_value=[]):
        domain = resolver.resolve()
    assert domain == JmDomainResolver.FALLBACK_DOMAIN


def test_resolve_publish_success(tmp_path):
    """发布页返回可用域名时写入缓存。"""
    resolver = JmDomainResolver(cache_dir=str(tmp_path))
    with (
        patch.object(resolver, "_fetch_publish_domains", return_value=["new-domain.com"]),
        patch.object(resolver, "_test_domain", return_value=True),
    ):
        domain = resolver.resolve()
    assert domain == "new-domain.com"
    cache_file = tmp_path / "jm_domain.txt"
    assert cache_file.exists()
    assert "new-domain.com" in cache_file.read_text()
