"""跨平台中日韩(CJK)字体配置模块"""
import platform
import sys
import tkinter as tk
from typing import List, Optional, Tuple, TYPE_CHECKING

if TYPE_CHECKING:
    from config import Config


class FontConfig:
    """跨平台字体配置类"""

    # 各平台推荐的中日韩字体列表（按优先级排序）
    # macOS
    MACOS_FONTS = [
        "Hiragino Sans",        # 冬青黑体（日文版，完整支持中日韩）
        "Hiragino Sans GB",     # 冬青黑体简体中文版
        "PingFang SC",          # 苹方-简（系统默认）
        "STHeiti",              # 华文黑体
        "Heiti SC",             # 黑体-简
        "Microsoft YaHei",      # 微软雅黑（可能已安装）
        "SimHei",               # 黑体
        "Arial Unicode MS",     # Arial Unicode（支持多语言）
    ]

    # Windows
    WINDOWS_FONTS = [
        "MS PGothic",           # MS P ゴシック（日语默认，完整支持中日韩）
        "MS PMincho",           # MS P 明朝
        "Meiryo",               # メイリオ（日语清晰字体）
        "Yu Gothic",            # 游ゴシック（Windows 8.1+）
        "Yu Mincho",            # 游明朝
        "Microsoft YaHei",      # 微软雅黑（主要支持中文）
        "Microsoft YaHei UI",   # 微软雅黑 UI
        "SimHei",               # 黑体
        "SimSun",               # 宋体
        "KaiTi",                # 楷体
        "FangSong",             # 仿宋
        "DengXian",             # 等线
        "Arial Unicode MS",     # 支持多语言
    ]

    # Linux
    LINUX_FONTS = [
        "Noto Sans CJK JP",     # 思源黑体-日（完整支持中日韩）
        "Noto Sans CJK SC",     # 思源黑体-简
        "Noto Sans CJK TC",     # 思源黑体-繁
        "Noto Sans CJK",        # 思源黑体（完整版）
        "Source Han Sans JP",   # 思源黑体日文版
        "Source Han Sans CN",   # 思源黑体简体中文版
        "WenQuanYi Micro Hei",  # 文泉驿微米黑
        "WenQuanYi Zen Hei",    # 文泉驿正黑
        "Droid Sans Fallback",  # Droid Sans
        "AR PL UMing CN",       # 文鼎PL明体
        "AR PL UKai CN",        # 文鼎PL楷体
        "ZCOOL XiaoWei",        # 站酷小薇
        "Microsoft YaHei",      # 可能已安装
        "SimHei",
    ]

    # 通用备选字体（所有平台可能都有）
    FALLBACK_FONTS = [
        "sans-serif",
    ]

    # 字体大小配置（相对于基础大小的倍数）
    SIZE_MULTIPLIERS = {
        "title": 1.33,     # 标题 (16 if base=12)
        "subtitle": 1.17,  # 副标题 (14 if base=12)
        "normal": 1.0,     # 正文
        "small": 0.83,     # 小字 (10 if base=12)
        "tiny": 0.75,      # 极小字 (9 if base=12)
    }

    # 默认字体大小
    DEFAULT_BASE_SIZE = 12

    def __init__(self, config: Optional["Config"] = None):
        """
        初始化字体配置

        Args:
            config: 可选的配置对象，如果提供了 config.font_name，将使用指定的字体
        """
        self.system = platform.system()
        self._available_fonts: Optional[List[str]] = None
        self._selected_font: Optional[str] = None
        self._config = config

        # 如果配置中指定了字体，优先使用
        if config and config.font_name:
            self._selected_font = config.font_name

    def get_available_fonts(self, root: Optional[tk.Tk] = None) -> List[str]:
        """获取系统可用字体列表

        Args:
            root: 可选的 tkinter 根窗口，如果提供则重用它
        """
        if self._available_fonts is None:
            # 使用提供的 root 或创建临时的 tkinter 实例
            should_destroy = False
            if root is None:
                root = tk.Tk()
                root.withdraw()  # 隐藏窗口
                should_destroy = True
            self._available_fonts = sorted(list(root.tk.call("font", "families")))
            if should_destroy:
                root.destroy()
        return self._available_fonts

    def get_preferred_fonts(self) -> List[str]:
        """根据操作系统获取首选字体列表（公开方法）"""
        if self.system == "Darwin":  # macOS
            return self.MACOS_FONTS
        elif self.system == "Windows":
            return self.WINDOWS_FONTS
        elif self.system == "Linux":
            return self.LINUX_FONTS
        else:
            return self.FALLBACK_FONTS

    def get_best_font(self) -> str:
        """获取系统中最佳中日韩字体"""
        if self._selected_font:
            return self._selected_font

        available = self.get_available_fonts()
        preferred = self.get_preferred_fonts()

        # 查找第一个可用的首选字体
        for font_name in preferred:
            if font_name in available:
                self._selected_font = font_name
                return font_name

        # 如果都不可用，返回系统默认
        self._selected_font = "sans-serif"
        return "sans-serif"

    def get_font(self, size_key: str = "normal", bold: bool = False) -> Tuple[str, int, str]:
        """
        获取字体配置元组

        Args:
            size_key: 字体大小键名 (title, subtitle, normal, small, tiny)
            bold: 是否粗体

        Returns:
            (字体名, 大小, 样式) 元组，适用于 tkinter 组件
        """
        font_name = self.get_best_font()
        # 获取基础字体大小
        base_size = self._config.font_size if self._config else self.DEFAULT_BASE_SIZE
        # 根据倍数计算实际大小
        multiplier = self.SIZE_MULTIPLIERS.get(size_key, 1.0)
        size = int(base_size * multiplier)
        style = "bold" if bold else "normal"
        return (font_name, size, style)

    def get_font_string(self, size_key: str = "normal", bold: bool = False) -> str:
        """
        获取字体字符串

        Args:
            size_key: 字体大小键名
            bold: 是否粗体

        Returns:
            字符串形式的字体配置，如 "Microsoft YaHei 12 bold"
        """
        font_name = self.get_best_font()
        base_size = self._config.font_size if self._config else self.DEFAULT_BASE_SIZE
        multiplier = self.SIZE_MULTIPLIERS.get(size_key, 1.0)
        size = int(base_size * multiplier)
        style = " bold" if bold else ""
        return f"{font_name} {size}{style}"

    def configure_widget(self, widget: tk.Widget, size_key: str = "normal", bold: bool = False):
        """
        直接配置 tkinter 组件的字体

        Args:
            widget: tkinter 组件
            size_key: 字体大小键名
            bold: 是否粗体
        """
        widget.configure(font=self.get_font(size_key, bold))

    @staticmethod
    def create_instance(config: Optional["Config"] = None) -> "FontConfig":
        """
        创建并返回字体配置实例（单例模式）

        Args:
            config: 可选的配置对象
        """
        if not hasattr(FontConfig, "_instance"):
            FontConfig._instance = FontConfig(config)
        elif config and not FontConfig._instance._config:
            FontConfig._instance._config = config
        return FontConfig._instance


