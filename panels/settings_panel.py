"""设置面板。"""

from __future__ import annotations

import tkinter as tk
from tkinter import scrolledtext, ttk
from typing import Any, Callable


class SettingsPanel(tk.Frame):
    """可复用设置面板（仅负责构建控件，不管理动画状态）。"""

    def __init__(
        self,
        parent: tk.Widget,
        config: Any,
        font_config: Any,
        on_config_change: Callable[[Any], None],
        on_font_change: Callable[[str, int], None],
        on_preview_change: Callable[[bool], None],
        on_theme_change: Callable[[str], None],
    ):
        super().__init__(parent)
        self.config_obj = config
        self.font_config = font_config
        self.on_config_change = on_config_change
        self.on_font_change = on_font_change
        self.on_preview_change = on_preview_change
        self.on_theme_change = on_theme_change

        self.download_dir_var = tk.StringVar(value=config.download_dir)
        self.concurrent_var = tk.IntVar(value=config.concurrent_downloads)
        self.batch_delay_var = tk.IntVar(value=config.batch_download_delay)
        self.auto_retry_var = tk.IntVar(value=config.auto_retry_max_attempts)
        self.font_var = tk.StringVar(value=config.font_name or "自动检测")
        self.font_size_var = tk.IntVar(value=config.font_size)
        self.theme_mode_var = tk.StringVar(value={"auto": "自动", "light": "浅色", "dark": "深色"}.get(config.theme_mode, "自动"))
        self.output_format_var = tk.StringVar(value={"cbz": "CBZ格式", "zip": "ZIP格式", "folder": "文件夹"}.get(config.output_format, "CBZ格式"))
        self.show_preview_var = tk.BooleanVar(value=bool(config.show_preview))
        self.login_status_var = tk.StringVar(value="未配置登录信息")
        self.proxy_status_var = tk.StringVar(value="未检测")

        self._build_ui()

    def _build_ui(self):
        self.columnconfigure(0, weight=1)

        self.container = ttk.Frame(self, height=0)
        self.container.grid(row=0, column=0, sticky=(tk.W, tk.E))
        self.container.grid_propagate(False)
        self.container.columnconfigure(0, weight=1)

        self.settings_frame = ttk.LabelFrame(self.container, text="设置", padding="5")
        self.settings_frame.grid(row=0, column=0, sticky=(tk.W, tk.E))

        ttk.Label(self.settings_frame, text="下载目录:").grid(row=0, column=0, sticky=tk.W)
        ttk.Entry(self.settings_frame, textvariable=self.download_dir_var, width=20).grid(row=0, column=1, sticky=(tk.W, tk.E), padx=5)
        self.browse_btn = ttk.Button(self.settings_frame, text="浏览...", width=6)
        self.browse_btn.grid(row=0, column=2)
        self.open_dir_btn = ttk.Button(self.settings_frame, text="跳转", width=6)
        self.open_dir_btn.grid(row=0, column=3, padx=(5, 0))

        ttk.Label(self.settings_frame, text="并发数:").grid(row=0, column=4, padx=(20, 5))
        ttk.Spinbox(self.settings_frame, from_=1, to=10, textvariable=self.concurrent_var, width=5).grid(row=0, column=5)

        ttk.Label(self.settings_frame, text="批量延迟(秒):").grid(row=0, column=6, padx=(20, 5))
        self.batch_delay_spinbox = ttk.Spinbox(self.settings_frame, from_=0, to=60, textvariable=self.batch_delay_var, width=5)
        self.batch_delay_spinbox.grid(row=0, column=7)

        ttk.Label(self.settings_frame, text="自动重试:").grid(row=0, column=8, padx=(20, 5))
        self.auto_retry_spinbox = ttk.Spinbox(self.settings_frame, from_=0, to=5, textvariable=self.auto_retry_var, width=5)
        self.auto_retry_spinbox.grid(row=0, column=9, padx=(0, 5))

        ttk.Label(self.settings_frame, text="字体:").grid(row=1, column=0, sticky=tk.W, pady=(5, 0))
        self.font_combo = ttk.Combobox(self.settings_frame, textvariable=self.font_var, width=25, state="readonly")
        self.font_combo["values"] = self._get_font_list()
        self.font_combo.grid(row=1, column=1, sticky=tk.W, padx=5, pady=(5, 0))
        self.font_combo.bind("<<ComboboxSelected>>", self._on_font_changed)

        ttk.Label(self.settings_frame, text="字体大小:").grid(row=1, column=3, padx=(20, 5), pady=(5, 0))
        ttk.Spinbox(self.settings_frame, from_=8, to=20, textvariable=self.font_size_var, width=5, command=self._on_font_size_changed).grid(row=1, column=4, pady=(5, 0))

        ttk.Label(self.settings_frame, text="主题:").grid(row=1, column=5, padx=(20, 5), pady=(5, 0))
        theme_combo = ttk.Combobox(self.settings_frame, textvariable=self.theme_mode_var, values=["自动", "浅色", "深色"], state="readonly", width=8)
        theme_combo.grid(row=1, column=6, pady=(5, 0), sticky=tk.W)
        theme_combo.bind("<<ComboboxSelected>>", self._on_theme_changed)

        ttk.Label(self.settings_frame, text="输出格式:").grid(row=1, column=7, padx=(20, 5), pady=(5, 0))
        output_format_combo = ttk.Combobox(self.settings_frame, textvariable=self.output_format_var, values=["CBZ格式", "ZIP格式", "文件夹"], state="readonly", width=10)
        output_format_combo.grid(row=1, column=8, pady=(5, 0), sticky=tk.W)
        output_format_combo.bind("<<ComboboxSelected>>", self._on_output_format_changed)

        ttk.Checkbutton(self.settings_frame, text="显示预览图", variable=self.show_preview_var, command=self._on_preview_changed).grid(row=2, column=0, columnspan=2, sticky=tk.W, pady=(5, 0))

        ttk.Label(self.settings_frame, text="登录 curl:").grid(row=3, column=0, sticky=tk.NW, pady=(8, 0))
        self.login_curl_text = scrolledtext.ScrolledText(self.settings_frame, height=4, wrap=tk.WORD)
        self.login_curl_text.grid(row=3, column=1, columnspan=4, sticky=(tk.W, tk.E), padx=5, pady=(8, 0))
        self.apply_login_btn = ttk.Button(self.settings_frame, text="应用登录信息")
        self.apply_login_btn.grid(row=3, column=5, sticky=tk.NW, pady=(8, 0))

        ttk.Label(self.settings_frame, text="登录状态:").grid(row=4, column=0, sticky=tk.W, pady=(5, 0))
        ttk.Label(self.settings_frame, textvariable=self.login_status_var).grid(row=4, column=1, columnspan=5, sticky=tk.W, padx=5, pady=(5, 0))

        ttk.Label(self.settings_frame, text="系统代理:").grid(row=5, column=0, sticky=tk.W, pady=(5, 0))
        ttk.Label(self.settings_frame, textvariable=self.proxy_status_var).grid(row=5, column=1, columnspan=4, sticky=tk.W, padx=5, pady=(5, 0))
        self.refresh_proxy_btn = ttk.Button(self.settings_frame, text="刷新代理")
        self.refresh_proxy_btn.grid(row=5, column=5, sticky=tk.W, pady=(5, 0))

        self.settings_frame.columnconfigure(1, weight=1)

    def _on_font_changed(self, event=None):
        self._save_all_settings()
        self.on_font_change(self.font_var.get(), int(self.font_size_var.get()))

    def _on_font_size_changed(self):
        self._save_all_settings()
        self.on_font_change(self.font_var.get(), int(self.font_size_var.get()))

    def _on_preview_changed(self):
        self._save_all_settings()
        self.on_preview_change(bool(self.show_preview_var.get()))

    def _on_theme_changed(self, event=None):
        self._save_all_settings()
        display = self.theme_mode_var.get()
        mode = {"自动": "auto", "浅色": "light", "深色": "dark"}.get(display, "auto")
        self.on_theme_change(mode)

    def _on_output_format_changed(self, event=None):
        self._save_all_settings()

    def _save_all_settings(self):
        self.config_obj.download_dir = self.download_dir_var.get()
        self.config_obj.concurrent_downloads = int(self.concurrent_var.get())
        self.config_obj.batch_download_delay = int(self.batch_delay_var.get())
        self.config_obj.auto_retry_max_attempts = int(self.auto_retry_var.get())
        self.config_obj.font_name = "" if self.font_var.get() == "自动检测" else self.font_var.get()
        self.config_obj.font_size = int(self.font_size_var.get())
        self.config_obj.show_preview = bool(self.show_preview_var.get())
        self.config_obj.theme_mode = {"自动": "auto", "浅色": "light", "深色": "dark"}.get(self.theme_mode_var.get(), "auto")
        self.config_obj.output_format = {"CBZ格式": "cbz", "ZIP格式": "zip", "文件夹": "folder"}.get(self.output_format_var.get(), "cbz")
        self.on_config_change(self.config_obj)

    def _get_font_list(self):
        fonts = ["自动检测"]
        available = self.font_config.get_available_fonts(self)
        preferred = self.font_config.get_preferred_fonts()
        for font in preferred:
            if font in available:
                fonts.append(font)
        fonts.extend(sorted([f for f in available if f not in preferred]))
        return fonts

    def refresh_theme(self):
        """应用当前主题颜色到面板内的 tk 组件"""
        from theme_manager import ThemeManager

        theme = ThemeManager.get_instance()
        bg_color = theme.get_color("background")
        card_bg = theme.get_color("card_bg")
        text_color = theme.get_color("text")
        insert_color = theme.get_color("insert")

        # SettingsPanel 根组件是 tk.Frame，需要手动刷新背景
        self.config(bg=bg_color)

        # 更新 ScrolledText (登录 curl 输入框)
        self.login_curl_text.config(
            bg=card_bg,
            fg=text_color,
            insertbackground=insert_color,
            selectbackground=theme.get_color("accent"),
            selectforeground="white",
        )
