"""下载面板包装层。"""

from __future__ import annotations

import tkinter as tk
import importlib
from typing import Any, Callable


class DownloadPanel(tk.Frame):
    """对 DownloadManagerUI 的轻量包装，统一面板接口。"""

    def __init__(
        self,
        parent: tk.Widget,
        download_manager: Any,
        on_status_update: Callable[[str], None],
        anchor_widget: tk.Widget,
    ):
        super().__init__(parent)
        self._on_status_update = on_status_update
        ui_module = importlib.import_module("download_manager_ui")
        ui_cls = getattr(ui_module, "DownloadManagerUI")
        self.ui = ui_cls(parent, download_manager, anchor_widget=anchor_widget)

    @property
    def is_expanded(self) -> bool:
        return self.ui.is_expanded

    def toggle(self):
        self.ui.toggle()

    def refresh_task_list(self):
        self.ui.refresh_task_list()

    def update_task(self, task: Any):
        self.ui.update_task(task)

    def refresh_theme(self):
        self.ui.refresh_theme()
