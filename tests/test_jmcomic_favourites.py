"""jmcomic 收藏夹解析测试"""

import unittest
from unittest.mock import MagicMock, patch

import requests

from sources.jmcomic.parser import JmParser


class TestJmcomicFavourites(unittest.TestCase):
    """测试 jmcomic 收藏夹解析流程"""

    def setUp(self):
        self.parser = JmParser(timeout=5)
        self.parser._domain = "18comic.vip"

    @patch("sources.jmcomic.parser.etree.HTML")
    def test_favourites_returns_comics_and_pagination(self, mock_html):
        """测试成功获取收藏夹漫画列表"""
        mock_doc = MagicMock()
        mock_html.return_value = mock_doc
        # 模拟 thumb-overlay 元素
        mock_item = MagicMock()
        mock_doc.xpath.side_effect = lambda xpath: {
            '//div[contains(@class,"thumb-overlay")]': [mock_item],
            '//div[contains(text(),"請先登入")]': [],
        }.get(xpath, [])
        # 模拟链接和标题
        mock_item.xpath.side_effect = lambda xpath: {
            ".//a/@href": ["/album/12345"],
            ".//img/@title": ["测试漫画"],
            ".//img/@data-original": ["https://cdn.example.com/cover.jpg"],
            './/span[contains(@class,"video-title")]/text()': [],
        }.get(xpath, [])

        mock_response = MagicMock()
        mock_response.url = "https://18comic.vip/user/favorites"
        mock_response.status_code = 200
        mock_response.encoding = "utf-8"
        mock_response.text = "<html></html>"
        self.parser.session.get = MagicMock(return_value=mock_response)

        comics, pagination, needs_login = self.parser.favourites(page=1)

        self.assertFalse(needs_login)
        self.assertEqual(len(comics), 1)
        self.assertEqual(comics[0].id, "12345")
        self.assertEqual(comics[0].title, "测试漫画")
        self.assertEqual(comics[0].source_site, "jmcomic")

    def test_favourites_detects_login_redirect(self):
        """测试检测到登录重定向"""
        mock_response = MagicMock()
        mock_response.url = "https://18comic.vip/login"
        mock_response.status_code = 200
        self.parser.session.get = MagicMock(return_value=mock_response)

        comics, pagination, needs_login = self.parser.favourites(page=1)

        self.assertTrue(needs_login)
        self.assertEqual(comics, [])
        self.assertIsNone(pagination)

    def test_favourites_detects_login_prompt(self):
        """测试检测到登录提示文字"""
        mock_response = MagicMock()
        mock_response.url = "https://18comic.vip/user/favorites"
        mock_response.status_code = 200
        mock_response.encoding = "utf-8"
        mock_response.text = "<html><div>請先登入</div></html>"
        self.parser.session.get = MagicMock(return_value=mock_response)

        comics, pagination, needs_login = self.parser.favourites(page=1)

        self.assertTrue(needs_login)
        self.assertEqual(comics, [])

    def test_favourites_handles_network_error(self):
        """测试网络错误处理"""
        self.parser.session.get = MagicMock(
            side_effect=requests.ConnectionError("网络错误")
        )

        comics, pagination, needs_login = self.parser.favourites(page=1)

        self.assertFalse(needs_login)
        self.assertEqual(comics, [])
        self.assertIsNone(pagination)

    def test_favourites_raises_when_raise_errors_true(self):
        """测试 raise_errors=True 时抛出异常"""
        self.parser.session.get = MagicMock(
            side_effect=requests.ConnectionError("网络错误")
        )

        with self.assertRaises(requests.ConnectionError):
            self.parser.favourites(page=1, raise_errors=True)

    def test_favourites_builds_url_with_page(self):
        """测试分页 URL 构建"""
        mock_response = MagicMock()
        mock_response.url = "https://18comic.vip/user/favorites?page=3"
        mock_response.status_code = 200
        mock_response.encoding = "utf-8"
        mock_response.text = "<html></html>"
        self.parser.session.get = MagicMock(return_value=mock_response)

        self.parser.favourites(page=3)

        call_args = self.parser.session.get.call_args
        self.assertIn("page=3", call_args[0][0])


