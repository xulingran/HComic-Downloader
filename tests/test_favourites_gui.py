"""收藏夹 GUI 行为测试"""
import time
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

        self.app = TestGUI()
        self.app.withdraw()

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


if __name__ == "__main__":
    unittest.main()
