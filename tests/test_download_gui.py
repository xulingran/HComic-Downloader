"""下载流程 GUI 回归测试"""
import time
import os
import tkinter as tk
import unittest
import tempfile
from unittest.mock import MagicMock, patch

from gui import HComicDownloaderGUI
from models import ComicInfo, DownloadTask, DownloadStatus
from downloader import DownloadResult


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


class TestDownloadGUI(unittest.TestCase):
    """测试单本下载时的详情补齐行为"""

    def setUp(self):
        class TestGUI(HComicDownloaderGUI):
            def center_window(self):
                pass

        try:
            self.app = TestGUI()
        except tk.TclError as exc:
            self.skipTest(f"Tk 不可用: {exc}")
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

    @patch("tkinter.messagebox.showinfo")
    @patch("tkinter.messagebox.askyesno", return_value=True)
    def test_single_download_prepares_comic_before_confirm_and_download(self, mock_askyesno, _mock_showinfo):
        source_comic = ComicInfo(
            id="123",
            title="源漫画",
            source_site="moeimg",
            pages=0,
            author=None,
            image_urls=[],
        )
        prepared_comic = ComicInfo(
            id="123",
            title="源漫画",
            source_site="moeimg",
            pages=12,
            author="作者X",
            image_urls=[f"https://cdn.example/{i:03d}.webp" for i in range(1, 13)],
        )
        downloaded_comics = []

        self.app.parser.prepare_for_download = lambda comic: prepared_comic
        self.app.cbz_builder.get_output_path_for_format = lambda comic, output_format, output_dir: "/tmp/test.cbz"
        self.app.cbz_builder.build_cbz = lambda temp_dir, comic, output_path: "/tmp/test.cbz"
        self.app.downloader.cleanup_temp_dir = lambda temp_dir: None
        self.app.downloader.download_comic_resume = (
            lambda comic, output_dir, progress_callback=None, **kwargs: downloaded_comics.append(comic) or DownloadResult(success=True, completed_pages=[1], failed_pages=[], temp_dir="/tmp/temp_moeimg_123")
        )

        with patch("gui.threading.Thread", ImmediateThread), patch("gui.os.path.exists", return_value=False):
            self.app.dl_ctrl.download_comic(
                source_comic,
                self.app.search_ctrl.ensure_comics_detail_ready,
                self.app.search_btn,
                self.app.favourites_btn,
            )

        ok = self._wait_until(lambda: (not self.app.dl_ctrl.is_downloading) and bool(downloaded_comics))
        self.assertTrue(ok)
        self.assertIs(downloaded_comics[0], source_comic)
        self.assertEqual(downloaded_comics[0].author, "作者X")
        self.assertEqual(downloaded_comics[0].pages, 12)

        self.assertTrue(mock_askyesno.called)
        confirm_text = mock_askyesno.call_args[0][1]
        self.assertIn("作者: 作者X", confirm_text)
        self.assertIn("页数: 12", confirm_text)

    @patch("tkinter.messagebox.showinfo")
    @patch("tkinter.messagebox.askyesno", return_value=True)
    def test_single_download_uses_final_output_path_for_zip_and_cbz(self, mock_askyesno, _mock_showinfo):
        source_comic = ComicInfo(
            id="456",
            title="输出路径测试",
            source_site="moeimg",
            pages=0,
            author=None,
            image_urls=[],
        )
        prepared_comic = ComicInfo(
            id="456",
            title="输出路径测试",
            source_site="moeimg",
            pages=2,
            author="作者B",
            image_urls=["https://cdn.example/001.webp", "https://cdn.example/002.webp"],
        )

        for output_format, builder_method, suffix in (("zip", "build_zip", ".zip"), ("cbz", "build_cbz", ".cbz")):
            with self.subTest(output_format=output_format):
                mock_askyesno.reset_mock()
                downloaded_comics = []
                expected_output_path = os.path.join(tempfile.gettempdir(), f"hcomic_{output_format}{suffix}")

                self.app.config.output_format = output_format
                self.app.download_dir_var.set(tempfile.gettempdir())
                self.app.search_ctrl.ensure_comics_detail_ready = lambda comics, progress_callback=None: [prepared_comic]
                self.app.cbz_builder.get_output_path_for_format = MagicMock(return_value=expected_output_path)
                build_mock = MagicMock(return_value=expected_output_path)
                setattr(self.app.cbz_builder, builder_method, build_mock)
                self.app.downloader.cleanup_temp_dir = lambda temp_dir: None
                self.app.downloader.download_comic_resume = (
                    lambda comic, output_dir, progress_callback=None, **kwargs: downloaded_comics.append(comic) or DownloadResult(success=True, completed_pages=[1, 2], failed_pages=[], temp_dir="/tmp/temp_moeimg_456")
                )

                with patch("gui.threading.Thread", ImmediateThread), patch("gui.os.path.exists", return_value=False):
                    self.app.dl_ctrl.download_comic(
                        source_comic,
                        self.app.search_ctrl.ensure_comics_detail_ready,
                        self.app.search_btn,
                        self.app.favourites_btn,
                    )

                ok = self._wait_until(lambda: (not self.app.dl_ctrl.is_downloading) and build_mock.called)
                self.assertTrue(ok)
                self.assertTrue(mock_askyesno.called)
                build_mock.assert_called_once()
                self.assertEqual(build_mock.call_args.args[2], expected_output_path)
                self.assertEqual(downloaded_comics[0].pages, 2)
                self.assertEqual(downloaded_comics[0].author, "作者B")

    @patch("tkinter.messagebox.showerror")
    @patch("tkinter.messagebox.showinfo")
    @patch("tkinter.messagebox.askyesno")
    def test_single_download_stops_when_detail_prepare_fails(self, mock_askyesno, _mock_showinfo, mock_showerror):
        source_comic = ComicInfo(
            id="321",
            title="失败漫画",
            source_site="moeimg",
            pages=0,
            author=None,
            image_urls=[],
        )
        downloaded_comics = []

        def raise_prepare_error(_):
            raise RuntimeError("detail failed")

        self.app.search_ctrl.ensure_comics_detail_ready = raise_prepare_error
        self.app.cbz_builder.get_output_path_for_format = lambda comic, output_format, output_dir: "/tmp/test.cbz"
        self.app.downloader.download_comic_resume = (
            lambda comic, output_dir, progress_callback=None, **kwargs: downloaded_comics.append(comic) or DownloadResult(success=True, completed_pages=[1], failed_pages=[], temp_dir="/tmp/temp_moeimg_321")
        )

        with patch("gui.threading.Thread", ImmediateThread), patch("gui.os.path.exists", return_value=False):
            self.app.dl_ctrl.download_comic(
                source_comic,
                self.app.search_ctrl.ensure_comics_detail_ready,
                self.app.search_btn,
                self.app.favourites_btn,
            )

        self.assertFalse(downloaded_comics)
        self.assertFalse(mock_askyesno.called)
        self.assertTrue(mock_showerror.called)

    @patch("tkinter.messagebox.showinfo")
    @patch("tkinter.messagebox.askyesno", return_value=True)
    def test_batch_download_prepares_details_before_confirm(self, mock_askyesno, _mock_showinfo):
        source_comic = ComicInfo(
            id="888",
            title="批量源漫画",
            source_site="moeimg",
            pages=0,
            author=None,
            image_urls=[],
        )
        prepared_comic = ComicInfo(
            id="888",
            title="批量源漫画",
            source_site="moeimg",
            pages=8,
            author="批量作者",
            image_urls=[f"https://cdn.example/{i:03d}.webp" for i in range(1, 9)],
        )

        self.app.dl_ctrl.batch_select_mode_var.set(True)
        self.app.app_state.download.selected_comics = {source_comic}

        ensure_called = []
        executed_comics = []

        def fake_ensure(comics, progress_callback=None):
            ensure_called.append([c.id for c in comics])
            return [prepared_comic]

        self.app.search_ctrl.ensure_comics_detail_ready = fake_ensure
        self.app.dl_ctrl.execute_batch_download = lambda comics: executed_comics.extend(comics)

        with patch("gui.threading.Thread", ImmediateThread):
            self.app.dl_ctrl.batch_download_selected(
                self.app.search_ctrl.ensure_comics_detail_ready,
                self.app.search_btn,
                self.app.favourites_btn,
            )

        ok = self._wait_until(lambda: bool(executed_comics))
        self.assertTrue(ok)
        self.assertEqual(ensure_called, [["888"]])
        self.assertTrue(mock_askyesno.called)
        self.assertEqual(executed_comics, [prepared_comic])

    @patch("tkinter.messagebox.showinfo")
    def test_batch_prepare_error_callback_keeps_exception_message(self, _mock_showinfo):
        source_comic = ComicInfo(
            id="999",
            title="批量失败漫画",
            source_site="moeimg",
            pages=0,
            author=None,
            image_urls=[],
        )

        self.app.dl_ctrl.batch_select_mode_var.set(True)
        self.app.app_state.download.selected_comics = {source_comic}
        self.app.search_ctrl.ensure_comics_detail_ready = lambda comics, progress_callback=None: (_ for _ in ()).throw(
            RuntimeError("detail failed")
        )
        self.app.dl_ctrl._on_batch_prepare_failed = MagicMock()

        scheduled_callbacks = []

        def fake_after(_delay, callback=None, *args):
            if callback:
                scheduled_callbacks.append((callback, args))
            return None

        self.app.after = fake_after

        with patch("gui.threading.Thread", ImmediateThread):
            self.app.dl_ctrl.batch_download_selected(
                self.app.search_ctrl.ensure_comics_detail_ready,
                self.app.search_btn,
                self.app.favourites_btn,
            )

        self.assertTrue(scheduled_callbacks)
        for callback, args in scheduled_callbacks:
            callback(*args)

        self.app.dl_ctrl._on_batch_prepare_failed.assert_called_once_with(
            "detail failed", self.app.search_btn, self.app.favourites_btn
        )

    def test_detail_ready_requires_current_comic_fields_even_if_key_cached(self):
        source_comic = ComicInfo(
            id="777",
            title="缓存命中但对象未补齐",
            source_site="moeimg",
            pages=0,
            image_urls=[],
        )
        prepared_comic = ComicInfo(
            id="777",
            title="缓存命中但对象未补齐",
            source_site="moeimg",
            pages=2,
            author="作者Y",
            image_urls=[
                "https://cdn.example/001.webp",
                "https://cdn.example/002.webp",
            ],
        )

        # 旧逻辑会把 key 命中视为"已补齐"，从而跳过 prepare_for_download。
        self.app.app_state.search.moeimg_detail_ready_keys.add(self.app.search_ctrl._detail_ready_key(source_comic))
        called = []
        self.app.parser.prepare_for_download = lambda comic: called.append(comic.id) or prepared_comic

        output = self.app.search_ctrl.ensure_comics_detail_ready([source_comic])
        self.assertEqual(called, ["777"])
        self.assertEqual(output[0].pages, 2)
        self.assertEqual(len(output[0].image_urls), 2)

    def test_download_callbacks_skip_after_when_destroying(self):
        task = DownloadTask(
            comic=ComicInfo(id="1", title="T"),
            status=DownloadStatus.QUEUED,
        )
        self.app.after = MagicMock()
        self.app.dl_ctrl._is_destroying = True

        self.app.dl_ctrl.on_download_task_update(task)
        self.app.dl_ctrl.on_download_queue_complete()

        self.app.after.assert_not_called()


if __name__ == "__main__":
    unittest.main()
