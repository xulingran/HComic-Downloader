"""卡片文本交互功能测试"""
import unittest
from unittest.mock import MagicMock

from gui import HComicDownloaderGUI
from models import ComicInfo
from font_config import get_font
from tkinter import font as tkfont


class TestCardTextInteraction(unittest.TestCase):
    """测试标题折叠展开、复制与批量点选逻辑"""

    def setUp(self):
        class TestGUI(HComicDownloaderGUI):
            def center_window(self):
                # 测试中不需要居中窗口
                pass

        self.app = TestGUI()
        self.app.withdraw()

    def tearDown(self):
        self.app.destroy()

    def test_truncate_title_to_three_lines(self):
        """折叠标题应限制三行并添加省略号"""
        font_obj = tkfont.Font(font=get_font("normal", bold=True))
        long_text = "这是一个非常长的标题" * 20
        clipped, truncated = self.app._truncate_text_to_lines(long_text, font_obj, max_width=160, max_lines=3)

        self.assertTrue(truncated)
        self.assertLessEqual(clipped.count("\n") + 1, 3)
        self.assertIn("...", clipped)

    def test_card_click_only_works_in_batch_mode(self):
        """卡片点选仅在批量模式开启时生效"""
        comic = ComicInfo(id="1", title="测试漫画", comic_source="NH")
        frame = MagicMock()

        self.app.batch_select_mode_var.set(False)
        self.app._on_card_click(None, comic, frame)
        self.assertNotIn(comic, self.app.selected_comics)

        self.app.batch_select_mode_var.set(True)
        self.app._on_card_click(None, comic, frame)
        self.assertIn(comic, self.app.selected_comics)

    def test_title_expand_state_key(self):
        """展开状态按 comic_source:id 存储"""
        comic = ComicInfo(id="42", title="标题", comic_source="MMCG_SHORT")
        key = self.app._get_card_key(comic)
        self.assertEqual(key, "MMCG_SHORT:42")
        self.assertFalse(self.app._is_title_expanded(comic))
        self.app.card_title_expanded[key] = True
        self.assertTrue(self.app._is_title_expanded(comic))


if __name__ == "__main__":
    unittest.main()
