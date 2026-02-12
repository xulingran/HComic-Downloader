"""主题管理模块 - 支持深色/浅色模式切换"""
import logging
import platform
import subprocess
from enum import Enum
from typing import Callable, Optional

logger = logging.getLogger(__name__)


class ThemeMode(Enum):
    """主题模式"""
    AUTO = "auto"    # 跟随系统
    LIGHT = "light"  # 强制浅色
    DARK = "dark"    # 强制深色


def _detect_macos_theme() -> str:
    """检测 macOS 系统主题"""
    try:
        result = subprocess.run(
            ["defaults", "read", "-g", "AppleInterfaceStyle"],
            capture_output=True, text=True, timeout=2
        )
        if result.returncode == 0 and "Dark" in result.stdout:
            return "dark"
    except Exception as e:
        logger.debug(f"macOS 主题检测失败: {e}")
    return "light"


def _detect_windows_theme() -> str:
    """检测 Windows 系统主题"""
    try:
        import winreg
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"
        )
        value, _ = winreg.QueryValueEx(key, "AppsUseLightTheme")
        return "dark" if value == 0 else "light"
    except Exception as e:
        logger.debug(f"Windows 主题检测失败: {e}")
    return "light"


def _detect_system_theme() -> str:
    """检测系统当前主题"""
    system = platform.system()
    if system == "Darwin":
        return _detect_macos_theme()
    elif system == "Windows":
        return _detect_windows_theme()
    else:
        # Linux 或其他系统，默认浅色
        return "light"


class ThemeManager:
    """主题管理器（单例）"""
    _instance: Optional['ThemeManager'] = None

    # 颜色配置
    COLORS = {
        "light": {
            "text": "#000000",
            "text_secondary": "#666666",
            "background": "#f0f0f0",
            "card_bg": "#f0f0f0",
            "accent": "#2196F3",
            "border": "#cccccc",
            "insert": "#000000",
        },
        "dark": {
            "text": "#e5e5e5",
            "text_secondary": "#a0a0a0",
            "background": "#1e1e1e",
            "card_bg": "#2d2d2d",
            "accent": "#64B5F6",
            "border": "#404040",
            "insert": "#e5e5e5",
        }
    }

    def __init__(self, mode: ThemeMode = ThemeMode.AUTO):
        self._mode = mode
        self._callbacks: list[Callable] = []
        self._current_theme: Optional[str] = None

    @classmethod
    def get_instance(cls) -> 'ThemeManager':
        """获取单例实例"""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def initialize(cls, mode: ThemeMode = ThemeMode.AUTO) -> 'ThemeManager':
        """初始化单例（仅调用一次）"""
        cls._instance = cls(mode)
        return cls._instance

    @property
    def mode(self) -> ThemeMode:
        """当前模式设置"""
        return self._mode

    @property
    def current_theme(self) -> str:
        """当前实际主题（'light' 或 'dark'）"""
        if self._mode == ThemeMode.AUTO:
            return _detect_system_theme()
        return self._mode.value

    def get_color(self, key: str) -> str:
        """获取语义颜色值

        Args:
            key: 颜色键名，如 'text', 'text_secondary', 'background' 等

        Returns:
            颜色值（如 '#000000'）
        """
        theme = self.current_theme
        colors = self.COLORS.get(theme, self.COLORS["light"])
        return colors.get(key, "#000000")

    def register_callback(self, callback: Callable) -> None:
        """注册主题变化回调"""
        if callback not in self._callbacks:
            self._callbacks.append(callback)

    def unregister_callback(self, callback: Callable) -> None:
        """注销回调"""
        if callback in self._callbacks:
            self._callbacks.remove(callback)

    def set_mode(self, mode: ThemeMode) -> None:
        """设置主题模式并触发回调"""
        old_theme = self.current_theme
        self._mode = mode
        new_theme = self.current_theme

        # 仅在实际主题变化时触发回调
        if old_theme != new_theme:
            logger.info(f"主题切换: {old_theme} -> {new_theme}")
            for callback in self._callbacks:
                try:
                    callback()
                except Exception as e:
                    logger.error(f"主题回调执行失败: {e}")
