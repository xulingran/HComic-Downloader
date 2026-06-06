"""jmcomic 收藏夹解析测试"""

import unittest
from unittest.mock import MagicMock, patch

import requests

from sources.jmcomic.parser import JmParser


def _make_homepage_resp(username: str = "testuser", status: int = 200) -> MagicMock:
    """构造一个包含用户名收藏链接的首页响应 mock。"""
    resp = MagicMock()
    resp.status_code = status
    resp.encoding = "utf-8"
    resp.url = "https://18comic.vip/"
    resp.text = (
        f"<html><body>"
        f'<a href="/user/{username}/favorite/albums">收藏</a>'
        f"</body></html>"
    )
    return resp


def _make_fav_resp(
    username: str = "testuser",
    page: int = 1,
    status: int = 200,
    text: str = "<html></html>",
) -> MagicMock:
    """构造一个收藏夹页面响应 mock。"""
    resp = MagicMock()
    resp.status_code = status
    resp.encoding = "utf-8"
    suffix = f"?page={page}" if page > 1 else ""
    resp.url = f"https://18comic.vip/user/{username}/favorite/albums{suffix}"
    resp.text = text
    return resp


class TestJmcomicFavourites(unittest.TestCase):
    """测试 jmcomic 收藏夹解析流程"""

    def setUp(self):
        self.parser = JmParser(timeout=5)
        self.parser._domain = "18comic.vip"

    # ── 基本功能 ──────────────────────────────────────────────────────────────

    @patch("sources.jmcomic.parser.etree.HTML")
    def test_favourites_returns_comics_and_pagination(self, mock_html):
        """已知用户名时成功获取收藏夹漫画列表"""
        self.parser._username = "testuser"
        mock_doc = MagicMock()
        mock_html.return_value = mock_doc
        mock_item = MagicMock()
        mock_doc.xpath.side_effect = lambda xpath: {
            '//div[contains(@class,"thumb-overlay")]': [mock_item],
            '//div[contains(text(),"請先登入")]': [],
        }.get(xpath, [])
        mock_item.xpath.side_effect = lambda xpath: {
            ".//a/@href": ["/album/12345"],
            ".//img/@title": ["测试漫画"],
            ".//img/@data-original": ["https://cdn.example.com/cover.jpg"],
            './/span[contains(@class,"video-title")]/text()': [],
        }.get(xpath, [])

        self.parser.session.get = MagicMock(return_value=_make_fav_resp())

        comics, pagination, needs_login = self.parser.favourites(page=1)

        self.assertFalse(needs_login)
        self.assertEqual(len(comics), 1)
        self.assertEqual(comics[0].id, "12345")
        self.assertEqual(comics[0].title, "测试漫画")
        self.assertEqual(comics[0].source_site, "jmcomic")

    # ── 登录检测 ─────────────────────────────────────────────────────────────

    def test_favourites_detects_login_redirect(self):
        """收藏夹页面重定向到 /login 时返回 needs_login=True"""
        self.parser._username = "testuser"
        resp = MagicMock()
        resp.url = "https://18comic.vip/login"
        resp.status_code = 200
        resp.encoding = "utf-8"
        resp.text = "<html></html>"
        self.parser.session.get = MagicMock(return_value=resp)

        comics, pagination, needs_login = self.parser.favourites(page=1)

        self.assertTrue(needs_login)
        self.assertEqual(comics, [])
        self.assertIsNone(pagination)

    def test_favourites_detects_login_prompt(self):
        """收藏夹页面含「請先登入」文字时返回 needs_login=True"""
        self.parser._username = "testuser"
        resp = _make_fav_resp(text="<html><div>請先登入</div></html>")
        self.parser.session.get = MagicMock(return_value=resp)

        comics, pagination, needs_login = self.parser.favourites(page=1)

        self.assertTrue(needs_login)
        self.assertEqual(comics, [])

    def test_favourites_returns_needs_login_when_username_discovery_fails(self):
        """用户名未知且首页发现失败时，返回 needs_login=True"""
        # 首页返回 200 但不含 /favorite 链接（未登录状态）
        homepage_resp = MagicMock()
        homepage_resp.status_code = 200
        homepage_resp.encoding = "utf-8"
        homepage_resp.url = "https://18comic.vip/"
        homepage_resp.text = "<html><body><a href='/login'>登入</a></body></html>"
        self.parser.session.get = MagicMock(return_value=homepage_resp)

        comics, pagination, needs_login = self.parser.favourites(page=1)

        self.assertTrue(needs_login)
        self.assertEqual(comics, [])

    # ── 错误处理 ─────────────────────────────────────────────────────────────

    def test_favourites_handles_network_error_on_fav_page(self):
        """收藏夹页面网络错误时静默返回空列表"""
        self.parser._username = "testuser"
        self.parser.session.get = MagicMock(
            side_effect=requests.ConnectionError("网络错误")
        )

        comics, pagination, needs_login = self.parser.favourites(page=1)

        self.assertFalse(needs_login)
        self.assertEqual(comics, [])
        self.assertIsNone(pagination)

    def test_favourites_raises_when_raise_errors_true(self):
        """raise_errors=True 时，收藏夹页面网络错误向上传播"""
        self.parser._username = "testuser"
        self.parser.session.get = MagicMock(
            side_effect=requests.ConnectionError("网络错误")
        )

        with self.assertRaises(requests.ConnectionError):
            self.parser.favourites(page=1, raise_errors=True)

    # ── URL 构造 ─────────────────────────────────────────────────────────────

    def test_favourites_builds_canonical_url_page1(self):
        """已知用户名时 page=1 使用规范 URL（无 page 参数）"""
        self.parser._username = "testuser"
        self.parser.session.get = MagicMock(return_value=_make_fav_resp())

        self.parser.favourites(page=1)

        url = self.parser.session.get.call_args[0][0]
        self.assertIn("/user/testuser/favorite/albums", url)
        self.assertNotIn("page=", url)

    def test_favourites_builds_canonical_url_page3(self):
        """已知用户名时 page=3 正确附加 ?page=3"""
        self.parser._username = "testuser"
        self.parser.session.get = MagicMock(return_value=_make_fav_resp(page=3))

        self.parser.favourites(page=3)

        url = self.parser.session.get.call_args[0][0]
        self.assertIn("/user/testuser/favorite/albums", url)
        self.assertIn("page=3", url)

    def test_favourites_discovers_username_from_homepage_then_fetches(self):
        """用户名未知时，先请求首页发现用户名，再请求收藏夹"""
        homepage_resp = _make_homepage_resp(username="xulingran")
        fav_resp = _make_fav_resp(username="xulingran")
        self.parser.session.get = MagicMock(side_effect=[homepage_resp, fav_resp])

        self.parser.favourites(page=1)

        calls = self.parser.session.get.call_args_list
        # 第一次：首页
        self.assertIn("18comic.vip/", calls[0][0][0])
        self.assertNotIn("/favorite", calls[0][0][0])
        # 第二次：规范收藏夹 URL
        self.assertIn("/user/xulingran/favorite/albums", calls[1][0][0])
        # 用户名已被缓存
        self.assertEqual(self.parser._username, "xulingran")

    def test_favourites_page2_uses_cached_username(self):
        """已知用户名时 page=2 直接使用规范 URL，不再请求首页"""
        self.parser._username = "xulingran"
        self.parser.session.get = MagicMock(return_value=_make_fav_resp(page=2))

        self.parser.favourites(page=2)

        # 只发起一次请求（直接到收藏夹，不需要先发现用户名）
        self.assertEqual(self.parser.session.get.call_count, 1)
        url = self.parser.session.get.call_args[0][0]
        self.assertIn("/user/xulingran/favorite/albums", url)
        self.assertIn("page=2", url)

    def test_build_favourites_url_raises_when_username_unknown(self):
        """_build_favourites_url 在用户名未知时抛出 RuntimeError"""
        with self.assertRaises(RuntimeError):
            self.parser._build_favourites_url("18comic.vip", 1)


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


