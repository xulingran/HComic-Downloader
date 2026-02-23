"""下载面板包装层。"""

from __future__ import annotations

import importlib
import tkinter as tk
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
        self._host: Any = None
        ui_module = importlib.import_module("download_manager_ui")
        ui_cls = getattr(ui_module, "DownloadManagerUI")
        self.ui = ui_cls(parent, download_manager, anchor_widget=anchor_widget)

    def bind_host(self, host: Any) -> None:
        self._host = host

    def _call_host(self, name: str, *args, **kwargs):
        if not self._host:
            return None
        fn = getattr(self._host, name, None)
        if callable(fn):
            return fn(*args, **kwargs)
        return None

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

    # 计划中的下载相关入口（兼容代理）
    def _on_download_task_update(self, task: Any):
        return self._call_host("_on_download_task_update", task)

    def _update_ui_for_task(self, task: Any):
        return self._call_host("_update_ui_for_task", task)

    def _on_download_queue_complete(self):
        return self._call_host("_on_download_queue_complete")

    def _toggle_download_manager(self):
        return self._call_host("_toggle_download_manager")

    def batch_download_selected(self):
        return self._call_host("batch_download_selected")

    def confirm_batch_download(self, comics: list[Any]) -> bool:
        result = self._call_host("confirm_batch_download", comics)
        return bool(result)

    def execute_batch_download(self, comics: list[Any]):
        return self._call_host("execute_batch_download", comics)

    def show_batch_download_summary(self, results: dict):
        return self._call_host("show_batch_download_summary", results)

    def download_comic(self, comic: Any):
        return self._call_host("download_comic", comic)

    def _continue_single_download(self, comic: Any):
        return self._call_host("_continue_single_download", comic)
