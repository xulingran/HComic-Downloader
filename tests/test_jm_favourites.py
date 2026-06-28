"""jm 收藏夹解析测试"""

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import requests

from sources.base import AntiBotChallengeError
from sources.jm.parser import JmParser


def _make_homepage_resp(username: str = "testuser", status: int = 200) -> MagicMock:
    """构造一个包含用户名收藏链接的首页响应 mock。"""
    resp = MagicMock()
    resp.status_code = status
    resp.encoding = "utf-8"
    resp.url = "https://18comic.vip/"
    resp.text = f'<html><body><a href="/user/{username}/favorite/albums">收藏</a></body></html>'
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
    resp.headers = {}
    return resp


def _make_challenge_resp(text: str | None = None) -> MagicMock:
    """构造 Cloudflare 明确标记的收藏夹挑战响应。"""
    resp = _make_fav_resp(status=403, text=text or ("x" * 6000))
    resp.headers = {"cf-mitigated": "challenge", "server": "cloudflare"}
    return resp


class TestJmFavourites(unittest.TestCase):
    """测试 jm 收藏夹解析流程"""

    def setUp(self):
        self.parser = JmParser(timeout=5)
        self.parser._domain = "18comic.vip"

    # ── 基本功能 ──────────────────────────────────────────────────────────────

    @patch("sources.jm.parser.etree.HTML")
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
        self.assertEqual(comics[0].source_site, "jm")

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
        self.parser.session.get = MagicMock(side_effect=requests.ConnectionError("网络错误"))

        comics, pagination, needs_login = self.parser.favourites(page=1)

        self.assertFalse(needs_login)
        self.assertEqual(comics, [])
        self.assertIsNone(pagination)

    def test_favourites_raises_when_raise_errors_true(self):
        """raise_errors=True 时，收藏夹页面网络错误向上传播"""
        self.parser._username = "testuser"
        self.parser.session.get = MagicMock(side_effect=requests.ConnectionError("网络错误"))

        with self.assertRaises(requests.ConnectionError):
            self.parser.favourites(page=1, raise_errors=True)

    def test_favourites_recovers_after_challenge_with_same_session_and_auth(self):
        """首次挑战后应在同一 Session 预热并成功重试收藏夹。"""
        cookie = "remember_id=42"
        self.parser.configure_auth(cookie=cookie, user_agent="UA/1.0")
        self.parser._domain = "18comic.vip"
        self.parser._username = "testuser"
        get = MagicMock(
            side_effect=[
                _make_challenge_resp(),
                _make_homepage_resp(),
                _make_fav_resp(),
            ]
        )
        self.parser.session.get = get

        comics, pagination, needs_login = self.parser.favourites(page=1, raise_errors=True)

        self.assertEqual(comics, [])
        self.assertIsNone(pagination)
        self.assertFalse(needs_login)
        self.assertEqual(get.call_count, 3)
        self.assertIn("/favorite/albums", get.call_args_list[0].args[0])
        self.assertEqual(get.call_args_list[1].args[0], "https://18comic.vip/")
        self.assertIn("/favorite/albums", get.call_args_list[2].args[0])
        for call in get.call_args_list:
            self.assertEqual(call.kwargs["headers"]["Cookie"], cookie)
            self.assertEqual(call.kwargs["headers"]["Referer"], "https://18comic.vip/")

    def test_favourites_raises_challenge_error_after_bounded_retries(self):
        """持续挑战最多请求三次收藏夹，并抛出结构化挑战异常。"""
        self.parser._username = "testuser"
        get = MagicMock(
            side_effect=[
                _make_challenge_resp(),
                _make_challenge_resp(),  # 首页预热也被挑战
                _make_challenge_resp(),
                _make_challenge_resp(),
            ]
        )
        self.parser.session.get = get

        with self.assertRaises(AntiBotChallengeError) as ctx:
            self.parser.favourites(page=1, raise_errors=True)

        self.assertIn("人机验证", str(ctx.exception))
        self.assertNotIn("登录凭证已失效", str(ctx.exception))
        self.assertEqual(
            ctx.exception.challenge_url,
            "https://18comic.vip/user/testuser/favorite/albums",
        )
        self.assertEqual(get.call_count, 4)
        favourite_calls = [call for call in get.call_args_list if "/favorite/albums" in call.args[0]]
        self.assertEqual(len(favourite_calls), 3)

    def test_favourites_does_not_retry_plain_403(self):
        """无挑战信号的普通 403 沿用 HTTP 错误路径且不重试。"""
        self.parser._username = "testuser"
        resp = _make_fav_resp(status=403, text="Forbidden")
        error = requests.HTTPError("403 Client Error", response=resp)
        resp.raise_for_status.side_effect = error
        self.parser.session.get = MagicMock(return_value=resp)

        with self.assertRaises(requests.HTTPError):
            self.parser.favourites(page=1, raise_errors=True)

        self.parser.session.get.assert_called_once()

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

    def test_favourites_sends_explicit_cookie_header(self):
        """Electron 导入的 jm Cookie 应作为显式请求头发送。"""
        cookie = "remember=abc; remember_id=42; cf_clearance=token"
        self.parser.configure_auth(cookie=cookie, user_agent="UA/1.0")
        self.parser._domain = "18comic.vip"
        self.parser._username = "testuser"
        self.parser.session.get = MagicMock(return_value=_make_fav_resp())

        self.parser.favourites(page=1)

        headers = self.parser.session.get.call_args.kwargs["headers"]
        self.assertEqual(headers["Cookie"], cookie)
        self.assertEqual(headers["Referer"], "https://18comic.vip/")

    def test_sync_cookies_to_jar_sets_host_and_domain_entries(self):
        """Cookie jar 同步同时写入 host-only 与 domain cookie。"""

        class FakeJar:
            def __init__(self):
                self.cookies = []

            def set_cookie(self, cookie):
                self.cookies.append(cookie)

        jar = FakeJar()
        self.parser.configure_auth(cookie="remember=abc; cf_clearance=token", user_agent="UA/1.0")
        self.parser.session = SimpleNamespace(cookies=jar)
        self.parser._domain = "18comic.vip"

        self.parser._sync_cookies_to_jar()

        domains = {(cookie.name, cookie.domain, cookie.domain_specified) for cookie in jar.cookies}
        self.assertIn(("remember", "18comic.vip", False), domains)
        self.assertIn(("remember", ".18comic.vip", True), domains)
        self.assertIn(("cf_clearance", "18comic.vip", False), domains)
        self.assertIn(("cf_clearance", ".18comic.vip", True), domains)
        self.assertTrue(self.parser._cookie_synced)

    def test_parse_favourites_snapshot_uses_rendered_dom_without_network(self):
        """浏览器快照走共享解析流程，且不触发标题补全网络请求。"""
        self.parser._username = "testuser"
        html = """
        <html><body>
          <div class="thumb-overlay">
            <a href="/album/12345"><img title="渲染后标题" src="/cover.jpg"></a>
          </div>
          <ul class="pagination">
            <li><a href="?page=1">1</a></li>
            <li class="active">2</li>
            <li><a href="?page=3">3</a></li>
          </ul>
        </body></html>
        """
        self.parser.session.get = MagicMock()

        comics, pagination, needs_login = self.parser.parse_favourites_snapshot(
            html,
            "https://18comic.vip/user/testuser/favorite/albums?page=2",
            page=2,
        )

        self.assertFalse(needs_login)
        self.assertEqual([comic.id for comic in comics], ["12345"])
        self.assertEqual(comics[0].title, "渲染后标题")
        self.assertEqual(pagination.current_page, 2)
        self.assertEqual(pagination.total_pages, 3)
        self.parser.session.get.assert_not_called()

    def test_parse_favourites_snapshot_accepts_visible_list_with_non_active_captcha_marker(self):
        """已渲染收藏夹列表即使残留 captcha 文本，也不应被误判为未完成验证。"""
        html = """
        <html><body>
          <script>window.captchaConfig = {};</script>
          <div class="thumb-overlay">
            <a href="/album/12345"><img title="渲染后标题" src="/cover.jpg"></a>
          </div>
        </body></html>
        """

        comics, pagination, needs_login = self.parser.parse_favourites_snapshot(
            html,
            "https://18comic.vip/user/testuser/favorite/albums",
        )

        self.assertFalse(needs_login)
        self.assertEqual([comic.id for comic in comics], ["12345"])
        self.assertIsNone(pagination)

    def test_parse_favourites_snapshot_rejects_challenge_page(self):
        with self.assertRaises(AntiBotChallengeError):
            self.parser.parse_favourites_snapshot(
                '<html><script src="/cdn-cgi/challenge-platform/x"></script></html>',
                "https://18comic.vip/user/testuser/favorite/albums",
            )

    def test_parse_favourites_snapshot_rejects_untrusted_url(self):
        with self.assertRaisesRegex(ValueError, "不受信任"):
            self.parser.parse_favourites_snapshot(
                "<html><body></body></html>",
                "https://evil.example/user/testuser/favorite/albums",
            )

    def test_parse_favourites_snapshot_rejects_page_mismatch(self):
        with self.assertRaisesRegex(ValueError, "页码不匹配"):
            self.parser.parse_favourites_snapshot(
                "<html><body></body></html>",
                "https://18comic.vip/user/testuser/favorite/albums?page=3",
                page=2,
            )

    def test_parse_favourites_snapshot_rejects_oversized_html(self):
        with self.assertRaisesRegex(ValueError, "5 MiB"):
            self.parser.parse_favourites_snapshot(
                "x" * (5 * 1024 * 1024 + 1),
                "https://18comic.vip/user/testuser/favorite/albums",
            )


