"""系统代理工具测试"""
import os
import unittest
from unittest.mock import patch

from utils import apply_system_proxy_to_session, export_system_proxies_to_env, get_system_proxies


class DummySession:
    def __init__(self):
        self.trust_env = False
        self.proxies = {}


class TestProxyUtils(unittest.TestCase):
    def test_get_system_proxies_normalizes_and_maps(self):
        with patch("utils.getproxies", return_value={"http": "127.0.0.1:7890", "https": "http://127.0.0.1:7891"}):
            proxies = get_system_proxies()

        self.assertEqual(proxies["http"], "http://127.0.0.1:7890")
        self.assertEqual(proxies["https"], "http://127.0.0.1:7891")

    def test_apply_system_proxy_to_session(self):
        session = DummySession()
        with patch("utils.getproxies", return_value={"all": "127.0.0.1:7890"}):
            proxies = apply_system_proxy_to_session(session)

        self.assertTrue(session.trust_env)
        self.assertEqual(proxies["http"], "http://127.0.0.1:7890")
        self.assertEqual(session.proxies["https"], "http://127.0.0.1:7890")

    def test_export_system_proxies_to_env_should_not_override_existing(self):
        old_http = os.environ.get("http_proxy")
        old_https = os.environ.get("https_proxy")
        old_https_upper = os.environ.get("HTTPS_PROXY")
        try:
            os.environ["http_proxy"] = "http://existing:8080"
            os.environ.pop("https_proxy", None)
            os.environ.pop("HTTPS_PROXY", None)

            with patch("utils.getproxies", return_value={"https": "127.0.0.1:7890"}):
                export_system_proxies_to_env()

            self.assertEqual(os.environ["http_proxy"], "http://existing:8080")
            self.assertEqual(os.environ["https_proxy"], "http://127.0.0.1:7890")
            self.assertEqual(os.environ["HTTPS_PROXY"], "http://127.0.0.1:7890")
        finally:
            if old_http is None:
                os.environ.pop("http_proxy", None)
            else:
                os.environ["http_proxy"] = old_http

            if old_https is None:
                os.environ.pop("https_proxy", None)
            else:
                os.environ["https_proxy"] = old_https

            if old_https_upper is None:
                os.environ.pop("HTTPS_PROXY", None)
            else:
                os.environ["HTTPS_PROXY"] = old_https_upper


if __name__ == "__main__":
    unittest.main()
