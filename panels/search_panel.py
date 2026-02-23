"""搜索结果面板入口与兼容代理。"""

from __future__ import annotations

import tkinter as tk
from typing import Any, Callable, List, Optional

from models import ComicInfo, PaginationInfo


class SearchPanel(tk.Frame):
    """搜索区和结果区面板（统一入口，逻辑由 host 提供）。"""

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
        self._host: Any = None

    def bind_host(self, host: Any) -> None:
        self._host = host

    def _call_host(self, name: str, *args, **kwargs):
        if not self._host:
            return None
        fn = getattr(self._host, name, None)
        if callable(fn):
            return fn(*args, **kwargs)
        return None

    def search(self):
        return self._call_host("search")

    def search_error(self, error: str):
        return self._call_host("search_error", error)

    def display_results(self, results: List[ComicInfo], pagination: Optional[PaginationInfo] = None):
        self.search_results = list(results)
        return self._call_host("display_results", results, pagination)

    def _start_result_detail_prefetch(self, results: List[ComicInfo]):
        return self._call_host("_start_result_detail_prefetch", results)

    def _on_result_detail_prefetched(self, comic: ComicInfo, generation: int):
        return self._call_host("_on_result_detail_prefetched", comic, generation)

    def _refresh_results_layout(self):
        return self._call_host("_refresh_results_layout")

    def _calculate_columns(self) -> int:
        result = self._call_host("_calculate_columns")
        return int(result) if result is not None else 1

    def update_pagination_controls(self):
        return self._call_host("update_pagination_controls")

    def go_previous_page(self):
        return self._call_host("go_previous_page")

    def go_next_page(self):
        return self._call_host("go_next_page")

    def go_to_page_dialog(self):
        return self._call_host("go_to_page_dialog")

    def _load_page(self):
        return self._call_host("_load_page")

    def create_batch_toolbar(self, parent: tk.Widget):
        return self._call_host("create_batch_toolbar", parent)

    def select_all(self):
        return self._call_host("select_all")

    def clear_selection(self):
        return self._call_host("clear_selection")

    def update_toolbar_buttons(self):
        return self._call_host("update_toolbar_buttons")

    def _on_batch_mode_changed(self):
        return self._call_host("_on_batch_mode_changed")

    def view_favourites(self):
        return self._call_host("view_favourites")

    def _handle_favourites_login_required(self):
        return self._call_host("_handle_favourites_login_required")

    def _on_mousewheel(self, event):
        return self._call_host("_on_mousewheel", event)

    def _on_touchpad_scroll(self, event):
        return self._call_host("_on_touchpad_scroll", event)

    def _scroll_canvas_smooth(self, delta_y: float):
        return self._call_host("_scroll_canvas_smooth", delta_y)

    def _bind_scroll_events(self):
        return self._call_host("_bind_scroll_events")
