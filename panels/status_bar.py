"""底部状态栏面板。"""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk
from typing import Callable, Optional


class StatusBar(tk.Frame):
    """状态栏 + 进度条。"""

    def __init__(self, parent: tk.Widget, on_toggle_download_panel: Optional[Callable[[], None]] = None):
        super().__init__(parent)
        self.columnconfigure(0, weight=1)

        self.status_var = tk.StringVar(value="就绪")
        self.status_label = ttk.Label(self, textvariable=self.status_var)
        self.status_label.grid(row=0, column=0, sticky=tk.W)

        progress_container = ttk.Frame(self)
        progress_container.grid(row=1, column=0, sticky="we", pady=(5, 0))
        progress_container.columnconfigure(0, weight=1)

        self.progress_var = tk.DoubleVar(value=0)
        self.progress_bar = ttk.Progressbar(progress_container, variable=self.progress_var, maximum=100)
        self.progress_bar.grid(row=0, column=0, sticky="we")

        self.expand_btn = ttk.Button(
            progress_container,
            text="▲",
            width=3,
            command=on_toggle_download_panel or (lambda: None),
        )
        self.expand_btn.grid(row=0, column=1, padx=(5, 0))

    def update_message(self, text: str):
        self.status_var.set(text)
        self.update_idletasks()

    def update_progress(self, progress: float):
        self.progress_var.set(progress)

    def update_login_status(self, logged_in: bool, source: str):
        status = "已登录" if logged_in else "未登录"
        self.update_message(f"来源 {source}: {status}")
