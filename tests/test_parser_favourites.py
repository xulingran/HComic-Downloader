"""Parser 收藏夹解析测试"""
import json
import unittest
from unittest.mock import MagicMock

import requests

from parser import HComicParser, ParserResponseError


def _build_payload_html(data_obj: dict) -> str:
    return f"<script>data: [null, {json.dumps(data_obj, ensure_ascii=False)}], form: null</script>"


class TestParserFavourites(unittest.TestCase):
    """测试收藏夹解析流程"""

    def setUp(self):
        self.parser = HComicParser(timeout=5)

    def test_parse_favourites_page_detects_login_required(self):
        html = _build_payload_html({"data": {"favourites": {}}})

        results, pagination, needs_login = self.parser.parse_favourites_page(html, requested_page=1)

        self.assertEqual(results, [])
        self.assertIsNone(pagination)
        self.assertTrue(needs_login)

    def test_parse_favourites_page_maps_docs_and_pagination(self):
        comic = {
            "id": "123",
            "title": {"display": "收藏测试漫画"},
            "tags": [{"type": "artist", "name": "测试作者"}],
            "num_pages": 18,
            "upload_date": 1760000000,
            "media_id": "99999",
            "comic_source": "NH",
        }
        html = _build_payload_html({
            "data": {
                "favourites": {
                    "docs": [{"comic": comic}],
                    "page": 2,
                    "pages": 6,
                    "total": 55,
                    "limit": 10,
                }
            }
        })

        results, pagination, needs_login = self.parser.parse_favourites_page(html, requested_page=2)

        self.assertFalse(needs_login)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].id, "123")
        self.assertEqual(results[0].title, "收藏测试漫画")
        self.assertEqual(results[0].author, "测试作者")
        self.assertIsNotNone(pagination)
        self.assertEqual(pagination.current_page, 2)
        self.assertEqual(pagination.total_pages, 6)
        self.assertEqual(pagination.total_items, 55)
        self.assertEqual(pagination.limit, 10)

    def test_parse_favourites_page_skips_invalid_items(self):
        valid_comic = {
            "id": "456",
            "title": {"display": "有效漫画"},
            "tags": [],
            "num_pages": 12,
            "upload_date": 1760000000,
            "media_id": "12345",
            "comic_source": "NH",
        }
        html = _build_payload_html({
            "data": {
                "favourites": {
                    "docs": [
                        {"comic": "invalid"},
                        {"comic": valid_comic},
                        {"invalid": "item"},
                    ],
                    "page": 1,
                    "pages": 1,
                    "total": 1,
                    "limit": 10,
                }
            }
        })

        results, pagination, needs_login = self.parser.parse_favourites_page(html, requested_page=1)

        self.assertFalse(needs_login)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].id, "456")
        self.assertIsNotNone(pagination)

    def test_build_favourites_url_with_page(self):
        self.assertEqual(HComicParser._build_favourites_url(1), "https://h-comic.com/favourites")
        self.assertEqual(HComicParser._build_favourites_url(3), "https://h-comic.com/favourites?page=3")


class TestAddToFavourites(unittest.TestCase):
    """测试加入收藏夹 API"""

    def setUp(self):
        self.parser = HComicParser(timeout=5)

    def test_add_to_favourites_success(self):
        mock_response = MagicMock()
        mock_response.raise_for_status.return_value = None
        self.parser.session.post = MagicMock(return_value=mock_response)

        result = self.parser.add_to_favourites("6a14ab77fc09e3d46c481542")

        self.assertTrue(result)
        self.parser.session.post.assert_called_once_with(
            "https://api.h-comic.com/api/favourites",
            json={"comicId": "6a14ab77fc09e3d46c481542"},
            timeout=5,
            headers={
                "Origin": "https://h-comic.com",
                "Referer": "https://h-comic.com/",
                "Cookie": None,
            },
        )

    def test_add_to_favourites_http_401(self):
        error_response = MagicMock()
        error_response.status_code = 401
        self.parser.session.post = MagicMock(
            side_effect=requests.HTTPError(response=error_response)
        )

        with self.assertRaises(ParserResponseError) as ctx:
            self.parser.add_to_favourites("123")
        self.assertIn("认证已失效", str(ctx.exception))

    def test_add_to_favourites_http_403(self):
        error_response = MagicMock()
        error_response.status_code = 403
        self.parser.session.post = MagicMock(
            side_effect=requests.HTTPError(response=error_response)
        )

        with self.assertRaises(ParserResponseError) as ctx:
            self.parser.add_to_favourites("123")
        self.assertIn("认证已失效", str(ctx.exception))

    def test_add_to_favourites_network_error(self):
        self.parser.session.post = MagicMock(
            side_effect=requests.ConnectionError("网络错误")
        )

        with self.assertRaises(ParserResponseError) as ctx:
            self.parser.add_to_favourites("123")
        self.assertIn("请求失败", str(ctx.exception))

    def test_add_to_favourites_timeout(self):
        self.parser.session.post = MagicMock(
            side_effect=requests.Timeout("超时")
        )

        with self.assertRaises(ParserResponseError) as ctx:
            self.parser.add_to_favourites("123")
        self.assertIn("超时", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