class TestJmAddToFavourites(unittest.TestCase):
    """测试 jm 加入收藏夹 API"""

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
        self.parser.session.post = MagicMock(side_effect=requests.ConnectionError("网络错误"))

        with self.assertRaises(RuntimeError) as ctx:
            self.parser.add_to_favourites("12345")
        self.assertIn("加入收藏夹失败", str(ctx.exception))

    def test_add_to_favourites_timeout(self):
        """测试超时"""
        self.parser.session.post = MagicMock(side_effect=requests.Timeout("超时"))

        with self.assertRaises(RuntimeError) as ctx:
            self.parser.add_to_favourites("12345")
        self.assertIn("加入收藏夹失败", str(ctx.exception))


class TestJmCheckFavourite(unittest.TestCase):
    """测试 jm 检查收藏状态 API"""

    def setUp(self):
        self.parser = JmParser(timeout=5)
        self.parser._domain = "18comic.vip"

    def test_check_favourite_favourited(self):
        """测试漫画已收藏"""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status.return_value = None
        mock_response.headers = {"content-type": "application/json"}
        mock_response.json.return_value = {"favorited": True}
        self.parser.session.get = MagicMock(return_value=mock_response)

        result = self.parser.check_favourite("12345")

        self.assertTrue(result)

    def test_check_favourite_not_favourited(self):
        """测试漫画未收藏"""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status.return_value = None
        mock_response.headers = {"content-type": "application/json"}
        mock_response.json.return_value = {"favorited": False}
        self.parser.session.get = MagicMock(return_value=mock_response)

        result = self.parser.check_favourite("12345")

        self.assertFalse(result)

    def test_check_favourite_uses_known_favourites_cache(self):
        """收藏夹页已解析到的 ID 应直接视为已收藏。"""
        self.parser._known_favourite_ids.add("12345")
        self.parser.session.get = MagicMock()

        result = self.parser.check_favourite("12345")

        self.assertTrue(result)
        self.parser.session.get.assert_not_called()

    def test_check_favourite_404_returns_false(self):
        """jm 旧 check API 不存在时不应阻断详情抽屉。"""
        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_response.headers = {}
        self.parser.session.get = MagicMock(return_value=mock_response)

        result = self.parser.check_favourite("12345")

        self.assertFalse(result)
        mock_response.raise_for_status.assert_not_called()

    def test_check_favourite_network_error(self):
        """测试网络错误"""
        self.parser.session.get = MagicMock(side_effect=requests.ConnectionError("网络错误"))

        with self.assertRaises(RuntimeError) as ctx:
            self.parser.check_favourite("12345")
        self.assertIn("检查收藏状态失败", str(ctx.exception))


