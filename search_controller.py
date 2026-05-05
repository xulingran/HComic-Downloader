import logging
import threading
from typing import Callable, Dict, List, Optional, Set, Tuple

import tkinter as tk
from tkinter import font as tkfont, messagebox, simpledialog
from tkinter import ttk

from models import ComicInfo, PaginationInfo
from parser import MultiSourceParser, ParserResponseError
from config import Config
from cover_loader import CoverLoader
from theme_manager import ThemeManager
from font_config import get_font, FontConfig
from app_state import AppState
from gui_logic import (
    calculate_grid_columns,
    is_moeimg_detail_ready,
    should_block_source_change,
)
from panels.comic_card import (
    CardContext,
    build_comic_card_frame,
    copy_selected_text,
    get_card_key,
    get_frame_background,
    is_title_expanded,
    on_title_click_press,
    on_title_drag,
    on_title_click_release,
    render_title_widget,
    set_text_widget_content,
    truncate_text_to_lines,
    wrap_text_lines,
)

logger = logging.getLogger(__name__)


class _CardEventHandlerAdapter:
    """卡片事件处理器适配器，将 SearchController 方法与 DownloadController 回调结合。"""

    def __init__(
        self,
        controller: 'SearchController',
        on_card_click: Callable,
        on_download_click: Callable,
    ):
        self._ctrl = controller
        self._on_card_click = on_card_click
        self._on_download_click = on_download_click

    def on_card_click(self, event: tk.Event, comic: ComicInfo, frame: tk.Frame) -> None:
        self._on_card_click(event, comic, frame)

    def on_download_click(self, comic: ComicInfo) -> None:
        self._on_download_click(comic)

    def on_schedule_cover_load(self, url: str, label: ttk.Label, card_width: int) -> None:
        self._ctrl._schedule_cover_load(url, label, card_width)

    def on_render_title(self, title_widget: tk.Text, comic: ComicInfo, card_width: int) -> None:
        self._ctrl._render_title_widget(title_widget, comic, card_width)

    def on_copy_selected_text(self, event: tk.Event) -> None:
        self._ctrl._copy_selected_text(event)

    def on_title_click_press(self, event: tk.Event) -> None:
        self._ctrl._on_title_click_press(event)

    def on_title_drag(self, event: tk.Event) -> None:
        self._ctrl._on_title_drag(event)

    def on_title_click_release(self, event: tk.Event, comic: ComicInfo, title_widget: tk.Text, card_width: int) -> str:
        return self._ctrl._on_title_click_release(event, comic, title_widget, card_width)

    def on_set_text_widget_content(self, widget: tk.Text, text: str, height: int) -> None:
        self._ctrl._set_text_widget_content(widget, text, height)


