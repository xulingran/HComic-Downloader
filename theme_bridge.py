"""主题桥接模块 - 连接 ThemeManager 和 GUI。"""

from __future__ import annotations

import logging
import platform
from typing import Any, Callable, Optional

import tkinter as tk
from tkinter import ttk

from theme_manager import ThemeManager, ThemeMode
from font_config import get_font, FontConfig

logger = logging.getLogger(__name__)


class ThemeBridge:
    """主题桥接器，负责主题轮询、样式配置和主题切换。"""

    def __init__(
        self,
        root: tk.Tk,
        config: Any,
        theme_manager: ThemeManager,
        font_config: FontConfig,
        on_theme_change: Optional[Callable[[], None]] = None,
    ):
        self._root = root
        self._config = config
        self._theme_manager = theme_manager
        self._font_config = font_config
        self._on_theme_change = on_theme_change

        self._poll_after_id: Optional[str] = None
        self._default_ttk_theme: Optional[str] = None

        # 初始化 ttk 样式
        self._style = ttk.Style()
        self._default_ttk_theme = self._style.theme_use()
        self.configure_ttk_styles()

        # 注册主题变化回调
        self._theme_manager.register_callback(self._on_theme_change_internal)

        # 启动主题轮询
        self.start_theme_polling()

    def destroy(self):
        """销毁时清理。"""
        if self._poll_after_id:
            self._root.after_cancel(self._poll_after_id)
            self._poll_after_id = None
        self._theme_manager.unregister_callback(self._on_theme_change_internal)

    def parse_theme_mode(self, mode: str) -> ThemeMode:
        """解析主题模式字符串。"""
        return {
            "auto": ThemeMode.AUTO,
            "light": ThemeMode.LIGHT,
            "dark": ThemeMode.DARK,
        }.get(mode, ThemeMode.AUTO)

    def theme_mode_to_display(self, mode: str) -> str:
        """主题模式转显示文本。"""
        return {"auto": "自动", "light": "浅色", "dark": "深色"}.get(mode, "自动")

    def display_to_theme_mode(self, display: str) -> str:
        """显示文本转主题模式。"""
        return {"自动": "auto", "浅色": "light", "深色": "dark"}.get(display, "auto")

    def start_theme_polling(self):
        """启动系统主题轮询。"""
        self._schedule_theme_poll()

    def _schedule_theme_poll(self):
        """安排下一次主题轮询。"""
        self._poll_after_id = self._root.after(2000, self._poll_theme_change)

    def _poll_theme_change(self):
        """轮询系统主题变化并刷新 UI。"""
        self._poll_after_id = None
        try:
            self._theme_manager.refresh_auto_theme()
        finally:
            if self._root.winfo_exists():
                self._schedule_theme_poll()

    def _on_theme_change_internal(self):
        """主题变化内部处理。"""
        self._apply_theme_to_ttk()
        if self._on_theme_change:
            self._on_theme_change()

    def _apply_theme_to_ttk(self):
        """应用主题到 ttk 样式。"""
        if self._theme_manager.current_theme == "dark":
            self._style.theme_use("clam")
        elif self._default_ttk_theme:
            self._style.theme_use(self._default_ttk_theme)

    def configure_ttk_styles(self):
        """配置 ttk 样式。"""
        # 主框架样式
        self._style.configure("Main.TFrame", background=self._theme_manager.get_color("background"))

        # 结果区域样式
        self._style.configure(
            "Results.TLabelframe",
            background=self._theme_manager.get_color("background"),
            foreground=self._theme_manager.get_color("text"),
        )
        self._style.configure(
            "Results.TLabelframe.Label",
            background=self._theme_manager.get_color("background"),
            foreground=self._theme_manager.get_color("text"),
        )

        # 卡片样式
        self._style.configure(
            "Card.TFrame",
            background=self._theme_manager.get_color("card_bg"),
            relief="solid",
            borderwidth=1,
        )

        # 工具栏样式
        self._style.configure(
            "Toolbar.TFrame",
            background=self._theme_manager.get_color("background"),
        )

        # 可滚动区域样式
        self._style.configure(
            "Scrollable.TFrame",
            background=self._theme_manager.get_color("background"),
        )

        # 按钮样式
        self._style.configure(
            "TButton",
            background=self._theme_manager.get_color("card_bg"),
            foreground=self._theme_manager.get_color("text"),
        )

        # 进度条样式
        self._style.configure(
            "Horizontal.TProgressbar",
            background=self._theme_manager.get_color("accent"),
            troughcolor=self._theme_manager.get_color("border"),
        )

    def apply_theme_to_canvas(self, canvas: tk.Canvas):
        """应用主题到 Canvas。"""
        canvas.configure(bg=self._theme_manager.get_color("background"))

    def apply_theme_to_text_widget(self, widget: tk.Text):
        """应用主题到 Text 组件。"""
        widget.configure(
            bg=self._theme_manager.get_color("card_bg"),
            fg=self._theme_manager.get_color("text"),
            insertbackground=self._theme_manager.get_color("insert"),
            selectbackground=self._theme_manager.get_color("accent"),
            selectforeground="white",
        )

    def apply_theme_to_card_frame(self, frame: tk.Frame) -> None:
        """应用主题颜色到卡片 frame 及其子组件。"""
        theme = self._theme_manager
        card_bg = theme.get_color("card_bg")
        text_primary = theme.get_color("text")
        text_secondary = theme.get_color("text_secondary")

        for widget in frame.winfo_children():
            if isinstance(widget, tk.Frame):
                try:
                    widget.config(bg=card_bg)
                except tk.TclError:
                    pass
            elif isinstance(widget, tk.Label):
                if getattr(widget, "select_mark", False):
                    continue
                role = getattr(widget, "theme_role", "")
                try:
                    if role == "placeholder":
                        widget.config(
                            bg=theme.get_color("border"),
                            foreground=text_secondary,
                        )
                    elif getattr(widget, "is_secondary_text", False):
                        widget.config(
                            bg=card_bg,
                            foreground=text_secondary,
                        )
                    else:
                        widget.config(bg=card_bg)
                except tk.TclError:
                    pass
            if isinstance(widget, tk.Text):
                try:
                    fg = text_secondary if getattr(widget, "is_secondary_text", False) else text_primary
                    widget.config(
                        fg=fg,
                        bg=card_bg,
                        insertbackground=theme.get_color("insert"),
                        disabledforeground=fg,
                        disabledbackground=card_bg,
                    )
                except tk.TclError:
                    pass

    def sync_light_background_from_native_theme(self):
        """从原生主题同步浅色背景色。"""
        if self._theme_manager.current_theme != "light":
            return

        try:
            # 尝试获取系统原生背景色
            if platform.system() == "Windows":
                import ctypes
                color = ctypes.windll.user32.GetSysColor(5)  # COLOR_WINDOW
                r = color & 0xFF
                g = (color >> 8) & 0xFF
                b = (color >> 16) & 0xFF
                bg_hex = f"#{r:02x}{g:02x}{b:02x}"
                self._theme_manager.set_light_background(bg_hex)
        except Exception:
            pass  # 忽略系统调用失败
