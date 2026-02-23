"""登录信息导入 GUI 测试"""
import json
import os
import tempfile
import time
import tkinter as tk
import unittest
from unittest.mock import patch

from gui import HComicDownloaderGUI


class TestLoginImportGUI(unittest.TestCase):
    """测试登录 curl 导入与静默校验行为"""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.config_path = os.path.join(self.temp_dir, "config.json")
        config_path = self.config_path

        class TestGUI(HComicDownloaderGUI):
            test_config_path = config_path

            def center_window(self):
                pass

            def _get_config_path(self):
                return self.test_config_path

        try:
            self.app = TestGUI()
        except tk.TclError as exc:
            self.skipTest(f"Tk 不可用: {exc}")
        self.app.withdraw()

    def tearDown(self):
        if hasattr(self, "app"):
            self.app.destroy()
        if os.path.exists(self.config_path):
            os.unlink(self.config_path)
        os.rmdir(self.temp_dir)

    def test_login_controls_exist(self):
        self.assertTrue(hasattr(self.app, "login_curl_text"))
        self.assertTrue(hasattr(self.app, "apply_login_btn"))
        self.assertTrue(hasattr(self.app, "login_status_var"))
        self.assertTrue(hasattr(self.app, "proxy_status_var"))

    @patch("tkinter.messagebox.showerror")
    def test_apply_login_success_persists_config(self, _mock_showerror):
        self.app.parser.verify_login_status = lambda: (True, "登录校验通过")
        curl_text = (
            "curl 'https://h-comic.com/' "
            "-b 'a=1; b=2' "
            "-H 'User-Agent: UA-Test/1.0'"
        )
        self.app.login_curl_text.insert("1.0", curl_text)
        self.app.apply_login_from_curl()

        for _ in range(20):
            self.app.update()
            if self.app.login_status_var.get() == "登录校验通过":
                break
            time.sleep(0.01)

        self.assertEqual(self.app.config.auth_cookie, "a=1; b=2")
        self.assertEqual(self.app.config.auth_user_agent, "UA-Test/1.0")
        self.assertTrue(os.path.exists(self.config_path))

        with open(self.config_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.assertEqual(data.get("auth_cookie"), "a=1; b=2")
        self.assertEqual(data.get("auth_user_agent"), "UA-Test/1.0")

    @patch("tkinter.messagebox.showerror")
    def test_apply_login_failure_should_not_override_existing(self, mock_showerror):
        self.app.config.auth_cookie = "old=cookie"
        self.app.config.auth_user_agent = "old-ua"
        self.app.login_curl_text.insert("1.0", "curl 'https://h-comic.com/' -A 'Only-UA'")

        self.app.apply_login_from_curl()

        self.assertEqual(self.app.config.auth_cookie, "old=cookie")
        self.assertEqual(self.app.config.auth_user_agent, "old-ua")
        self.assertTrue(mock_showerror.called)

    def test_verify_login_async_updates_status(self):
        self.app.login_status_var.set("等待中")
        self.app.parser.verify_login_status = lambda: (False, "登录疑似失效（检测到登录入口）")

        self.app._verify_login_async()

        for _ in range(30):
            self.app.update()
            if self.app.login_status_var.get() != "等待中":
                break
            time.sleep(0.01)

        self.assertEqual(self.app.login_status_var.get(), "登录疑似失效（检测到登录入口）")

    @patch("tkinter.messagebox.showerror")
    def test_apply_login_persists_per_source(self, _mock_showerror):
        self.app.parser.verify_login_status = lambda: (True, "登录校验通过")

        # hcomic 登录信息
        self.app.source_var.set("h-comic")
        self.app._on_source_changed()
        self.app.login_curl_text.insert(
            "1.0",
            "curl 'https://h-comic.com/' -b 'hc=1' -H 'User-Agent: HC-UA'",
        )
        self.app.apply_login_from_curl()
        self.app.login_curl_text.delete("1.0", "end")

        # moeimg 登录信息
        self.app.source_var.set("moeimg.fan")
        self.app._on_source_changed()
        self.app.login_curl_text.insert(
            "1.0",
            "curl 'https://moeimg.fan/' -b 'mi=2' -H 'User-Agent: MI-UA'",
        )
        self.app.apply_login_from_curl()

        hcomic_auth = self.app.config.get_source_auth("hcomic")
        moeimg_auth = self.app.config.get_source_auth("moeimg")
        self.assertEqual(hcomic_auth["cookie"], "hc=1")
        self.assertEqual(hcomic_auth["user_agent"], "HC-UA")
        self.assertEqual(moeimg_auth["cookie"], "mi=2")
        self.assertEqual(moeimg_auth["user_agent"], "MI-UA")

    def test_initial_load_should_read_saved_auth_config(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as f:
            config_path = f.name
            json.dump({
                "download_dir": self.temp_dir,
                "concurrent_downloads": 2,
                "timeout": 10,
                "retry_times": 1,
                "cbz_filename_template": "{author}-{title}.cbz",
                "font_name": "",
                "font_size": 12,
                "show_preview": False,
                "auth_cookie": "persisted_cookie=1",
                "auth_user_agent": "Persisted-UA/1.0",
            }, f, ensure_ascii=False)

        class LoadConfigGUI(HComicDownloaderGUI):
            test_config_path = config_path

            def center_window(self):
                pass

            def _get_config_path(self):
                return self.test_config_path

        try:
            app = LoadConfigGUI()
        except tk.TclError as exc:
            self.skipTest(f"Tk 不可用: {exc}")
        app.withdraw()
        try:
            self.assertEqual(app.config.auth_cookie, "persisted_cookie=1")
            self.assertEqual(app.config.auth_user_agent, "Persisted-UA/1.0")
            self.assertEqual(app.parser.session.headers.get("Cookie"), "persisted_cookie=1")
            self.assertEqual(app.parser.session.headers.get("User-Agent"), "Persisted-UA/1.0")
        finally:
            app.destroy()
            os.unlink(config_path)


if __name__ == "__main__":
    unittest.main()
