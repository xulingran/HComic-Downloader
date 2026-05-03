"""tkinter GUI 界面模块"""
import logging
import os
import platform
import subprocess
import threading
from queue import Queue, Empty
from concurrent.futures import ThreadPoolExecutor
import tkinter as tk
from tkinter import font as tkfont
from tkinter import ttk, messagebox, scrolledtext, simpledialog
from typing import Callable, List, Optional, Tuple
from PIL import Image, ImageTk
from io import BytesIO

from config import Config
from auth_parser import extract_auth_from_curl
from models import ComicInfo, PaginationInfo, DownloadTask, DownloadStatus
from parser import MultiSourceParser
from downloader import ComicDownloader, DownloadError
from cbz_builder import CBZBuilder
from utils import (
    apply_system_proxy_to_session,
    export_system_proxies_to_env,
    format_file_size,
    get_system_proxies,
)
from font_config import configure_font, get_font, get_font_string, FontConfig
from download_manager import ComicDownloadManager
from theme_manager import ThemeManager, ThemeMode
from file_conflict_dialog import show_conflict_dialog
from panels import DownloadPanel, SearchPanel, SettingsPanel, StatusBar
from panels.comic_card import (
    build_comic_card_frame,
    copy_selected_text,
    get_frame_background,
    get_card_key,
    is_title_expanded,
    on_title_click_press,
    on_title_drag,
    on_title_click_release,
    render_title_widget,
    set_text_widget_content,
    truncate_text_to_lines,
    wrap_text_lines,
)
from gui_logic import (
    build_batch_summary,
    calculate_grid_columns,
    is_moeimg_detail_ready,
    should_block_source_change,
    should_ignore_gui_callback,
    stop_download_manager_for_shutdown,
)

logger = logging.getLogger(__name__)


