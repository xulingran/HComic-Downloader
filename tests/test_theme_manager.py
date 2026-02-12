"""ThemeManager 模块单元测试（对齐当前实现）"""
import sys
from unittest.mock import MagicMock, patch


class TestThemeMode:
    """测试 ThemeMode 枚举"""

    def test_theme_mode_values(self):
        from theme_manager import ThemeMode

        assert ThemeMode.AUTO.value == "auto"
        assert ThemeMode.LIGHT.value == "light"
        assert ThemeMode.DARK.value == "dark"


class TestThemeManager:
    """测试 ThemeManager 核心行为"""

    def _fresh_manager(self):
        from theme_manager import ThemeManager

        ThemeManager._instance = None
        return ThemeManager.get_instance()

    def test_singleton_pattern(self):
        from theme_manager import ThemeManager

        ThemeManager._instance = None
        a = ThemeManager.get_instance()
        b = ThemeManager.get_instance()
        assert a is b

    def test_get_color_known_and_unknown_key(self):
        from theme_manager import ThemeMode

        manager = self._fresh_manager()
        manager.set_mode(ThemeMode.LIGHT)
        assert manager.get_color("text") == "#000000"
        assert manager.get_color("unknown_key") == "#000000"

        manager.set_mode(ThemeMode.DARK)
        assert manager.get_color("text") == "#e0e0e0"

    def test_register_and_unregister_callback(self):
        manager = self._fresh_manager()
        cb = MagicMock()

        manager.register_callback(cb)
        assert cb in manager._callbacks

        manager.unregister_callback(cb)
        assert cb not in manager._callbacks

    def test_set_mode_triggers_callback_only_when_mode_changes(self):
        from theme_manager import ThemeMode

        manager = self._fresh_manager()
        cb = MagicMock()
        manager.register_callback(cb)

        manager.set_mode(ThemeMode.LIGHT)
        assert cb.call_count == 1

        manager.set_mode(ThemeMode.LIGHT)
        # 相同模式不重复触发（LIGHT/DARK）
        assert cb.call_count == 1

        manager.set_mode(ThemeMode.DARK)
        assert cb.call_count == 2

    def test_set_mode_auto_same_mode_calls_refresh_path(self):
        from theme_manager import ThemeMode

        manager = self._fresh_manager()
        manager.set_mode(ThemeMode.AUTO)

        with patch.object(manager, "refresh_auto_theme", return_value=False) as refresh:
            manager.set_mode(ThemeMode.AUTO)
            refresh.assert_called_once()

    def test_refresh_auto_theme_returns_false_when_not_auto(self):
        from theme_manager import ThemeMode

        manager = self._fresh_manager()
        manager.set_mode(ThemeMode.LIGHT)
        assert manager.refresh_auto_theme() is False

    def test_refresh_auto_theme_returns_false_when_theme_unchanged(self):
        from theme_manager import ThemeMode

        manager = self._fresh_manager()
        manager.set_mode(ThemeMode.AUTO)
        manager._current_theme = "light"

        with patch.object(manager, "_detect_system_theme", return_value="light"):
            assert manager.refresh_auto_theme() is False

    def test_refresh_auto_theme_updates_theme_and_notifies(self):
        from theme_manager import ThemeMode

        manager = self._fresh_manager()
        manager.set_mode(ThemeMode.AUTO)
        manager._current_theme = "light"
        cb = MagicMock()
        manager.register_callback(cb)

        with patch.object(manager, "_detect_system_theme", return_value="dark"):
            assert manager.refresh_auto_theme() is True

        assert manager.current_theme == "dark"
        cb.assert_called_once()


class TestSystemThemeDetection:
    """测试系统主题检测分支"""

    def _fresh_manager(self):
        from theme_manager import ThemeManager

        ThemeManager._instance = None
        return ThemeManager.get_instance()

    def test_detect_macos_theme_dark(self):
        manager = self._fresh_manager()

        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="Dark\n")
            assert manager._detect_macos_theme() == "dark"

    def test_detect_macos_theme_light(self):
        manager = self._fresh_manager()

        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1, stdout="")
            assert manager._detect_macos_theme() == "light"

    def test_detect_windows_theme_dark(self):
        manager = self._fresh_manager()
        mock_winreg = MagicMock()
        mock_key = MagicMock()
        mock_winreg.OpenKey.return_value = mock_key
        mock_winreg.QueryValueEx.return_value = (0, None)

        with patch.dict(sys.modules, {"winreg": mock_winreg}):
            assert manager._detect_windows_theme() == "dark"

    def test_detect_windows_theme_light(self):
        manager = self._fresh_manager()
        mock_winreg = MagicMock()
        mock_key = MagicMock()
        mock_winreg.OpenKey.return_value = mock_key
        mock_winreg.QueryValueEx.return_value = (1, None)

        with patch.dict(sys.modules, {"winreg": mock_winreg}):
            assert manager._detect_windows_theme() == "light"

    def test_detect_system_theme_dispatch(self):
        manager = self._fresh_manager()

        with patch("platform.system", return_value="Darwin"), patch.object(
            manager, "_detect_macos_theme", return_value="dark"
        ) as mac_detect:
            assert manager._detect_system_theme() == "dark"
            mac_detect.assert_called_once()

        with patch("platform.system", return_value="Windows"), patch.object(
            manager, "_detect_windows_theme", return_value="light"
        ) as win_detect:
            assert manager._detect_system_theme() == "light"
            win_detect.assert_called_once()

        with patch("platform.system", return_value="Linux"):
            assert manager._detect_system_theme() == "light"
