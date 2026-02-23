"""parser fallback 与网络错误处理测试"""

import requests

from parser import HComicParser, ParserResponseError


def test_extract_payload_data_primary_regex_fails():
    html = '<html><body>no payload</body></html>'
    try:
        HComicParser._extract_payload_data(html)
        raised = False
    except ValueError:
        raised = True
    assert raised is True


def test_extract_payload_data_fallback_succeeds():
    # 缺少 `form:`，主正则应失败，fallback 仍能提取 data
    html = 'data: [null, {"data": {"comics": [], "pages": {"pages": 1, "total": 0, "limit": 10}}}], extra text'
    data = HComicParser._extract_payload_data(html)
    assert data["comics"] == []
    assert data["pages"]["pages"] == 1


def test_network_timeout_returns_error_message(parser, monkeypatch):
    def mock_get(*args, **kwargs):
        raise requests.Timeout("timed out")

    monkeypatch.setattr(parser.session, "get", mock_get)

    try:
        parser._request_text("https://h-comic.com/?q=test")
        assert False, "expected ParserResponseError"
    except ParserResponseError as e:
        assert "请求超时" in str(e)
        assert "https://h-comic.com/?q=test" in str(e)