class HComicDownloaderGUI(tk.Tk):
    """HComic Downloader 主窗口"""
    QUERY_MODE_OPTIONS: Tuple[Tuple[str, str], ...] = (
        ("keyword", "关键词"),
        ("author", "作者"),
        ("tag", "Tag"),
    )

    def __init__(self):
        super().__init__()

        self.title("HComic Downloader")
        self.geometry("900x700")
        self.minsize(800, 600)

        # 初始化配置（优先从配置文件加载）
        self.config = self._load_initial_config()
        # 预览图开关不持久化：每次启动默认关闭
        self.config.show_preview = False

        # 初始化字体配置（传入配置对象）
        self.font_config = FontConfig.create_instance(self.config)
        logger.info(f"使用字体: {self.font_config.get_best_font()}")

        # 初始化主题管理器
        self.theme_manager = ThemeManager.get_instance()
        # 从配置加载主题模式
        theme_mode = self._parse_theme_mode(self.config.theme_mode)
        self.theme_manager.set_mode(theme_mode)
        # 初始化 ttk 样式（用于主题切换）
        self.style = ttk.Style()
        # 记录启动时系统默认 ttk 主题，浅色模式时回退到该主题
        self._default_ttk_theme = self.style.theme_use()
        self._configure_ttk_styles()
        # 注册主题变化回调
        self.theme_manager.register_callback(self._on_theme_change_refresh)
        # 主线程轮询系统主题变化（仅 AUTO 模式生效）
        self._theme_poll_after_id = None
        self._start_theme_polling()
        logger.info(f"主题模式: {self.theme_manager.mode.value}, 当前主题: {self.theme_manager.current_theme}")

        # 导出系统代理到环境变量，确保所有请求路径行为一致
        export_system_proxies_to_env()

        # 初始化组件
        # 启动默认来源固定为 h-comic，运行时可切换。
        self.config.default_source = "hcomic"
        self.parser = MultiSourceParser(
            timeout=self.config.timeout,
            default_source="hcomic",
            source_auth=self.config.source_auth,
            cookie=self.config.auth_cookie,
            user_agent=self.config.auth_user_agent,
        )
        self.source_options = self.parser.get_source_options()
        self.source_key_to_label = {key: label for key, label in self.source_options}
        self.source_label_to_key = {label: key for key, label in self.source_options}
        self.query_mode_key_to_label = {key: label for key, label in self.QUERY_MODE_OPTIONS}
        self.query_mode_label_to_key = {label: key for key, label in self.QUERY_MODE_OPTIONS}
        current_source_auth = self.config.get_source_auth(self.parser.current_source)
        self.downloader = ComicDownloader(
            concurrent_downloads=self.config.concurrent_downloads,
            timeout=self.config.timeout,
            retry_times=self.config.retry_times,
            cookie=current_source_auth.get("cookie", ""),
            user_agent=current_source_auth.get("user_agent", ""),
        )
        self.cbz_builder = CBZBuilder(self.config.cbz_filename_template, self.config)

        # 下载管理器（使用 ComicDownloadManager）
        self.download_manager = ComicDownloadManager(
            downloader=self.downloader,
            cbz_builder=self.cbz_builder,
            output_dir=self.config.download_dir,
            prepare_comic=self.parser.prepare_for_download,
        )
        self.download_manager.set_callbacks(
            on_task_update=self._on_download_task_update,
            on_queue_complete=self._on_download_queue_complete,
        )
        self.download_manager.set_auto_retry_max_attempts(self.config.auto_retry_max_attempts)

        # 搜索结果显示
        self.search_results: List[ComicInfo] = []
        self.result_frames: List[tk.Frame] = []

        # 图片缓存
        self.image_cache: dict = {}
        self.cover_executor = ThreadPoolExecutor(max_workers=4)
        self.cover_load_generation: int = 0
        self.cover_loading_keys: set[str] = set()
        self.cover_loading_lock = threading.Lock()
        self._scroll_reset_after_id = None
        self._is_scrolling = False
        self._wheel_delta_remainder = 0.0
        self._touchpad_scroll_scale = 3.0
        self._platform_system = platform.system()
        self._content_height = 1
        self._pending_image_updates = {}
        self._pending_image_flush_after_id = None
        self._resize_after_id = None

        # 下载状态
        self.is_downloading = False

        # 批量下载状态
        self.selected_comics: set[ComicInfo] = set()  # 选中的漫画集合
        self.is_batch_downloading: bool = False        # 批量下载进行中
        self.batch_select_mode_var = tk.BooleanVar(value=False)  # 批量选择模式
        self.is_preparing_details: bool = False        # 下载前详情预取中
        self.detail_prefetch_generation: int = 0       # 结果列表详情预取代次
        self.moeimg_detail_ready_keys: set[str] = set()
        self._is_destroying: bool = False

        # 翻页状态
        self.current_page: int = 1                    # 当前页码
        self.total_pages: int = 1                     # 总页数
        self.current_search_keyword: str = ""         # 当前搜索关键词（用于翻页）
        self.current_search_mode: str = "keyword"     # 当前搜索模式（用于翻页）
        self.has_search_started: bool = False         # 是否已发起过搜索（允许空关键词翻页）
        self.current_view_mode: str = "search"        # 当前视图模式：search / favourites
        self.card_title_expanded: dict[str, bool] = {}  # 卡片标题展开状态

        # 预览图设置（运行时开关，不持久化）
        self.show_preview_var = tk.BooleanVar(value=False)

        # 设置面板折叠/动画状态
        self.settings_expanded: bool = False
        self.settings_target_height: int = 0
        self.settings_current_height: int = 0
        self._settings_anim_after_id = None
        self._settings_anim_start_height: int = 0
        self._settings_anim_end_height: int = 0
        self._settings_anim_step: int = 0
        self._settings_anim_total_steps: int = 1
        self._settings_anim_duration_ms: int = 180
        self._settings_anim_interval_ms: int = 12

        # 动态布局配置
        self.min_card_width = 220  # 卡片最小宽度
        self.card_padding = 10     # 卡片间距
        self.columns = 3           # 当前列数

        # 创建界面
        self.create_widgets()
        # 启动时主动应用一次主题，确保 tk 组件（如 ScrolledText/根 Frame）配色正确
        self._on_theme_change_refresh()

        # 同步来源选择器到当前来源
        if hasattr(self, "source_var"):
            self.source_var.set(self.source_key_to_label.get(self.parser.current_source, "h-comic"))

        # 初始化登录状态展示（不自动发起网络校验，避免启动即产生后台请求）
        self._update_login_status_for_current_source()
        self._refresh_proxy_status()

        # 绑定窗口大小变化事件
        self.bind('<Configure>', self._on_window_resize)

        # 居中窗口
        self.center_window()

    def center_window(self):
        """将窗口居中"""
        self.update_idletasks()
        width = self.winfo_width()
        height = self.winfo_height()
        x = (self.winfo_screenwidth() // 2) - (width // 2)
        y = (self.winfo_screenheight() // 2) - (height // 2)
        self.geometry(f'{width}x{height}+{x}+{y}')

    def _get_current_source(self) -> str:
        if hasattr(self, "source_var"):
            selected = self.source_label_to_key.get(self.source_var.get())
            if selected:
                return selected
        return self.parser.current_source

    def _get_selected_query_mode(self) -> str:
        if hasattr(self, "query_mode_var"):
            selected = self.query_mode_label_to_key.get(self.query_mode_var.get())
            if selected:
                return selected
        return "keyword"

    def _build_search_keyword(self, keyword: str, query_mode: str) -> str:
        text = (keyword or "").strip()
        source = self._get_current_source()
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
        source = self._get_current_source()
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
            keyword = self.current_search_keyword.strip() if self.has_search_started else self.search_var.get().strip()
            if not keyword:
                return f"/spa/latest-manga?page={page_token}"
            return f"/spa/search?query=...&page={page_token}"

        return f"/?q=...&page={page_token}"

    def _refresh_query_context_hint(self):
        if not hasattr(self, "query_context_var"):
            return

        mode = self._get_effective_query_mode()
        source = self._get_current_source()
        source_label = self.source_key_to_label.get(source, source)
        mode_label = (
            "收藏夹"
            if mode == "favourites"
            else self.query_mode_key_to_label.get(mode, mode)
        )
        endpoint = self._get_request_endpoint_hint()
        page_info = f"{self.current_page}/{self.total_pages}"
        self.query_context_var.set(
            f"当前查询: 来源={source_label} | 模式={mode_label} | 端点={endpoint} | 页码={page_info}"
        )

    def _source_requires_login(self, source: Optional[str] = None) -> bool:
        current = source or self._get_current_source()
        return current == "hcomic"

    def _sync_auth_for_source(self, source: str):
        auth = self.config.get_source_auth(source)
        self.parser.configure_auth(
            cookie=auth.get("cookie", ""),
            user_agent=auth.get("user_agent", ""),
            source=source,
        )
        if source == self._get_current_source():
            self.downloader.configure_auth(
                cookie=auth.get("cookie", ""),
                user_agent=auth.get("user_agent", ""),
            )

    def _update_login_status_for_current_source(self, auto_verify: bool = False):
        source = self._get_current_source()
        if not self._source_requires_login(source):
            self.login_status_var.set("当前来源无需登录信息")
            return

        auth = self.config.get_source_auth(source)
        if auth.get("cookie") and auth.get("user_agent"):
            self.login_status_var.set("已加载登录配置（待校验）")
            if auto_verify:
                self._verify_login_async()
        else:
            self.login_status_var.set("未配置登录信息")

    def _clear_results_for_source_switch(self):
        self.cover_load_generation += 1
        self._clear_pending_image_updates()
        for frame in self.result_frames:
            frame.destroy()
        self.result_frames.clear()
        self.search_results = []
        self.selected_comics.clear()
        self.image_cache.clear()
        self.card_title_expanded.clear()
        self.moeimg_detail_ready_keys.clear()
        with self.cover_loading_lock:
            self.cover_loading_keys.clear()
        if hasattr(self, "update_toolbar_buttons"):
            self.update_toolbar_buttons()
        if hasattr(self, "update_pagination_controls"):
            self.update_pagination_controls()

    def _on_source_changed(self, event=None):
        selected_source = self.source_label_to_key.get(self.source_var.get())
        if not selected_source:
            return

        if (
            selected_source != self.parser.current_source
            and should_block_source_change(
                self.is_downloading,
                self.is_batch_downloading,
                self.is_preparing_details,
            )
        ):
            # 下载进行中禁止切换来源，避免中途改写会话认证导致任务失败
            self.source_var.set(
                self.source_key_to_label.get(self.parser.current_source, self.parser.current_source)
            )
            messagebox.showinfo("提示", "下载进行中，暂不支持切换来源")
            return

        if selected_source == self.parser.current_source:
            return

        self.parser.set_source(selected_source)
        self.config.default_source = selected_source
        self._sync_auth_for_source(selected_source)

        self.current_view_mode = "search"
        self.current_page = 1
        self.total_pages = 1
        self.current_search_keyword = ""
        self.current_search_mode = self._get_selected_query_mode()
        self.has_search_started = False
        self._clear_results_for_source_switch()
        self.update_status(f"已切换来源: {self.source_key_to_label.get(selected_source, selected_source)}")
        self._update_login_status_for_current_source()
        self._refresh_query_context_hint()

        try:
            self.config.save(self._get_config_path())
        except Exception as e:
            logger.error(f"保存配置失败: {e}")

    def destroy(self):
        """销毁窗口前清理主题回调，避免单例持有失效引用。"""
        self._is_destroying = True
        # 保存配置
        self._save_all_settings()

        if getattr(self, "_theme_poll_after_id", None):
            self.after_cancel(self._theme_poll_after_id)
            self._theme_poll_after_id = None
        if getattr(self, "_scroll_reset_after_id", None):
            self.after_cancel(self._scroll_reset_after_id)
            self._scroll_reset_after_id = None
        if hasattr(self, "_clear_pending_image_updates"):
            self._clear_pending_image_updates()
        stop_download_manager_for_shutdown(getattr(self, "download_manager", None))
        if hasattr(self, "cover_executor"):
            try:
                self.cover_executor.shutdown(wait=False, cancel_futures=True)
            except TypeError:
                # 兼容较旧 Python 版本（无 cancel_futures 参数）
                self.cover_executor.shutdown(wait=False)
        if hasattr(self, "theme_manager"):
            self.theme_manager.unregister_callback(self._on_theme_change_refresh)
        super().destroy()

    def _start_theme_polling(self):
        """启动系统主题轮询（在 Tk 主线程执行）。"""
        self._schedule_theme_poll()

    def _schedule_theme_poll(self):
        """安排下一次主题轮询。"""
        self._theme_poll_after_id = self.after(2000, self._poll_theme_change)

    def _poll_theme_change(self):
        """轮询系统主题变化并刷新 UI。"""
        self._theme_poll_after_id = None
        try:
            self.theme_manager.refresh_auto_theme()
        finally:
            # 窗口尚未销毁时继续轮询
            if self.winfo_exists():
                self._schedule_theme_poll()

    def _load_initial_config(self) -> Config:
        """加载启动配置；异常时回退默认配置。"""
        try:
            return Config.load(self._get_config_path())
        except AttributeError:
            # 测试场景下，子类可能在 __init__ 后再注入配置路径属性
            return Config()
        except Exception as e:
            logger.warning(f"加载配置失败，使用默认配置: {e}")
            return Config()

    def create_widgets(self):
        """创建界面组件"""
        # 主容器
        main_frame = ttk.Frame(self, padding="10", style="Main.TFrame")
        main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))

        # 配置网格权重
        self.columnconfigure(0, weight=1)
        self.rowconfigure(0, weight=1)
        main_frame.columnconfigure(0, weight=1)
        main_frame.rowconfigure(2, weight=1)  # 结果区域可扩展

        # ===== 搜索栏 =====
        search_frame = ttk.Frame(main_frame, style="Main.TFrame")
        search_frame.grid(row=0, column=0, sticky=(tk.W, tk.E), pady=(0, 10))
        search_frame.columnconfigure(0, weight=1)

        self.search_panel = SearchPanel(
            main_frame,
            parser=self.parser,
            config=self.config,
            font_config=self.font_config,
            on_download=self.download_comic,
            on_batch_download=self.execute_batch_download,
            on_status_update=self.update_status,
        )
        self.search_panel.bind_host(self)

        self.search_var = tk.StringVar()
        self.search_entry = ttk.Entry(search_frame, textvariable=self.search_var, font=get_font("normal"))
        self.search_entry.grid(row=0, column=0, sticky=(tk.W, tk.E), padx=(0, 10))
        self.search_entry.bind('<Return>', lambda e: self.search())

        self.query_mode_var = tk.StringVar(value=self.query_mode_key_to_label["keyword"])
        self.query_mode_combo = ttk.Combobox(
            search_frame,
            textvariable=self.query_mode_var,
            values=[label for _, label in self.QUERY_MODE_OPTIONS],
            state="readonly",
            width=7,
        )
        self.query_mode_combo.grid(row=0, column=1, padx=(0, 8))
        self.query_mode_combo.bind("<<ComboboxSelected>>", lambda _e: self._refresh_query_context_hint())

        self.source_var = tk.StringVar(value=self.source_key_to_label.get(self.parser.current_source, "h-comic"))
        self.source_combo = ttk.Combobox(
            search_frame,
            textvariable=self.source_var,
            values=[label for _, label in self.source_options],
            state="readonly",
            width=12,
        )
        self.source_combo.grid(row=0, column=2, padx=(0, 8))
        self.source_combo.bind("<<ComboboxSelected>>", self._on_source_changed)

        self.search_btn = ttk.Button(search_frame, text="搜索", command=self.search_panel.search)
        self.search_btn.grid(row=0, column=3)

        self.favourites_btn = ttk.Button(search_frame, text="收藏夹", command=self.search_panel.view_favourites)
        self.favourites_btn.grid(row=0, column=4, padx=(8, 0))

        self.toggle_settings_btn = ttk.Button(
            search_frame,
            text="展开设置 ▼",
            command=self.toggle_settings_panel
        )
        self.toggle_settings_btn.grid(row=0, column=5, padx=(8, 0))

        self.query_context_var = tk.StringVar(value="")
        self.query_context_label = ttk.Label(search_frame, textvariable=self.query_context_var)
        self.query_context_label.grid(row=1, column=0, columnspan=6, sticky=(tk.W, tk.E), pady=(6, 0))
        self._refresh_query_context_hint()

        # ===== 设置栏 =====
        self.settings_panel = SettingsPanel(
            main_frame,
            config=self.config,
            font_config=self.font_config,
            on_config_change=lambda _c: self._save_all_settings(),
            on_font_change=lambda *_args: self._on_font_size_changed(),
            on_preview_change=lambda *_args: self._on_preview_changed(),
            on_theme_change=lambda *_args: self._on_theme_change(None),
        )
        self.settings_panel.grid(row=1, column=0, sticky=(tk.W, tk.E), pady=(0, 10))

        self.settings_container = self.settings_panel.container
        self.settings_frame = self.settings_panel.settings_frame
        self.download_dir_var = self.settings_panel.download_dir_var
        self.concurrent_var = self.settings_panel.concurrent_var
        self.batch_delay_var = self.settings_panel.batch_delay_var
        self.batch_delay_spinbox = self.settings_panel.batch_delay_spinbox
        self.auto_retry_var = self.settings_panel.auto_retry_var
        self.auto_retry_spinbox = self.settings_panel.auto_retry_spinbox
        self.font_var = self.settings_panel.font_var
        self.font_size_var = self.settings_panel.font_size_var
        self.theme_mode_var = self.settings_panel.theme_mode_var
        self.output_format_var = self.settings_panel.output_format_var
        self.show_preview_var = self.settings_panel.show_preview_var
        self.login_curl_text = self.settings_panel.login_curl_text
        self.apply_login_btn = self.settings_panel.apply_login_btn
        self.login_status_var = self.settings_panel.login_status_var
        self.proxy_status_var = self.settings_panel.proxy_status_var

        self.settings_panel.browse_btn.config(command=self.browse_download_dir)
        self.settings_panel.open_dir_btn.config(command=self.open_download_dir)
        self.apply_login_btn.config(command=self.apply_login_from_curl)
        self.settings_panel.refresh_proxy_btn.config(command=lambda: self._refresh_proxy_status(show_message=True))
        self.settings_panel.font_combo.bind("<<ComboboxSelected>>", self._on_font_changed)
        self.batch_delay_spinbox.config(validate="key", validatecommand=(self.register(self._validate_batch_delay), '%P'))

        # 设置面板目标高度，默认折叠
        self.update_idletasks()
        self.settings_target_height = max(self.settings_frame.winfo_reqheight(), 1)
        self.settings_current_height = 0
        self.settings_container.configure(height=0)
        self.settings_container.grid_remove()
        self._set_settings_button_text()

        # ===== 搜索结果区域 =====
        results_frame = ttk.LabelFrame(main_frame, text="搜索结果", padding="5", style="Results.TLabelframe")
        results_frame.grid(row=2, column=0, sticky=(tk.W, tk.E, tk.N, tk.S), pady=(0, 10))
        results_frame.columnconfigure(0, weight=1)
        results_frame.rowconfigure(1, weight=1)  # 改为 row=1，因为 row=0 是工具栏

        # 创建批量操作工具栏
        self.batch_toolbar = self.search_panel.create_batch_toolbar(results_frame)

        # 画布和滚动条
        self.canvas = tk.Canvas(results_frame, highlightthickness=0, bg=self.theme_manager.get_color("background"))
        scrollbar = ttk.Scrollbar(results_frame, orient="vertical", command=self.canvas.yview)
        self.scrollable_frame = ttk.Frame(self.canvas, style="Scrollable.TFrame")

        self.scrollable_frame.bind("<Configure>", self._on_scrollable_frame_configure)

        # 创建内窗口（宽度将动态调整）
        self.canvas_window = self.canvas.create_window((0, 0), window=self.scrollable_frame, anchor="nw")
        self.canvas.configure(yscrollcommand=scrollbar.set)

        self.canvas.grid(row=1, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))  # row=1
        scrollbar.grid(row=1, column=1, sticky=(tk.N, tk.S))  # row=1

        # 跨平台滚动事件绑定（鼠标滚轮 + 触控板）
        self._bind_scroll_events()

        # ===== 进度区域 =====
        self.status_bar = StatusBar(main_frame, on_toggle_download_panel=self._toggle_download_manager)
        self.status_bar.grid(row=4, column=0, sticky=(tk.W, tk.E))
        self.status_var = self.status_bar.status_var
        self.status_label = self.status_bar.status_label
        self.progress_var = self.status_bar.progress_var
        self.progress_bar = self.status_bar.progress_bar
        self.expand_btn = self.status_bar.expand_btn

        # ===== 下载管理器面板（锚在进度区上方，避免动画触发整页重排）=====
        self.download_panel = DownloadPanel(
            main_frame,
            self.download_manager,
            on_status_update=self.update_status,
            anchor_widget=self.status_bar,
        )
        self.download_panel.bind_host(self)
        # 向后兼容：保留原属性名，减少现有逻辑改动
        self.download_manager_ui = self.download_panel.ui

    def toggle_settings_panel(self):
        """切换设置面板展开/折叠状态。"""
        self._animate_settings_panel(not self.settings_expanded)

    def _set_settings_button_text(self):
        """根据展开状态更新设置按钮文本。"""
        text = "收起设置 ▲" if self.settings_expanded else "展开设置 ▼"
        self.toggle_settings_btn.config(text=text)

    def _animate_settings_panel(self, expand: bool):
        """使用高度动画展开或折叠设置面板。"""
        if self._settings_anim_after_id:
            self.after_cancel(self._settings_anim_after_id)
            self._settings_anim_after_id = None

        self.settings_expanded = expand
        self._set_settings_button_text()

        if expand:
            self.update_idletasks()
            self.settings_target_height = max(self.settings_frame.winfo_reqheight(), 1)
            self.settings_container.grid()

        self._settings_anim_start_height = self.settings_current_height
        self._settings_anim_end_height = self.settings_target_height if expand else 0
        self._settings_anim_step = 0
        self._settings_anim_total_steps = max(
            1,
            self._settings_anim_duration_ms // self._settings_anim_interval_ms
        )

        # 起始高度，避免动画第一帧跳变
        self.settings_container.configure(height=self._settings_anim_start_height)
        self._run_settings_animation_step()

    def _run_settings_animation_step(self):
        """执行设置面板动画单帧。"""
        progress = min(
            1.0,
            (self._settings_anim_step + 1) / self._settings_anim_total_steps
        )
        # ease-out cubic
        eased = 1 - (1 - progress) ** 3
        new_height = int(
            self._settings_anim_start_height +
            (self._settings_anim_end_height - self._settings_anim_start_height) * eased
        )
        self.settings_current_height = new_height
        self.settings_container.configure(height=new_height)

        if self._settings_anim_step + 1 < self._settings_anim_total_steps:
            self._settings_anim_step += 1
            self._settings_anim_after_id = self.after(
                self._settings_anim_interval_ms,
                self._run_settings_animation_step
            )
            return

        # 结束态
        self.settings_current_height = self._settings_anim_end_height
        self.settings_container.configure(height=self.settings_current_height)
        if self.settings_current_height == 0:
            self.settings_container.grid_remove()
        else:
            self.settings_container.grid()
        self._settings_anim_after_id = None

    def _on_mousewheel(self, event):
        """处理 Windows/macOS/Linux 的 MouseWheel 事件（含触控板）"""
        if not self._is_scroll_event_for_results(event):
            return

        delta = getattr(event, "delta", 0)
        if delta == 0:
            return

        self._mark_scroll_active()

        # macOS 下 MouseWheel 也可能来自触控板，走平滑像素滚动路径更跟手。
        if self._platform_system == "Darwin":
            self._scroll_canvas_smooth(delta)
            return "break"

        # Windows/Linux 常见为 120 的倍数；macOS 常见为小步进增量
        threshold = 120
        self._wheel_delta_remainder += -delta
        units = int(self._wheel_delta_remainder / threshold)
        if units == 0:
            return

        self._wheel_delta_remainder -= units * threshold
        self.canvas.yview_scroll(units, "units")
        return "break"

    def _on_mousewheel_linux_button(self, event):
        """处理 Linux/X11 的 Button-4/Button-5 滚轮事件"""
        if not self._is_scroll_event_for_results(event):
            return

        self._mark_scroll_active()
        if event.num == 4:
            self.canvas.yview_scroll(-1, "units")
        elif event.num == 5:
            self.canvas.yview_scroll(1, "units")
        return "break"

    def _on_touchpad_scroll(self, event):
        """处理高精度触控板滚动（Tk 8.7+/9 的 TouchpadScroll 事件）"""
        if not self._is_scroll_event_for_results(event):
            return

        packed_delta = getattr(event, "delta", 0)
        if packed_delta == 0:
            return

        _, delta_y = self._unpack_touchpad_scroll_delta(packed_delta)
        if delta_y == 0:
            return "break"

        self._mark_scroll_active()
        self._scroll_canvas_smooth(-delta_y)
        return "break"

    def _scroll_canvas_smooth(self, delta_y: float):
        """按像素增量平滑滚动 Canvas。"""
        total_height = max(1, self._content_height)
        viewport_height = max(1, self.canvas.winfo_height())
        if total_height <= viewport_height:
            return

        # 只在可滚动区间内换算比例，避免内容很长时滚动过慢。
        scrollable_height = total_height - viewport_height
        first, _ = self.canvas.yview()
        delta_fraction = (delta_y * self._touchpad_scroll_scale) / scrollable_height
        new_first = min(1.0, max(0.0, first + delta_fraction))
        if new_first != first:
            self.canvas.yview_moveto(new_first)

    def _bind_scroll_events(self):
        """绑定跨平台滚动事件。"""
        # 触控板事件在不同平台/Tk 版本的分发链路可能不同；
        # 同时绑定窗口级、控件级与 all 级，提升命中率。
        for widget in (self.canvas, self.scrollable_frame):
            widget.bind("<MouseWheel>", self._on_mousewheel, add="+")
            # TouchpadScroll 只在 macOS 上可用
            if platform.system() == "Darwin":
                widget.bind("<TouchpadScroll>", self._on_touchpad_scroll, add="+")
            widget.bind("<Button-4>", self._on_mousewheel_linux_button, add="+")
            widget.bind("<Button-5>", self._on_mousewheel_linux_button, add="+")
        self.bind_all("<MouseWheel>", self._on_mousewheel, add="+")
        if platform.system() == "Darwin":
            self.bind_all("<TouchpadScroll>", self._on_touchpad_scroll, add="+")
        self.bind_all("<Button-4>", self._on_mousewheel_linux_button, add="+")
        self.bind_all("<Button-5>", self._on_mousewheel_linux_button, add="+")

    @staticmethod
    def _unpack_touchpad_scroll_delta(packed_delta: int) -> Tuple[int, int]:
        """解包 TouchpadScroll 的 32 位 delta 为 (delta_x, delta_y)。"""
        packed = packed_delta & 0xFFFFFFFF
        delta_x = (packed >> 16) & 0xFFFF
        delta_y = packed & 0xFFFF
        if delta_x >= 0x8000:
            delta_x -= 0x10000
        if delta_y >= 0x8000:
            delta_y -= 0x10000
        return delta_x, delta_y

    def _is_scroll_event_for_results(self, event) -> bool:
        """仅响应发生在搜索结果区域内的滚动事件。"""
        widget = getattr(event, "widget", None)
        original_widget = widget
        while widget is not None:
            if widget == self.canvas or widget == self.scrollable_frame:
                return True
            widget = widget.master

        # macOS 触控板在某些 Tk 版本中，event.widget 可能不是实际悬停控件；
        # 使用指针坐标反查一次作为兜底。
        x_root = getattr(event, "x_root", None)
        y_root = getattr(event, "y_root", None)
        if x_root is not None and y_root is not None:
            hovered = self.winfo_containing(x_root, y_root)
            while hovered is not None:
                if hovered == self.canvas or hovered == self.scrollable_frame:
                    return True
                hovered = hovered.master

        # 某些平台/Tk 版本下触控板事件可能缺失可靠的 widget/坐标信息。
        # 保底策略：如果当前控件是原生可滚动输入控件，则不劫持；否则允许结果区滚动。
        if isinstance(original_widget, (tk.Text, scrolledtext.ScrolledText, tk.Entry, ttk.Entry)):
            return False
        return True

    def _mark_scroll_active(self):
        """标记当前处于滚动状态。"""
        self._is_scrolling = True
        if self._scroll_reset_after_id:
            self.after_cancel(self._scroll_reset_after_id)
        self._scroll_reset_after_id = self.after(120, self._mark_scroll_idle)

    def _mark_scroll_idle(self):
        """滚动空闲标记"""
        self._is_scrolling = False
        self._scroll_reset_after_id = None
        self._flush_pending_image_updates()

    def _on_scrollable_frame_configure(self, event):
        """结果区域尺寸变更时更新滚动范围和内容高度缓存。"""
        self._content_height = max(1, int(getattr(event, "height", 1)))
        canvas_width = max(1, self.canvas.winfo_width())
        self.canvas.configure(scrollregion=(0, 0, canvas_width, self._content_height))

    def _validate_batch_delay(self, value: str) -> bool:
        """验证批量下载延迟输入（仅允许 0-60 的整数或空字符串）"""
        if value == "":
            return True
        try:
            delay = int(value)
            return 0 <= delay <= 60
        except ValueError:
            return False

    def _get_batch_delay_seconds(self) -> int:
        """安全获取批量下载延迟秒数，避免 IntVar 空值触发 TclError。"""
        raw_value = self.batch_delay_spinbox.get().strip() if hasattr(self, "batch_delay_spinbox") else ""
        try:
            delay = int(raw_value)
        except (ValueError, TypeError):
            delay = 0

        # 兜底限制范围，避免粘贴等场景绕过 Spinbox 预期范围
        delay = max(0, min(60, delay))
        if raw_value != str(delay):
            self.batch_delay_var.set(delay)
        return delay

    def _on_window_resize(self, event):
        """处理窗口大小变化事件"""
        # 只在主窗口大小变化时处理（忽略子组件）
        if event.widget != self:
            return

        # 延迟处理，避免频繁调用
        if self._resize_after_id:
            self.after_cancel(self._resize_after_id)
        self._resize_after_id = self.after(100, self._update_layout)

    def _update_layout(self):
        """更新布局以适应窗口大小"""
        # 计算新的列数
        new_columns = self._calculate_columns()

        # 如果列数发生变化，重新排列结果
        if new_columns != self.columns:
            self.columns = new_columns
            if self.search_results:
                self._refresh_results_layout()

        # 更新 canvas 内窗口宽度
        self._update_canvas_width()

    def _calculate_columns(self) -> int:
        """根据窗口宽度计算应该显示的列数"""
        canvas_width = self.canvas.winfo_width()
        # 减去滚动条宽度
        if canvas_width > 1:
            available_width = canvas_width - 20  # 预留一些边距
            return calculate_grid_columns(
                window_width=available_width,
                min_card_width=(self.min_card_width + self.card_padding * 2),
                padding=0,
            )
        return 3  # 默认 3 列

    def _update_canvas_width(self):
        """更新 canvas 内窗口宽度"""
        canvas_width = self.canvas.winfo_width()
        if canvas_width > 1:
            # 内窗口宽度 = canvas 宽度 - 滚动条宽度（如果有）
            self.canvas.itemconfig(self.canvas_window, width=canvas_width - 20)
            self.canvas.configure(scrollregion=(0, 0, canvas_width, max(1, self._content_height)))

    def _refresh_results_layout(self):
        """重新排列搜索结果布局"""
        self.cover_load_generation += 1
        self._clear_pending_image_updates()
        with self.cover_loading_lock:
            self.cover_loading_keys.clear()

        # 清除旧结果
        for frame in self.result_frames:
            frame.destroy()
        self.result_frames.clear()

        if not self.search_results:
            return

        # 使用新的列数重新显示结果
        for i, comic in enumerate(self.search_results):
            row = i // self.columns
            col = i % self.columns
            frame = self.create_comic_card(comic, row, col)
            self.result_frames.append(frame)

    def _get_font_list(self):
        """获取可用字体列表"""
        fonts = ["自动检测"]
        available = self.font_config.get_available_fonts(self)
        # 优先显示推荐的中文字体
        preferred = self.font_config.get_preferred_fonts()
        for font in preferred:
            if font in available:
                fonts.append(font)
        # 添加所有其他可用字体
        fonts.extend(sorted([f for f in available if f not in preferred]))
        return fonts

    def _on_font_changed(self, event):
        """字体选择变化事件"""
        selected = self.font_var.get()
        if selected == "自动检测":
            self.config.font_name = ""
        else:
            self.config.font_name = selected
        # 重新创建字体配置
        self.font_config = FontConfig(self.config)
        logger.info(f"字体已更改为: {self.font_config.get_best_font()}")

        # 保存配置
        try:
            self.config.save(self._get_config_path())
        except Exception as e:
            logger.error(f"保存配置失败: {e}")

    def _on_font_size_changed(self):
        """字体大小变化事件"""
        self.config.font_size = self.font_size_var.get()
        # 重新创建字体配置
        self.font_config = FontConfig(self.config)
        logger.info(f"字体大小已更改为: {self.config.font_size}")

        # 保存配置
        try:
            self.config.save(self._get_config_path())
        except Exception as e:
            logger.error(f"保存配置失败: {e}")

    def _save_all_settings(self):
        """保存所有设置到配置文件"""
        try:
            # 更新配置值
            self.config.download_dir = self.download_dir_var.get()
            self.config.concurrent_downloads = self.concurrent_var.get()
            self.config.batch_download_delay = self.batch_delay_var.get()
            self.config.auto_retry_max_attempts = self.auto_retry_var.get()

            # 字体
            font = self.font_var.get()
            self.config.font_name = "" if font == "自动检测" else font

            # 主题
            self.config.theme_mode = self._display_to_theme_mode(self.theme_mode_var.get())
            self.config.default_source = self._get_current_source()

            # 保存到文件
            self.config.save(self._get_config_path())

            # 更新下载管理器设置
            if hasattr(self, "download_manager"):
                self.download_manager.set_auto_retry_max_attempts(self.config.auto_retry_max_attempts)

            logger.info("所有设置已保存")
        except Exception as e:
            logger.error(f"保存设置失败: {e}")

    def _on_preview_changed(self):
        """预览图设置变化事件"""
        show_preview = self.show_preview_var.get()
        logger.info(f"预览图设置已更改为: {show_preview}（仅本次运行有效）")

        # 如果有搜索结果，重新渲染
        if self.search_results:
            self._refresh_results_layout()

    def _theme_mode_to_display(self, mode: str) -> str:
        """将主题模式值转换为显示文本"""
        return {"auto": "自动", "light": "浅色", "dark": "深色"}.get(mode, "自动")

    def _parse_theme_mode(self, mode: str) -> ThemeMode:
        """解析主题模式，非法值回退到 AUTO。"""
        try:
            return ThemeMode(mode)
        except (ValueError, TypeError):
            logger.warning(f"无效主题模式配置: {mode!r}，回退为 auto")
            self.config.theme_mode = ThemeMode.AUTO.value
            return ThemeMode.AUTO

    def _display_to_theme_mode(self, display: str) -> str:
        """将显示文本转换为主题模式值"""
        return {"自动": "auto", "浅色": "light", "深色": "dark"}.get(display, "auto")

    def _on_theme_change(self, event):
        """主题变化事件"""
        mode_str = self.theme_mode_var.get()
        mode = self._display_to_theme_mode(mode_str)

        # 保存配置
        self.config.theme_mode = mode
        try:
            self.config.save(self._get_config_path())
        except Exception as e:
            logger.error(f"保存配置失败: {e}")
            return

        # 更新主题管理器
        theme_mode = self._parse_theme_mode(mode)
        self.theme_manager.set_mode(theme_mode)

        logger.info(f"主题设置已更改为: {mode_str}")

    def _configure_ttk_styles(self):
        """配置 ttk 组件样式以支持主题切换"""
        theme = self.theme_manager

        # 先切换基础 ttk 主题，再配置自定义样式，避免 theme_use 重置已有样式。
        if theme.current_theme == "dark":
            target_ttk_theme = "clam"
        else:
            target_ttk_theme = getattr(self, "_default_ttk_theme", "default")
        try:
            if self.style.theme_use() != target_ttk_theme:
                self.style.theme_use(target_ttk_theme)
        except tk.TclError:
            logger.warning(f"切换 ttk 主题失败: {target_ttk_theme}")

        # 浅色主题每次都重新读取系统原生背景，避免启动快照在后续主题切换后失效。
        self._sync_light_background_from_native_theme()

        bg_color = theme.get_color("background")
        card_bg = theme.get_color("card_bg")
        text_color = theme.get_color("text")
        text_secondary = theme.get_color("text_secondary")

        # 主框架样式
        self.style.configure("Main.TFrame", background=bg_color)
        # 搜索结果区域样式
        self.style.configure("Results.TLabelframe", background=bg_color)
        self.style.configure("Results.TLabelframe.Label", background=bg_color, foreground=text_color)
        # 工具栏样式
        self.style.configure("Toolbar.TFrame", background=bg_color)
        # 可滚动框架样式
        self.style.configure("Scrollable.TFrame", background=bg_color)
        # 卡片框架样式
        self.style.configure("Card.TFrame", background=card_bg)
        # 设置面板样式
        self.style.configure("Settings.TLabelframe", background=bg_color)
        self.style.configure("Settings.TLabelframe.Label", background=bg_color, foreground=text_color)
        # 进度区域样式
        self.style.configure("Progress.TFrame", background=bg_color)
        # 标签样式
        self.style.configure("TLabel", background=bg_color, foreground=text_color)
        self.style.configure("Secondary.TLabel", background=bg_color, foreground=text_secondary)

        # Entry 样式
        self.style.configure(
            "TEntry",
            fieldbackground=card_bg,
            background=card_bg,
            foreground=text_color,
            insertcolor=theme.get_color("insert"),
        )

        # Combobox 样式 - 基础样式
        self.style.configure(
            "TCombobox",
            fieldbackground=card_bg,
            background=card_bg,
            foreground=text_color,
            selectbackground=theme.get_color("accent"),
            selectforeground="white",
        )
        self.style.map(
            "TCombobox",
            fieldbackground=[("readonly", card_bg), ("active", card_bg), ("disabled", card_bg)],
            selectbackground=[("readonly", theme.get_color("accent"))],
            selectforeground=[("readonly", "white")],
            foreground=[("readonly", text_color)],
        )
        # Spinbox 样式
        self.style.configure(
            "TSpinbox",
            fieldbackground=card_bg,
            background=bg_color,
            foreground=text_color,
            insertcolor=theme.get_color("insert"),
        )

        # Button 样式
        self.style.configure(
            "TButton",
            background=card_bg,
            foreground=text_color,
        )

        # Checkbutton 样式
        self.style.configure(
            "TCheckbutton",
            background=bg_color,
            foreground=text_color,
        )
        self.style.map("TCheckbutton", background=[("active", bg_color)])

        # Progressbar 样式 - 水平进度条
        self.style.configure(
            "Horizontal.TProgressbar",
            background=theme.get_color("accent"),
            troughcolor=card_bg,
            bordercolor=card_bg,
            lightcolor=theme.get_color("accent"),
            darkcolor=theme.get_color("accent"),
        )

        # Labelframe 样式
        self.style.configure("TLabelframe", background=bg_color)
        self.style.configure("TLabelframe.Label", background=bg_color, foreground=text_color)

        # 更新根窗口背景
        self.configure(bg=bg_color)

    def _sync_light_background_from_native_theme(self):
        """在浅色主题下将系统原生背景同步到 light 配色。"""
        if self.theme_manager.current_theme != "light":
            return

        candidates = (
            self.style.lookup("TFrame", "background"),
            self.style.lookup(".", "background"),
            self.cget("bg"),
        )

        for raw_color in candidates:
            if not raw_color:
                continue
            try:
                rgb = self.winfo_rgb(raw_color)
            except tk.TclError:
                continue

            native_bg = "#{:02x}{:02x}{:02x}".format(rgb[0] >> 8, rgb[1] >> 8, rgb[2] >> 8)
            self.theme_manager.set_light_background(native_bg)
            return

    def _on_theme_change_refresh(self):
        """主题变化时刷新界面"""
        # 更新 ttk 样式
        self._configure_ttk_styles()
        bg_color = self.theme_manager.get_color("background")

        # 更新 canvas 背景色
        if hasattr(self, 'canvas'):
            self.canvas.config(bg=bg_color)

        # 更新卡片颜色
        for frame in self.result_frames:
            self._update_card_colors(frame)
            comic = getattr(frame, "comic_ref", None)
            if comic in self.selected_comics:
                self.update_card_visual(frame, True)

        # 更新下载管理器 UI 主题
        if hasattr(self, 'download_manager_ui'):
            self.download_manager_ui.refresh_theme()

        # 更新设置面板主题
        if hasattr(self, 'settings_panel'):
            self.settings_panel.refresh_theme()

        # 更新状态栏主题
        if hasattr(self, 'status_bar'):
            self.status_bar.refresh_theme()

    def _update_card_colors(self, frame: tk.Frame):
        """更新卡片主题相关颜色（仅处理 tk 子组件，ttk 组件由 style 控制）"""
        theme = self.theme_manager
        card_bg = theme.get_color("card_bg")
        text_primary = theme.get_color("text")
        text_secondary = theme.get_color("text_secondary")

        # 更新子组件配色（仅 tk 组件）
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

    def _get_config_path(self) -> str:
        """获取配置文件路径"""
        config_dir = os.path.join(os.path.expanduser("~"), ".hcomic_downloader")
        return os.path.join(config_dir, "config.json")

    def apply_login_from_curl(self):
        """从 curl 文本提取并应用登录信息。"""
        curl_text = self.login_curl_text.get("1.0", tk.END).strip()
        if not curl_text:
            messagebox.showwarning("提示", "请先粘贴完整 curl 请求")
            return

        try:
            cookie, user_agent = extract_auth_from_curl(curl_text)
        except ValueError as e:
            messagebox.showerror("登录信息提取失败", str(e))
            return

        current_source = self._get_current_source()
        self.config.set_source_auth(current_source, cookie=cookie, user_agent=user_agent)
        self.parser.configure_auth(cookie=cookie, user_agent=user_agent, source=current_source)
        self.downloader.configure_auth(cookie=cookie, user_agent=user_agent)

        try:
            self.config.save(self._get_config_path())
        except Exception as e:
            logger.error(f"保存配置失败: {e}")
            messagebox.showerror("错误", f"保存配置失败: {e}")
            return

        self.login_status_var.set("已应用登录信息，正在校验...")
        self._verify_login_async()

    def _verify_login_async(self):
        """异步校验登录状态。"""
        result_queue: Queue = Queue(maxsize=1)

        def worker():
            ok, msg = self.parser.verify_login_status()
            result_queue.put((ok, msg))

        def poll_result():
            try:
                ok, msg = result_queue.get_nowait()
            except Empty:
                self.after(50, poll_result)
                return

            self.login_status_var.set(msg)
            if ok:
                logger.info("登录状态校验通过")
            else:
                logger.warning("登录状态校验未通过")

        threading.Thread(target=worker, daemon=True).start()
        self.after(50, poll_result)

    @staticmethod
    def _format_proxy_status(proxies: dict) -> str:
        """格式化代理状态文本。"""
        if not proxies:
            return "未检测到系统代理（直连）"
        parts = []
        if proxies.get("http"):
            parts.append(f"HTTP: {proxies['http']}")
        if proxies.get("https"):
            parts.append(f"HTTPS: {proxies['https']}")
        if not parts:
            return "未检测到系统代理（直连）"
        return " | ".join(parts)

    def _refresh_proxy_status(self, show_message: bool = False):
        """刷新并应用系统代理到现有会话。"""
        proxies = get_system_proxies()
        for session in self.parser.get_sessions():
            apply_system_proxy_to_session(session)
        apply_system_proxy_to_session(self.downloader.session)

        status_text = self._format_proxy_status(proxies)
        if hasattr(self, "proxy_status_var"):
            self.proxy_status_var.set(status_text)
        logger.info(f"系统代理状态: {status_text}")

        if show_message:
            messagebox.showinfo("系统代理状态", status_text)

    def _get_cover_request_headers(self) -> dict:
        """构建封面请求头，复用当前会话认证。"""
        headers = dict(self.parser.session.headers)
        headers["Accept"] = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
        return headers

    def create_batch_toolbar(self, parent: ttk.Frame) -> ttk.Frame:
        """创建批量操作工具栏

        Args:
            parent: 父容器

        Returns:
            工具栏框架
        """
        toolbar = ttk.Frame(parent, style="Toolbar.TFrame")
        toolbar.grid(row=0, column=0, sticky=(tk.W, tk.E), pady=(0, 5))

        # 批量选择模式
        self.batch_mode_check = ttk.Checkbutton(
            toolbar,
            text="批量选择模式",
            variable=self.batch_select_mode_var,
            command=self._on_batch_mode_changed
        )
        self.batch_mode_check.grid(row=0, column=0, padx=(0, 10))

        # 全选按钮
        self.select_all_btn = ttk.Button(
            toolbar,
            text="全选",
            command=self.select_all,
            width=8
        )
        self.select_all_btn.grid(row=0, column=1, padx=(0, 5))

        # (可选)取消选择按钮
        self.clear_selection_btn = ttk.Button(
            toolbar,
            text="取消",
            command=self.clear_selection,
            width=8
        )
        self.clear_selection_btn.grid(row=0, column=2, padx=(0, 5))

        # 批量下载按钮
        self.batch_download_btn = ttk.Button(
            toolbar,
            text="批量下载(0)",
            command=self.batch_download_selected,
            width=12
        )
        self.batch_download_btn.grid(row=0, column=3, padx=(0, 15))

        # 分隔符
        ttk.Separator(toolbar, orient="vertical").grid(row=0, column=4, sticky=(tk.N, tk.S), padx=5)

        # 翻页按钮：上一页
        self.prev_page_btn = ttk.Button(
            toolbar,
            text="上一页",
            command=self.go_previous_page,
            width=8
        )
        self.prev_page_btn.grid(row=0, column=5, padx=(10, 5))
        # 初始禁用
        self.prev_page_btn.state(['disabled'])

        # 页数标签（点击可跳转）
        self.page_label_var = tk.StringVar(value="1/1")
        self.page_label = ttk.Label(
            toolbar,
            textvariable=self.page_label_var,
            font=get_font("normal"),
            cursor="hand2"
        )
        self.page_label.grid(row=0, column=6, padx=(0, 5))
        self.page_label.bind("<Button-1>", lambda e: self.go_to_page_dialog())

        # 翻页按钮：下一页
        self.next_page_btn = ttk.Button(
            toolbar,
            text="下一页",
            command=self.go_next_page,
            width=8
        )
        self.next_page_btn.grid(row=0, column=7)
        # 初始禁用
        self.next_page_btn.state(['disabled'])

        # 初始状态
        self.update_toolbar_buttons()

        return toolbar

    def select_all(self):
        """选中所有当前搜索结果"""
        if self.is_batch_downloading or not self.batch_select_mode_var.get():
            return

        self.selected_comics.clear()
        for comic in self.search_results:
            self.selected_comics.add(comic)

        # 更新所有卡片视觉
        for i, frame in enumerate(self.result_frames):
            if i < len(self.search_results):
                self.update_card_visual(frame, True)

        # 更新工具栏按钮
        if hasattr(self, 'update_toolbar_buttons'):
            self.update_toolbar_buttons()

        logger.info(f"已选中全部 {len(self.search_results)} 本漫画")

    def clear_selection(self):
        """清空所有选择"""
        if self.is_batch_downloading:
            return

        self.selected_comics.clear()

        # 更新所有卡片视觉
        for frame in self.result_frames:
            self.update_card_visual(frame, False)

        # 更新工具栏按钮
        if hasattr(self, 'update_toolbar_buttons'):
            self.update_toolbar_buttons()

        logger.info("已清空所有选择")

    def update_toolbar_buttons(self):
        """更新工具栏按钮状态"""
        selected_count = len(self.selected_comics)
        in_batch_mode = self.batch_select_mode_var.get()

        # 更新批量下载按钮文本
        self.batch_download_btn.config(text=f"批量下载({selected_count})")

        # 根据选中数量启用/禁用按钮
        if in_batch_mode and selected_count > 0 and not self.is_batch_downloading:
            self.batch_download_btn.state(['!disabled'])
        else:
            self.batch_download_btn.state(['disabled'])

        # 批量下载中或未开启批量模式时禁用批量按钮
        if self.is_batch_downloading or not in_batch_mode:
            self.select_all_btn.state(['disabled'])
            self.clear_selection_btn.state(['disabled'])
        else:
            self.select_all_btn.state(['!disabled'])
            self.clear_selection_btn.state(['!disabled'])

    def _on_batch_mode_changed(self):
        """批量选择模式切换"""
        if not self.batch_select_mode_var.get():
            self.clear_selection()
        self.update_toolbar_buttons()

    def update_pagination_controls(self):
        """更新翻页控件状态"""
        # 更新页数标签
        self.page_label_var.set(f"{self.current_page}/{self.total_pages}")

        # 更新翻页按钮状态
        if self.current_page > 1:
            self.prev_page_btn.state(['!disabled'])
        else:
            self.prev_page_btn.state(['disabled'])

        if self.current_page < self.total_pages:
            self.next_page_btn.state(['!disabled'])
        else:
            self.next_page_btn.state(['disabled'])

        self._refresh_query_context_hint()

    def _scroll_results_to_top(self):
        """将结果列表滚动到顶部。"""
        try:
            self.canvas.yview_moveto(0.0)
        except tk.TclError:
            logger.debug("结果列表已销毁，跳过滚动到顶部")

    def go_previous_page(self):
        """跳转到上一页"""
        if self.current_page <= 1:
            return

        self.current_page -= 1
        self._load_page()

    def go_next_page(self):
        """跳转到下一页"""
        if self.current_page >= self.total_pages:
            return

        self.current_page += 1
        self._load_page()

    def go_to_page_dialog(self):
        """弹出对话框跳转到指定页码"""
        # 只有一页时无需跳转
        if self.total_pages <= 1:
            messagebox.showinfo("提示", "当前只有一页")
            return

        # 检查是否已开始搜索
        if self.current_view_mode == "search" and not self.has_search_started:
            messagebox.showinfo("提示", "请先进行搜索")
            return

        # 弹出输入对话框
        dialog = simpledialog.askinteger(
            "跳转页码",
            f"请输入页码 (1-{self.total_pages}):",
            parent=self,
            minvalue=1,
            maxvalue=self.total_pages,
            initialvalue=self.current_page
        )

        if dialog is not None and dialog != self.current_page:
            self.current_page = dialog
            self._load_page()

    def _load_page(self):
        """加载指定页码的搜索结果"""
        if self.current_view_mode == "search" and not self.has_search_started:
            messagebox.showinfo("提示", "请先进行搜索")
            return
        if self.current_view_mode == "favourites" and not self.parser.source_supports_favourites():
            self.current_view_mode = "search"
            self.update_status("当前来源暂不支持收藏夹")
            return

        self._scroll_results_to_top()

        # 禁用翻页按钮
        self.prev_page_btn.state(['disabled'])
        self.next_page_btn.state(['disabled'])
        self.search_btn.config(state=tk.DISABLED)
        self.favourites_btn.config(state=tk.DISABLED)

        page_info = f"第 {self.current_page}/{self.total_pages} 页"
        self.update_status(f"正在加载{page_info}...")
        self._refresh_query_context_hint()

        if self.current_view_mode == "favourites":
            def do_load_favourites():
                try:
                    results, pagination, needs_login = self.parser.favourites(page=self.current_page)
                    if needs_login:
                        self.after(0, self._handle_favourites_login_required)
                        return
                    self.after(0, lambda: self.display_results(results, pagination))
                except Exception as e:
                    error_msg = str(e)
                    logger.error(f"Favourites page load error: {error_msg}")
                    self.after(0, lambda: self.search_error(error_msg))

            threading.Thread(target=do_load_favourites, daemon=True).start()
            return

        # 在后台线程中执行搜索
        def do_search():
            try:
                results, pagination = self.parser.search(self.current_search_keyword, page=self.current_page)
                self.after(0, lambda: self.display_results(results, pagination))
            except Exception as e:
                error_msg = str(e)
                logger.error(f"Page load error: {error_msg}")
                self.after(0, lambda: self.search_error(error_msg))

        threading.Thread(target=do_search, daemon=True).start()

    def _handle_favourites_login_required(self):
        """处理收藏夹模式下的未登录状态。"""
        self.search_btn.config(state=tk.NORMAL)
        self.favourites_btn.config(state=tk.NORMAL)
        self.update_pagination_controls()
        self.update_status("登录信息已过期或收藏夹为空")
        messagebox.showwarning("提示", "登录信息已过期或收藏夹为空")

    def view_favourites(self):
        """加载收藏夹（重置为第1页）。"""
        if not self.parser.source_supports_favourites():
            messagebox.showwarning("提示", "当前来源暂不支持收藏夹")
            return

        previous_mode = self.current_view_mode
        previous_page = self.current_page

        self.current_view_mode = "favourites"
        self.current_page = 1
        self._refresh_query_context_hint()

        self.search_btn.config(state=tk.DISABLED)
        self.favourites_btn.config(state=tk.DISABLED)
        self.update_status("正在加载收藏夹...")

        def do_load_favourites():
            try:
                results, pagination, needs_login = self.parser.favourites(page=1)
                if needs_login:
                    def handle_needs_login():
                        self.current_view_mode = previous_mode
                        self.current_page = previous_page
                        self._handle_favourites_login_required()
                    self.after(0, handle_needs_login)
                    return
                self.after(0, lambda: self.display_results(results, pagination))
            except Exception as e:
                error_msg = str(e)
                logger.error(f"Load favourites error: {error_msg}")
                self.after(0, lambda: self.search_error(error_msg))

        threading.Thread(target=do_load_favourites, daemon=True).start()

    def confirm_batch_download(self, comics: list[ComicInfo]) -> bool:
        """显示批量下载确认对话框

        Args:
            comics: 要下载的漫画列表

        Returns:
            用户是否确认下载
        """
        if not comics:
            return False

        # 构建确认消息
        comic_list = "\n".join([f"{i+1}. {comic.title}" for i, comic in enumerate(comics)])

        message = f"即将下载以下 {len(comics)} 本漫画：\n\n{comic_list}\n\n是否继续？"

        return messagebox.askyesno("确认批量下载", message)

    def batch_download_selected(self):
        """批量下载选中的漫画"""
        if not self.batch_select_mode_var.get():
            messagebox.showinfo("提示", "请先开启批量选择模式")
            return

        # 检查是否有选中
        if not self.selected_comics:
            messagebox.showinfo("提示", "请先选择要下载的漫画")
            return

        # 检查是否已有下载任务
        if self.is_downloading or self.is_batch_downloading:
            messagebox.showinfo("提示", "已有下载任务进行中，请等待完成")
            return
        if self.is_preparing_details:
            messagebox.showinfo("提示", "正在获取漫画详情，请稍后")
            return

        # 转换为列表保持顺序
        download_list = list(self.selected_comics)
        self.is_preparing_details = True
        self.search_btn.config(state=tk.DISABLED)
        self.favourites_btn.config(state=tk.DISABLED)
        self.update_status("正在获取批量下载详情...")

        def update_prepare_progress(current: int, total: int, comic: ComicInfo):
            self.after(
                0,
                lambda c=current, t=total, title=comic.title: self.update_status(
                    f"正在获取详情 ({c}/{t}): {title}"
                ),
            )

        def do_prepare_and_continue():
            try:
                prepared_list = self._ensure_comics_detail_ready(download_list, progress_callback=update_prepare_progress)
            except Exception as e:
                error_msg = str(e)
                self.after(0, lambda msg=error_msg: self._on_batch_prepare_failed(msg))
                return
            self.after(0, lambda: self._on_batch_prepare_ready(prepared_list))

        threading.Thread(target=do_prepare_and_continue, daemon=True).start()

    def _on_batch_prepare_ready(self, comics: list[ComicInfo]):
        self.is_preparing_details = False
        self.search_btn.config(state=tk.NORMAL)
        self.favourites_btn.config(state=tk.NORMAL)

        # 显示确认对话框
        if not self.confirm_batch_download(comics):
            self.update_status("已取消批量下载")
            return

        # 开始批量下载
        self.execute_batch_download(comics)

    def _on_batch_prepare_failed(self, error_msg: str):
        self.is_preparing_details = False
        self.search_btn.config(state=tk.NORMAL)
        self.favourites_btn.config(state=tk.NORMAL)
        self.update_status(f"获取详情失败: {error_msg}")
        messagebox.showerror("错误", f"批量下载前获取详情失败:\n{error_msg}")

    def detect_file_conflicts(self, comics: list[ComicInfo]) -> tuple[list[ComicInfo], list[tuple[int, ComicInfo, str]]]:
        """检测文件冲突

        Args:
            comics: 待下载漫画列表

        Returns:
            (无冲突的漫画列表, 冲突列表)
            冲突列表格式: [(原索引, ComicInfo, 文件名), ...]
        """
        conflicts = []
        no_conflict = []

        # 使用 GUI 当前显示的目录，而非配置文件中的目录
        current_dir = self.download_dir_var.get()
        output_format = self.config.output_format

        for i, comic in enumerate(comics):
            output_path = self.cbz_builder.get_output_path_for_format(comic, output_format, current_dir)
            filename = os.path.basename(output_path)

            if os.path.exists(output_path):
                conflicts.append((i, comic, filename))
            else:
                no_conflict.append(comic)

        return no_conflict, conflicts

    def handle_file_conflicts(self, conflicts: list[tuple[int, ComicInfo, str]]) -> tuple[list[ComicInfo], list[ComicInfo]]:
        """处理文件冲突

        Args:
            conflicts: 冲突列表 [(原索引, ComicInfo, 文件名), ...]

        Returns:
            (选择覆盖的漫画列表, 选择跳过的漫画列表)
        """
        if not conflicts:
            return [], []

        # 提取冲突漫画和文件名
        conflict_comics = [c[1] for c in conflicts]
        conflict_filenames = [c[2] for c in conflicts]

        # 显示对话框
        decisions = show_conflict_dialog(self, conflict_comics, conflict_filenames)

        if decisions is None:
            # 用户取消
            return [], conflict_comics  # 全部视为跳过

        overwrite = []
        skip = []

        for i, (orig_idx, comic, filename) in enumerate(conflicts):
            if decisions.get(i, False):
                overwrite.append(comic)
            else:
                skip.append(comic)

        return overwrite, skip

    def execute_batch_download(self, comics: list[ComicInfo]):
        """执行批量下载（使用下载管理器）"""
        if not comics:
            return

        # 检测文件冲突
        no_conflict, conflicts = self.detect_file_conflicts(comics)

        # 如果有冲突，让用户处理
        if conflicts:
            overwrite, skip = self.handle_file_conflicts(conflicts)

            # 如果用户取消了所有冲突处理（全部跳过或取消对话框）
            if not no_conflict and not overwrite:
                messagebox.showinfo("提示", "所有下载任务已取消")
                return

            # 合并无冲突和选择覆盖的漫画
            comics = no_conflict + overwrite

            if not comics:
                messagebox.showinfo("提示", "没有漫画需要下载")
                return

            # 显示处理结果
            skip_count = len(skip)
            if skip_count > 0:
                self.update_status(f"已跳过 {skip_count} 个同名文件")

        # 更新输出目录、输出格式和批量下载间隔
        self.download_manager.set_output_dir(self.download_dir_var.get())
        self.download_manager.set_output_format(self.config.output_format)
        self.download_manager.set_delay_after(self._get_batch_delay_seconds())

        # 添加任务到队列
        self.download_manager.add_tasks(comics)

        # 展开下载管理器
        if not self.download_manager_ui.is_expanded:
            self._toggle_download_manager()

        # 刷新 UI 显示所有任务
        self.download_manager_ui.refresh_task_list()

        # 启动下载处理器
        self.is_batch_downloading = True
        self.update_toolbar_buttons()
        self.download_manager.start()

    def show_batch_download_summary(self, results: dict):
        """显示批量下载汇总

        Args:
            results: 包含 success 和 failed 的字典
        """
        self.is_batch_downloading = False
        self.update_toolbar_buttons()

        success_count = len(results["success"])
        failed_count = len(results["failed"])

        # 构建消息
        message = f"批量下载完成\n\n成功: {success_count} 本"
        if failed_count > 0:
            message += f"\n失败: {failed_count} 本"
            for comic, error in results["failed"]:
                message += f"\n  - {comic.title}: {error}"

        self.update_status(f"批量下载完成：成功 {success_count} 本，失败 {failed_count} 本")
        self.progress_var.set(0)

        if failed_count > 0:
            messagebox.showwarning("批量下载完成", message)
        else:
            messagebox.showinfo("批量下载完成", message)

        # 清空选择
        self.clear_selection()

    def browse_download_dir(self):
        """浏览下载目录"""
        from tkinter import filedialog
        dir_path = filedialog.askdirectory(initialdir=self.download_dir_var.get())
        if dir_path:
            self.download_dir_var.set(dir_path)

    def open_download_dir(self):
        """打开下载目录（跨平台）"""
        download_dir = self.download_dir_var.get()

        if not download_dir or not os.path.exists(download_dir):
            messagebox.showinfo("提示", "下载目录不存在，请先设置有效的下载目录")
            return

        try:
            system = platform.system()

            if system == "Windows":
                # Windows: 使用 explorer
                os.startfile(download_dir)
            elif system == "Darwin":
                # macOS: 使用 open
                subprocess.run(["open", download_dir], check=True)
            else:
                # Linux: 使用 xdg-open
                try:
                    subprocess.run(["xdg-open", download_dir], check=True)
                except (subprocess.CalledProcessError, FileNotFoundError, OSError):
                    # fallback: 使用 nautilus
                    try:
                        subprocess.run(["nautilus", download_dir], check=True)
                    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
                        # 最后尝试: 使用 xdg-open 备用命令
                        subprocess.run(["xdg-open", "--", download_dir], check=True)

            logger.info(f"已打开下载目录: {download_dir}")

        except Exception as e:
            logger.error(f"打开下载目录失败: {e}")
            messagebox.showerror("错误", f"无法打开目录:\n{e}")

    def _on_download_task_update(self, task: DownloadTask):
        """下载任务更新回调（可能在后台线程调用）"""
        if should_ignore_gui_callback(self._is_destroying):
            return
        # 使用 after() 确保 UI 更新在主线程执行
        try:
            self.after(0, lambda: self._update_ui_for_task(task))
        except tk.TclError:
            logger.debug("窗口已销毁，忽略下载任务更新")

    def _update_ui_for_task(self, task: DownloadTask):
        """在主线程更新 UI"""
        # 更新下载管理器 UI
        if hasattr(self, 'download_manager_ui'):
            self.download_manager_ui.update_task(task)

        # 更新底部进度条（仅当前任务）
        if self.download_manager.current_task_id == task.task_id:
            progress = task.progress_percentage
            self.progress_var.set(progress)
            self.update_status(
                f"[{task.progress_current}/{task.progress_total}] {task.comic.title}"
            )

    def _on_download_queue_complete(self):
        """下载队列完成回调"""
        if should_ignore_gui_callback(self._is_destroying):
            return

        def on_complete():
            if should_ignore_gui_callback(self._is_destroying):
                return
            self.is_batch_downloading = False
            self.update_toolbar_buttons()

            stats = self.download_manager.get_stats()
            failed = stats["failed"]

            # 显示汇总
            message = build_batch_summary(stats)
            if failed > 0:
                # 显示失败的漫画标题和错误信息
                failed_tasks = [
                    task for task in self.download_manager.tasks.values()
                    if task.status == DownloadStatus.FAILED
                ]
                for task in failed_tasks:
                    message += f"\n  - {task.comic.title}"
                    if task.error_message:
                        message += f": {task.error_message}"

            messagebox.showinfo("完成", message)

            # 清理已完成的任务
            self.download_manager.clear_completed()
            self.download_manager_ui.refresh_task_list()

            self.update_status("就绪")
            self.progress_var.set(0)

        try:
            self.after(0, on_complete)
        except tk.TclError:
            logger.debug("窗口已销毁，忽略队列完成回调")

    def _toggle_download_manager(self):
        """切换下载管理器显示"""
        self.download_manager_ui.toggle()
        # 更新按钮图标
        icon = "▼" if self.download_manager_ui.is_expanded else "▲"
        self.expand_btn.config(text=icon)

    def update_status(self, message: str):
        """更新状态信息"""
        self.status_var.set(message)
        self.update_idletasks()

    def _dispatch_ui_callback(self, callback: Callable[[], None]):
        """在 UI 线程执行回调；已在主线程时直接执行，避免不必要排队。"""
        try:
            if threading.current_thread() is threading.main_thread():
                callback()
            else:
                self.after(0, callback)
        except tk.TclError:
            logger.debug("窗口已销毁，忽略 UI 回调")

    def toggle_selection(self, comic: ComicInfo) -> bool:
        """切换漫画选中状态

        Args:
            comic: 漫画信息

        Returns:
            切换后的选中状态（True=选中, False=未选中）
        """
        if comic in self.selected_comics:
            self.selected_comics.remove(comic)
            logger.debug(f"取消选中: {comic.title}")
            return False
        else:
            self.selected_comics.add(comic)
            logger.debug(f"选中: {comic.title}")
            return True

    def update_card_visual(self, frame: tk.Frame, is_selected: bool):
        """更新卡片视觉样式

        Args:
            frame: 卡片框架
            is_selected: 是否选中
        """
        # 尝试找到标题标签和勾选标记标签
        select_label = None
        for child in frame.winfo_children():
            if hasattr(child, 'select_mark'):
                select_label = child
                break

        if is_selected:
            # 选中样式：蓝色边框、浅蓝背景
            frame.config(relief="solid", borderwidth=2)
            # 尝试配置背景色（tk.Frame 直接支持）
            selected_bg = self.theme_manager.get_color("accent")
            try:
                frame.config(bg=selected_bg)
                # 递归设置子组件背景
                for child in frame.winfo_children():
                    if isinstance(child, tk.Frame):
                        child.config(bg=selected_bg)
            except (tk.TclError, AttributeError):
                pass

            # 添加或更新右上角勾选标记
            if select_label is None:
                select_label = tk.Label(
                    frame,
                    text="✓",
                    fg="#ffffff",
                    bg=selected_bg,
                    font=("Arial", 14, "bold")
                )
                select_label.select_mark = True  # 标记这是选择指示器
                select_label.place(relx=1.0, rely=0.0, anchor="ne", x=-5, y=5)
            else:
                select_label.config(bg=selected_bg, fg="#ffffff")
        else:
            # 未选中样式：恢复默认
            frame.config(relief="solid", borderwidth=1)
            try:
                frame.config(bg="")
                for child in frame.winfo_children():
                    if isinstance(child, tk.Frame):
                        child.config(bg="")
            except (tk.TclError, AttributeError):
                pass

            # 移除勾选标记
            if select_label is not None:
                select_label.destroy()

    def _on_card_click(self, event, comic: ComicInfo, frame: tk.Frame):
        """处理卡片点击事件

        Args:
            event: 点击事件
            comic: 漫画信息
            frame: 卡片框架
        """
        # 批量下载中不允许更改选择
        if self.is_batch_downloading:
            return

        # 仅批量选择模式可点选
        if not self.batch_select_mode_var.get():
            return

        # 切换选中状态
        is_selected = self.toggle_selection(comic)

        # 更新卡片视觉
        self.update_card_visual(frame, is_selected)

        # 更新工具栏按钮状态
        if hasattr(self, 'update_toolbar_buttons'):
            self.update_toolbar_buttons()

    def search(self):
        """执行搜索（重置为第1页）"""
        input_keyword = self.search_var.get().strip()
        query_mode = self._get_selected_query_mode()
        keyword = self._build_search_keyword(input_keyword, query_mode)

        self.current_view_mode = "search"

        # 保存搜索关键词，重置页码
        self.current_search_keyword = keyword
        self.current_search_mode = query_mode
        self.has_search_started = True
        self.current_page = 1
        self._refresh_query_context_hint()

        # 禁用搜索按钮
        self.search_btn.config(state=tk.DISABLED)
        if input_keyword:
            if query_mode == "keyword":
                self.update_status(f"正在搜索: {input_keyword}...")
            else:
                mode_label = self.query_mode_key_to_label.get(query_mode, query_mode)
                self.update_status(f"正在按{mode_label}搜索: {input_keyword}...")
        else:
            self.update_status("正在搜索...")

        # 在后台线程中执行搜索
        def do_search():
            try:
                results, pagination = self.parser.search(keyword, page=self.current_page)
                self.after(0, lambda: self.display_results(results, pagination))
            except Exception as e:
                error_msg = str(e)
                logger.error(f"Search error: {error_msg}")
                self.after(0, lambda: self.search_error(error_msg))

        threading.Thread(target=do_search, daemon=True).start()

    def search_error(self, error_msg: str):
        """处理搜索错误"""
        self.search_btn.config(state=tk.NORMAL)
        self.favourites_btn.config(state=tk.NORMAL)
        self.update_status(f"搜索失败: {error_msg}")
        messagebox.showerror("错误", f"搜索失败: {error_msg}")

    def display_results(self, results: List[ComicInfo], pagination: Optional[PaginationInfo] = None):
        """显示搜索结果

        Args:
            results: 漫画列表
            pagination: 分页信息
        """
        self.search_btn.config(state=tk.NORMAL)
        self.favourites_btn.config(state=tk.NORMAL)
        self.search_results = results

        # 更新分页信息
        if pagination:
            self.current_page = pagination.current_page
            self.total_pages = pagination.total_pages
        else:
            self.current_page = max(1, self.current_page)
            self.total_pages = max(1, self.current_page)

        # 新搜索时清空选择
        self.selected_comics.clear()
        if hasattr(self, 'update_toolbar_buttons'):
            self.update_toolbar_buttons()
        if hasattr(self, 'update_pagination_controls'):
            self.update_pagination_controls()

        # 清除旧结果
        self.cover_load_generation += 1
        self.detail_prefetch_generation += 1
        self._clear_pending_image_updates()
        for frame in self.result_frames:
            frame.destroy()
        self.result_frames.clear()
        self.image_cache.clear()
        self.card_title_expanded.clear()
        self.moeimg_detail_ready_keys.clear()
        with self.cover_loading_lock:
            self.cover_loading_keys.clear()
        self._scroll_results_to_top()

        if not results:
            self.update_status("未找到相关漫画")
            no_result_label = ttk.Label(self.scrollable_frame, text="未找到相关漫画", font=get_font("subtitle"))
            no_result_label.grid(row=0, column=0, pady=50)
            self.result_frames.append(no_result_label)
            return

        page_info = f"第 {self.current_page}/{self.total_pages} 页"
        if self.current_view_mode == "favourites":
            self.update_status(f"找到 {len(results)} 个收藏 - {page_info}")
        else:
            self.update_status(f"找到 {len(results)} 个结果 - {page_info}")

        # 更新列数
        self.columns = self._calculate_columns()
        self._update_canvas_width()

        # 显示结果网格（使用动态列数）
        for i, comic in enumerate(results):
            row = i // self.columns
            col = i % self.columns
            frame = self.create_comic_card(comic, row, col)
            self.result_frames.append(frame)

        self._start_result_detail_prefetch(results)

    @staticmethod
    def _is_moeimg_comic(comic: ComicInfo) -> bool:
        return (comic.source_site or "").strip().lower() == "moeimg"

    @staticmethod
    def _detail_ready_key(comic: ComicInfo) -> str:
        return f"{(comic.source_site or '').strip().lower()}:{comic.id}"

    @staticmethod
    def _dedupe_text_values(values: List[str]) -> List[str]:
        output: List[str] = []
        seen: set[str] = set()
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
        """将详情结果合并回现有对象，保持引用稳定。"""
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

    def _ensure_comics_detail_ready(
        self,
        comics: list[ComicInfo],
        progress_callback: Optional[Callable[[int, int, ComicInfo], None]] = None,
    ) -> list[ComicInfo]:
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
                    self.after(0, lambda c=comic, g=generation: self._on_result_detail_prefetched(c, g))
                except Exception as e:
                    logger.warning(f"Result detail prefetch failed: {comic.title} ({e})")

        threading.Thread(target=do_prefetch, daemon=True).start()

    def _on_result_detail_prefetched(self, comic: ComicInfo, generation: int):
        if generation != self.detail_prefetch_generation:
            return
        self._update_visible_card_metadata(comic)

    @staticmethod
    def _get_card_key(comic: ComicInfo) -> str:
        """生成卡片唯一键"""
        return get_card_key(comic)

    def _is_title_expanded(self, comic: ComicInfo) -> bool:
        """标题是否已展开"""
        return is_title_expanded(self.card_title_expanded, comic)

    def _wrap_text_lines(self, text: str, font_obj: tkfont.Font, max_width: int) -> List[str]:
        """按像素宽度换行"""
        return wrap_text_lines(text, font_obj, max_width)

    def _truncate_text_to_lines(
        self, text: str, font_obj: tkfont.Font, max_width: int, max_lines: int = 3
    ) -> tuple[str, bool]:
        """将文本裁剪到指定行数，必要时添加省略号"""
        return truncate_text_to_lines(text, font_obj, max_width, max_lines=max_lines)

    @staticmethod
    def _set_text_widget_content(widget: tk.Text, text: str, height: int):
        """更新 Text 内容并保持只读"""
        set_text_widget_content(widget, text, height)

    def _render_title_widget(self, title_widget: tk.Text, comic: ComicInfo, card_width: int):
        """根据展开状态渲染标题文本"""
        font_obj = tkfont.Font(font=get_font("normal", bold=True))
        render_title_widget(
            title_widget=title_widget,
            comic=comic,
            card_width=card_width,
            expanded=self._is_title_expanded(comic),
            font_obj=font_obj,
        )

    def _on_title_click_press(self, event):
        """记录标题点击起始状态"""
        on_title_click_press(event)
        return None

    def _on_title_drag(self, event):
        """标题拖拽选择时打标记"""
        on_title_drag(event)
        return None

    def _on_title_click_release(self, event, comic: ComicInfo, title_widget: tk.Text, card_width: int):
        """标题点击释放：无拖拽无选区时切换展开"""
        return on_title_click_release(
            event=event,
            comic=comic,
            title_widget=title_widget,
            card_width=card_width,
            card_title_expanded=self.card_title_expanded,
            render_callback=self._render_title_widget,
        )

    def _copy_selected_text(self, event):
        """复制 Text 当前选区"""
        def _set_clipboard(text: str):
            self.clipboard_clear()
            self.clipboard_append(text)
            self.update_idletasks()

        return copy_selected_text(event, clipboard_setter=_set_clipboard)

    def _get_frame_background(self) -> str:
        """获取与卡片一致的背景色"""
        return get_frame_background(self.theme_manager)

    def create_comic_card(self, comic: ComicInfo, row: int, col: int) -> tk.Frame:
        """创建漫画卡片"""
        frame = build_comic_card_frame(
            parent=self.scrollable_frame,
            comic=comic,
            row=row,
            col=col,
            columns=self.columns,
            canvas_width=self.canvas.winfo_width(),
            card_padding=self.card_padding,
            show_preview=self.show_preview_var.get(),
            theme_manager=self.theme_manager,
            card_key=self._get_card_key(comic),
            on_card_click=self._on_card_click,
            on_download_click=self.download_comic,
            on_schedule_cover_load=self._schedule_cover_load,
            on_render_title=self._render_title_widget,
            on_copy_selected_text=self._copy_selected_text,
            on_title_click_press_cb=self._on_title_click_press,
            on_title_drag_cb=self._on_title_drag,
            on_title_click_release_cb=self._on_title_click_release,
            on_set_text_widget_content_cb=self._set_text_widget_content,
            get_font_fn=get_font,
        )

        # 保留已选状态（窗口缩放重排时）
        if comic in self.selected_comics:
            self.update_card_visual(frame, True)

        return frame

    def _schedule_cover_load(self, url: str, label: ttk.Label, card_width: int = 200):
        """调度封面加载任务（固定并发，避免线程爆炸）"""
        cover_width = min(200, max(120, card_width - 20))
        cover_height = int(cover_width * 1.4)
        cache_key = f"{url}_{cover_width}x{cover_height}"

        if cache_key in self.image_cache:
            photo = self.image_cache[cache_key]
            self.after(0, lambda l=label, p=photo: self._safe_update_image(l, p))
            return

        with self.cover_loading_lock:
            if cache_key in self.cover_loading_keys:
                return
            self.cover_loading_keys.add(cache_key)

        generation = self.cover_load_generation
        self.cover_executor.submit(self.load_cover, url, label, card_width, generation)

    def load_cover(self, url: str, label: ttk.Label, card_width: int = 200, generation: int = 0):
        """异步加载封面图片

        Args:
            url: 图片 URL
            label: 要显示图片的 Label
            card_width: 卡片宽度，用于调整封面大小
            generation: 搜索结果代际（用于丢弃过期任务）
        """
        cache_key = ""
        try:
            if generation != self.cover_load_generation:
                return

            # 根据卡片宽度计算封面尺寸
            cover_width = min(200, max(120, card_width - 20))
            cover_height = int(cover_width * 1.4)  # 保持宽高比

            cache_key = f"{url}_{cover_width}x{cover_height}"

            if cache_key in self.image_cache:
                photo = self.image_cache[cache_key]
                # 检查 label 是否仍然存在
                self.after(0, lambda l=label, p=photo: self._safe_update_image(l, p))
                return

            # 复用 parser 会话，统一认证、代理与连接复用策略
            response = self.parser.session.get(
                url,
                timeout=10,
                headers=self._get_cover_request_headers(),
            )
            response.raise_for_status()

            img = Image.open(BytesIO(response.content))
            # 根据卡片宽度调整大小
            img.thumbnail((cover_width, cover_height), Image.Resampling.LANCZOS)
            photo = ImageTk.PhotoImage(img)

            if generation != self.cover_load_generation:
                return

            self.image_cache[cache_key] = photo
            # 检查 label 是否仍然存在
            self.after(0, lambda l=label, p=photo: self._safe_update_image(l, p))
        except Exception as e:
            logger.debug(f"Failed to load cover: {e}")
            if generation == self.cover_load_generation:
                self.after(
                    0,
                    lambda l=label, u=url, w=card_width, g=generation: self._show_cover_retry_icon(l, u, w, g),
                )
        finally:
            if cache_key:
                with self.cover_loading_lock:
                    self.cover_loading_keys.discard(cache_key)

    def _show_cover_retry_icon(self, label: ttk.Label, url: str, card_width: int, generation: int):
        """封面加载失败时显示重试图标。"""
        if generation != self.cover_load_generation:
            return
        try:
            if not label.winfo_exists():
                return
            label._cover_url = url
            label._cover_card_width = card_width
            label.config(image="", text="⚠\n重试", cursor="hand2")
            label.image = None
            label.bind("<Button-1>", lambda e, l=label: self._retry_cover_load(e, l))
        except tk.TclError:
            logger.debug("封面标签已销毁，跳过失败图标更新")

    def _retry_cover_load(self, event, label: ttk.Label):
        """重试封面加载。"""
        url = getattr(label, "_cover_url", "")
        card_width = getattr(label, "_cover_card_width", 200)
        if not url:
            return "break"
        try:
            if not label.winfo_exists():
                return "break"
            label.config(image="", text="加载中...", cursor="")
            label.image = None
        except tk.TclError:
            return "break"

        self._schedule_cover_load(url, label, card_width)
        return "break"

    @staticmethod
    def _restore_cover_click_binding(label: ttk.Label):
        """恢复封面正常点击行为（批量选择）。"""
        label_dict = getattr(label, "__dict__", {})
        if "_card_click_handler" not in label_dict:
            return
        handler = label_dict.get("_card_click_handler")
        if callable(handler):
            label.bind("<Button-1>", handler)

    def _safe_update_image(self, label: ttk.Label, photo):
        """安全地更新 label 的图片，处理 label 已被销毁的情况

        Args:
            label: 要更新的 Label
            photo: 要显示的图片
        """
        try:
            if self._is_scrolling:
                # 滚动期间先缓存最新图片，空闲后统一刷新，避免回调风暴。
                self._queue_pending_image_update(label, photo)
                return

            # 检查 label 是否仍然有效（未被销毁）
            if label.winfo_exists():
                self._restore_cover_click_binding(label)
                label.config(image=photo, text="", cursor="")
                label.image = photo
        except tk.TclError:
            # label 已被销毁，忽略错误
            logger.debug("Label已被销毁，跳过图片更新")

    def _queue_pending_image_update(self, label: ttk.Label, photo):
        """滚动期间缓存图片刷新请求，仅保留每个 label 的最新值。"""
        self._pending_image_updates[label] = photo
        if self._pending_image_flush_after_id is None:
            self._pending_image_flush_after_id = self.after(120, self._flush_pending_image_updates)

    def _flush_pending_image_updates(self):
        """在滚动空闲时刷新缓存的图片更新请求。"""
        self._pending_image_flush_after_id = None
        if self._is_scrolling:
            if self._pending_image_updates:
                self._pending_image_flush_after_id = self.after(120, self._flush_pending_image_updates)
            return

        if not self._pending_image_updates:
            return

        pending_updates = list(self._pending_image_updates.items())
        self._pending_image_updates.clear()
        for label, photo in pending_updates:
            try:
                if label.winfo_exists():
                    self._restore_cover_click_binding(label)
                    label.config(image=photo, text="", cursor="")
                    label.image = photo
            except tk.TclError:
                logger.debug("Label已被销毁，跳过图片更新")

    def _clear_pending_image_updates(self):
        """清理待刷新图片队列与对应定时器。"""
        self._pending_image_updates.clear()
        if self._pending_image_flush_after_id:
            self.after_cancel(self._pending_image_flush_after_id)
            self._pending_image_flush_after_id = None

    def download_comic(self, comic: ComicInfo):
        """下载选中的漫画"""
        # 批量下载中不允许单个下载
        if self.is_batch_downloading:
            messagebox.showinfo("提示", "批量下载进行中，请等待完成")
            return

        if self.is_downloading:
            messagebox.showinfo("提示", "已有下载任务进行中，请等待完成")
            return
        if self.is_preparing_details:
            messagebox.showinfo("提示", "正在获取漫画详情，请稍后")
            return

        self.is_preparing_details = True
        self.search_btn.config(state=tk.DISABLED)
        self.favourites_btn.config(state=tk.DISABLED)
        self.update_status(f"正在确认详情: {comic.title}...")

        def do_prepare():
            try:
                prepared_list = self._ensure_comics_detail_ready([comic])
                comic_to_download = prepared_list[0] if prepared_list else comic
                self._dispatch_ui_callback(lambda c=comic_to_download: self._continue_single_download(c))
            except Exception as e:
                self._dispatch_ui_callback(
                    lambda err=str(e), title=comic.title: self._on_single_prepare_failed(title, err)
                )

        threading.Thread(target=do_prepare, daemon=True).start()

    def _on_single_prepare_failed(self, comic_title: str, error_msg: str):
        self.is_preparing_details = False
        self.search_btn.config(state=tk.NORMAL)
        self.favourites_btn.config(state=tk.NORMAL)
        logger.warning(f"Prepare comic before download failed: {error_msg}")
        self.update_status(f"获取详情失败: {comic_title}")
        messagebox.showerror("错误", f"下载前获取详情失败:\n{error_msg}")

    def _continue_single_download(self, comic_to_download: ComicInfo):
        self.is_preparing_details = False
        self.search_btn.config(state=tk.NORMAL)
        self.favourites_btn.config(state=tk.NORMAL)

        # 检测文件冲突
        current_dir = self.download_dir_var.get()
        output_format = self.config.output_format
        target_output_path = self.cbz_builder.get_output_path_for_format(comic_to_download, output_format, current_dir)

        if os.path.exists(target_output_path):
            filename = os.path.basename(target_output_path)
            # 使用冲突对话框处理单个文件冲突
            decisions = show_conflict_dialog(self, [comic_to_download], [filename])
            if decisions is None or not decisions.get(0, False):
                # 用户取消或选择跳过
                self.update_status("已取消下载")
                return

        # 确认下载
        format_display = {"folder": "文件夹", "zip": "ZIP格式", "cbz": "CBZ格式"}.get(output_format, "CBZ格式")
        if not messagebox.askyesno(
            "确认下载",
            f"是否下载:\n{comic_to_download.title}\n\n作者: {comic_to_download.author or '未知'}\n页数: {comic_to_download.pages}\n\n输出格式: {format_display}",
        ):
            self.update_status("已取消下载")
            return

        self.is_downloading = True
        self.update_status(f"准备下载: {comic_to_download.title}...")
        self.progress_var.set(0)

        # 更新下载器配置
        self.downloader.concurrent_downloads = self.concurrent_var.get()

        def do_download():
            temp_dir = None
            try:
                # 下载图片
                temp_dir = self.downloader.download_comic(
                    comic_to_download,
                    self.download_dir_var.get(),
                    progress_callback=self._progress_callback,
                )

                # 根据输出格式处理
                if output_format == "folder":
                    self.after(0, lambda: self.update_status("正在保存文件夹..."))
                    # save_as_folder 需要目录路径（不是文件路径），所以用 current_dir
                    output_path = self.cbz_builder.save_as_folder(temp_dir, comic_to_download, current_dir)
                    # 文件夹模式已移动临时目录，无需清理
                elif output_format == "zip":
                    self.after(0, lambda: self.update_status("正在打包 ZIP..."))
                    output_path = self.cbz_builder.build_zip(temp_dir, comic_to_download, target_output_path)
                    # 清理临时目录
                    self.downloader.cleanup_temp_dir(temp_dir)
                else:  # cbz (默认)
                    self.after(0, lambda: self.update_status("正在打包 CBZ..."))
                    output_path = self.cbz_builder.build_cbz(temp_dir, comic_to_download, target_output_path)
                    # 清理临时目录
                    self.downloader.cleanup_temp_dir(temp_dir)

                self.after(0, lambda: self.download_complete(output_path))

            except Exception as e:
                error_msg = str(e)
                logger.error(f"Download error: {error_msg}")
                self.after(0, lambda: self.download_error(error_msg, temp_dir))

        threading.Thread(target=do_download, daemon=True).start()

    def _progress_callback(self, current: int, total: int, status: str, comic_info: Optional[dict] = None):
        """进度回调

        Args:
            current: 当前进度
            total: 总进度
            status: 状态信息
            comic_info: 批量下载时的漫画信息字典，包含 comic_index, total_comics, title
        """
        def update():
            progress = (current / total * 100) if total > 0 else 0
            self.progress_var.set(progress)

            # 如果有漫画信息（批量下载场景），显示双层进度
            if comic_info:
                comic_index = comic_info.get("comic_index", 0)
                total_comics = comic_info.get("total_comics", 1)
                title = comic_info.get("title", "未知")
                full_status = f"[{comic_index}/{total_comics}] [{current}/{total}] {title} - {status}"
            else:
                full_status = status

            self.update_status(full_status)
        self.after(0, update)


    def download_complete(self, output_path: str):
        """下载完成"""
        self.is_downloading = False
        self.progress_var.set(100)
        self.update_status(f"下载完成: {output_path}")
        messagebox.showinfo("完成", f"下载成功!\n保存位置:\n{output_path}")

    def download_error(self, error_msg: str, temp_dir: Optional[str]):
        """下载错误"""
        self.is_downloading = False
        self.progress_var.set(0)
        self.update_status(f"下载失败: {error_msg}")

        if temp_dir and os.path.exists(temp_dir):
            msg = f"下载失败: {error_msg}\n\n临时文件保留在:\n{temp_dir}"
        else:
            msg = f"下载失败: {error_msg}"

        messagebox.showerror("错误", msg)


def main():
    """程序入口"""
    # 配置日志
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    # 启动 GUI
    app = HComicDownloaderGUI()
    app.mainloop()


if __name__ == "__main__":
    main()
