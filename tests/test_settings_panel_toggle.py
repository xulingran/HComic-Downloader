"""设置面板折叠动画测试"""
import time
import unittest


class TestSettingsPanelToggle(unittest.TestCase):
    """测试设置面板默认折叠与动画切换行为"""

    def _create_test_gui(self):
        from gui import HComicDownloaderGUI

        class TestGUI(HComicDownloaderGUI):
            def center_window(self):
                pass

        app = TestGUI()
        app.withdraw()
        return app

    def _wait_until(self, app, condition, timeout=3.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            app.update()
            if condition():
                return True
            time.sleep(0.01)
        app.update()
        return condition()

    def test_default_collapsed_state(self):
        app = self._create_test_gui()
        try:
            self.assertFalse(app.settings_expanded)
            self.assertEqual(app.toggle_settings_btn.cget("text"), "展开设置 ▼")
            self.assertEqual(app._settings_animator.current_height, 0)
            self.assertEqual(app.settings_container.winfo_manager(), "")
        finally:
            app.destroy()

    def test_expand_then_collapse(self):
        app = self._create_test_gui()
        try:
            app.toggle_settings_panel()
            expanded_ok = self._wait_until(
                app,
                lambda: app._settings_animator._after_id is None and app._settings_animator.current_height == app._settings_animator._end_height
            )
            self.assertTrue(expanded_ok, "展开动画应在超时前完成")
            self.assertTrue(app.settings_expanded)
            self.assertEqual(app.toggle_settings_btn.cget("text"), "收起设置 ▲")
            self.assertEqual(app.settings_container.winfo_manager(), "grid")

            app.toggle_settings_panel()
            collapsed_ok = self._wait_until(
                app,
                lambda: app._settings_animator._after_id is None and app._settings_animator.current_height == 0
            )
            self.assertTrue(collapsed_ok, "收起动画应在超时前完成")
            self.assertFalse(app.settings_expanded)
            self.assertEqual(app.toggle_settings_btn.cget("text"), "展开设置 ▼")
            self.assertEqual(app.settings_container.winfo_manager(), "")
        finally:
            app.destroy()

    def test_rapid_toggle_stable(self):
        app = self._create_test_gui()
        try:
            for _ in range(5):
                app.toggle_settings_panel()
                app.update()

            settled = self._wait_until(app, lambda: app._settings_animator._after_id is None)
            self.assertTrue(settled, "快速切换后动画应能稳定结束")
            # 初始为折叠，切换 5 次后应为展开
            self.assertTrue(app.settings_expanded)
            self.assertEqual(app.toggle_settings_btn.cget("text"), "收起设置 ▲")
            self.assertEqual(app._settings_animator.current_height, app._settings_animator._end_height)
            self.assertEqual(app.settings_container.winfo_manager(), "grid")
            self.assertTrue(hasattr(app, "search_btn"))
            self.assertTrue(hasattr(app, "search_entry"))
        finally:
            app.destroy()


if __name__ == "__main__":
    unittest.main()
