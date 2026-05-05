"""应用状态管理模块。

提供统一的状态管理，消除 gui_app.py 和控制器之间的状态重复。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Set, Optional, Any

import tkinter as tk

from models import ComicInfo


@dataclass
class SearchState:
    """搜索相关状态。"""
    results: List[ComicInfo] = field(default_factory=list)
    result_frames: List[tk.Frame] = field(default_factory=list)
    current_page: int = 1
    total_pages: int = 1
    current_keyword: str = ""
    current_mode: str = "keyword"
    has_search_started: bool = False
    view_mode: str = "search"  # "search" or "favourites"
    card_title_expanded: Dict[str, bool] = field(default_factory=dict)
    detail_prefetch_generation: int = 0
    moeimg_detail_ready_keys: Set[str] = field(default_factory=set)

    def clear_results(self):
        """清除搜索结果。"""
        for frame in self.result_frames:
            try:
                frame.destroy()
            except tk.TclError:
                pass
        self.result_frames.clear()
        self.results.clear()
        self.card_title_expanded.clear()
        self.moeimg_detail_ready_keys.clear()

    def reset_pagination(self):
        """重置分页状态。"""
        self.current_page = 1
        self.total_pages = 1
        self.current_keyword = ""
        self.current_mode = "keyword"
        self.has_search_started = False


@dataclass
class DownloadState:
    """下载相关状态。"""
    is_downloading: bool = False
    is_batch_downloading: bool = False
    is_preparing_details: bool = False
    selected_comics: Set[ComicInfo] = field(default_factory=set)

    @property
    def is_any_active(self) -> bool:
        """是否有任何下载相关任务在进行。"""
        return self.is_downloading or self.is_batch_downloading or self.is_preparing_details

    def clear_selection(self):
        """清除选择。"""
        self.selected_comics.clear()


@dataclass
class ViewState:
    """视图相关状态。"""
    show_preview: bool = False
    settings_expanded: bool = False
    columns: int = 3
    min_card_width: int = 220
    card_padding: int = 10


class AppState:
    """应用状态管理器。

    提供统一的状态访问接口，消除状态重复。
    """

    def __init__(self):
        self.search = SearchState()
        self.download = DownloadState()
        self.view = ViewState()

    def clear_all(self):
        """清除所有状态。"""
        self.search.clear_results()
        self.download.clear_selection()

    def reset_for_source_switch(self):
        """切换来源时重置相关状态。"""
        self.search.clear_results()
        self.search.reset_pagination()
        self.download.clear_selection()