class SearchController:
    def __init__(
        self,
        root: tk.Tk,
        parser: MultiSourceParser,
        config: Config,
        font_config: FontConfig,
        theme_manager: ThemeManager,
        cover_loader: CoverLoader,
        app_state: AppState,
        get_widgets: Callable,
        get_download_callbacks: Callable,
        on_status_update: Callable[[str], None],
        on_source_changed_post: Callable[[str], None],
        on_card_theme_update: Callable,
    ):
        self._root = root
        self.parser = parser
        self.config = config
        self.font_config = font_config
        self.theme_manager = theme_manager
        self.cover_loader = cover_loader
        self._app_state = app_state
        self._get_widgets = get_widgets
        self._get_download_callbacks = get_download_callbacks
        self._on_status_update = on_status_update
        self._on_source_changed_post = on_source_changed_post
        self._on_card_theme_update = on_card_theme_update

        self.source_options = self.parser.get_source_options()
        self.source_key_to_label = {key: label for key, label in self.source_options}
        self.source_label_to_key = {label: key for key, label in self.source_options}

        # 卡片上下文（在 create_comic_card 中使用）
        self._card_ctx: Optional[CardContext] = None

    def _get_search_widgets(self):
        """获取搜索相关 widget 字典（延迟获取，避免初始化时 widget 尚未创建）。"""
        return self._get_widgets()

    # 状态属性代理（访问 app_state）
    @property
    def search_results(self) -> List[ComicInfo]:
        return self._app_state.search.results

    @search_results.setter
    def search_results(self, value: List[ComicInfo]):
        self._app_state.search.results = value

    @property
    def result_frames(self) -> List[tk.Frame]:
        return self._app_state.search.result_frames

    @result_frames.setter
    def result_frames(self, value: List[tk.Frame]):
        self._app_state.search.result_frames = value

    @property
    def current_page(self) -> int:
        return self._app_state.search.current_page

    @current_page.setter
    def current_page(self, value: int):
        self._app_state.search.current_page = value

    @property
    def total_pages(self) -> int:
        return self._app_state.search.total_pages

    @total_pages.setter
    def total_pages(self, value: int):
        self._app_state.search.total_pages = value

    @property
    def current_search_keyword(self) -> str:
        return self._app_state.search.current_keyword

    @current_search_keyword.setter
    def current_search_keyword(self, value: str):
        self._app_state.search.current_keyword = value

    @property
    def current_search_mode(self) -> str:
        return self._app_state.search.current_mode

    @current_search_mode.setter
    def current_search_mode(self, value: str):
        self._app_state.search.current_mode = value

    @property
    def has_search_started(self) -> bool:
        return self._app_state.search.has_search_started

    @has_search_started.setter
    def has_search_started(self, value: bool):
        self._app_state.search.has_search_started = value

    @property
    def current_view_mode(self) -> str:
        return self._app_state.search.view_mode

    @current_view_mode.setter
    def current_view_mode(self, value: str):
        self._app_state.search.view_mode = value

    @property
    def card_title_expanded(self) -> Dict[str, bool]:
        return self._app_state.search.card_title_expanded

    @property
    def detail_prefetch_generation(self) -> int:
        return self._app_state.search.detail_prefetch_generation

    @detail_prefetch_generation.setter
    def detail_prefetch_generation(self, value: int):
        self._app_state.search.detail_prefetch_generation = value

    @property
    def moeimg_detail_ready_keys(self) -> Set[str]:
        return self._app_state.search.moeimg_detail_ready_keys

    def _get_card_ctx(self) -> CardContext:
        """获取或创建卡片上下文。"""
        if self._card_ctx is None:
            self._card_ctx = CardContext(
                theme_manager=self.theme_manager,
                get_font_fn=get_font,
                card_padding=self._root.card_padding,
                show_preview=self._root.show_preview_var.get(),
            )
        return self._card_ctx

    def _fetch_download_callbacks(self):
        return self._get_download_callbacks()

    def get_current_source(self) -> str:
        w = self._get_search_widgets()
        if hasattr(self._root, "source_var"):
            selected = self.source_label_to_key.get(self._root.source_var.get())
            if selected:
                return selected
        return self.parser.current_source

    def _get_selected_query_mode(self) -> str:
        if hasattr(self._root, "query_mode_var"):
            selected = self._root.query_mode_label_to_key.get(self._root.query_mode_var.get())
            if selected:
                return selected
        return "keyword"

    def _build_search_keyword(self, keyword: str, query_mode: str) -> str:
        text = (keyword or "").strip()
        source = self.get_current_source()
        if source != "moeimg":
            return text
        if query_mode == "author":
            return f"Author: {text}" if text else "Author:"
        if query_mode == "tag":
            return f"Tag: {text}" if text else "Tag:"
        return text

    def _get_effective_query_mode(self) -> str:
        if self.current_view_mode == "favourites":
            return "favourites"
        if self.has_search_started:
            return (self.current_search_mode or "keyword").strip().lower()
        return self._get_selected_query_mode()

    def _get_request_endpoint_hint(self) -> str:
        source = self.get_current_source()
        mode = self._get_effective_query_mode()
        page_token = "{page}"

        if mode == "favourites":
            if source == "hcomic":
                return f"/favourites?page={page_token}"
            return "不支持收藏夹"

        if source == "moeimg":
            if mode == "author":
                return f"/spa/author/{{id}}?page={page_token}"
            if mode == "tag":
                return f"/spa/genre/{{id}}?page={page_token}"
            keyword = self.current_search_keyword.strip() if self.has_search_started else self._root.search_var.get().strip()
            if not keyword:
                return f"/spa/latest-manga?page={page_token}"
            return f"/spa/search?query=...&page={page_token}"

        return f"/?q=...&page={page_token}"

    def refresh_query_context_hint(self):
        if not hasattr(self._root, "query_context_var"):
            return

        mode = self._get_effective_query_mode()
        source = self.get_current_source()
        source_label = self.source_key_to_label.get(source, source)
        mode_label = (
            "收藏夹"
            if mode == "favourites"
            else self._root.query_mode_key_to_label.get(mode, mode)
        )
        endpoint = self._get_request_endpoint_hint()
        page_info = f"{self.current_page}/{self.total_pages}"
        self._root.query_context_var.set(
            f"当前查询: 来源={source_label} | 模式={mode_label} | 端点={endpoint} | 页码={page_info}"
        )

    def source_requires_login(self, source: Optional[str] = None) -> bool:
        current = source or self.get_current_source()
        return current == "hcomic"

    def clear_results_for_source_switch(self, selected_comics: Set[ComicInfo]):
        self.cover_loader.increment_generation()
        for frame in self.result_frames:
            frame.destroy()
        self.result_frames.clear()
        self.search_results = []
        selected_comics.clear()
        self.cover_loader.image_cache.clear()
        self.card_title_expanded.clear()
        self.moeimg_detail_ready_keys.clear()

    def on_source_changed(self, event=None):
        selected_source = self.source_label_to_key.get(self._root.source_var.get())
        if not selected_source:
            return

        dl = self._app_state.download
        if (
            selected_source != self.parser.current_source
            and dl.is_any_active
        ):
            self._root.source_var.set(
                self.source_key_to_label.get(self.parser.current_source, self.parser.current_source)
            )
            messagebox.showinfo("提示", "下载进行中，暂不支持切换来源")
            return

        if selected_source == self.parser.current_source:
            return

        self.parser.set_source(selected_source)
        self.config.default_source = selected_source
        self._on_source_changed_post(selected_source)

        self.current_view_mode = "search"
        self.current_page = 1
        self.total_pages = 1
        self.current_search_keyword = ""
        self.current_search_mode = self._get_selected_query_mode()
        self.has_search_started = False
        self.clear_results_for_source_switch(self._app_state.download.selected_comics)
        self._on_status_update(f"已切换来源: {self.source_key_to_label.get(selected_source, selected_source)}")

    def search(self):
        input_keyword = self._root.search_var.get().strip()
        query_mode = self._get_selected_query_mode()
        keyword = self._build_search_keyword(input_keyword, query_mode)

        self.current_view_mode = "search"
        self.current_search_keyword = keyword
        self.current_search_mode = query_mode
        self.has_search_started = True
        self.current_page = 1
        self.refresh_query_context_hint()

        w = self._get_search_widgets()
        w["search_btn"].config(state=tk.DISABLED)
        if input_keyword:
            if query_mode == "keyword":
                self._on_status_update(f"正在搜索: {input_keyword}...")
            else:
                mode_label = self._root.query_mode_key_to_label.get(query_mode, query_mode)
                self._on_status_update(f"正在按{mode_label}搜索: {input_keyword}...")
        else:
            self._on_status_update("正在搜索...")

        def do_search():
            try:
                results, pagination = self.parser.search(keyword, page=self.current_page)
                self._root.after(0, lambda: self.display_results(results, pagination))
            except (ParserResponseError, ValueError) as e:
                error_msg = str(e)
                logger.error(f"Search error: {error_msg}")
                self._root.after(0, lambda: self.search_error(error_msg))

        threading.Thread(target=do_search, daemon=True).start()

    def search_error(self, error_msg: str):
        w = self._get_search_widgets()
        w["search_btn"].config(state=tk.NORMAL)
        w["favourites_btn"].config(state=tk.NORMAL)
        self._on_status_update(f"搜索失败: {error_msg}")
        messagebox.showerror("错误", f"搜索失败: {error_msg}")

    def display_results(self, results: List[ComicInfo], pagination: Optional[PaginationInfo] = None):
        w = self._get_search_widgets()
        dc = self._fetch_download_callbacks()
        w["search_btn"].config(state=tk.NORMAL)
        w["favourites_btn"].config(state=tk.NORMAL)
        self.search_results = results

        if pagination:
            self.current_page = pagination.current_page
            self.total_pages = pagination.total_pages
        else:
            self.current_page = max(1, self.current_page)
            self.total_pages = max(1, self.current_page)

        self._app_state.download.selected_comics.clear()
        dc["update_toolbar_buttons"]()
        self.update_pagination_controls()

        self.cover_loader.clear_all()
        self.detail_prefetch_generation += 1
        for frame in self.result_frames:
            frame.destroy()
        self.result_frames.clear()
        self.card_title_expanded.clear()
        self.moeimg_detail_ready_keys.clear()
        self._scroll_results_to_top()

        if not results:
            self._on_status_update("未找到相关漫画")
            no_result_label = ttk.Label(
                self._root.scrollable_frame, text="未找到相关漫画", font=get_font("subtitle")
            )
            no_result_label.grid(row=0, column=0, pady=50)
            self.result_frames.append(no_result_label)
            return

        page_info = f"第 {self.current_page}/{self.total_pages} 页"
        if self.current_view_mode == "favourites":
            self._on_status_update(f"找到 {len(results)} 个收藏 - {page_info}")
        else:
            self._on_status_update(f"找到 {len(results)} 个结果 - {page_info}")

        self._root.columns = self._calculate_columns()
        self._update_canvas_width()

        for i, comic in enumerate(results):
            row = i // self._root.columns
            col = i % self._root.columns
            frame = self.create_comic_card(comic, row, col, dc)
            self.result_frames.append(frame)

        self._start_result_detail_prefetch(results)

    def update_pagination_controls(self):
        w = self._get_search_widgets()
        w["page_label_var"].set(f"{self.current_page}/{self.total_pages}")

        if self.current_page > 1:
            w["prev_page_btn"].state(['!disabled'])
        else:
            w["prev_page_btn"].state(['disabled'])

        if self.current_page < self.total_pages:
            w["next_page_btn"].state(['!disabled'])
        else:
            w["next_page_btn"].state(['disabled'])

        self.refresh_query_context_hint()

    def go_previous_page(self):
        if self.current_page <= 1:
            return
        self.current_page -= 1
        self._load_page()

    def go_next_page(self):
        if self.current_page >= self.total_pages:
            return
        self.current_page += 1
        self._load_page()

    def go_to_page_dialog(self):
        if self.total_pages <= 1:
            messagebox.showinfo("提示", "当前只有一页")
            return
        if self.current_view_mode == "search" and not self.has_search_started:
            messagebox.showinfo("提示", "请先进行搜索")
            return

        dialog = simpledialog.askinteger(
            "跳转页码",
            f"请输入页码 (1-{self.total_pages}):",
            parent=self._root,
            minvalue=1,
            maxvalue=self.total_pages,
            initialvalue=self.current_page,
        )

        if dialog is not None and dialog != self.current_page:
            self.current_page = dialog
            self._load_page()

    def _load_page(self):
        if self.current_view_mode == "search" and not self.has_search_started:
            messagebox.showinfo("提示", "请先进行搜索")
            return
        if self.current_view_mode == "favourites" and not self.parser.source_supports_favourites():
            self.current_view_mode = "search"
            self._on_status_update("当前来源暂不支持收藏夹")
            return

        self._scroll_results_to_top()

        w = self._get_search_widgets()
        w["prev_page_btn"].state(['disabled'])
        w["next_page_btn"].state(['disabled'])
        w["search_btn"].config(state=tk.DISABLED)
        w["favourites_btn"].config(state=tk.DISABLED)

        page_info = f"第 {self.current_page}/{self.total_pages} 页"
        self._on_status_update(f"正在加载{page_info}...")
        self.refresh_query_context_hint()

        if self.current_view_mode == "favourites":
            def do_load_favourites():
                try:
                    results, pagination, needs_login = self.parser.favourites(page=self.current_page)
                    if needs_login:
                        from gui_app import LoginExpiredDialog
                        self._root.after(0, lambda: self._handle_favourites_login_required(w))
                        return
                    self._root.after(0, lambda: self.display_results(results, pagination))
                except (ParserResponseError, ValueError) as e:
                    error_msg = str(e)
                    logger.error(f"Favourites page load error: {error_msg}")
                    self._root.after(0, lambda: self.search_error(error_msg))

            threading.Thread(target=do_load_favourites, daemon=True).start()
            return

        def do_search():
            try:
                results, pagination = self.parser.search(self.current_search_keyword, page=self.current_page)
                self._root.after(0, lambda: self.display_results(results, pagination))
            except (ParserResponseError, ValueError) as e:
                error_msg = str(e)
                logger.error(f"Page load error: {error_msg}")
                self._root.after(0, lambda: self.search_error(error_msg))

        threading.Thread(target=do_search, daemon=True).start()

    def _handle_favourites_login_required(self, w):
        from gui_app import LoginExpiredDialog
        w["search_btn"].config(state=tk.NORMAL)
        w["favourites_btn"].config(state=tk.NORMAL)
        self.update_pagination_controls()
        self._on_status_update("登录信息已过期或收藏夹为空")
        LoginExpiredDialog(self._root)

    def view_favourites(self):
        if not self.parser.source_supports_favourites():
            messagebox.showwarning("提示", "当前来源暂不支持收藏夹")
            return

        w = self._get_search_widgets()
        previous_mode = self.current_view_mode
        previous_page = self.current_page

        self.current_view_mode = "favourites"
        self.current_page = 1
        self.refresh_query_context_hint()

        w["search_btn"].config(state=tk.DISABLED)
        w["favourites_btn"].config(state=tk.DISABLED)
        self._on_status_update("正在加载收藏夹...")

        def do_load_favourites():
            try:
                results, pagination, needs_login = self.parser.favourites(page=1)
                if needs_login:
                    def handle_needs_login():
                        self.current_view_mode = previous_mode
                        self.current_page = previous_page
                        self._handle_favourites_login_required(w)
                    self._root.after(0, handle_needs_login)
                    return
                self._root.after(0, lambda: self.display_results(results, pagination))
            except (ParserResponseError, ValueError) as e:
                error_msg = str(e)
                logger.error(f"Load favourites error: {error_msg}")
                self._root.after(0, lambda: self.search_error(error_msg))

        threading.Thread(target=do_load_favourites, daemon=True).start()

    def on_window_resize(self, event):
        if event.widget != self._root:
            return

        if hasattr(self._root, '_resize_after_id') and self._root._resize_after_id:
            self._root.after_cancel(self._root._resize_after_id)
        self._root._resize_after_id = self._root.after(100, self._update_layout)

    def _update_layout(self):
        new_columns = self._calculate_columns()
        if new_columns != self._root.columns:
            self._root.columns = new_columns
            if self.search_results:
                self._refresh_results_layout()

        self._update_canvas_width()

    def _calculate_columns(self) -> int:
        canvas_width = self._root.canvas.winfo_width()
        if canvas_width > 1:
            available_width = canvas_width - 20
            return calculate_grid_columns(
                window_width=available_width,
                min_card_width=(self._root.min_card_width + self._root.card_padding * 2),
                padding=0,
            )
        return 3

    def _update_canvas_width(self):
        canvas_width = self._root.canvas.winfo_width()
        if canvas_width > 1:
            self._root.canvas.itemconfig(self._root.canvas_window, width=canvas_width - 20)
            content_h = self._root.scroll_handler._content_height if hasattr(self._root, 'scroll_handler') else 1
            self._root.canvas.configure(scrollregion=(0, 0, canvas_width, max(1, content_h)))

    def _refresh_results_layout(self):
        self.cover_loader.increment_generation()
        dc = self._fetch_download_callbacks()

        for frame in self.result_frames:
            frame.destroy()
        self.result_frames.clear()

        if not self.search_results:
            return

        for i, comic in enumerate(self.search_results):
            row = i // self._root.columns
            col = i % self._root.columns
            frame = self.create_comic_card(comic, row, col, dc)
            self.result_frames.append(frame)

    def _scroll_results_to_top(self):
        try:
            self._root.canvas.yview_moveto(0.0)
        except tk.TclError:
            logger.debug("结果列表已销毁，跳过滚动到顶部")

    def create_comic_card(self, comic: ComicInfo, row: int, col: int, dc: dict) -> tk.Frame:
        # 更新卡片上下文中的预览图设置
        ctx = self._get_card_ctx()
        ctx.show_preview = self._root.show_preview_var.get()

        # 创建适配器，将 dc 回调与 self 方法结合
        handler = _CardEventHandlerAdapter(
            controller=self,
            on_card_click=dc["on_card_click"],
            on_download_click=dc["download_comic"],
        )

        frame = build_comic_card_frame(
            parent=self._root.scrollable_frame,
            comic=comic,
            row=row,
            col=col,
            columns=self._root.columns,
            canvas_width=self._root.canvas.winfo_width(),
            card_key=self._get_card_key(comic),
            ctx=ctx,
            handler=handler,
        )

        if comic in self._app_state.download.selected_comics:
            dc["update_card_visual"](frame, True)

        return frame

    def _schedule_cover_load(self, url: str, label: ttk.Label, card_width: int = 200):
        self.cover_loader.schedule_cover_load(url, label, card_width)

    @staticmethod
    def _get_card_key(comic: ComicInfo) -> str:
        return get_card_key(comic)

    def _is_title_expanded(self, comic: ComicInfo) -> bool:
        return is_title_expanded(self.card_title_expanded, comic)

    @staticmethod
    def _set_text_widget_content(widget: tk.Text, text: str, height: int):
        set_text_widget_content(widget, text, height)

    def _render_title_widget(self, title_widget: tk.Text, comic: ComicInfo, card_width: int):
        font_obj = tkfont.Font(font=get_font("normal", bold=True))
        render_title_widget(
            title_widget=title_widget,
            comic=comic,
            card_width=card_width,
            expanded=self._is_title_expanded(comic),
            font_obj=font_obj,
        )

    @staticmethod
    def _on_title_click_press(event):
        on_title_click_press(event)
        return None

    @staticmethod
    def _on_title_drag(event):
        on_title_drag(event)
        return None

    def _on_title_click_release(self, event, comic: ComicInfo, title_widget: tk.Text, card_width: int):
        return on_title_click_release(
            event=event,
            comic=comic,
            title_widget=title_widget,
            card_width=card_width,
            card_title_expanded=self.card_title_expanded,
            render_callback=self._render_title_widget,
        )

    def _copy_selected_text(self, event):
        def _set_clipboard(text: str):
            self._root.clipboard_clear()
            self._root.clipboard_append(text)
            self._root.update_idletasks()

        return copy_selected_text(event, clipboard_setter=_set_clipboard)

    @staticmethod
    def _is_moeimg_comic(comic: ComicInfo) -> bool:
        return (comic.source_site or "").strip().lower() == "moeimg"

    @staticmethod
    def _detail_ready_key(comic: ComicInfo) -> str:
        return f"{(comic.source_site or '').strip().lower()}:{comic.id}"

    @staticmethod
    def _dedupe_text_values(values: List[str]) -> List[str]:
        output: List[str] = []
        seen: Set[str] = set()
        for value in values:
            text = (value or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            output.append(text)
        return output

    def _is_moeimg_detail_ready(self, comic: ComicInfo) -> bool:
        return is_moeimg_detail_ready(comic)

    def _merge_prepared_comic(self, target: ComicInfo, prepared: ComicInfo):
        if prepared.title:
            target.title = prepared.title
        if prepared.author:
            target.author = prepared.author
        if prepared.pages > target.pages:
            target.pages = prepared.pages
        if prepared.category and not target.category:
            target.category = prepared.category
        if prepared.publish_date and not target.publish_date:
            target.publish_date = prepared.publish_date
        if prepared.cover_url:
            target.cover_url = prepared.cover_url
        if prepared.preview_url:
            target.preview_url = prepared.preview_url
        if prepared.media_id:
            target.media_id = prepared.media_id
        if prepared.comic_source:
            target.comic_source = prepared.comic_source
        if prepared.source_site:
            target.source_site = prepared.source_site

        if prepared.tags:
            target.tags = self._dedupe_text_values((target.tags or []) + list(prepared.tags))
        if prepared.image_urls:
            target.image_urls = self._dedupe_text_values(list(prepared.image_urls))

    def _prepare_single_comic_detail(self, comic: ComicInfo) -> ComicInfo:
        prepared = self.parser.prepare_for_download(comic)
        if isinstance(prepared, ComicInfo):
            self._merge_prepared_comic(comic, prepared)

        if self._is_moeimg_comic(comic) and comic.image_urls and comic.pages > 0:
            self.moeimg_detail_ready_keys.add(self._detail_ready_key(comic))
        return comic

    def ensure_comics_detail_ready(
        self,
        comics: List[ComicInfo],
        progress_callback: Optional[Callable] = None,
    ) -> List[ComicInfo]:
        if not comics:
            return comics

        total = len(comics)
        for idx, comic in enumerate(comics, start=1):
            if progress_callback:
                progress_callback(idx, total, comic)

            if not self._is_moeimg_comic(comic):
                continue

            if self._is_moeimg_detail_ready(comic):
                continue

            prepared = self._prepare_single_comic_detail(comic)
            if not self._is_moeimg_detail_ready(prepared):
                raise RuntimeError(f"详情未完整获取: {comic.title}")

        return comics

    def _start_result_detail_prefetch(self, results: List[ComicInfo]):
        target_comics = [comic for comic in results if self._is_moeimg_comic(comic)]
        if not target_comics:
            return

        generation = self.detail_prefetch_generation

        def do_prefetch():
            for comic in target_comics:
                if generation != self.detail_prefetch_generation:
                    return
                if self._is_moeimg_detail_ready(comic):
                    continue
                try:
                    self._prepare_single_comic_detail(comic)
                    self._root.after(0, lambda c=comic, g=generation: self._on_result_detail_prefetched(c, g))
                except (ParserResponseError, ValueError) as e:
                    logger.warning(f"Result detail prefetch failed: {comic.title} ({e})")

        threading.Thread(target=do_prefetch, daemon=True).start()

    def _on_result_detail_prefetched(self, comic: ComicInfo, generation: int):
        if generation != self.detail_prefetch_generation:
            return
        self._update_visible_card_metadata(comic)

    def _update_visible_card_metadata(self, comic: ComicInfo):
        author_text = f"作者: {comic.author or '未知'}"
        pages_text = f"页数: {comic.pages}"
        card_key = self._get_card_key(comic)

        for frame in self.result_frames:
            if getattr(frame, "comic_ref", None) is not comic and getattr(frame, "comic_key", "") != card_key:
                continue

            author_widget = getattr(frame, "author_widget", None)
            if author_widget and author_widget.winfo_exists():
                self._set_text_widget_content(author_widget, author_text, 1)

            pages_label = getattr(frame, "pages_label", None)
            if pages_label and pages_label.winfo_exists():
                pages_label.config(text=pages_text)
            break

    def update_card_colors(self, frame: tk.Frame):
        """更新卡片主题相关颜色（委托给 theme_bridge）。"""
        if hasattr(self._root, "theme_bridge"):
            self._root.theme_bridge.apply_theme_to_card_frame(frame)
