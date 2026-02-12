"""ThemeManager 模块单元测试"""
import sys
import pytest
import platform
from unittest.mock import patch, MagicMock


class TestThemeMode:
    """测试 ThemeMode 枚举"""

    def test_theme_mode_values(self):
        """验证枚举值"""
        from theme_manager import ThemeMode
        assert ThemeMode.AUTO.value == "auto"
        assert ThemeMode.LIGHT.value == "light"
        assert ThemeMode.DARK.value == "dark"


class TestSystemThemeDetection:
    """测试系统主题检测"""

    def test_detect_macos_theme_dark(self):
        """macOS 深色模式检测"""
        from theme_manager import _detect_macos_theme
        with patch('subprocess.run') as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="Dark\n")
            assert _detect_macos_theme() == "dark"

    def test_detect_macos_theme_light(self):
        """macOS 浅色模式检测"""
        from theme_manager import _detect_macos_theme
        with patch('subprocess.run') as mock_run:
            mock_run.return_value = MagicMock(returncode=1, stdout="")
            assert _detect_macos_theme() == "light"

    def test_detect_windows_theme_dark(self):
        """Windows 深色模式检测"""
        from theme_manager import _detect_windows_theme
        # 在非 Windows 系统上模拟 winreg
        mock_winreg = MagicMock()
        mock_key = MagicMock()
        mock_winreg.OpenKey.return_value = mock_key
        mock_winreg.QueryValueEx.return_value = (0, None)  # 0 = 深色

        with patch.dict(sys.modules, {'winreg': mock_winreg}):
            assert _detect_windows_theme() == "dark"

    def test_detect_windows_theme_light(self):
        """Windows 浅色模式检测"""
        from theme_manager import _detect_windows_theme
        # 在非 Windows 系统上模拟 winreg
        mock_winreg = MagicMock()
        mock_key = MagicMock()
        mock_winreg.OpenKey.return_value = mock_key
        mock_winreg.QueryValueEx.return_value = (1, None)  # 1 = 浅色

        with patch.dict(sys.modules, {'winreg': mock_winreg}):
            assert _detect_windows_theme() == "light"


class TestThemeManager:
    """测试 ThemeManager 类"""

    def test_singleton_pattern(self):
        """测试单例模式"""
        from theme_manager import ThemeManager
        # 重置单例
        ThemeManager._instance = None
        instance1 = ThemeManager.get_instance()
        instance2 = ThemeManager.get_instance()
        assert instance1 is instance2

    def test_initialize_sets_mode(self):
        """测试初始化设置模式"""
        from theme_manager import ThemeManager, ThemeMode
        ThemeManager._instance = None
        manager = ThemeManager.initialize(ThemeMode.DARK)
        assert manager.mode == ThemeMode.DARK

    def test_current_theme_auto_mode(self):
        """测试 AUTO 模式返回系统主题"""
        from theme_manager import ThemeManager, ThemeMode, _detect_system_theme
        ThemeManager._instance = None
        manager = ThemeManager.initialize(ThemeMode.AUTO)

        with patch('theme_manager._detect_system_theme', return_value='dark'):
            assert manager.current_theme == 'dark'

        with patch('theme_manager._detect_system_theme', return_value='light'):
            assert manager.current_theme == 'light'

    def test_current_theme_explicit_mode(self):
        """测试显式模式返回对应值"""
        from theme_manager import ThemeManager, ThemeMode
        ThemeManager._instance = None
        manager = ThemeManager.initialize(ThemeMode.DARK)
        assert manager.current_theme == 'dark'

        ThemeManager._instance = None
        manager = ThemeManager.initialize(ThemeMode.LIGHT)
        assert manager.current_theme == 'light'

    def test_get_color_light_theme(self):
        """测试浅色主题颜色"""
        from theme_manager import ThemeManager, ThemeMode
        ThemeManager._instance = None
        manager = ThemeManager.initialize(ThemeMode.LIGHT)

        assert manager.get_color('text') == '#000000'
        assert manager.get_color('background') == '#f0f0f0'
        assert manager.get_color('accent') == '#2196F3'

    def test_get_color_dark_theme(self):
        """测试深色主题颜色"""
        from theme_manager import ThemeManager, ThemeMode
        ThemeManager._instance = None
        manager = ThemeManager.initialize(ThemeMode.DARK)

        assert manager.get_color('text') == '#e5e5e5'
        assert manager.get_color('background') == '#1e1e1e'
        assert manager.get_color('accent') == '#64B5F6'

    def test_get_color_unknown_key(self):
        """测试未知颜色键返回默认值"""
        from theme_manager import ThemeManager, ThemeMode
        ThemeManager._instance = None
        manager = ThemeManager.initialize(ThemeMode.LIGHT)

        # 未知键应返回默认值
        assert manager.get_color('unknown_key') == '#000000'

    def test_register_callback(self):
        """测试注册回调"""
        from theme_manager import ThemeManager, ThemeMode
        ThemeManager._instance = None
        manager = ThemeManager.initialize(ThemeMode.AUTO)

        callback = MagicMock()
        manager.register_callback(callback)

        assert callback in manager._callbacks

    def test_unregister_callback(self):
        """测试注销回调"""
        from theme_manager import ThemeManager, ThemeMode
        ThemeManager._instance = None
        manager = ThemeManager.initialize(ThemeMode.AUTO)

        callback = MagicMock()
        manager.register_callback(callback)
        manager.unregister_callback(callback)

        assert callback not in manager._callbacks

    def test_set_mode_triggers_callback(self):
        """测试设置模式触发回调"""
        from theme_manager import ThemeManager, ThemeMode
        ThemeManager._instance = None
        manager = ThemeManager.initialize(ThemeMode.LIGHT)

        callback = MagicMock()
        manager.register_callback(callback)

        # 切换到深色模式应触发回调
        manager.set_mode(ThemeMode.DARK)
        callback.assert_called_once()

    def test_set_mode_same_theme_no_callback(self):
        """测试相同主题不触发回调"""
        from theme_manager import ThemeManager, ThemeMode
        ThemeManager._instance = None
        manager = ThemeManager.initialize(ThemeMode.LIGHT)

        callback = MagicMock()
        manager.register_callback(callback)

        # 再次设置为 LIGHT，主题相同，不应触发回调
        manager.set_mode(ThemeMode.LIGHT)
        callback.assert_not_called()
