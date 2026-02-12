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
from tkinter import ttk, messagebox, scrolledtext
from typing import List, Optional, Tuple
from PIL import Image, ImageTk
from io import BytesIO

from config import Config
from auth_parser import extract_auth_from_curl
from models import ComicInfo, PaginationInfo, DownloadTask
from parser import HComicParser
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
from download_manager_ui import DownloadManagerUI

logger = logging.getLogger(__name__)


class HComicDownloaderGUI(tk.Tk):
    """HComic Downloader 主窗口"""

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

        # 导出系统代理到环境变量，确保所有请求路径行为一致
        export_system_proxies_to_env()

        # 初始化组件
        self.parser = HComicParser(
            timeout=self.config.timeout,
            cookie=self.config.auth_cookie,
            user_agent=self.config.auth_user_agent,
        )
        self.downloader = ComicDownloader(
            concurrent_downloads=self.config.concurrent_downloads,
            timeout=self.config.timeout,
            retry_times=self.config.retry_times,
            cookie=self.config.auth_cookie,
            user_agent=self.config.auth_user_agent,
        )
        self.cbz_builder = CBZBuilder(self.config.cbz_filename_template, self.config)

        # 下载管理器（使用 ComicDownloadManager）
        self.download_manager = ComicDownloadManager(
            downloader=self.downloader,
            cbz_builder=self.cbz_builder,
            output_dir=self.config.download_dir,
        )
        self.download_manager.set_callbacks(
            on_task_update=self._on_download_task_update,
            on_queue_complete=self._on_download_queue_complete,
        )

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

        # 下载状态
        self.is_downloading = False

        # 批量下载状态
        self.selected_comics: set[ComicInfo] = set()  # 选中的漫画集合
        self.is_batch_downloading: bool = False        # 批量下载进行中
        self.batch_select_mode_var = tk.BooleanVar(value=False)  # 批量选择模式

        # 翻页状态
        self.current_page: int = 1                    # 当前页码
        self.total_pages: int = 1                     # 总页数
        self.current_search_keyword: str = ""         # 当前搜索关键词（用于翻页）
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

        # 初始化登录状态展示并执行静默校验
        if self.config.auth_cookie and self.config.auth_user_agent:
            self.login_status_var.set("已加载登录配置（待校验）")
            self._verify_login_async()
        else:
            self.login_status_var.set("未配置登录信息")
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
        main_frame = ttk.Frame(self, padding="10")
        main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))

        # 配置网格权重
        self.columnconfigure(0, weight=1)
        self.rowconfigure(0, weight=1)
        main_frame.columnconfigure(0, weight=1)
        main_frame.rowconfigure(2, weight=1)  # 结果区域可扩展

        # ===== 搜索栏 =====
        search_frame = ttk.Frame(main_frame)
        search_frame.grid(row=0, column=0, sticky=(tk.W, tk.E), pady=(0, 10))
        search_frame.columnconfigure(0, weight=1)

        self.search_var = tk.StringVar()
        self.search_entry = ttk.Entry(search_frame, textvariable=self.search_var, font=get_font("normal"))
        self.search_entry.grid(row=0, column=0, sticky=(tk.W, tk.E), padx=(0, 10))
        self.search_entry.bind('<Return>', lambda e: self.search())

        self.search_btn = ttk.Button(search_frame, text="搜索", command=self.search)
        self.search_btn.grid(row=0, column=1)

        self.favourites_btn = ttk.Button(search_frame, text="收藏夹", command=self.view_favourites)
        self.favourites_btn.grid(row=0, column=2, padx=(8, 0))

        self.toggle_settings_btn = ttk.Button(
            search_frame,
            text="展开设置 ▼",
            command=self.toggle_settings_panel
        )
        self.toggle_settings_btn.grid(row=0, column=3, padx=(8, 0))

        # ===== 设置栏 =====
        self.settings_container = ttk.Frame(main_frame, height=0)
        self.settings_container.grid(row=1, column=0, sticky=(tk.W, tk.E), pady=(0, 10))
        self.settings_container.grid_propagate(False)
        self.settings_container.columnconfigure(0, weight=1)

        self.settings_frame = ttk.LabelFrame(self.settings_container, text="设置", padding="5")
        self.settings_frame.grid(row=0, column=0, sticky=(tk.W, tk.E))

        # 第一行：下载目录和并发数
        ttk.Label(self.settings_frame, text="下载目录:").grid(row=0, column=0, sticky=tk.W)
        self.download_dir_var = tk.StringVar(value=self.config.download_dir)
        ttk.Entry(self.settings_frame, textvariable=self.download_dir_var, width=20).grid(row=0, column=1, sticky=(tk.W, tk.E), padx=5)
        ttk.Button(self.settings_frame, text="浏览...", command=self.browse_download_dir, width=3).grid(row=0, column=2)
        ttk.Button(self.settings_frame, text="跳转", command=self.open_download_dir, width=3).grid(row=0, column=3)

        ttk.Label(self.settings_frame, text="并发数:").grid(row=0, column=4, padx=(20, 5))
        self.concurrent_var = tk.IntVar(value=self.config.concurrent_downloads)
        ttk.Spinbox(self.settings_frame, from_=1, to=10, textvariable=self.concurrent_var, width=5).grid(row=0, column=5)

        ttk.Label(self.settings_frame, text="批量延迟(秒):").grid(row=0, column=6, padx=(20, 5))
        self.batch_delay_var = tk.IntVar(value=self.config.batch_download_delay)
        self.batch_delay_spinbox = ttk.Spinbox(
            self.settings_frame, from_=0, to=60, textvariable=self.batch_delay_var, width=5
        )
        self.batch_delay_spinbox.grid(row=0, column=7, padx=(0, 5))
        # 限制输入为整数
        self.batch_delay_spinbox.config(validate="key", validatecommand=(self.register(self._validate_batch_delay), '%P'))

        # 第二行：字体设置
        ttk.Label(self.settings_frame, text="字体:").grid(row=1, column=0, sticky=tk.W, pady=(5, 0))
        self.font_var = tk.StringVar(value=self.config.font_name or "自动检测")
        font_combo = ttk.Combobox(self.settings_frame, textvariable=self.font_var, width=25, state="readonly")
        font_combo['values'] = self._get_font_list()
        font_combo.grid(row=1, column=1, sticky=tk.W, padx=5, pady=(5, 0))
        font_combo.bind("<<ComboboxSelected>>", self._on_font_changed)

        ttk.Label(self.settings_frame, text="字体大小:").grid(row=1, column=3, padx=(20, 5), pady=(5, 0))
        self.font_size_var = tk.IntVar(value=self.config.font_size)
        ttk.Spinbox(self.settings_frame, from_=8, to=20, textvariable=self.font_size_var, width=5, command=self._on_font_size_changed).grid(row=1, column=4, pady=(5, 0))

        # 第三行：预览图设置
        preview_check = ttk.Checkbutton(
            self.settings_frame,
            text="显示预览图",
            variable=self.show_preview_var,
            command=self._on_preview_changed
        )
        preview_check.grid(row=2, column=0, columnspan=2, sticky=tk.W, pady=(5, 0))

        # 第四行：登录 curl 输入与应用按钮
        ttk.Label(self.settings_frame, text="登录 curl:").grid(row=3, column=0, sticky=tk.NW, pady=(8, 0))
        self.login_curl_text = scrolledtext.ScrolledText(self.settings_frame, height=4, wrap=tk.WORD)
        self.login_curl_text.grid(row=3, column=1, columnspan=4, sticky=(tk.W, tk.E), padx=5, pady=(8, 0))
        self.apply_login_btn = ttk.Button(self.settings_frame, text="应用登录信息", command=self.apply_login_from_curl)
        self.apply_login_btn.grid(row=3, column=5, sticky=tk.NW, pady=(8, 0))

        # 第五行：登录状态
        ttk.Label(self.settings_frame, text="登录状态:").grid(row=4, column=0, sticky=tk.W, pady=(5, 0))
        self.login_status_var = tk.StringVar(value="未配置登录信息")
        ttk.Label(self.settings_frame, textvariable=self.login_status_var).grid(
            row=4, column=1, columnspan=5, sticky=tk.W, padx=5, pady=(5, 0)
        )

        # 第六行：系统代理状态
        ttk.Label(self.settings_frame, text="系统代理:").grid(row=5, column=0, sticky=tk.W, pady=(5, 0))
        self.proxy_status_var = tk.StringVar(value="未检测")
        ttk.Label(self.settings_frame, textvariable=self.proxy_status_var).grid(
            row=5, column=1, columnspan=4, sticky=tk.W, padx=5, pady=(5, 0)
        )
        ttk.Button(
            self.settings_frame,
            text="刷新代理",
            command=lambda: self._refresh_proxy_status(show_message=True),
        ).grid(row=5, column=5, sticky=tk.W, pady=(5, 0))

        # 让设置栏的输入框可以根据窗口宽度自动调整
        self.settings_frame.columnconfigure(1, weight=1)

        # 设置面板目标高度，默认折叠
        self.update_idletasks()
        self.settings_target_height = max(self.settings_frame.winfo_reqheight(), 1)
        self.settings_current_height = 0
        self.settings_container.configure(height=0)
        self.settings_container.grid_remove()
        self._set_settings_button_text()

        # ===== 搜索结果区域 =====
        results_frame = ttk.LabelFrame(main_frame, text="搜索结果", padding="5")
        results_frame.grid(row=2, column=0, sticky=(tk.W, tk.E, tk.N, tk.S), pady=(0, 10))
        results_frame.columnconfigure(0, weight=1)
        results_frame.rowconfigure(1, weight=1)  # 改为 row=1，因为 row=0 是工具栏

        # 创建批量操作工具栏
        self.batch_toolbar = self.create_batch_toolbar(results_frame)

        # 画布和滚动条
        self.canvas = tk.Canvas(results_frame, highlightthickness=0)
        scrollbar = ttk.Scrollbar(results_frame, orient="vertical", command=self.canvas.yview)
        self.scrollable_frame = ttk.Frame(self.canvas)

        self.scrollable_frame.bind("<Configure>", self._on_scrollable_frame_configure)

        # 创建内窗口（宽度将动态调整）
        self.canvas_window = self.canvas.create_window((0, 0), window=self.scrollable_frame, anchor="nw")
        self.canvas.configure(yscrollcommand=scrollbar.set)

        self.canvas.grid(row=1, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))  # row=1
        scrollbar.grid(row=1, column=1, sticky=(tk.N, tk.S))  # row=1

        # 跨平台滚动事件绑定（鼠标滚轮 + 触控板）
        self._bind_scroll_events()

        # ===== 下载管理器面板（初始隐藏）=====
        self.download_manager_ui = DownloadManagerUI(main_frame, self.download_manager)
        self.download_manager_ui.panel.grid(row=3, column=0, sticky="ew")
        self.download_manager_ui.panel.grid_remove()

        # ===== 进度区域 =====
        progress_frame = ttk.Frame(main_frame)
        progress_frame.grid(row=4, column=0, sticky=(tk.W, tk.E))
        progress_frame.columnconfigure(0, weight=1)

        self.status_var = tk.StringVar(value="就绪")
        self.status_label = ttk.Label(progress_frame, textvariable=self.status_var)
        self.status_label.grid(row=0, column=0, sticky=tk.W)

        # 进度条容器
        progress_container = ttk.Frame(progress_frame)
        progress_container.grid(row=1, column=0, sticky=(tk.W, tk.E), pady=(5, 0))
        progress_container.columnconfigure(0, weight=1)

        self.progress_var = tk.DoubleVar(value=0)
        self.progress_bar = ttk.Progressbar(
            progress_container,
            variable=self.progress_var,
            maximum=100
        )
        self.progress_bar.grid(row=0, column=0, sticky=(tk.W, tk.E))

        # 展开/折叠按钮
        self.expand_btn = ttk.Button(
            progress_container,
            text="▲",
            width=3,
            command=self._toggle_download_manager
        )
        self.expand_btn.grid(row=0, column=1, padx=(5, 0))

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
            widget.bind("<TouchpadScroll>", self._on_touchpad_scroll, add="+")
            widget.bind("<Button-4>", self._on_mousewheel_linux_button, add="+")
            widget.bind("<Button-5>", self._on_mousewheel_linux_button, add="+")
        self.bind_all("<MouseWheel>", self._on_mousewheel, add="+")
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
        if hasattr(self, '_resize_after_id'):
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
            columns = max(1, int(available_width / (self.min_card_width + self.card_padding * 2)))
            return columns
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

    def _on_font_size_changed(self):
        """字体大小变化事件"""
        self.config.font_size = self.font_size_var.get()
        # 重新创建字体配置
        self.font_config = FontConfig(self.config)
        logger.info(f"字体大小已更改为: {self.config.font_size}")

    def _on_preview_changed(self):
        """预览图设置变化事件"""
        show_preview = self.show_preview_var.get()
        logger.info(f"预览图设置已更改为: {show_preview}（仅本次运行有效）")

        # 如果有搜索结果，重新渲染
        if self.search_results:
            self._refresh_results_layout()

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

        self.config.auth_cookie = cookie
        self.config.auth_user_agent = user_agent
        self.parser.configure_auth(cookie=cookie, user_agent=user_agent)
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
        apply_system_proxy_to_session(self.parser.session)
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
        toolbar = ttk.Frame(parent)
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

        # 页数标签
        self.page_label_var = tk.StringVar(value="1/1")
        self.page_label = ttk.Label(
            toolbar,
            textvariable=self.page_label_var,
            font=get_font("normal")
        )
        self.page_label.grid(row=0, column=6, padx=(0, 5))

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

    def _load_page(self):
        """加载指定页码的搜索结果"""
        if self.current_view_mode == "search" and not self.has_search_started:
            messagebox.showinfo("提示", "请先进行搜索")
            return

        # 禁用翻页按钮
        self.prev_page_btn.state(['disabled'])
        self.next_page_btn.state(['disabled'])
        self.search_btn.config(state=tk.DISABLED)
        self.favourites_btn.config(state=tk.DISABLED)

        page_info = f"第 {self.current_page}/{self.total_pages} 页"
        self.update_status(f"正在加载{page_info}...")

        if self.current_view_mode == "favourites":
            def do_load_favourites():
                try:
                    results, pagination, needs_login = self.parser.favourites(page=self.current_page)
                    if needs_login:
                        self.after(0, self._handle_favourites_login_required)
                        return
                    self.after(0, lambda: self.display_results(results, pagination))
                except Exception as e:
                    logger.error(f"Favourites page load error: {e}")
                    self.after(0, lambda: self.search_error(str(e)))

            threading.Thread(target=do_load_favourites, daemon=True).start()
            return

        # 在后台线程中执行搜索
        def do_search():
            try:
                results, pagination = self.parser.search(self.current_search_keyword, page=self.current_page)
                self.after(0, lambda: self.display_results(results, pagination))
            except Exception as e:
                logger.error(f"Page load error: {e}")
                self.after(0, lambda: self.search_error(str(e)))

        threading.Thread(target=do_search, daemon=True).start()

    def _handle_favourites_login_required(self):
        """处理收藏夹模式下的未登录状态。"""
        self.search_btn.config(state=tk.NORMAL)
        self.favourites_btn.config(state=tk.NORMAL)
        self.update_pagination_controls()
        self.update_status("收藏夹需要登录，请先应用登录信息")
        messagebox.showwarning("需要登录", "请先应用登录信息后再查看收藏夹")

    def view_favourites(self):
        """加载收藏夹（重置为第1页）。"""
        previous_mode = self.current_view_mode
        previous_page = self.current_page

        self.current_view_mode = "favourites"
        self.current_page = 1

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
                logger.error(f"Load favourites error: {e}")
                self.after(0, lambda: self.search_error(str(e)))

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

        # 转换为列表保持顺序
        download_list = list(self.selected_comics)

        # 显示确认对话框
        if not self.confirm_batch_download(download_list):
            return

        # 开始批量下载
        self.execute_batch_download(download_list)

    def execute_batch_download(self, comics: list[ComicInfo]):
        """执行批量下载（使用下载管理器）"""
        if not comics:
            return

        # 更新输出目录和批量下载间隔
        self.download_manager.set_output_dir(self.download_dir_var.get())
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
                except:
                    # fallback: 使用 nautilus
                    try:
                        subprocess.run(["nautilus", download_dir], check=True)
                    except:
                        # 最后尝试: 使用 xdg-open 备用命令
                        subprocess.run(["xdg-open", "--", download_dir], check=True)

            logger.info(f"已打开下载目录: {download_dir}")

        except Exception as e:
            logger.error(f"打开下载目录失败: {e}")
            messagebox.showerror("错误", f"无法打开目录:\n{e}")

    def _on_download_task_update(self, task: DownloadTask):
        """下载任务更新回调（可能在后台线程调用）"""
        # 使用 after() 确保 UI 更新在主线程执行
        self.after(0, lambda: self._update_ui_for_task(task))

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
        def on_complete():
            self.is_batch_downloading = False
            self.update_toolbar_buttons()

            stats = self.download_manager.get_stats()
            success = stats["completed"]
            failed = stats["failed"]
            cancelled = stats["cancelled"]

            # 显示汇总
            message = f"批量下载完成\n\n成功: {success} 本"
            if failed > 0:
                message += f"\n失败: {failed} 本"
            if cancelled > 0:
                message += f"\n取消: {cancelled} 本"

            messagebox.showinfo("完成", message)

            # 清理已完成的任务
            self.download_manager.clear_completed()
            self.download_manager_ui.refresh_task_list()

            self.update_status("就绪")
            self.progress_var.set(0)

        self.after(0, on_complete)

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
            try:
                frame.config(bg="#E3F2FD")
                # 递归设置子组件背景
                for child in frame.winfo_children():
                    if isinstance(child, tk.Frame):
                        child.config(bg="#E3F2FD")
            except:
                pass

            # 添加或更新右上角勾选标记
            if select_label is None:
                select_label = tk.Label(
                    frame,
                    text="✓",
                    fg="#2196F3",
                    bg="#E3F2FD",
                    font=("Arial", 14, "bold")
                )
                select_label.select_mark = True  # 标记这是选择指示器
                select_label.place(relx=1.0, rely=0.0, anchor="ne", x=-5, y=5)
        else:
            # 未选中样式：恢复默认
            frame.config(relief="solid", borderwidth=1)
            try:
                frame.config(bg="")
                for child in frame.winfo_children():
                    if isinstance(child, tk.Frame):
                        child.config(bg="")
            except:
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
        keyword = self.search_var.get().strip()

        self.current_view_mode = "search"

        # 保存搜索关键词，重置页码
        self.current_search_keyword = keyword
        self.has_search_started = True
        self.current_page = 1

        # 禁用搜索按钮
        self.search_btn.config(state=tk.DISABLED)
        if keyword:
            self.update_status(f"正在搜索: {keyword}...")
        else:
            self.update_status("正在搜索...")

        # 在后台线程中执行搜索
        def do_search():
            try:
                results, pagination = self.parser.search(keyword, page=self.current_page)
                self.after(0, lambda: self.display_results(results, pagination))
            except Exception as e:
                logger.error(f"Search error: {e}")
                self.after(0, lambda: self.search_error(str(e)))

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
        self._clear_pending_image_updates()
        for frame in self.result_frames:
            frame.destroy()
        self.result_frames.clear()
        self.image_cache.clear()
        self.card_title_expanded.clear()
        with self.cover_loading_lock:
            self.cover_loading_keys.clear()

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

    @staticmethod
    def _get_card_key(comic: ComicInfo) -> str:
        """生成卡片唯一键"""
        return f"{comic.comic_source}:{comic.id}"

    def _is_title_expanded(self, comic: ComicInfo) -> bool:
        """标题是否已展开"""
        return self.card_title_expanded.get(self._get_card_key(comic), False)

    def _wrap_text_lines(self, text: str, font_obj: tkfont.Font, max_width: int) -> List[str]:
        """按像素宽度换行"""
        safe_width = max(40, max_width)
        lines: List[str] = []
        current = ""

        for ch in text:
            if ch == "\n":
                lines.append(current)
                current = ""
                continue

            test_line = current + ch
            if current and font_obj.measure(test_line) > safe_width:
                lines.append(current)
                current = ch
            else:
                current = test_line

        lines.append(current)
        return lines or [""]

    def _truncate_text_to_lines(
        self, text: str, font_obj: tkfont.Font, max_width: int, max_lines: int = 3
    ) -> tuple[str, bool]:
        """将文本裁剪到指定行数，必要时添加省略号"""
        lines = self._wrap_text_lines(text, font_obj, max_width)
        if len(lines) <= max_lines:
            return text, False

        clipped = lines[:max_lines]
        last = clipped[-1]
        ellipsis = "..."
        while last and font_obj.measure(last + ellipsis) > max_width:
            last = last[:-1]
        clipped[-1] = (last + ellipsis) if last else ellipsis
        return "\n".join(clipped), True

    @staticmethod
    def _set_text_widget_content(widget: tk.Text, text: str, height: int):
        """更新 Text 内容并保持只读"""
        widget.config(state=tk.NORMAL)
        widget.delete("1.0", tk.END)
        widget.insert("1.0", text)
        widget.config(height=max(1, height))
        try:
            bg = widget.cget("bg")
            widget.config(disabledbackground=bg, disabledforeground=widget.cget("fg"))
        except tk.TclError:
            pass
        widget.config(state=tk.DISABLED)

    def _render_title_widget(self, title_widget: tk.Text, comic: ComicInfo, card_width: int):
        """根据展开状态渲染标题文本"""
        text = comic.title or "未知标题"
        wrap_px = max(140, card_width - 10)
        font_obj = tkfont.Font(font=get_font("normal", bold=True))

        if self._is_title_expanded(comic):
            lines = self._wrap_text_lines(text, font_obj, wrap_px)
            self._set_text_widget_content(title_widget, text, len(lines))
        else:
            clipped, _ = self._truncate_text_to_lines(text, font_obj, wrap_px, max_lines=3)
            self._set_text_widget_content(title_widget, clipped, 3)

    def _on_title_click_press(self, event):
        """记录标题点击起始状态"""
        widget = event.widget
        widget._click_start = (event.x, event.y)
        widget._dragging = False
        widget.focus_set()
        return None

    def _on_title_drag(self, event):
        """标题拖拽选择时打标记"""
        widget = event.widget
        start = getattr(widget, "_click_start", (event.x, event.y))
        if abs(event.x - start[0]) > 3 or abs(event.y - start[1]) > 3:
            widget._dragging = True
        return None

    def _on_title_click_release(self, event, comic: ComicInfo, title_widget: tk.Text, card_width: int):
        """标题点击释放：无拖拽无选区时切换展开"""
        widget = event.widget
        if getattr(widget, "_dragging", False):
            return "break"
        if widget.tag_ranges(tk.SEL):
            return "break"

        key = self._get_card_key(comic)
        self.card_title_expanded[key] = not self.card_title_expanded.get(key, False)
        self._render_title_widget(title_widget, comic, card_width)
        return "break"

    def _copy_selected_text(self, event):
        """复制 Text 当前选区"""
        widget = event.widget
        try:
            selected_text = widget.get(tk.SEL_FIRST, tk.SEL_LAST)
        except tk.TclError:
            return "break"
        self.clipboard_clear()
        self.clipboard_append(selected_text)
        self.update_idletasks()
        return "break"

    @staticmethod
    def _get_frame_background() -> str:
        """获取与卡片一致的背景色"""
        bg = ttk.Style().lookup("TFrame", "background")
        return bg or "#f0f0f0"

    def create_comic_card(self, comic: ComicInfo, row: int, col: int) -> tk.Frame:
        """创建漫画卡片"""
        frame = ttk.Frame(self.scrollable_frame, relief="solid", borderwidth=1, padding="5")
        frame.columnconfigure(0, weight=1)

        # 配置列权重，使卡片可以均匀分布
        for c in range(self.columns):
            self.scrollable_frame.columnconfigure(c, weight=1, uniform="card")

        frame.grid(row=row, column=col, padx=5, pady=5, sticky=(tk.W, tk.E, tk.N, tk.S))

        # 计算卡片宽度（用于标题换行）
        canvas_width = self.canvas.winfo_width()
        if canvas_width > 1:
            card_width = (canvas_width - 20) // self.columns - self.card_padding * 2
        else:
            card_width = 200  # 默认值
        card_inner_width = max(140, card_width - 10)
        card_bg = self._get_frame_background()

        # 封面区域
        if self.show_preview_var.get():
            # 显示预览图模式
            img_label = ttk.Label(frame)
            img_label.grid(row=0, column=0, pady=(0, 5))

            # 异步加载封面（传入卡片宽度）
            if comic.cover_url:
                self._schedule_cover_load(comic.cover_url, img_label, card_width)
        else:
            # 不显示预览图模式 - 显示紧凑的 NSFW 占位符
            placeholder_width = max(12, min(28, int(card_width // 10)))
            placeholder = tk.Label(
                frame,
                text="NSFW",
                bg="#3d3d3d",
                fg="#e5e5e5",
                font=get_font("small", bold=True),
                width=placeholder_width,
                height=2,
                relief="flat",
                bd=0,
                anchor="center",
            )
            placeholder.grid(row=0, column=0, pady=(0, 5))

        # 标题（默认三行，点击展开/收起；支持文本选择复制）
        title_widget = tk.Text(
            frame,
            wrap=tk.WORD,
            height=3,
            bd=0,
            relief="flat",
            font=get_font("normal", bold=True),
            cursor="xterm",
            padx=0,
            pady=0,
            highlightthickness=0,
            bg=card_bg,
            fg="black",
            insertbackground="black",
            width=max(12, int(card_inner_width / max(7, tkfont.Font(font=get_font("normal", bold=True)).measure("测")))),
        )
        title_widget.grid(row=1, column=0, sticky=(tk.W, tk.E))
        self._render_title_widget(title_widget, comic, card_width)

        # 作者（支持文本选择复制）
        author_text = f"作者: {comic.author or '未知'}"
        author_widget = tk.Text(
            frame,
            wrap=tk.WORD,
            height=1,
            bd=0,
            relief="flat",
            font=get_font("small"),
            fg="gray",
            cursor="xterm",
            padx=0,
            pady=0,
            highlightthickness=0,
            bg=card_bg,
            insertbackground="black",
            width=max(12, int(card_inner_width / max(7, tkfont.Font(font=get_font("small")).measure("测")))),
        )
        author_widget.grid(row=2, column=0, sticky=(tk.W, tk.E))
        self._set_text_widget_content(author_widget, author_text, 1)

        # 页数
        pages_text = f"页数: {comic.pages}"
        pages_label = tk.Label(frame, text=pages_text, foreground="gray", font=get_font("small"))
        pages_label.grid(row=3, column=0, sticky=tk.W)

        # 下载按钮
        download_btn = ttk.Button(
            frame, text="下载",
            command=lambda c=comic: self.download_comic(c)
        )
        download_btn.grid(row=4, column=0, pady=(5, 0))

        # 标题点击展开/收起；拖拽可选中文本
        title_widget.bind("<ButtonPress-1>", self._on_title_click_press)
        title_widget.bind("<B1-Motion>", self._on_title_drag)
        title_widget.bind(
            "<ButtonRelease-1>",
            lambda e, c=comic, w=title_widget, cw=card_width: self._on_title_click_release(e, c, w, cw)
        )

        # 文本复制快捷键
        for text_widget in (title_widget, author_widget):
            text_widget.bind("<Command-c>", self._copy_selected_text)
            text_widget.bind("<Control-c>", self._copy_selected_text)

        # 仅在批量模式时允许卡片点选（封面/空白/页数字段可触发）
        clickable_widgets = [frame, pages_label]
        if self.show_preview_var.get() and comic.cover_url:
            clickable_widgets.append(img_label)
        elif not self.show_preview_var.get():
            clickable_widgets.append(placeholder)
        for widget in clickable_widgets:
            widget.bind('<Button-1>', lambda e, c=comic, f=frame: self._on_card_click(e, c, f))

        # 下载按钮点击时阻止事件冒泡到卡片
        download_btn.bind('<Button-1>', lambda e, b=download_btn: b.focus_set())

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
            # 不更新失败文本，因为卡片可能已被销毁
        finally:
            if cache_key:
                with self.cover_loading_lock:
                    self.cover_loading_keys.discard(cache_key)

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
                label.config(image=photo)
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
                    label.config(image=photo)
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

        # 确认下载
        if not messagebox.askyesno("确认下载", f"是否下载:\n{comic.title}\n\n作者: {comic.author or '未知'}\n页数: {comic.pages}"):
            return

        self.is_downloading = True
        self.update_status(f"准备下载: {comic.title}...")
        self.progress_var.set(0)

        # 更新下载器配置
        self.downloader.concurrent_downloads = self.concurrent_var.get()

        def do_download():
            temp_dir = None
            try:
                # 下载图片
                temp_dir = self.downloader.download_comic(
                    comic,
                    self.download_dir_var.get(),
                    progress_callback=self._progress_callback,
                )

                self.after(0, lambda: self.update_status("正在打包 CBZ..."))

                # 打包为 CBZ
                output_path = self.cbz_builder.build_cbz(
                    temp_dir,
                    comic,
                )

                # 清理临时目录
                self.downloader.cleanup_temp_dir(temp_dir)

                self.after(0, lambda: self.download_complete(output_path))

            except Exception as e:
                logger.error(f"Download error: {e}")
                self.after(0, lambda: self.download_error(str(e), temp_dir))

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
