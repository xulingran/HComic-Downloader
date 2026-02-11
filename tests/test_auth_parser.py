"""auth_parser 模块单元测试"""
import unittest

from auth_parser import extract_auth_from_curl


class TestExtractAuthFromCurl(unittest.TestCase):
    """测试 curl 登录信息提取"""

    def test_extract_from_cookie_and_header_user_agent(self):
        curl_text = (
            "curl 'https://h-comic.com/' "
            "-b 'a=1; b=2' "
            "-H 'User-Agent: Test-UA/1.0'"
        )

        cookie, user_agent = extract_auth_from_curl(curl_text)

        self.assertEqual(cookie, "a=1; b=2")
        self.assertEqual(user_agent, "Test-UA/1.0")

    def test_extract_cookie_from_header(self):
        curl_text = (
            "curl 'https://h-comic.com/' "
            "-H 'Cookie: x=1; y=2' "
            "-H 'user-agent: Header-UA/2.0'"
        )

        cookie, user_agent = extract_auth_from_curl(curl_text)

        self.assertEqual(cookie, "x=1; y=2")
        self.assertEqual(user_agent, "Header-UA/2.0")

    def test_extract_user_agent_from_short_and_long_flag(self):
        curl_text = "curl https://h-comic.com/ --cookie='foo=bar' -A 'UA-A'"
        cookie, user_agent = extract_auth_from_curl(curl_text)
        self.assertEqual(cookie, "foo=bar")
        self.assertEqual(user_agent, "UA-A")

        curl_text = "curl https://h-comic.com/ -b 'foo=bar' --user-agent='UA-B'"
        cookie, user_agent = extract_auth_from_curl(curl_text)
        self.assertEqual(cookie, "foo=bar")
        self.assertEqual(user_agent, "UA-B")

    def test_extract_from_multiline_curl(self):
        curl_text = (
            "curl 'https://h-comic.com/' \\\n"
            "  -H 'User-Agent: Multi-UA' \\\n"
            "  -b 'token=abc; sid=xyz'"
        )

        cookie, user_agent = extract_auth_from_curl(curl_text)

        self.assertEqual(cookie, "token=abc; sid=xyz")
        self.assertEqual(user_agent, "Multi-UA")

    def test_missing_cookie_or_user_agent_should_raise(self):
        with self.assertRaises(ValueError):
            extract_auth_from_curl("curl https://h-comic.com/ -A 'Only-UA'")

        with self.assertRaises(ValueError):
            extract_auth_from_curl("curl https://h-comic.com/ -b 'only=cookie'")


if __name__ == "__main__":
    unittest.main()
