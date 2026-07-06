"""Config 模块单元测试"""

import json
import os
import tempfile
import unittest
from pathlib import Path

from config import AuthSourceData, Config


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

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
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
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
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
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
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
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            config_path = f.name
            # 旧版本配置，没有 theme_mode 字段
            json.dump(
                {
                    "download_dir": "/tmp/test",
                    "concurrent_downloads": 4,
                    "timeout": 30,
                    "retry_times": 3,
                    "cbz_filename_template": "{author}-{title}.cbz",
                    "font_name": "",
                    "font_size": 12,
                },
                f,
            )

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
        self.assertIn("nh", config.source_auth)
        self.assertEqual(config.source_auth["hcomic"]["cookie"], "")
        self.assertEqual(config.source_auth["hcomic"]["user_agent"], "")
        self.assertEqual(
            config.get_source_auth("nh"),
            {"cookie": "", "user_agent": "", "bearer_token": ""},
        )

    def test_source_auth_normalization_keeps_supported_sources_and_filters_unknown(self):
        config = Config(
            source_auth={
                "hcomic": {"cookie": "hc=1", "user_agent": "HC-UA", "bearer_token": "hc-token"},
                # NH 收敛为仅 API Key（remove-nh-password-login spec）：归一化必须
                # 清空 username/password/cookie/user_agent，仅保留有效 API Key。
                "nh": {
                    "cookie": "nh=1",
                    "user_agent": "NH-UA",
                    "bearer_token": "nh-key",
                    "username": "nh-user",
                    "password": "nh-password",
                },
                "unknown": {"cookie": "must-be-filtered"},
            }
        )

        self.assertEqual(
            config.get_source_auth("hcomic"),
            {"cookie": "hc=1", "user_agent": "HC-UA", "bearer_token": "hc-token", "username": "", "password": ""},
        )
        self.assertEqual(
            config.get_source_auth("nh"),
            {"cookie": "", "user_agent": "", "bearer_token": "nh-key"},
        )
        self.assertNotIn("unknown", config.source_auth)

    def test_source_auth_round_trip(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            config_path = f.name

        try:
            config = Config(default_source="moeimg")
            config.set_source_auth("hcomic", AuthSourceData(cookie="hc=1", user_agent="HC-UA"))
            config.set_source_auth("moeimg", AuthSourceData(cookie="mi=2", user_agent="MI-UA"))
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

    def test_nh_source_auth_round_trip_preserves_only_api_key(self):
        """NH 收敛为仅 API Key（remove-nh-password-login spec）：往返只保留 Key。"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            config_path = f.name

        try:
            config = Config()
            # set_source_auth 对 NH 只接受 bearer_token；其余字段被丢弃。
            config.set_source_auth(
                "nh",
                AuthSourceData(
                    cookie="sessionid=nh-session",
                    user_agent="NH-UA/1.0",
                    bearer_token="nh-api-key",
                    username="nh-user",
                    password="nh-password",
                ),
            )
            config.save(config_path)

            loaded = Config.load(config_path)

            self.assertEqual(
                loaded.get_source_auth("nh"),
                {"cookie": "", "user_agent": "", "bearer_token": "nh-api-key"},
            )
        finally:
            os.unlink(config_path)

    def test_legacy_auth_fields_migrate_to_source_auth(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
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

    def test_legacy_jmcomic_default_source_migrates_to_jm(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            config_path = f.name
            json.dump({"default_source": "jmcomic"}, f)

        try:
            loaded = Config.load(config_path)
            self.assertEqual(loaded.default_source, "jm")
        finally:
            os.unlink(config_path)

    def test_legacy_jmcomic_source_auth_migrates_to_jm(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            config_path = f.name
            json.dump(
                {
                    "source_auth": {
                        "jmcomic": {"cookie": "j=1", "user_agent": "J-UA"},
                    }
                },
                f,
            )

        try:
            loaded = Config.load(config_path)
            self.assertEqual(loaded.get_source_auth("jm")["cookie"], "j=1")
            self.assertEqual(loaded.get_source_auth("jm")["user_agent"], "J-UA")
        finally:
            os.unlink(config_path)

    def test_legacy_jmcomic_tag_blacklist_migrates_to_jm(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            config_path = f.name
            json.dump({"tag_blacklist": {"jmcomic": ["tagA"], "jm": ["tagB"]}}, f)

        try:
            loaded = Config.load(config_path)
            self.assertEqual(loaded.tag_blacklist["jm"], ["tagA", "tagB"])
        finally:
            os.unlink(config_path)

    def test_legacy_jmcomic_domain_migrates_to_jm_domain(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            config_path = f.name
            json.dump({"jmcomic_domain": "18comic.vip"}, f)

        try:
            loaded = Config.load(config_path)
            self.assertEqual(loaded.jm_domain, "18comic.vip")
        finally:
            os.unlink(config_path)


class TestDuplicateBlacklistMigration(unittest.TestCase):
    """测试 duplicate_blacklist 数据结构迁移：纯字符串 → {fingerprint, memberCount}"""

    def test_default_duplicate_blacklist_empty(self):
        config = Config()
        self.assertEqual(
            config.duplicate_blacklist, {"hcomic": [], "moeimg": [], "jm": [], "bika": [], "copymanga": [], "nh": []}
        )

    def test_legacy_string_entries_migrate_to_objects(self):
        """旧版纯字符串列表迁移为 {fingerprint, memberCount: None}"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            config_path = f.name
            json.dump(
                {
                    "download_dir": "/tmp/test",
                    "duplicate_blacklist": {"hcomic": ["指纹A", "指纹B"], "jm": ["指纹C"]},
                },
                f,
            )

        try:
            loaded = Config.load(config_path)
            self.assertEqual(
                loaded.duplicate_blacklist["hcomic"],
                [{"fingerprint": "指纹A", "memberCount": None}, {"fingerprint": "指纹B", "memberCount": None}],
            )
            self.assertEqual(
                loaded.duplicate_blacklist["jm"],
                [{"fingerprint": "指纹C", "memberCount": None}],
            )
        finally:
            os.unlink(config_path)

    def test_structured_entries_preserved(self):
        """新版结构化对象正常加载，memberCount 保留"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            config_path = f.name
            json.dump(
                {
                    "download_dir": "/tmp/test",
                    "duplicate_blacklist": {"hcomic": [{"fingerprint": "指纹A", "memberCount": 3}]},
                },
                f,
            )

        try:
            loaded = Config.load(config_path)
            self.assertEqual(
                loaded.duplicate_blacklist["hcomic"],
                [{"fingerprint": "指纹A", "memberCount": 3}],
            )
        finally:
            os.unlink(config_path)

    def test_missing_field_defaults_to_empty(self):
        """老配置无 duplicate_blacklist 字段时填充空默认值"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            config_path = f.name
            json.dump({"download_dir": "/tmp/test"}, f)

        try:
            loaded = Config.load(config_path)
            self.assertEqual(
                loaded.duplicate_blacklist,
                {"hcomic": [], "moeimg": [], "jm": [], "bika": [], "copymanga": [], "nh": []},
            )
        finally:
            os.unlink(config_path)

    def test_mixed_legacy_and_structured_entries(self):
        """混合旧字符串和新对象的列表都能正确迁移"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            config_path = f.name
            json.dump(
                {
                    "download_dir": "/tmp/test",
                    "duplicate_blacklist": {"hcomic": ["旧指纹", {"fingerprint": "新指纹", "memberCount": 2}]},
                },
                f,
            )

        try:
            loaded = Config.load(config_path)
            self.assertEqual(
                loaded.duplicate_blacklist["hcomic"],
                [
                    {"fingerprint": "旧指纹", "memberCount": None},
                    {"fingerprint": "新指纹", "memberCount": 2},
                ],
            )
        finally:
            os.unlink(config_path)

    def test_legacy_jmcomic_duplicate_blacklist_migrates_to_jm(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            config_path = f.name
            json.dump(
                {"duplicate_blacklist": {"jmcomic": ["旧指纹"], "jm": [{"fingerprint": "新指纹", "memberCount": 2}]}}, f
            )

        try:
            loaded = Config.load(config_path)
            self.assertEqual(
                loaded.duplicate_blacklist["jm"],
                [
                    {"fingerprint": "旧指纹", "memberCount": None},
                    {"fingerprint": "新指纹", "memberCount": 2},
                ],
            )
        finally:
            os.unlink(config_path)

    def test_legacy_jmcomic_missing_blacklist_migrates_to_jm(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            config_path = f.name
            json.dump({"missing_blacklist": {"jmcomic": ["缺失指纹"]}}, f)

        try:
            loaded = Config.load(config_path)
            self.assertEqual(loaded.missing_blacklist["jm"], [{"fingerprint": "缺失指纹", "memberCount": None}])
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


class TestConfigLoadCorrupted(unittest.TestCase):
    """测试 Config.load() 处理损坏配置文件"""

    def test_load_corrupted_json_returns_default(self):
        """损坏的 JSON 文件应返回默认配置"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            config_path = f.name
            f.write("{invalid json content!!!")

        try:
            config = Config.load(config_path)
            self.assertIsInstance(config, Config)
            self.assertEqual(config.concurrent_downloads, 4)
            self.assertEqual(config.theme_mode, "auto")
        finally:
            backup_path = config_path + ".corrupted"
            if os.path.exists(backup_path):
                os.unlink(backup_path)
            if os.path.exists(config_path):
                os.unlink(config_path)

    def test_load_corrupted_json_creates_backup(self):
        """损坏的 JSON 文件应被备份为 .corrupted"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            config_path = f.name
            f.write("not valid json {{{")

        backup_path = config_path + ".corrupted"
        try:
            Config.load(config_path)
            self.assertTrue(os.path.exists(backup_path), "应创建 .corrupted 备份文件")
        finally:
            if os.path.exists(backup_path):
                os.unlink(backup_path)
            if os.path.exists(config_path):
                os.unlink(config_path)

    def test_corrupted_backup_not_overwritten(self):
        """已存在 .corrupted 备份时不覆盖"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            config_path = f.name
            f.write("bad json 1")

        backup_path = config_path + ".corrupted"
        try:
            # 第一次损坏：创建备份
            Config.load(config_path)
            self.assertTrue(os.path.exists(backup_path))
            with open(backup_path) as f:
                first_backup = f.read()

            # 创建新的损坏文件（模拟第二次损坏）
            with open(config_path, "w") as f:
                f.write("bad json 2 different")

            # 第二次损坏：不应覆盖备份
            Config.load(config_path)
            with open(backup_path) as f:
                second_backup = f.read()
            self.assertEqual(first_backup, second_backup, "第二次损坏不应覆盖已有的 .corrupted 备份")
        finally:
            if os.path.exists(backup_path):
                os.unlink(backup_path)
            if os.path.exists(config_path):
                os.unlink(config_path)

    def test_load_nonexistent_file_returns_default(self):
        """不存在的文件应返回默认配置（已有行为，回归测试）"""
        config = Config.load("/nonexistent/path/config.json")
        self.assertIsInstance(config, Config)
        self.assertEqual(config.concurrent_downloads, 4)


class TestThemeModeNormalization(unittest.TestCase):
    """测试 theme_mode 归一化"""

    def test_invalid_theme_mode_normalized_to_auto(self):
        """非法 theme_mode 值应被归一化为 auto"""
        config = Config(theme_mode="weird")
        self.assertEqual(config.theme_mode, "auto")

    def test_empty_theme_mode_normalized_to_auto(self):
        """空字符串 theme_mode 应被归一化为 auto"""
        config = Config(theme_mode="")
        self.assertEqual(config.theme_mode, "auto")

    def test_valid_dark_preserved(self):
        """合法 dark 值应保留"""
        config = Config(theme_mode="dark")
        self.assertEqual(config.theme_mode, "dark")

    def test_valid_light_preserved(self):
        """合法 light 值应保留"""
        config = Config(theme_mode="light")
        self.assertEqual(config.theme_mode, "light")

    def test_valid_auto_preserved(self):
        """合法 auto 值应保留"""
        config = Config(theme_mode="auto")
        self.assertEqual(config.theme_mode, "auto")

    def test_invalid_theme_mode_from_file_normalized(self):
        """从文件加载的非法 theme_mode 应被归一化"""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            config_path = f.name
            json.dump(
                {
                    "theme_mode": "weird",
                    "download_dir": "/tmp/test",
                },
                f,
            )

        try:
            config = Config.load(config_path)
            self.assertEqual(config.theme_mode, "auto")
        finally:
            os.unlink(config_path)


class TestPreviewPreloadAdaptive(unittest.TestCase):
    def test_default_is_false(self):
        """自适应预加载默认关闭，避免改动既有行为"""
        config = Config()
        self.assertFalse(config.preview_preload_adaptive)


if __name__ == "__main__":
    unittest.main()
