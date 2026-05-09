"""tkinter GUI 界面模块"""
import logging
import os
import platform
import subprocess
import threading
import webbrowser
from queue import Queue, Empty
import tkinter as tk
from tkinter import ttk, messagebox
from typing import Callable, List, Optional, Tuple

from config import Config
from auth_parser import extract_auth_from_curl
from models import ComicInfo, DownloadTask, DownloadStatus
from parser import MultiSourceParser
from downloader import ComicDownloader
from cbz_builder import CBZBuilder
from utils import (
    apply_system_proxy_to_session,
    export_system_proxies_to_env,
    get_system_proxies,
)
from font_config import get_font, FontConfig
from download_manager import ComicDownloadManager
from animation import PanelAnimator
from app_state import AppState
from auth_manager import AuthManager, LoginExpiredDialog
from theme_bridge import ThemeBridge
from scroll_handler import ScrollHandler
from cover_loader import CoverLoader
from search_controller import SearchController
from download_controller import DownloadController
from theme_manager import ThemeManager, ThemeMode
from file_conflict_dialog import show_conflict_dialog
from panels import DownloadPanel, SettingsPanel, StatusBar
from gui_logic import (
    build_batch_summary,
    should_ignore_gui_callback,
    stop_download_manager_for_shutdown,
)
from notifier import SystemNotifier

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
        theme_mode = ThemeMode.AUTO  # 默认值，由 ThemeBridge 管理
        self.theme_manager.set_mode(theme_mode)
        logger.info(f"主题模式: {self.theme_manager.mode.value}, 当前主题: {self.theme_manager.current_theme}")

        # 导出系统代理到环境变量，确保所有请求路径行为一致
        export_system_proxies_to_env()

        # 初始化组件
        # Config.__post_init__ 已校验 default_source 合法性（非法值回退 hcomic）
        self.parser = MultiSourceParser(
            timeout=self.config.timeout,
            default_source=self.config.default_source,
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
        self.download_manager.set_auto_retry_max_attempts(self.config.auto_retry_max_attempts)

        # 应用状态管理
        self.app_state = AppState()

        # 图片缓存与封面加载（由 CoverLoader 管理）
        self.image_cache: dict = {}
        self._resize_after_id = None

        # 预览图设置（运行时开关，不持久化）
        self.show_preview_var = tk.BooleanVar(value=False)

        # 设置面板折叠状态（动画由 PanelAnimator 管理）
        self.settings_expanded: bool = False

        # 动态布局配置
        self.min_card_width = 220  # 卡片最小宽度
        self.card_padding = 10     # 卡片间距
        self.columns = 3           # 当前列数

        # 预创建 CoverLoader（不依赖 canvas，只需 root + session）
        self.cover_loader = CoverLoader(
            root=self,
            session_get_fn=self.parser.session.get,
            get_cover_headers_fn=self._get_cover_request_headers,
            is_scrolling_fn=lambda: getattr(self, 'scroll_handler', None) and self.scroll_handler.is_scrolling,
        )
        self.image_cache = self.cover_loader.image_cache

        # 初始化控制器（通过 callable 延迟获取 widget，可在 create_widgets 前创建）
        self.search_ctrl = SearchController(
            root=self,
            parser=self.parser,
            config=self.config,
            font_config=self.font_config,
            theme_manager=self.theme_manager,
            cover_loader=self.cover_loader,
            app_state=self.app_state,
            get_widgets=self._get_search_widgets,
            get_download_callbacks=self._get_download_callbacks,
            on_status_update=self.update_status,
            on_source_changed_post=self._on_source_changed_post,
            on_card_theme_update=self._update_card_colors,
        )

        # 初始化系统通知模块
        self.notifier = SystemNotifier(self, self.config)

        self.dl_ctrl = DownloadController(
            root=self,
            config=self.config,
            downloader=self.downloader,
            cbz_builder=self.cbz_builder,
            download_manager=self.download_manager,
            theme_manager=self.theme_manager,
            app_state=self.app_state,
            get_settings_vars=self._get_settings_vars,
            on_status_update=self.update_status,
            on_progress_update=lambda v: self.progress_var.set(v),
            on_buttons_restore=lambda: None,
            notifier=self.notifier,
        )
        self.download_manager.set_callbacks(
            on_task_update=self.dl_ctrl.on_download_task_update,
            on_queue_complete=self.dl_ctrl.on_download_queue_complete,
        )
        self.batch_select_mode_var = self.dl_ctrl.batch_select_mode_var

        # 创建界面
        self.create_widgets()

        # 初始化主题桥接器（在 create_widgets 之后）
        self.theme_bridge = ThemeBridge(
            root=self,
            config=self.config,
            theme_manager=self.theme_manager,
            font_config=self.font_config,
            on_theme_change=self._on_theme_change_refresh,
        )

        # 初始化登录管理器（在 create_widgets 之后）
        self.auth_manager = AuthManager(
            root=self,
            config=self.config,
            parser=self.parser,
            downloader=self.downloader,
            login_status_var=self.login_status_var,
            go_login_btn=self.settings_panel.go_login_btn,
            on_status_update=self.update_status,
        )

        # 启动时主动应用一次主题，确保 tk 组件配色正确
        self._on_theme_change_refresh()

        # 同步来源选择器到当前来源
        if hasattr(self, "source_var"):
            self.source_var.set(self.source_key_to_label.get(self.parser.current_source, "h-comic"))

        # 初始化登录状态展示（不自动发起网络校验，避免启动即产生后台请求）
        self.auth_manager.update_login_status()
        self._refresh_proxy_status()

        # 初始化协议状态（仅 Windows）
        if platform.system() == "Windows" and hasattr(self, 'notifier'):
            if self.notifier.is_protocol_registered():
                self.settings_panel.protocol_status_var.set("● 已注册")
            else:
                self.settings_panel.protocol_status_var.set("○ 未注册")

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

    def _get_search_widgets(self) -> dict:
        return {
            "search_btn": self.search_btn,
            "favourites_btn": self.favourites_btn,
            "prev_page_btn": self.dl_ctrl.prev_page_btn,
            "next_page_btn": self.dl_ctrl.next_page_btn,
            "page_label_var": self.dl_ctrl.page_label_var,
        }

    def _get_download_callbacks(self) -> dict:
        return {
            "on_card_click": self.dl_ctrl.on_card_click,
            "download_comic": lambda comic: self.dl_ctrl.download_comic(
                comic, self.search_ctrl.ensure_comics_detail_ready, self.search_btn, self.favourites_btn
            ),
            "update_toolbar_buttons": self.dl_ctrl.update_toolbar_buttons,
            "update_card_visual": self.dl_ctrl.update_card_visual,
        }

    def _get_settings_vars(self) -> dict:
        return {
            "download_dir": self.download_dir_var.get(),
            "download_dir_var": self.download_dir_var,
            "concurrent": self.concurrent_var.get(),
            "batch_delay": self._get_batch_delay_seconds(),
            "download_manager_ui": getattr(self, 'download_manager_ui', None),
            "expand_btn": getattr(self, 'expand_btn', None),
        }

    def _on_source_changed_post(self, source: str):
        self.auth_manager.sync_auth_for_source(source)
        self.auth_manager.update_login_status()
        self._persist_config()

    def _get_current_source(self) -> str:
        if hasattr(self, "source_var"):
            selected = self.source_label_to_key.get(self.source_var.get())
            if selected:
                return selected
        return self.parser.current_source

    def _on_scroll_idle_flush_covers(self):
        self.cover_loader.flush_pending_on_idle()

    def _on_scrollable_frame_configure(self, event):
        if hasattr(self, 'scroll_handler'):
            self.scroll_handler.on_scrollable_frame_configure_event(event)
        else:
            canvas_width = max(1, self.canvas.winfo_width())
            height = max(1, int(getattr(event, "height", 1)))
            self.canvas.configure(scrollregion=(0, 0, canvas_width, height))

    def _on_scrollable_frame_height_change(self, height: int):
        pass

    def destroy(self):
        """销毁窗口前清理资源。"""
        if hasattr(self, 'dl_ctrl'):
            self.dl_ctrl.set_destroying(True)
        if hasattr(self, "auth_manager"):
            self.auth_manager.destroy()
        # 先停止后台 UI 回调，再保存配置
        if hasattr(self, "theme_bridge"):
            self.theme_bridge.destroy()
        if hasattr(self, "scroll_handler"):
            self.scroll_handler.destroy()
        if hasattr(self, "cover_loader"):
            self.cover_loader.clear_pending()
            self.cover_loader.shutdown()

        try:
            self._save_all_settings()
        except Exception as e:
            logger.warning(f"保存设置失败: {e}")

        stop_download_manager_for_shutdown(getattr(self, "download_manager", None))
        super().destroy()

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

        self.search_var = tk.StringVar()
        self.search_entry = ttk.Entry(search_frame, textvariable=self.search_var, font=get_font("normal"))
        self.search_entry.grid(row=0, column=0, sticky=(tk.W, tk.E), padx=(0, 10))
        self.search_entry.bind('<Return>', lambda e: self.search_ctrl.search())

        self.query_mode_var = tk.StringVar(value=self.query_mode_key_to_label["keyword"])
        self.query_mode_combo = ttk.Combobox(
            search_frame,
            textvariable=self.query_mode_var,
            values=[label for _, label in self.QUERY_MODE_OPTIONS],
            state="readonly",
            width=7,
        )
        self.query_mode_combo.grid(row=0, column=1, padx=(0, 8))
        self.query_mode_combo.bind("<<ComboboxSelected>>", lambda _e: self.search_ctrl.refresh_query_context_hint())

        self.source_var = tk.StringVar(value=self.source_key_to_label.get(self.parser.current_source, "h-comic"))
        self.source_combo = ttk.Combobox(
            search_frame,
            textvariable=self.source_var,
            values=[label for _, label in self.source_options],
            state="readonly",
            width=12,
        )
        self.source_combo.grid(row=0, column=2, padx=(0, 8))
        self.source_combo.bind("<<ComboboxSelected>>", self.search_ctrl.on_source_changed)

        self.search_btn = ttk.Button(search_frame, text="搜索", command=self.search_ctrl.search)
        self.search_btn.grid(row=0, column=3)

        self.favourites_btn = ttk.Button(search_frame, text="收藏夹", command=self.search_ctrl.view_favourites)
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

        # ===== 设置栏 =====
        self.settings_panel = SettingsPanel(
            main_frame,
            config=self.config,
            font_config=self.font_config,
            on_config_change=lambda _c: self._save_all_settings(),
            on_font_change=lambda *_args: self._on_font_size_changed(),
            on_preview_change=lambda *_args: self._on_preview_changed(),
            on_theme_change=lambda *_args: self._on_theme_change(None),
            on_notify_change=self._on_notify_changed,
            on_register_protocol=self._on_register_protocol,
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

        self.settings_panel.browse_btn.config(command=self.dl_ctrl.browse_download_dir)
        self.settings_panel.open_dir_btn.config(command=self.dl_ctrl.open_download_dir)
        self.settings_panel.apply_login_btn.config(command=lambda: self.auth_manager.apply_login_from_curl(self.settings_panel.login_curl_text))
        self.settings_panel.refresh_proxy_btn.config(command=lambda: self._refresh_proxy_status(show_message=True))
        self.settings_panel.font_combo.bind("<<ComboboxSelected>>", self._on_font_changed)
        self.batch_delay_spinbox.config(validate="key", validatecommand=(self.register(self._validate_batch_delay), '%P'))

        # 设置面板动画器，默认折叠
        self.update_idletasks()
        settings_target_height = max(self.settings_frame.winfo_reqheight(), 1)
        self._settings_animator = PanelAnimator(
            root=self,
            target=self.settings_container,
            duration_ms=180,
            on_complete=self._on_settings_animation_complete,
        )
        self._settings_animator.set_height_immediate(0)
        self._set_settings_button_text()

        # ===== 搜索结果区域 =====
        results_frame = ttk.LabelFrame(main_frame, text="搜索结果", padding="5", style="Results.TLabelframe")
        results_frame.grid(row=2, column=0, sticky=(tk.W, tk.E, tk.N, tk.S), pady=(0, 10))
        results_frame.columnconfigure(0, weight=1)
        results_frame.rowconfigure(1, weight=1)  # 改为 row=1，因为 row=0 是工具栏

        # 创建批量操作工具栏
        self.batch_toolbar = self.dl_ctrl.create_batch_toolbar(results_frame, self.search_ctrl, get_font)

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

        # 初始化滚动处理器（需要 canvas 和 scrollable_frame）
        self.scroll_handler = ScrollHandler(
            root=self,
            canvas=self.canvas,
            scrollable_frame=self.scrollable_frame,
            on_scroll_idle=self._on_scroll_idle_flush_covers,
            on_scrollable_frame_configure=self._on_scrollable_frame_height_change,
        )
        # 更新 CoverLoader 的滚动检测函数，现在 scroll_handler 已存在
        self.cover_loader._is_scrolling = lambda: self.scroll_handler.is_scrolling

        # ===== 进度区域 =====
        self.status_bar = StatusBar(main_frame, on_toggle_download_panel=lambda: self.dl_ctrl.toggle_download_manager())
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
        self.settings_expanded = expand
        self._set_settings_button_text()

        # 动画前固定 Canvas 高度，防止设置面板高度变化导致 results_frame 级联重排
        if hasattr(self, 'canvas') and self.canvas.winfo_exists():
            self._canvas_fixed_height = self.canvas.winfo_height()
            self.canvas.configure(height=self._canvas_fixed_height)

        if expand:
            self.update_idletasks()
            target_height = max(self.settings_frame.winfo_reqheight(), 1)
            self._settings_animator.expand(target_height)
        else:
            self._settings_animator.collapse()

    def _on_settings_animation_complete(self, final_height: int):
        """设置面板动画完成回调。"""
        # 动画结束后恢复 Canvas 自然高度（height=0 表示由布局管理器决定）
        if hasattr(self, 'canvas') and self.canvas.winfo_exists():
            self.canvas.configure(height=0)
        if final_height == 0:
            self.settings_expanded = False
            self._set_settings_button_text()

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
        if hasattr(self, 'search_ctrl'):
            self.search_ctrl.on_window_resize(event)

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
        self._persist_config()

    def _on_font_size_changed(self):
        """字体大小变化事件"""
        self.config.font_size = self.font_size_var.get()
        # 重新创建字体配置
        self.font_config = FontConfig(self.config)
        logger.info(f"字体大小已更改为: {self.config.font_size}")

        # 保存配置
        self._persist_config()

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
            if hasattr(self, 'theme_bridge'):
                self.config.theme_mode = self.theme_bridge.display_to_theme_mode(self.theme_mode_var.get())
            self.config.default_source = self._get_current_source()

            # 保存到文件
            self._persist_config()

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
        if self.app_state.search.results:
            self.search_ctrl._refresh_results_layout()

    def _on_theme_change_refresh(self):
        """主题变化时刷新界面"""
        # 更新 ttk 样式
        if hasattr(self, 'theme_bridge'):
            self.theme_bridge.configure_ttk_styles()
        bg_color = self.theme_manager.get_color("background")

        # 更新 canvas 背景色
        if hasattr(self, 'canvas'):
            self.canvas.config(bg=bg_color)

        # 更新卡片颜色
        for frame in self.app_state.search.result_frames:
            self.search_ctrl.update_card_colors(frame)
            comic = getattr(frame, "comic_ref", None)
            if comic in self.app_state.download.selected_comics:
                self.dl_ctrl.update_card_visual(frame, True)

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
        """更新卡片主题相关颜色（委托给 theme_bridge）。"""
        if hasattr(self, "theme_bridge"):
            self.theme_bridge.apply_theme_to_card_frame(frame)

    def _get_config_path(self) -> str:
        """获取配置文件路径"""
        config_dir = os.path.join(os.path.expanduser("~"), ".hcomic_downloader")
        return os.path.join(config_dir, "config.json")

    def _persist_config(self):
        """保存配置到文件（统一入口）。"""
        try:
            self.config.save(self._get_config_path())
        except Exception as e:
            logger.error("保存配置失败: %s", e)

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

    def _on_notify_changed(self, enabled: bool):
        """通知开关变化事件"""
        if enabled and hasattr(self, 'notifier'):
            # macOS: 请求通知权限
            self.notifier.request_permission()
        logger.info(f"系统通知已{'启用' if enabled else '禁用'}")

    def _on_register_protocol(self):
        """注册协议按钮点击事件"""
        if not hasattr(self, 'notifier'):
            return

        success, message = self.notifier.register_protocol()
        if success:
            self.settings_panel.protocol_status_var.set("● 已注册")
            messagebox.showinfo("注册成功", message)
        else:
            self.settings_panel.protocol_status_var.set("○ 未注册")
            messagebox.showerror("注册失败", message)

    def _get_cover_request_headers(self) -> dict:
        """构建封面请求头，复用当前会话认证。"""
        headers = dict(self.parser.session.headers)
        headers["Accept"] = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
        return headers

    def update_status(self, message: str):
        """更新状态信息"""
        self.status_var.set(message)
        self.update_idletasks()

    def _schedule_cover_load(self, url: str, label: ttk.Label, card_width: int = 200):
        self.cover_loader.schedule_cover_load(url, label, card_width)

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
