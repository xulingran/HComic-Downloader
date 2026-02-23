"""收藏夹 GUI 行为测试"""
import time
import tkinter as tk
import unittest
from unittest.mock import patch

from gui import HComicDownloaderGUI
from models import ComicInfo, PaginationInfo


class ImmediateThread:
    """测试用同步线程替身。"""

    def __init__(self, target=None, daemon=None, args=(), kwargs=None):
        self.target = target
        self.args = args
        self.kwargs = kwargs or {}
        self.daemon = daemon

    def start(self):
        if self.target:
            self.target(*self.args, **self.kwargs)


class TestFavouritesGUI(unittest.TestCase):
    """测试收藏夹入口、翻页与未登录提示"""

    def setUp(self):
        class TestGUI(HComicDownloaderGUI):
            def center_window(self):
                pass

        try:
            self.app = TestGUI()
        except tk.TclError as exc:
            self.skipTest(f"Tk 不可用: {exc}")
        self.app.withdraw()
        # 固定测试来源为 hcomic，避免受本机配置 default_source 污染
        self.app.source_var.set("h-comic")
        with patch.object(self.app.config, "save", lambda *args, **kwargs: None):
            self.app._on_source_changed()

    def tearDown(self):
        self.app.destroy()

    def _wait_until(self, condition, timeout: float = 1.0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            self.app.update()
            if condition():
                return True
            time.sleep(0.01)
        return condition()

    def test_favourites_controls_exist(self):
        self.assertTrue(hasattr(self.app, "favourites_btn"))
        self.assertEqual(self.app.current_view_mode, "search")

    def test_view_favourites_calls_parser_and_switches_mode(self):
        comic = ComicInfo(id="c1", title="收藏漫画1", pages=8, media_id="m1", comic_source="NH")
        called_pages = []

        def fake_favourites(page=1):
            called_pages.append(page)
            return [comic], PaginationInfo(current_page=1, total_pages=1, total_items=1, limit=10), False

        self.app.parser.favourites = fake_favourites
        with patch("gui.threading.Thread", ImmediateThread):
            self.app.view_favourites()

        ok = self._wait_until(lambda: len(self.app.search_results) == 1 and called_pages)
        self.assertTrue(ok)
        self.assertEqual(called_pages, [1])
        self.assertEqual(self.app.current_view_mode, "favourites")
        self.assertEqual(self.app.search_results[0].id, "c1")

    def test_favourites_mode_pagination_uses_favourites_api(self):
        comic = ComicInfo(id="c2", title="收藏漫画2", pages=6, media_id="m2", comic_source="NH")
        called_pages = []
        called_search = []

        def fake_favourites(page=1):
            called_pages.append(page)
            return [comic], PaginationInfo(current_page=page, total_pages=3, total_items=3, limit=10), False

        def fake_search(keyword, page=1):
            called_search.append((keyword, page))
            return [], None

        self.app.parser.favourites = fake_favourites
        self.app.parser.search = fake_search
        self.app.current_view_mode = "favourites"
        self.app.current_page = 2
        self.app.total_pages = 3

        with patch("gui.threading.Thread", ImmediateThread):
            self.app._load_page()

        ok = self._wait_until(lambda: bool(called_pages))
        self.assertTrue(ok)
        self.assertEqual(called_pages, [2])
        self.assertEqual(called_search, [])

    @patch("tkinter.messagebox.showwarning")
    def test_search_without_keyword_still_calls_search_api(self, mock_warning):
        called_search = []
        comic = ComicInfo(id="s1", title="搜索结果1", pages=7, media_id="ms1", comic_source="NH")

        def fake_search(keyword, page=1):
            called_search.append((keyword, page))
            return [comic], PaginationInfo(current_page=page, total_pages=2, total_items=2, limit=10)

        self.app.parser.search = fake_search
        self.app.search_var.set("")

        with patch("gui.threading.Thread", ImmediateThread):
            self.app.search()

        ok = self._wait_until(lambda: bool(called_search))
        self.assertTrue(ok)
        self.assertEqual(called_search, [("", 1)])
        self.assertFalse(mock_warning.called)
        self.assertTrue(self.app.has_search_started)
        self.assertEqual(self.app.current_view_mode, "search")

    @patch("tkinter.messagebox.showinfo")
    def test_search_mode_pagination_allows_empty_keyword_after_search(self, mock_info):
        called_search = []
        comic = ComicInfo(id="s2", title="搜索结果2", pages=8, media_id="ms2", comic_source="NH")

        def fake_search(keyword, page=1):
            called_search.append((keyword, page))
            return [comic], PaginationInfo(current_page=page, total_pages=3, total_items=3, limit=10)

        self.app.parser.search = fake_search
        self.app.current_view_mode = "search"
        self.app.current_search_keyword = ""
        self.app.has_search_started = True
        self.app.current_page = 2
        self.app.total_pages = 3

        with patch("gui.threading.Thread", ImmediateThread):
            self.app._load_page()

        ok = self._wait_until(lambda: bool(called_search))
        self.assertTrue(ok)
        self.assertEqual(called_search, [("", 2)])
        self.assertFalse(mock_info.called)

    def test_pagination_load_scrolls_to_top(self):
        called_search = []
        comic = ComicInfo(id="s3", title="翻页结果", pages=3, media_id="ms3", comic_source="NH")

        def fake_search(keyword, page=1):
            called_search.append((keyword, page))
            return [comic], PaginationInfo(current_page=page, total_pages=3, total_items=3, limit=10)

        self.app.parser.search = fake_search
        self.app.current_view_mode = "search"
        self.app.current_search_keyword = "abc"
        self.app.has_search_started = True
        self.app.current_page = 2
        self.app.total_pages = 3
        self.app.canvas.yview_moveto = unittest.mock.MagicMock()

        with patch("gui.threading.Thread", ImmediateThread):
            self.app._load_page()

        ok = self._wait_until(lambda: bool(called_search))
        self.assertTrue(ok)
        self.app.canvas.yview_moveto.assert_any_call(0.0)

    @patch("tkinter.messagebox.showwarning")
    def test_view_favourites_login_required_keeps_existing_results(self, mock_warning):
        old_comic = ComicInfo(id="old", title="旧结果", pages=5, media_id="oldm", comic_source="NH")
        self.app.search_results = [old_comic]

        self.app.parser.favourites = lambda page=1: ([], None, True)
        with patch("gui.threading.Thread", ImmediateThread):
            self.app.view_favourites()

        ok = self._wait_until(lambda: mock_warning.called)
        self.assertTrue(ok)
        self.assertEqual(len(self.app.search_results), 1)
        self.assertEqual(self.app.search_results[0].id, "old")
        self.assertEqual(self.app.current_view_mode, "search")

    @patch("tkinter.messagebox.showwarning")
    def test_view_favourites_unsupported_source_shows_warning(self, mock_warning):
        self.app.source_var.set("moeimg.fan")
        with patch.object(self.app.config, "save", lambda *args, **kwargs: None):
            self.app._on_source_changed()
        self.assertEqual(self.app.parser.current_source, "moeimg")

        self.app.view_favourites()
        self.assertTrue(mock_warning.called)
        self.assertEqual(self.app.current_view_mode, "search")

    def test_moeimg_query_mode_author_transforms_search_keyword(self):
        called_search = []
        comic = ComicInfo(id="m1", title="作者搜索结果", pages=1, source_site="moeimg")

        def fake_search(keyword, page=1):
            called_search.append((keyword, page))
            return [comic], PaginationInfo(current_page=page, total_pages=1, total_items=1, limit=10)

        self.app.source_var.set("moeimg.fan")
        with patch.object(self.app.config, "save", lambda *args, **kwargs: None):
            self.app._on_source_changed()

        self.app.parser.search = fake_search
        self.app.query_mode_var.set("作者")
        self.app.search_var.set("horn-wood")

        with patch("gui.threading.Thread", ImmediateThread):
            self.app.search()

        ok = self._wait_until(lambda: bool(called_search))
        self.assertTrue(ok)
        self.assertEqual(called_search, [("Author: horn-wood", 1)])


if __name__ == "__main__":
    unittest.main()