class TestJmRemoveFromFavourites(unittest.TestCase):
    """测试 jm 移除收藏夹 API"""

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
        self.parser.session.post = MagicMock(side_effect=requests.ConnectionError("网络错误"))

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
            ComicInfo(id="1", title="Title A", source_site="jm", comic_source="JM"),
            ComicInfo(id="2", title="Title B", source_site="jm", comic_source="JM"),
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
            ComicInfo(id="1", title="已有标题", source_site="jm", comic_source="JM"),
            ComicInfo(id="2", title="未知标题", source_site="jm", comic_source="JM"),
        ]

        detail_html = '<html><body><h1 id="book-name">补全的标题</h1></body></html>'

        mock_thread_session = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.encoding = "utf-8"
        mock_resp.text = detail_html
        mock_resp.url = "https://18comic.vip/album/2"
        mock_thread_session.get.return_value = mock_resp

        with (
            patch("time.sleep", lambda x: None),
            patch(
                "sources.jm.title_resolver._create_thread_session",
                return_value=mock_thread_session,
            ),
            patch(
                "sources.jm.title_resolver.apply_system_proxy_to_session",
                lambda s: None,
            ),
            patch.object(
                self.parser,
                "_serialize_cookies_for_title_fetch",
                return_value=[("ck", "val")],
            ),
        ):
            self.parser._fill_missing_titles(comics, "18comic.vip")

        assert comics[0].title == "已有标题"
        assert comics[1].title == "补全的标题"

    def test_fill_handles_login_redirect(self):
        """线程被重定向到 /login → 标题不填充。"""
        from unittest.mock import patch

        from models import ComicInfo

        comics = [
            ComicInfo(id="3", title="未知标题", source_site="jm", comic_source="JM"),
        ]

        mock_thread_session = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.encoding = "utf-8"
        mock_resp.text = "<html>login page</html>"
        mock_resp.url = "https://18comic.vip/login"
        mock_thread_session.get.return_value = mock_resp

        with (
            patch("time.sleep", lambda x: None),
            patch(
                "sources.jm.title_resolver._create_thread_session",
                return_value=mock_thread_session,
            ),
            patch(
                "sources.jm.title_resolver.apply_system_proxy_to_session",
                lambda s: None,
            ),
            patch.object(
                self.parser,
                "_serialize_cookies_for_title_fetch",
                return_value=[("ck", "val")],
            ),
        ):
            self.parser._fill_missing_titles(comics, "18comic.vip")

        # 登录重定向时标题不填充
        assert comics[0].title == "未知标题"

    def test_fill_handles_error_page(self):
        """线程被重定向到 /error/ → 标题不填充。"""
        from unittest.mock import patch

        from models import ComicInfo

        comics = [
            ComicInfo(id="4", title="未知标题", source_site="jm", comic_source="JM"),
        ]

        mock_thread_session = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.encoding = "utf-8"
        mock_resp.text = "<html>error</html>"
        mock_resp.url = "https://18comic.vip/error/404"
        mock_thread_session.get.return_value = mock_resp

        with (
            patch("time.sleep", lambda x: None),
            patch(
                "sources.jm.title_resolver._create_thread_session",
                return_value=mock_thread_session,
            ),
            patch(
                "sources.jm.title_resolver.apply_system_proxy_to_session",
                lambda s: None,
            ),
            patch.object(
                self.parser,
                "_serialize_cookies_for_title_fetch",
                return_value=[("ck", "val")],
            ),
        ):
            self.parser._fill_missing_titles(comics, "18comic.vip")

        assert comics[0].title == "未知标题"

    def test_fill_json_ld_fallback(self):
        """当 h1 标题为 '未知标题' 时从 JSON-LD 提取。"""
        from unittest.mock import patch

        from models import ComicInfo

        comics = [
            ComicInfo(id="5", title="未知标题", source_site="jm", comic_source="JM"),
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

        with (
            patch("time.sleep", lambda x: None),
            patch(
                "sources.jm.title_resolver._create_thread_session",
                return_value=mock_thread_session,
            ),
            patch(
                "sources.jm.title_resolver.apply_system_proxy_to_session",
                lambda s: None,
            ),
            patch.object(
                self.parser,
                "_serialize_cookies_for_title_fetch",
                return_value=[("ck", "val")],
            ),
        ):
            self.parser._fill_missing_titles(comics, "18comic.vip")

        assert comics[0].title == "JSON-LD 标题"

    def test_fill_network_error_graceful(self):
        """线程内网络异常 → 该条目跳过，不影响其他。"""
        from unittest.mock import patch

        from models import ComicInfo

        comics = [
            ComicInfo(id="6", title="未知标题", source_site="jm", comic_source="JM"),
            ComicInfo(id="7", title="已有标题", source_site="jm", comic_source="JM"),
        ]

        mock_thread_session = MagicMock()
        mock_thread_session.get.side_effect = requests.ConnectionError("network down")

        with (
            patch("time.sleep", lambda x: None),
            patch(
                "sources.jm.title_resolver._create_thread_session",
                return_value=mock_thread_session,
            ),
            patch(
                "sources.jm.title_resolver.apply_system_proxy_to_session",
                lambda s: None,
            ),
            patch.object(
                self.parser,
                "_serialize_cookies_for_title_fetch",
                return_value=[("ck", "val")],
            ),
        ):
            self.parser._fill_missing_titles(comics, "18comic.vip")

        # 网络错误的条目保持原标题，已有标题的不受影响
        assert comics[0].title == "未知标题"
        assert comics[1].title == "已有标题"
