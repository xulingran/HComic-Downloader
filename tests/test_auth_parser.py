"""auth_parser 模块单元测试"""

import unittest

import pytest

from auth_parser import extract_auth_from_curl


class TestExtractAuthFromCurl(unittest.TestCase):
    """测试 curl 登录信息提取"""

    def test_extract_from_cookie_and_header_user_agent(self):
        curl_text = (
            "curl 'https://h-comic.com/' "
            "-b 'a=1; b=2' "
            "-H 'User-Agent: Test-UA/1.0'"
        )

        cookie, user_agent, bearer, domain = extract_auth_from_curl(curl_text)

        self.assertEqual(cookie, "a=1; b=2")
        self.assertEqual(user_agent, "Test-UA/1.0")
        self.assertEqual(bearer, "")
        self.assertEqual(domain, "h-comic.com")

    def test_extract_cookie_from_header(self):
        curl_text = (
            "curl 'https://h-comic.com/' "
            "-H 'Cookie: x=1; y=2' "
            "-H 'user-agent: Header-UA/2.0'"
        )

        cookie, user_agent, bearer, domain = extract_auth_from_curl(curl_text)

        self.assertEqual(cookie, "x=1; y=2")
        self.assertEqual(user_agent, "Header-UA/2.0")
        self.assertEqual(bearer, "")
        self.assertEqual(domain, "h-comic.com")

    def test_extract_user_agent_from_short_and_long_flag(self):
        curl_text = "curl https://h-comic.com/ --cookie='foo=bar' -A 'UA-A'"
        cookie, user_agent, bearer, domain = extract_auth_from_curl(curl_text)
        self.assertEqual(cookie, "foo=bar")
        self.assertEqual(user_agent, "UA-A")
        self.assertEqual(bearer, "")
        self.assertEqual(domain, "h-comic.com")

        curl_text = "curl https://h-comic.com/ -b 'foo=bar' --user-agent='UA-B'"
        cookie, user_agent, bearer, domain = extract_auth_from_curl(curl_text)
        self.assertEqual(cookie, "foo=bar")
        self.assertEqual(user_agent, "UA-B")
        self.assertEqual(bearer, "")
        self.assertEqual(domain, "h-comic.com")

    def test_extract_from_multiline_curl(self):
        curl_text = (
            "curl 'https://h-comic.com/' \\\n"
            "  -H 'User-Agent: Multi-UA' \\\n"
            "  -b 'token=abc; sid=xyz'"
        )

        cookie, user_agent, bearer, domain = extract_auth_from_curl(curl_text)

        self.assertEqual(cookie, "token=abc; sid=xyz")
        self.assertEqual(user_agent, "Multi-UA")
        self.assertEqual(bearer, "")
        self.assertEqual(domain, "h-comic.com")

    def test_missing_cookie_or_user_agent_should_raise(self):
        with self.assertRaises(ValueError):
            extract_auth_from_curl("curl https://h-comic.com/ -A 'Only-UA'")

        with self.assertRaises(ValueError):
            extract_auth_from_curl("curl https://h-comic.com/ -b 'only=cookie'")


@pytest.mark.parametrize(
    "curl_text,expected_cookie,expected_ua",
    [
        # 标准 -H 格式
        (
            'curl -H "Cookie: session=abc" -H "User-Agent: Mozilla"',
            "session=abc",
            "Mozilla",
        ),
        # -b / -A 短选项
        ('curl -b "session=xyz" -A "Chrome/120.0"', "session=xyz", "Chrome/120.0"),
        # 长选项
        ('curl --cookie "id=123" --user-agent "Firefox/121"', "id=123", "Firefox/121"),
        # 反斜杠换行续行
        (
            'curl -H "Cookie: a=b" \\\n     -H "User-Agent: TestAgent/1.0"',
            "a=b",
            "TestAgent/1.0",
        ),
        # 混合格式
        ('curl -b "c1=v1" -H "User-Agent: U1"', "c1=v1", "U1"),
        # --header= 格式
        (
            'curl --header="Cookie: token=xyz" --header="User-Agent: Safari"',
            "token=xyz",
            "Safari",
        ),
        # 空格处理 (auth_parser 会对 cookie 值进行 strip)
        ('curl -b "  name=value  " -A "Agent"', "name=value", "Agent"),
        # 无冒号的 header (覆盖 _split_header 边界情况)
        ('curl -H "Cookie: test" -H "X-Custom-Header" -A "Agent"', "test", "Agent"),
    ],
)
def test_extract_auth_from_curl_variations(curl_text, expected_cookie, expected_ua):
    """测试各种 curl 命令格式的解析"""
    cookie, ua, bearer, domain = extract_auth_from_curl(curl_text)
    assert cookie == expected_cookie
    assert ua == expected_ua
    assert bearer == ""


@pytest.mark.parametrize(
    "invalid_curl,error_msg",
    [
        ("", "curl 内容为空"),
        ("   ", "curl 内容为空"),
        ('curl -H "User-Agent: Mozilla"', "缺少"),
        ('curl -b "session=abc"', "缺少"),  # 缺少 UA
        ("curl invalid syntax'", "curl 解析失败"),
    ],
)
def test_extract_auth_errors(invalid_curl, error_msg):
    """测试各种错误输入场景"""
    with pytest.raises(ValueError, match=error_msg):
        extract_auth_from_curl(invalid_curl)


class TestExtractBearerToken(unittest.TestCase):
    """测试 Bearer Token 提取"""

    def test_extract_bearer_token_from_header(self):
        curl_text = (
            "curl 'https://h-comic.com/' "
            "-b 'session=abc' "
            "-H 'User-Agent: Test-UA/1.0' "
            "-H 'Authorization: Bearer eyJhbGciOiJSUzI1NiI...' "
        )
        cookie, user_agent, bearer, domain = extract_auth_from_curl(curl_text)
        self.assertEqual(cookie, "session=abc")
        self.assertEqual(user_agent, "Test-UA/1.0")
        self.assertEqual(bearer, "eyJhbGciOiJSUzI1NiI...")

    def test_no_bearer_token_returns_empty(self):
        curl_text = "curl 'https://h-comic.com/' " "-b 'session=abc' " "-A 'UA'"
        cookie, user_agent, bearer, domain = extract_auth_from_curl(curl_text)
        self.assertEqual(cookie, "session=abc")
        self.assertEqual(user_agent, "UA")
        self.assertEqual(bearer, "")

    def test_authorization_header_without_bearer_returns_empty(self):
        curl_text = (
            "curl 'https://h-comic.com/' "
            "-b 'session=abc' "
            "-A 'UA' "
            "-H 'Authorization: Basic abc123'"
        )
        cookie, user_agent, bearer, domain = extract_auth_from_curl(curl_text)
        self.assertEqual(cookie, "session=abc")
        self.assertEqual(user_agent, "UA")
        self.assertEqual(bearer, "")


if __name__ == "__main__":
    unittest.main()