# 全局字体配置实例
_font_config: Optional[FontConfig] = None


def get_font_config() -> FontConfig:
    """获取全局字体配置实例"""
    global _font_config
    if _font_config is None:
        _font_config = FontConfig.create_instance()
    return _font_config


def get_font(size_key: str = "normal", bold: bool = False) -> Tuple[str, int, str]:
    """快捷方法：获取字体配置元组"""
    return get_font_config().get_font(size_key, bold)


def get_font_string(size_key: str = "normal", bold: bool = False) -> str:
    """快捷方法：获取字体字符串"""
    return get_font_config().get_font_string(size_key, bold)


def configure_font(widget: tk.Widget, size_key: str = "normal", bold: bool = False):
    """快捷方法：配置组件字体"""
    get_font_config().configure_widget(widget, size_key, bold)


if __name__ == "__main__":
    # 测试代码
    fc = FontConfig()
    print(f"系统: {fc.system}")
    print(f"选择的中日韩字体: {fc.get_best_font()}")
    print(f"可用字体数量: {len(fc.get_available_fonts())}")
    print(f"推荐字体配置:")
    for size_name in ["title", "subtitle", "normal", "small", "tiny"]:
        print(f"  {size_name}: {fc.get_font_string(size_name)}")
        print(f"         {fc.get_font_string(size_name, True)} (bold)")
    # 测试日语字符显示
    test_text = "日本語テスト 123 测试"
    print(f"\n测试文本: {test_text}")