class TestJmcomicAddToFavourites(unittest.TestCase):
    """测试 jmcomic 加入收藏夹 API"""

    def setUp(self):
        self.parser = JmParser(timeout=5)
        self.parser._domain = "18comic.vip"

    def test_add_to_favourites_success(self):
        """测试成功添加收藏"""
        mock_response = MagicMock()
        mock_response.raise_for_status.return_value = None
        mock_response.headers = {"content-type": "application/json"}
        mock_response.json.return_value = {"status": "ok"}
        self.parser.session.post = MagicMock(return_value=mock_response)

        result = self.parser.add_to_favourites("12345")

        self.assertTrue(result)
        self.parser.session.post.assert_called_once()
        call_args = self.parser.session.post.call_args
        self.assertIn("/ajax/favorite/add", call_args[0][0])
        self.assertEqual(call_args[1]["data"]["aid"], "12345")

    def test_add_to_favourites_network_error(self):
        """测试网络错误"""
        self.parser.session.post = MagicMock(
            side_effect=requests.ConnectionError("网络错误")
        )

        with self.assertRaises(RuntimeError) as ctx:
            self.parser.add_to_favourites("12345")
        self.assertIn("加入收藏夹失败", str(ctx.exception))

    def test_add_to_favourites_timeout(self):
        """测试超时"""
        self.parser.session.post = MagicMock(side_effect=requests.Timeout("超时"))

        with self.assertRaises(RuntimeError) as ctx:
            self.parser.add_to_favourites("12345")
        self.assertIn("加入收藏夹失败", str(ctx.exception))


class TestJmcomicCheckFavourite(unittest.TestCase):
    """测试 jmcomic 检查收藏状态 API"""

    def setUp(self):
        self.parser = JmParser(timeout=5)
        self.parser._domain = "18comic.vip"

    def test_check_favourite_favourited(self):
        """测试漫画已收藏"""
        mock_response = MagicMock()
        mock_response.raise_for_status.return_value = None
        mock_response.headers = {"content-type": "application/json"}
        mock_response.json.return_value = {"favorited": True}
        self.parser.session.get = MagicMock(return_value=mock_response)

        result = self.parser.check_favourite("12345")

        self.assertTrue(result)

    def test_check_favourite_not_favourited(self):
        """测试漫画未收藏"""
        mock_response = MagicMock()
        mock_response.raise_for_status.return_value = None
        mock_response.headers = {"content-type": "application/json"}
        mock_response.json.return_value = {"favorited": False}
        self.parser.session.get = MagicMock(return_value=mock_response)

        result = self.parser.check_favourite("12345")

        self.assertFalse(result)

    def test_check_favourite_network_error(self):
        """测试网络错误"""
        self.parser.session.get = MagicMock(
            side_effect=requests.ConnectionError("网络错误")
        )

        with self.assertRaises(RuntimeError) as ctx:
            self.parser.check_favourite("12345")
        self.assertIn("检查收藏状态失败", str(ctx.exception))


class TestJmcomicRemoveFromFavourites(unittest.TestCase):
    """测试 jmcomic 移除收藏夹 API"""

    def setUp(self):
        self.parser = JmParser(timeout=5)
        self.parser._domain = "18comic.vip"

    def test_remove_from_favourites_success(self):
        """测试成功移除收藏"""
        mock_response = MagicMock()
        mock_response.raise_for_status.return_value = None
        self.parser.session.post = MagicMock(return_value=mock_response)

        result = self.parser.remove_from_favourites("12345")

        self.assertTrue(result)
        self.parser.session.post.assert_called_once()
        call_args = self.parser.session.post.call_args
        self.assertIn("/ajax/favorite/remove", call_args[0][0])
        self.assertEqual(call_args[1]["data"]["aid"], "12345")

    def test_remove_from_favourites_network_error(self):
        """测试网络错误"""
        self.parser.session.post = MagicMock(
            side_effect=requests.ConnectionError("网络错误")
        )

        with self.assertRaises(RuntimeError) as ctx:
            self.parser.remove_from_favourites("12345")
        self.assertIn("移除收藏夹失败", str(ctx.exception))

    def test_remove_from_favourites_timeout(self):
        """测试超时"""
        self.parser.session.post = MagicMock(side_effect=requests.Timeout("超时"))

        with self.assertRaises(RuntimeError) as ctx:
            self.parser.remove_from_favourites("12345")
        self.assertIn("移除收藏夹失败", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
