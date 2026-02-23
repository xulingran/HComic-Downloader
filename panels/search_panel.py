"""搜索结果面板。"""

from __future__ import annotations

import tkinter as tk
from typing import Any, Callable, List

from models import ComicInfo


class SearchPanel(tk.Frame):
    """搜索区和结果区面板。"""

    def __init__(
        self,
        parent: tk.Widget,
        parser: Any,
        config: Any,
        font_config: Any,
        on_download: Callable[[ComicInfo], None],
        on_batch_download: Callable[[List[ComicInfo]], None],
        on_status_update: Callable[[str], None],
    ):
        super().__init__(parent)
        self.parser = parser
        self.config_obj = config
        self.font_config = font_config
        self.on_download = on_download
        self.on_batch_download = on_batch_download
        self.on_status_update = on_status_update

        self.search_results: List[ComicInfo] = []

    def search(self):
        """执行搜索。"""

    def search_error(self, error: str):
        self.on_status_update(f"搜索失败: {error}")

    def display_results(self, results: List[ComicInfo]):
        self.search_results = list(results)
        self.on_status_update(f"找到 {len(results)} 个结果")
