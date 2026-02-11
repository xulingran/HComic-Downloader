"""预览图切换功能单元测试"""
import os
import tempfile
import unittest
from unittest.mock import MagicMock

import tkinter as tk


class TestPreviewToggleGUI(unittest.TestCase):
    """测试预览图切换 GUI 功能"""

    def setUp(self):
        """测试前设置"""
        # 创建临时配置目录
        self.temp_dir = tempfile.mkdtemp()
        self.config_path = os.path.join(self.temp_dir, 'config.json')

    def tearDown(self):
        """测试后清理"""
        # 清理临时文件
        if os.path.exists(self.config_path):
            os.unlink(self.config_path)
        os.rmdir(self.temp_dir)

    def _create_test_gui(self):
        """创建测试用的 GUI 实例"""
        from gui import HComicDownloaderGUI

        # 创建一个修改了配置路径的 GUI 类
        class TestGUI(HComicDownloaderGUI):
            def _get_config_path(self):
                return self.test_config_path

        # 创建 GUI 实例（HComicDownloaderGUI 继承自 tk.Tk，会自己创建窗口）
        app = TestGUI()
        app.withdraw()  # 隐藏窗口
        app.test_config_path = self.config_path

        return app

    def test_show_preview_var_exists(self):
        """测试 show_preview_var 变量存在"""
        app = self._create_test_gui()
        try:
            self.assertTrue(
                hasattr(app, 'show_preview_var'),
                "GUI 应有 show_preview_var 属性"
            )
            self.assertIsInstance(
                app.show_preview_var,
                tk.BooleanVar,
                "show_preview_var 应是 BooleanVar 类型"
            )
        finally:
            app.destroy()

    def test_default_show_preview_is_false(self):
        """测试默认不显示预览图"""
        app = self._create_test_gui()
        try:
            self.assertFalse(
                app.show_preview_var.get(),
                "默认值应为 False"
            )
            self.assertFalse(
                app.config.show_preview,
                "Config.show_preview 默认值应为 False"
            )
        finally:
            app.destroy()

    def test_on_preview_changed_method_exists(self):
        """测试 _on_preview_changed 方法存在"""
        app = self._create_test_gui()
        try:
            self.assertTrue(
                hasattr(app, '_on_preview_changed'),
                "GUI 应有 _on_preview_changed 方法"
            )
            self.assertTrue(
                callable(app._on_preview_changed),
                "_on_preview_changed 应该是可调用的"
            )
        finally:
            app.destroy()

    def test_toggle_to_true(self):
        """测试切换到 True"""
        app = self._create_test_gui()
        try:
            # 切换到 True
            app.show_preview_var.set(True)
            app._on_preview_changed()

            # 验证
            self.assertTrue(
                app.show_preview_var.get(),
                "show_preview_var 应为 True"
            )
            self.assertFalse(
                app.config.show_preview,
                "config.show_preview 不应被运行时切换修改（不持久化）"
            )
        finally:
            app.destroy()

    def test_toggle_to_false(self):
        """测试切换到 False"""
        app = self._create_test_gui()
        try:
            # 先设为 True
            app.show_preview_var.set(True)
            app._on_preview_changed()

            # 再切换回 False
            app.show_preview_var.set(False)
            app._on_preview_changed()

            # 验证
            self.assertFalse(
                app.show_preview_var.get(),
                "show_preview_var 应为 False"
            )
            self.assertFalse(
                app.config.show_preview,
                "config.show_preview 仍应保持默认 False"
            )
        finally:
            app.destroy()

    def test_preview_setting_should_not_persist_to_config(self):
        """测试预览图设置不会写入配置文件"""
        app = self._create_test_gui()
        try:
            # 切换到 True
            app.show_preview_var.set(True)
            app._on_preview_changed()

            self.assertFalse(
                os.path.exists(self.config_path),
                "切换预览图不应触发配置持久化写入"
            )
        finally:
            app.destroy()

    def test_get_config_path_method(self):
        """测试 _get_config_path 方法"""
        app = self._create_test_gui()
        try:
            config_path = app._get_config_path()
            self.assertIsInstance(config_path, str)
            self.assertTrue(
                config_path.endswith('config.json'),
                "配置文件名应为 config.json"
            )
            self.assertTrue(
                '.hcomic_downloader' in config_path or config_path.startswith('/'),
                "配置路径应包含目录或为绝对路径"
            )
        finally:
            app.destroy()

    def test_safe_update_image_method_exists(self):
        """测试 _safe_update_image 方法存在"""
        app = self._create_test_gui()
        try:
            self.assertTrue(
                hasattr(app, '_safe_update_image'),
                "GUI 应有 _safe_update_image 方法"
            )
            self.assertTrue(
                callable(app._safe_update_image),
                "_safe_update_image 应该是可调用的"
            )
        finally:
            app.destroy()

    def test_safe_update_image_queues_when_scrolling(self):
        """滚动中应先缓存图片更新，避免频繁 UI 刷新"""
        app = self._create_test_gui()
        try:
            label = MagicMock()
            label.winfo_exists.return_value = True
            photo = object()
            app._is_scrolling = True

            app._safe_update_image(label, photo)

            self.assertIn(label, app._pending_image_updates)
            self.assertIs(app._pending_image_updates[label], photo)
            label.config.assert_not_called()
        finally:
            app.destroy()

    def test_mark_scroll_idle_flushes_pending_images(self):
        """滚动结束时应刷新缓存的图片更新"""
        app = self._create_test_gui()
        try:
            label = MagicMock()
            label.winfo_exists.return_value = True
            photo = object()
            app._is_scrolling = True
            app._safe_update_image(label, photo)

            app._mark_scroll_idle()

            label.config.assert_called_once_with(image=photo)
            self.assertIs(label.image, photo)
            self.assertFalse(app._pending_image_updates)
        finally:
            app.destroy()

    def test_rapid_toggle_does_not_crash(self):
        """测试快速切换不会导致崩溃"""
        app = self._create_test_gui()
        try:
            # 快速切换多次
            for i in range(5):
                app.show_preview_var.set(True)
                app._on_preview_changed()
                app.show_preview_var.set(False)
                app._on_preview_changed()

            # 如果没有崩溃，测试通过
            self.assertTrue(True, "快速切换不应导致崩溃")
        finally:
            app.destroy()