class TestFillMissingTitles(unittest.TestCase):
    """测试 _fill_missing_titles 并发标题补全。"""

    def setUp(self):
        self.parser = JmParser(timeout=5)
        self.parser._domain = "18comic.vip"
        self.parser._cdn_domain = None
        self.parser._cookie = ""
        self.parser._cookie_synced = True

    def test_fill_skips_when_all_titled(self):
        """所有 comic 都有标题时不发起任何请求。"""
        from models import ComicInfo

        comics = [
            ComicInfo(
                id="1", title="Title A", source_site="jmcomic", comic_source="JMCOMIC"
            ),
            ComicInfo(
                id="2", title="Title B", source_site="jmcomic", comic_source="JMCOMIC"
            ),
        ]
        # _serialize_cookies_for_title_fetch 不应被调用（所有标题已存在）

        self.parser._fill_missing_titles(comics, "18comic.vip")

        # 标题不变
        assert comics[0].title == "Title A"
        assert comics[1].title == "Title B"

    def test_fill_updates_missing_titles(self):
        """缺失标题的 comic 被正确填充。"""
        from unittest.mock import patch

        from models import ComicInfo

        comics = [
            ComicInfo(
                id="1", title="已有标题", source_site="jmcomic", comic_source="JMCOMIC"
            ),
            ComicInfo(
                id="2", title="未知标题", source_site="jmcomic", comic_source="JMCOMIC"
            ),
        ]

        detail_html = (
            "<html><body>" '<h1 id="book-name">补全的标题</h1>' "</body></html>"
        )

        mock_thread_session = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.encoding = "utf-8"
        mock_resp.text = detail_html
        mock_resp.url = "https://18comic.vip/album/2"
        mock_thread_session.get.return_value = mock_resp

        with patch("time.sleep", lambda x: None), patch(
            "sources.jmcomic.title_resolver._create_thread_session",
            return_value=mock_thread_session,
        ), patch(
            "sources.jmcomic.title_resolver.apply_system_proxy_to_session",
            lambda s: None,
        ), patch.object(
            self.parser,
            "_serialize_cookies_for_title_fetch",
            return_value=[("ck", "val")],
        ):
            self.parser._fill_missing_titles(comics, "18comic.vip")

        assert comics[0].title == "已有标题"
        assert comics[1].title == "补全的标题"

    def test_fill_handles_login_redirect(self):
        """线程被重定向到 /login → 标题不填充。"""
        from unittest.mock import patch

        from models import ComicInfo

        comics = [
            ComicInfo(
                id="3", title="未知标题", source_site="jmcomic", comic_source="JMCOMIC"
            ),
        ]

        mock_thread_session = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.encoding = "utf-8"
        mock_resp.text = "<html>login page</html>"
        mock_resp.url = "https://18comic.vip/login"
        mock_thread_session.get.return_value = mock_resp

        with patch("time.sleep", lambda x: None), patch(
            "sources.jmcomic.title_resolver._create_thread_session",
            return_value=mock_thread_session,
        ), patch(
            "sources.jmcomic.title_resolver.apply_system_proxy_to_session",
            lambda s: None,
        ), patch.object(
            self.parser,
            "_serialize_cookies_for_title_fetch",
            return_value=[("ck", "val")],
        ):
            self.parser._fill_missing_titles(comics, "18comic.vip")

        # 登录重定向时标题不填充
        assert comics[0].title == "未知标题"

    def test_fill_handles_error_page(self):
        """线程被重定向到 /error/ → 标题不填充。"""
        from unittest.mock import patch

        from models import ComicInfo

        comics = [
            ComicInfo(
                id="4", title="未知标题", source_site="jmcomic", comic_source="JMCOMIC"
            ),
        ]

        mock_thread_session = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.encoding = "utf-8"
        mock_resp.text = "<html>error</html>"
        mock_resp.url = "https://18comic.vip/error/404"
        mock_thread_session.get.return_value = mock_resp

        with patch("time.sleep", lambda x: None), patch(
            "sources.jmcomic.title_resolver._create_thread_session",
            return_value=mock_thread_session,
        ), patch(
            "sources.jmcomic.title_resolver.apply_system_proxy_to_session",
            lambda s: None,
        ), patch.object(
            self.parser,
            "_serialize_cookies_for_title_fetch",
            return_value=[("ck", "val")],
        ):
            self.parser._fill_missing_titles(comics, "18comic.vip")

        assert comics[0].title == "未知标题"

    def test_fill_json_ld_fallback(self):
        """当 h1 标题为 '未知标题' 时从 JSON-LD 提取。"""
        from unittest.mock import patch

        from models import ComicInfo

        comics = [
            ComicInfo(
                id="5", title="未知标题", source_site="jmcomic", comic_source="JMCOMIC"
            ),
        ]

        detail_html = (
            "<html><body>"
            '<h1 id="book-name">未知标题</h1>'
            '<script type="application/ld+json">'
            '{"name": "JSON-LD 标题"}'
            "</script>"
            "</body></html>"
        )

        mock_thread_session = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.encoding = "utf-8"
        mock_resp.text = detail_html
        mock_resp.url = "https://18comic.vip/album/5"
        mock_thread_session.get.return_value = mock_resp

        with patch("time.sleep", lambda x: None), patch(
            "sources.jmcomic.title_resolver._create_thread_session",
            return_value=mock_thread_session,
        ), patch(
            "sources.jmcomic.title_resolver.apply_system_proxy_to_session",
            lambda s: None,
        ), patch.object(
            self.parser,
            "_serialize_cookies_for_title_fetch",
            return_value=[("ck", "val")],
        ):
            self.parser._fill_missing_titles(comics, "18comic.vip")

        assert comics[0].title == "JSON-LD 标题"

    def test_fill_network_error_graceful(self):
        """线程内网络异常 → 该条目跳过，不影响其他。"""
        from unittest.mock import patch

        from models import ComicInfo

        comics = [
            ComicInfo(
                id="6", title="未知标题", source_site="jmcomic", comic_source="JMCOMIC"
            ),
            ComicInfo(
                id="7", title="已有标题", source_site="jmcomic", comic_source="JMCOMIC"
            ),
        ]

        mock_thread_session = MagicMock()
        mock_thread_session.get.side_effect = requests.ConnectionError("network down")

        with patch("time.sleep", lambda x: None), patch(
            "sources.jmcomic.title_resolver._create_thread_session",
            return_value=mock_thread_session,
        ), patch(
            "sources.jmcomic.title_resolver.apply_system_proxy_to_session",
            lambda s: None,
        ), patch.object(
            self.parser,
            "_serialize_cookies_for_title_fetch",
            return_value=[("ck", "val")],
        ):
            self.parser._fill_missing_titles(comics, "18comic.vip")

        # 网络错误的条目保持原标题，已有标题的不受影响
        assert comics[0].title == "未知标题"
        assert comics[1].title == "已有标题"
