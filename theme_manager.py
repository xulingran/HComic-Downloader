"""主题管理器 - 支持自动/浅色/深色三种模式"""
import logging
import platform
import subprocess
import threading
from enum import Enum
from typing import Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


class ThemeMode(Enum):
    """主题模式枚举"""
    AUTO = "auto"
    LIGHT = "light"
    DARK = "dark"


class ThemeManager:
    """主题管理器单例类"""

    _instance: Optional["ThemeManager"] = None
    _lock = threading.Lock()

    # 颜色定义
    _COLORS: Dict[str, Dict[str, str]] = {
        "light": {
            "background": "#ffffff",
            "card_bg": "#ffffff",
            "text": "#000000",
            "text_secondary": "#666666",
            "accent": "#2196F3",
            "border": "#cccccc",
            "insert": "#000000",
        },
        "dark": {
            "background": "#1e1e1e",
            "card_bg": "#2d2d2d",
            "text": "#e0e0e0",
            "text_secondary": "#a0a0a0",
            "accent": "#64B5F6",
            "border": "#3d3d3d",
            "insert": "#ffffff",
        },
    }

    def __new__(cls):
        """单例模式实现"""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        """初始化主题管理器"""
        if hasattr(self, "_initialized"):
            return

        self._mode: ThemeMode = ThemeMode.AUTO
        self._callbacks: List[Callable[[], None]] = []
        self._current_theme: str = "light"
        self._initialized = True

        # 初始化时检测系统主题
        self._update_current_theme()

    @classmethod
    def get_instance(cls) -> "ThemeManager":
        """获取主题管理器单例"""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @property
    def current_theme(self) -> str:
        """获取当前主题 ('light' 或 'dark')"""
        return self._current_theme

    @property
    def mode(self) -> ThemeMode:
        """获取主题模式"""
        return self._mode

    def get_color(self, key: str) -> str:
        """获取当前主题下的颜色值

        Args:
            key: 颜色键名 (background, card_bg, text, text_secondary, accent, border, insert)

        Returns:
            颜色值 (十六进制字符串)
        """
        colors = self._COLORS.get(self._current_theme, self._COLORS["light"])
        return colors.get(key, "#000000")

    def set_mode(self, mode: ThemeMode):
        """设置主题模式

        Args:
            mode: 主题模式 (AUTO, LIGHT, DARK)
        """
        if self._mode == mode:
            # AUTO 模式下允许重复触发检测，确保可手动刷新系统主题状态
            if mode == ThemeMode.AUTO:
                self.refresh_auto_theme()
            return

        self._mode = mode
        self._update_current_theme()
        self._notify_callbacks()

    def refresh_auto_theme(self) -> bool:
        """在 AUTO 模式下检测系统主题变化并按需通知回调。

        Returns:
            是否检测到并应用了主题变化。
        """
        if self._mode != ThemeMode.AUTO:
            return False

        detected_theme = self._detect_system_theme()
        if detected_theme == self._current_theme:
            return False

        self._current_theme = detected_theme
        logger.info(f"系统主题变化已应用: {self._current_theme} (mode: {self._mode.value})")
        self._notify_callbacks()
        return True

    def register_callback(self, callback: Callable[[], None]):
        """注册主题变化回调

        Args:
            callback: 主题变化时调用的函数
        """
        if callback not in self._callbacks:
            self._callbacks.append(callback)

    def unregister_callback(self, callback: Callable[[], None]):
        """注销主题变化回调

        Args:
            callback: 要移除的回调函数
        """
        if callback in self._callbacks:
            self._callbacks.remove(callback)

    def _update_current_theme(self):
        """更新当前主题"""
        if self._mode == ThemeMode.LIGHT:
            self._current_theme = "light"
        elif self._mode == ThemeMode.DARK:
            self._current_theme = "dark"
        else:  # AUTO
            self._current_theme = self._detect_system_theme()

        logger.info(f"主题已更新: {self._current_theme} (mode: {self._mode.value})")

    def _detect_system_theme(self) -> str:
        """检测系统主题设置

        Returns:
            'light' 或 'dark'
        """
        system = platform.system()

        if system == "Darwin":
            return self._detect_macos_theme()
        elif system == "Windows":
            return self._detect_windows_theme()
        else:
            # Linux 默认浅色
            return "light"

    def _detect_macos_theme(self) -> str:
        """检测 macOS 系统主题

        Returns:
            'light' 或 'dark'
        """
        try:
            result = subprocess.run(
                ["defaults", "read", "-g", "AppleInterfaceStyle"],
                capture_output=True,
                text=True,
                timeout=2,
            )
            # 返回码 0 且输出包含 "Dark" = 深色模式
            if result.returncode == 0 and "Dark" in result.stdout:
                return "dark"
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
            logger.debug(f"检测 macOS 主题失败: {e}")

        return "light"

    def _detect_windows_theme(self) -> str:
        """检测 Windows 系统主题

        Returns:
            'light' 或 'dark'
        """
        try:
            import winreg

            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"
            )
            value, _ = winreg.QueryValueEx(key, "AppsUseLightTheme")
            winreg.CloseKey(key)

            # 0 = 深色, 1 = 浅色
            return "dark" if value == 0 else "light"
        except (ImportError, OSError, FileNotFoundError) as e:
            logger.debug(f"检测 Windows 主题失败: {e}")

        return "light"

    def _notify_callbacks(self):
        """通知所有注册的回调函数"""
        for callback in self._callbacks:
            try:
                callback()
            except Exception as e:
                logger.error(f"主题变化回调执行失败: {e}")