class TestPreviewCardRendering(unittest.TestCase):
    """测试预览图卡片渲染"""

    def setUp(self):
        """测试前设置"""
        self.temp_dir = tempfile.mkdtemp()
        self.config_path = os.path.join(self.temp_dir, 'config.json')

    def tearDown(self):
        """测试后清理"""
        if os.path.exists(self.config_path):
            os.unlink(self.config_path)
        os.rmdir(self.temp_dir)

    def _create_test_gui(self):
        """创建测试用的 GUI 实例"""
        from gui import HComicDownloaderGUI

        class TestGUI(HComicDownloaderGUI):
            def _get_config_path(self):
                return self.test_config_path

        app = TestGUI()
        app.withdraw()  # 隐藏窗口
        app.test_config_path = self.config_path
        return app

    def _create_test_comic(self):
        """创建测试用的漫画对象"""
        from models import ComicInfo
        return ComicInfo(
            id='123',
            title='テスト漫画',
            author='テスト作者',
            pages=20,
            tags=[],
            publish_date='2025-01-01',
            cover_url='https://example.com/cover.jpg',
            preview_url='https://example.com',
            media_id='abc123',
            comic_source='test'
        )

    def test_create_card_with_preview_off(self):
        """测试关闭预览图时创建卡片"""
        app = self._create_test_gui()
        try:
            # 确保预览图关闭
            app.show_preview_var.set(False)

            # 创建卡片
            comic = self._create_test_comic()
            frame = app.create_comic_card(comic, 0, 0)

            # 验证卡片已创建
            self.assertIsNotNone(frame)
            self.assertTrue(frame.winfo_exists())

            # 验证卡片有 NSFW 占位符
            children = frame.winfo_children()
            nswf_labels = [c for c in children if isinstance(c, tk.Label) and 'NSFW' in c.cget('text')]
            self.assertTrue(
                len(nswf_labels) > 0,
                "关闭预览图时应显示 NSFW 占位符"
            )
        finally:
            app.destroy()

    def test_create_card_with_preview_on(self):
        """测试开启预览图时创建卡片"""
        app = self._create_test_gui()
        try:
            # 开启预览图
            app.show_preview_var.set(True)

            # 创建卡片
            comic = self._create_test_comic()
            frame = app.create_comic_card(comic, 0, 0)

            # 验证卡片已创建
            self.assertIsNotNone(frame)
            self.assertTrue(frame.winfo_exists())

            # 验证卡片有图片标签（不是 NSFW 文本标签）
            children = frame.winfo_children()
            from tkinter import ttk
            img_labels = [c for c in children if isinstance(c, ttk.Label)]
            nswf_labels = [c for c in children if isinstance(c, tk.Label) and 'NSFW' in c.cget('text')]

            self.assertTrue(
                len(img_labels) > 0,
                "开启预览图时应创建图片标签"
            )
            self.assertEqual(
                len(nswf_labels), 0,
                "开启预览图时不应显示 NSFW 占位符"
            )
        finally:
            app.destroy()


if __name__ == '__main__':
    unittest.main()
