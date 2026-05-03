"""Config 模块单元测试"""
import json
import os
import tempfile
import unittest
from pathlib import Path

from config import Config


class TestConfigShowPreview(unittest.TestCase):
    """测试 Config.show_preview 字段"""

    def test_default_value_is_false(self):
        """测试 show_preview 默认值为 False"""
        config = Config()
        self.assertFalse(config.show_preview, "show_preview 默认值应为 False")

    def test_explicit_true_value(self):
        """测试显式设置 show_preview 为 True"""
        config = Config(show_preview=True)
        self.assertTrue(config.show_preview, "应正确设置为 True")

    def test_explicit_false_value(self):
        """测试显式设置 show_preview 为 False"""
        config = Config(show_preview=False)
        self.assertFalse(config.show_preview, "应正确设置为 False")

    def test_serialization_includes_show_preview(self):
        """测试序列化包含 show_preview 字段"""
        config = Config(show_preview=False)

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            config_path = f.name

        try:
            config.save(config_path)

            with open(config_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            self.assertIn('show_preview', data, "保存的配置应包含 show_preview 字段")
            self.assertFalse(data['show_preview'], "保存的值应为 False")
        finally:
            os.unlink(config_path)

    def test_serialization_true_value(self):
        """测试序列化 True 值"""
        config = Config(show_preview=True)

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            config_path = f.name

        try:
            config.save(config_path)

            with open(config_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            self.assertTrue(data['show_preview'], "保存的值应为 True")
        finally:
            os.unlink(config_path)

    def test_load_from_file_with_show_preview_true(self):
        """测试从文件加载 show_preview=True"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            config_path = f.name
            json.dump({
                'download_dir': '/tmp/test',
                'concurrent_downloads': 4,
                'timeout': 30,
                'retry_times': 3,
                'cbz_filename_template': '{author}-{title}.cbz',
                'font_name': '',
                'font_size': 12,
                'show_preview': True,
            }, f)

        try:
            config = Config.load(config_path)
            self.assertTrue(config.show_preview, "应从文件加载 True 值")
        finally:
            os.unlink(config_path)

    def test_load_from_file_with_show_preview_false(self):
        """测试从文件加载 show_preview=False"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            config_path = f.name
            json.dump({
                'download_dir': '/tmp/test',
                'concurrent_downloads': 4,
                'timeout': 30,
                'retry_times': 3,
                'cbz_filename_template': '{author}-{title}.cbz',
                'font_name': '',
                'font_size': 12,
                'show_preview': False,
            }, f)

        try:
            config = Config.load(config_path)
            self.assertFalse(config.show_preview, "应从文件加载 False 值")
        finally:
            os.unlink(config_path)

    def test_load_legacy_config_without_show_preview(self):
        """测试加载旧版本配置（没有 show_preview 字段）"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            config_path = f.name
            # 旧版本配置，没有 show_preview 字段
            json.dump({
                'download_dir': '/tmp/test',
                'concurrent_downloads': 4,
                'timeout': 30,
                'retry_times': 3,
                'cbz_filename_template': '{author}-{title}.cbz',
                'font_name': '',
                'font_size': 12,
            }, f)

        try:
            config = Config.load(config_path)
            # 应使用默认值 False
            self.assertFalse(config.show_preview, "旧配置应使用默认值 False")
        finally:
            os.unlink(config_path)

    def test_round_trip_save_and_load(self):
        """测试保存后重新加载的完整性"""
        original_config = Config(
            download_dir='/tmp/test',
            show_preview=True,
            font_size=14
        )

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            config_path = f.name

        try:
            # 保存
            original_config.save(config_path)

            # 加载
            loaded_config = Config.load(config_path)

            # 验证
            self.assertEqual(loaded_config.show_preview, True, "show_preview 应保持为 True")
            self.assertEqual(loaded_config.font_size, 14, "font_size 应保持为 14")
        finally:
            os.unlink(config_path)


class TestConfigOtherFields(unittest.TestCase):
    """测试 Config 其他字段（确保不影响现有功能）"""

    def test_default_download_dir(self):
        """测试默认下载目录"""
        config = Config()
        expected_dir = str(Path.home() / "Downloads" / "hcomic")
        self.assertEqual(config.download_dir, expected_dir)

    def test_default_concurrent_downloads(self):
        """测试默认并发数"""
        config = Config()
        self.assertEqual(config.concurrent_downloads, 4)

    def test_default_timeout(self):
        """测试默认超时时间"""
        config = Config()
        self.assertEqual(config.timeout, 30)

    def test_default_retry_times(self):
        """测试默认重试次数"""
        config = Config()
        self.assertEqual(config.retry_times, 3)

    def test_default_font_settings(self):
        """测试默认字体设置"""
        config = Config()
        self.assertEqual(config.font_name, "")
        self.assertEqual(config.font_size, 12)

    def test_default_auth_settings(self):
        """测试默认登录配置"""
        config = Config()
        self.assertEqual(config.auth_cookie, "")
        self.assertEqual(config.auth_user_agent, "")

    def test_auth_fields_round_trip(self):
        """测试登录配置字段保存与加载"""
        original_config = Config(
            auth_cookie="k=v; sid=123",
            auth_user_agent="UA-Config-Test/1.0",
        )

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            config_path = f.name

        try:
            original_config.save(config_path)
            loaded_config = Config.load(config_path)
            self.assertEqual(loaded_config.auth_cookie, "k=v; sid=123")
            self.assertEqual(loaded_config.auth_user_agent, "UA-Config-Test/1.0")
        finally:
            os.unlink(config_path)


class TestThemeModeConfig(unittest.TestCase):
    """测试主题配置"""

    def test_default_theme_mode_is_auto(self):
        """默认主题模式为 auto"""
        config = Config()
        self.assertEqual(config.theme_mode, "auto", "theme_mode 默认值应为 'auto'")

    def test_theme_mode_persists(self):
        """主题模式持久化"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            config_path = f.name

        try:
            config = Config(theme_mode="dark")
            config.save(config_path)

            loaded = Config.load(config_path)
            self.assertEqual(loaded.theme_mode, "dark", "应从文件加载 dark 主题模式")
        finally:
            os.unlink(config_path)

    def test_theme_mode_light_persists(self):
        """light 主题模式持久化"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            config_path = f.name

        try:
            config = Config(theme_mode="light")
            config.save(config_path)

            loaded = Config.load(config_path)
            self.assertEqual(loaded.theme_mode, "light", "应从文件加载 light 主题模式")
        finally:
            os.unlink(config_path)

    def test_load_legacy_config_without_theme_mode(self):
        """测试加载旧版本配置（没有 theme_mode 字段）"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            config_path = f.name
            # 旧版本配置，没有 theme_mode 字段
            json.dump({
                'download_dir': '/tmp/test',
                'concurrent_downloads': 4,
                'timeout': 30,
                'retry_times': 3,
                'cbz_filename_template': '{author}-{title}.cbz',
                'font_name': '',
                'font_size': 12,
            }, f)

        try:
            config = Config.load(config_path)
            # 应使用默认值 auto
            self.assertEqual(config.theme_mode, "auto", "旧配置应使用默认值 auto")
        finally:
            os.unlink(config_path)


class TestMultiSourceConfig(unittest.TestCase):
    """测试多来源配置与兼容迁移"""

    def test_default_source_and_auth_defaults(self):
        config = Config()
        self.assertEqual(config.default_source, "hcomic")
        self.assertIn("hcomic", config.source_auth)
        self.assertIn("moeimg", config.source_auth)
        self.assertEqual(config.source_auth["hcomic"]["cookie"], "")
        self.assertEqual(config.source_auth["hcomic"]["user_agent"], "")

    def test_source_auth_round_trip(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            config_path = f.name

        try:
            config = Config(default_source="moeimg")
            config.set_source_auth("hcomic", cookie="hc=1", user_agent="HC-UA")
            config.set_source_auth("moeimg", cookie="mi=2", user_agent="MI-UA")
            config.save(config_path)

            loaded = Config.load(config_path)
            self.assertEqual(loaded.default_source, "moeimg")
            self.assertEqual(loaded.get_source_auth("hcomic")["cookie"], "hc=1")
            self.assertEqual(loaded.get_source_auth("moeimg")["user_agent"], "MI-UA")
            # 旧字段与 hcomic 保持兼容同步
            self.assertEqual(loaded.auth_cookie, "hc=1")
            self.assertEqual(loaded.auth_user_agent, "HC-UA")
        finally:
            os.unlink(config_path)

    def test_legacy_auth_fields_migrate_to_source_auth(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            config_path = f.name
            json.dump(
                {
                    "download_dir": "/tmp/test",
                    "auth_cookie": "legacy_cookie=1",
                    "auth_user_agent": "Legacy-UA/1.0",
                },
                f,
            )

        try:
            loaded = Config.load(config_path)
            self.assertEqual(loaded.get_source_auth("hcomic")["cookie"], "legacy_cookie=1")
            self.assertEqual(loaded.get_source_auth("hcomic")["user_agent"], "Legacy-UA/1.0")
            self.assertEqual(loaded.get_source_auth("moeimg")["cookie"], "")
        finally:
            os.unlink(config_path)


class TestConfigConstructorNoSideEffects(unittest.TestCase):
    """测试 Config 构造函数不产生 I/O 副作用"""

    def test_config_constructor_does_not_create_directory(self):
        """Config() 不应自动创建 download_dir 目录"""
        with tempfile.TemporaryDirectory() as tmp:
            nonexistent = os.path.join(tmp, "should_not_exist")
            self.assertFalse(os.path.exists(nonexistent))
            Config(download_dir=nonexistent)
            self.assertFalse(os.path.exists(nonexistent))


if __name__ == '__main__':
    unittest.main()
