"""下载管理器 UI 组件"""
import logging
import tkinter as tk
from tkinter import ttk
from enum import Enum
from typing import Optional, Callable, Dict

from models import DownloadTask, DownloadStatus
from download_manager import DownloadManager

logger = logging.getLogger(__name__)


class ViewMode(Enum):
    """视图模式"""
    COMPACT = "compact"
    DETAIL = "detail"


class DownloadManagerUI:
    """下载管理器 UI 面板"""

    # 动画配置
    ANIM_DURATION_MS = 250
    ANIM_INTERVAL_MS = 16  # ~60fps
    EXPANDED_HEIGHT = 400
    COLLAPSED_HEIGHT = 0

    def __init__(self, parent: tk.Widget, download_manager: DownloadManager):
        self.parent = parent
        self.dm = download_manager

        # 状态
        self.is_expanded = False
        self.view_mode = ViewMode.COMPACT
        self._current_height = 0

        # 动画状态
        self._anim_after_id = None
        self._anim_step = 0
        self._anim_total_steps = 0
        self._anim_start_height = 0
        self._anim_end_height = 0

        # UI 组件存储
        self._task_widgets: Dict[str, 'DownloadItemWidget'] = {}

        # 创建 UI
        self._create_panel()
        self._create_header()
        self._create_list_container()

    def _create_panel(self):
        """创建主面板（可动画容器）"""
        self.panel = tk.Frame(self.parent, bg="#f0f0f0", relief="solid", bd=1)
        self.panel.grid(row=2, column=0, sticky="nsew")
        self.panel.grid_remove()  # 初始隐藏

    def _create_header(self):
        """创建头部"""
        self.header = ttk.Frame(self.panel)
        self.header.pack(fill="x", padx=10, pady=5)

        # 统计标签
        self.stats_label = ttk.Label(self.header, text="下载队列 (0本)")
        self.stats_label.pack(side="left")

        # 控制按钮区
        controls = ttk.Frame(self.header)
        controls.pack(side="right")

        # 视图切换
        self.view_toggle_btn = ttk.Button(
            controls,
            text="简洁 ▼",
            command=self._toggle_view_mode,
            width=8
        )
        self.view_toggle_btn.pack(side="left", padx=2)

        # 全部暂停/继续
        self.global_pause_btn = ttk.Button(
            controls,
            text="⏸ 全部暂停",
            command=self._toggle_global_pause
        )
        self.global_pause_btn.pack(side="left", padx=2)

        # 关闭按钮
        ttk.Button(
            controls,
            text="✕",
            width=3,
            command=self.toggle
        ).pack(side="left", padx=2)

    def _create_list_container(self):
        """创建列表容器"""
        # 使用 Canvas + Frame 实现滚动
        self.list_canvas = tk.Canvas(self.panel, highlightthickness=0, bg="#f0f0f0")
        self.list_canvas.pack(side="left", fill="both", expand=True, padx=10, pady=5)

        self.scrollbar = ttk.Scrollbar(
            self.panel,
            orient="vertical",
            command=self.list_canvas.yview
        )
        self.scrollbar.pack(side="right", fill="y")

        self.list_canvas.configure(yscrollcommand=self.scrollbar.set)

        # 任务列表 Frame
        self.list_frame = ttk.Frame(self.list_canvas)
        self._list_window = self.list_canvas.create_window(
            (0, 0),
            window=self.list_frame,
            anchor="nw",
            width=self.list_canvas.winfo_width()
        )

        # 绑定事件
        self.list_frame.bind("<Configure>", self._on_frame_configure)
        self.list_canvas.bind("<Configure>", self._on_canvas_configure)

    def _on_frame_configure(self, event=None):
        """列表内容变化时更新滚动区域"""
        self.list_canvas.configure(scrollregion=self.list_canvas.bbox("all"))

    def _on_canvas_configure(self, event):
        """Canvas 大小变化时更新内部 Frame 宽度"""
        self.list_canvas.itemconfig(self._list_window, width=event.width)

    def toggle(self):
        """切换展开/折叠"""
        self._animate(not self.is_expanded)

    def _animate(self, expand: bool):
        """执行高度动画"""
        if self._anim_after_id:
            self.panel.after_cancel(self._anim_after_id)
            self._anim_after_id = None

        self.is_expanded = expand

        if expand:
            self.panel.grid()
            self._current_height = 1  # 避免除零

        self._anim_start_height = self._current_height
        self._anim_end_height = self.EXPANDED_HEIGHT if expand else 0
        self._anim_step = 0
        self._anim_total_steps = max(
            1,
            self.ANIM_DURATION_MS // self.ANIM_INTERVAL_MS
        )

        self._run_animation_step()

    def _run_animation_step(self):
        """执行动画单帧"""
        progress = min(1.0, (self._anim_step + 1) / self._anim_total_steps)
        # ease-out cubic
        eased = 1 - (1 - progress) ** 3

        new_height = int(
            self._anim_start_height +
            (self._anim_end_height - self._anim_start_height) * eased
        )
        self._current_height = new_height
        self.panel.configure(height=new_height)

        if self._anim_step + 1 < self._anim_total_steps:
            self._anim_step += 1
            self._anim_after_id = self.panel.after(
                self.ANIM_INTERVAL_MS,
                self._run_animation_step
            )
        else:
            # 动画结束
            self._current_height = self._anim_end_height
            self.panel.configure(height=self._current_height)
            if not self.is_expanded:
                self.panel.grid_remove()
            self._anim_after_id = None

    def _toggle_view_mode(self):
        """切换视图模式"""
        self.view_mode = (
            ViewMode.DETAIL if self.view_mode == ViewMode.COMPACT
            else ViewMode.COMPACT
        )
        self.view_toggle_btn.config(
            text="详细 ▼" if self.view_mode == ViewMode.DETAIL else "简洁 ▼"
        )
        self._refresh_task_list()

    def _toggle_global_pause(self):
        """切换全局暂停"""
        is_paused = self.dm.toggle_global_pause()
        self.global_pause_btn.config(
            text="▶ 全部继续" if is_paused else "⏸ 全部暂停"
        )

    def _refresh_task_list(self):
        """刷新任务列表（占位）"""
        pass

    def update_stats(self):
        """更新统计信息"""
        stats = self.dm.get_stats()
        total = stats["total"]
        downloading = stats["downloading"]

        self.stats_label.config(text=f"下载队列 ({total}本)")
