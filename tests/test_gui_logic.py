"""GUI 逻辑回归测试（不依赖 tkinter）。"""

import unittest

from gui_logic import (
    build_batch_summary,
    calculate_grid_columns,
    format_download_speed,
    is_moeimg_detail_ready,
    should_block_source_change,
    should_ignore_gui_callback,
    stop_download_manager_for_shutdown,
)
from models import ComicInfo


class _FakeDownloadManager:
    def __init__(self):
        self.calls = []

    def set_callbacks(self, on_task_update=None, on_queue_complete=None):
        self.calls.append(("set_callbacks", on_task_update, on_queue_complete))

    def stop(self):
        self.calls.append(("stop",))


class TestGuiLogic(unittest.TestCase):
    def test_is_moeimg_detail_ready_requires_urls_and_pages(self):
        self.assertTrue(
            is_moeimg_detail_ready(ComicInfo(id="1", source_site="hcomic", pages=0, image_urls=[]))
        )
        self.assertFalse(
            is_moeimg_detail_ready(ComicInfo(id="2", source_site="moeimg", pages=0, image_urls=[]))
        )
        self.assertFalse(
            is_moeimg_detail_ready(ComicInfo(id="3", source_site="moeimg", pages=5, image_urls=[]))
        )
        self.assertFalse(
            is_moeimg_detail_ready(
                ComicInfo(id="4", source_site="moeimg", pages=0, image_urls=["https://cdn/x.webp"])
            )
        )
        self.assertTrue(
            is_moeimg_detail_ready(
                ComicInfo(id="5", source_site="moeimg", pages=2, image_urls=["https://cdn/1.webp"])
            )
        )

    def test_stop_download_manager_for_shutdown_detaches_callbacks_first(self):
        dm = _FakeDownloadManager()
        stop_download_manager_for_shutdown(dm)
        self.assertEqual(
            dm.calls,
            [
                ("set_callbacks", None, None),
                ("stop",),
            ],
        )

    def test_stop_download_manager_for_shutdown_accepts_none(self):
        stop_download_manager_for_shutdown(None)

    def test_should_ignore_gui_callback(self):
        self.assertTrue(should_ignore_gui_callback(True))
        self.assertFalse(should_ignore_gui_callback(False))

    def test_should_block_source_change(self):
        self.assertFalse(should_block_source_change(False, False, False))
        self.assertTrue(should_block_source_change(True, False, False))
        self.assertTrue(should_block_source_change(False, True, False))
        self.assertTrue(should_block_source_change(False, False, True))

    def test_calculate_grid_columns(self):
        self.assertEqual(calculate_grid_columns(1200, 220, 40), 5)
        self.assertEqual(calculate_grid_columns(200, 220, 40), 1)

    def test_format_download_speed(self):
        self.assertEqual(format_download_speed(0), "0.0 页/秒")
        self.assertEqual(format_download_speed(1.26), "1.3 页/秒")

    def test_build_batch_summary(self):
        text = build_batch_summary({"completed": 5, "failed": 1, "cancelled": 2})
        self.assertIn("成功: 5 本", text)
        self.assertIn("失败: 1 本", text)
        self.assertIn("取消: 2 本", text)


if __name__ == "__main__":
    unittest.main()
