"""Parser 收藏夹解析测试"""
import json
import unittest

from parser import HComicParser


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


if __name__ == "__main__":
    unittest.main()
