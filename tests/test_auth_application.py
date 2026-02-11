"""认证信息注入应用测试"""
import unittest

from downloader import ComicDownloader
from parser import HComicParser


class TestAuthApplication(unittest.TestCase):
    """测试 parser/downloader 的认证注入"""

    def test_parser_configure_auth_updates_headers(self):
        parser = HComicParser(timeout=5)
        parser.configure_auth(cookie="a=1; b=2", user_agent="UA-Test")

        self.assertEqual(parser.session.headers.get("User-Agent"), "UA-Test")
        self.assertEqual(parser.session.headers.get("Cookie"), "a=1; b=2")

    def test_downloader_configure_auth_updates_headers(self):
        downloader = ComicDownloader(timeout=5)
        downloader.configure_auth(cookie="c=3; d=4", user_agent="UA-Downloader")

        self.assertEqual(downloader.session.headers.get("User-Agent"), "UA-Downloader")
        self.assertEqual(downloader.session.headers.get("Cookie"), "c=3; d=4")

    def test_clear_cookie_removes_header(self):
        parser = HComicParser(timeout=5, cookie="x=1", user_agent="UA-X")
        self.assertIn("Cookie", parser.session.headers)

        parser.configure_auth(cookie="", user_agent="UA-X")

        self.assertNotIn("Cookie", parser.session.headers)

        downloader = ComicDownloader(timeout=5, cookie="y=1", user_agent="UA-Y")
        self.assertIn("Cookie", downloader.session.headers)

        downloader.configure_auth(cookie="", user_agent="UA-Y")

        self.assertNotIn("Cookie", downloader.session.headers)


if __name__ == "__main__":
    unittest.main()
