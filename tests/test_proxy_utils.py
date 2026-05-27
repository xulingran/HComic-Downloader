"""系统代理工具测试"""
import unittest
from unittest.mock import patch

from utils import apply_system_proxy_to_session, get_system_proxies


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


if __name__ == "__main__":
    unittest.main()
