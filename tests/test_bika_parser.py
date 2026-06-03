"""Bika 解析器单元测试。"""

from __future__ import annotations

from sources.bika.parser import BikaParser


class TestBikaSignature:
    """测试 HMAC-SHA256 签名计算。"""

    def test_signature_basic(self):
        """测试基本签名计算。"""
        url = "comics/advanced-search?page=1"
        timestamp = "1234567890"
        nonce = "4ce7a7aa759b40f794d189a88b84aba8"
        method = "POST"

        signature = BikaParser._get_signature(url, timestamp, nonce, method)

        # 签名应该是 64 字符的十六进制字符串
        assert len(signature) == 64
        assert all(c in "0123456789abcdef" for c in signature)

    def test_signature_case_insensitive(self):
        """测试签名对 URL 大小写不敏感。"""
        url1 = "comics/advanced-search?page=1"
        url2 = "COMICS/ADVANCED-SEARCH?PAGE=1"
        timestamp = "1234567890"
        nonce = "4ce7a7aa759b40f794d189a88b84aba8"
        method = "POST"

        sig1 = BikaParser._get_signature(url1, timestamp, nonce, method)
        sig2 = BikaParser._get_signature(url2, timestamp, nonce, method)

        assert sig1 == sig2

    def test_signature_different_methods(self):
        """测试不同 HTTP 方法产生不同签名。"""
        url = "comics/123"
        timestamp = "1234567890"
        nonce = "4ce7a7aa759b40f794d189a88b84aba8"

        sig_get = BikaParser._get_signature(url, timestamp, nonce, "GET")
        sig_post = BikaParser._get_signature(url, timestamp, nonce, "POST")

        assert sig_get != sig_post

    def test_signature_different_timestamps(self):
        """测试不同时间戳产生不同签名。"""
        url = "comics/123"
        nonce = "4ce7a7aa759b40f794d189a88b84aba8"
        method = "GET"

        sig1 = BikaParser._get_signature(url, "1000000000", nonce, method)
        sig2 = BikaParser._get_signature(url, "2000000000", nonce, method)

        assert sig1 != sig2


class TestBikaParser:
    """测试 BikaParser 基本功能。"""

    def test_init(self):
        """测试解析器初始化。"""
        parser = BikaParser(timeout=15)
        assert parser.timeout == 15
        assert parser._token == ""

    def test_configure_auth(self):
        """测试认证配置。"""
        parser = BikaParser()
        parser.configure_auth(bearer_token="test_token_123")
        assert parser._token == "test_token_123"

    def test_configure_auth_strips_whitespace(self):
        """测试认证配置去除空白。"""
        parser = BikaParser()
        parser.configure_auth(bearer_token="  test_token  ")
        assert parser._token == "test_token"

    def test_verify_login_status_no_token(self):
        """测试未登录时验证状态。"""
        parser = BikaParser()
        valid, message = parser.verify_login_status()
        assert valid is False
        assert "未登录" in message
