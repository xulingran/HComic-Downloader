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

    def refresh_task_list(self):
        """刷新任务列表"""
        # 清理旧组件
        for widget in self._task_widgets.values():
            widget.frame.destroy()
        self._task_widgets.clear()

        # 按队列顺序创建新组件
        for task_id in self.dm.queue:
            task = self.dm.tasks.get(task_id)
            if not task:
                continue

            widget = DownloadItemWidget(
                self.list_frame,
                task,
                self.view_mode,
                on_play=lambda tid=task_id: self._on_task_play(tid),
                on_pause=lambda tid=task_id: self._on_task_pause(tid),
                on_cancel=lambda tid=task_id: self._on_task_cancel(tid),
            )
            widget.frame.pack(fill="x", pady=2)
            self._task_widgets[task_id] = widget

        # 更新统计
        self.update_stats()

    def update_task(self, task: DownloadTask):
        """更新单个任务 UI"""
        task_id = task.task_id

        # 如果组件不存在，刷新整个列表
        if task_id not in self._task_widgets:
            self.refresh_task_list()
            return

        # 更新现有组件
        widget = self._task_widgets[task_id]
        widget.update(task)

        # 如果任务完成/取消/失败，延迟刷新列表
        if task.status in (DownloadStatus.COMPLETED, DownloadStatus.CANCELLED, DownloadStatus.FAILED):
            self.panel.after(1000, self.refresh_task_list)

    def _on_task_play(self, task_id: str):
        """播放按钮点击"""
        self.dm.resume_task(task_id)

    def _on_task_pause(self, task_id: str):
        """暂停按钮点击"""
        self.dm.pause_task(task_id)

    def _on_task_cancel(self, task_id: str):
        """取消按钮点击"""
        self.dm.cancel_task(task_id)
        self.refresh_task_list()

    def _refresh_task_list(self):
        """内部刷新方法（别名）"""
        self.refresh_task_list()


class DownloadItemWidget:
    """单个下载任务的 UI 表示"""

    # 高度配置
    COMPACT_HEIGHT = 50
    DETAIL_HEIGHT = 90
    THUMB_SIZE_COMPACT = 40
    THUMB_SIZE_DETAIL = 70

    # 状态图标映射
    STATUS_ICONS = {
        DownloadStatus.QUEUED: "⏳",
        DownloadStatus.DOWNLOADING: "⬇",
        DownloadStatus.PAUSED: "⏸",
        DownloadStatus.COMPLETED: "✓",
        DownloadStatus.FAILED: "✗",
        DownloadStatus.CANCELLED: "⏹",
    }

    def __init__(
        self,
        parent: tk.Widget,
        task: DownloadTask,
        view_mode: ViewMode,
        on_play: Optional[Callable[[], None]] = None,
        on_pause: Optional[Callable[[], None]] = None,
        on_cancel: Optional[Callable[[], None]] = None,
    ):
        self.task = task
        self.view_mode = view_mode
        self.on_play = on_play
        self.on_pause = on_pause
        self.on_cancel = on_cancel

        # 创建 Frame
        self.frame = ttk.Frame(parent, relief="groove", borderwidth=1)

        # 缩略图（使用标签占位）
        self.thumb_label = ttk.Label(
            self.frame,
            text="📷",
            font=("TkDefaultFont", 20),
            width=3,
            anchor="center"
        )
        self.thumb_label.pack(side="left", padx=5, pady=5)

        # 信息区
        self.info_frame = ttk.Frame(self.frame)
        self.info_frame.pack(side="left", fill="both", expand=True, padx=5, pady=5)

        # 标题行
        title_row = ttk.Frame(self.info_frame)
        title_row.pack(fill="x")

        self.status_icon = ttk.Label(title_row, text=self.STATUS_ICONS.get(task.status, "?"))
        self.status_icon.pack(side="left", padx=(0, 5))

        self.title_label = ttk.Label(
            title_row,
            text=task.comic.title,
            font=("TkDefaultFont", 10, "bold")
        )
        self.title_label.pack(side="left")

        # 进度区
        self.progress_frame = ttk.Frame(self.info_frame)
        self.progress_frame.pack(fill="x", pady=(3, 0))

        self.progress_bar = ttk.Progressbar(
            self.progress_frame,
            mode="determinate",
            maximum=100
        )
        self.progress_bar.pack(side="left", fill="x", expand=True)

        self.progress_label = ttk.Label(self.progress_frame, text="0%", width=4)
        self.progress_label.pack(side="left", padx=(5, 0))

        # 控制按钮
        self.controls_frame = ttk.Frame(self.frame)
        self.controls_frame.pack(side="right", padx=5, pady=5)

        self.play_btn = ttk.Button(
            self.controls_frame,
            text="▶",
            width=3,
            command=self._on_play_clicked
        )
        self.play_btn.pack(side="left", padx=1)

        self.pause_btn = ttk.Button(
            self.controls_frame,
            text="⏸",
            width=3,
            command=self._on_pause_clicked
        )
        self.pause_btn.pack(side="left", padx=1)

        self.cancel_btn = ttk.Button(
            self.controls_frame,
            text="✕",
            width=3,
            command=self._on_cancel_clicked
        )
        self.cancel_btn.pack(side="left", padx=1)

        # 初始更新
        self.update(task)

    def _on_play_clicked(self):
        if self.on_play:
            self.on_play()

    def _on_pause_clicked(self):
        if self.on_pause:
            self.on_pause()

    def _on_cancel_clicked(self):
        if self.on_cancel:
            self.on_cancel()

    def update(self, task: DownloadTask):
        """更新 UI 状态"""
        self.task = task

        # 更新进度
        pct = task.progress_percentage
        self.progress_bar["value"] = pct
        self.progress_label.config(text=f"{pct:.0f}%")

        # 更新状态图标
        icon = self.STATUS_ICONS.get(task.status, "?")
        self.status_icon.config(text=icon)

        # 更新按钮状态
        self._update_buttons()

        # 根据状态调整颜色
        if task.status == DownloadStatus.FAILED:
            self.title_label.config(foreground="red")
        elif task.status == DownloadStatus.COMPLETED:
            self.title_label.config(foreground="green")
        else:
            self.title_label.config(foreground="black")

    def _update_buttons(self):
        """根据状态更新按钮"""
        status = self.task.status

        # 播放按钮：仅在暂停时可用
        play_state = "normal" if status == DownloadStatus.PAUSED else "disabled"
        self.play_btn.config(state=play_state)

        # 暂停按钮：仅在下载中时可用
        pause_state = "normal" if status == DownloadStatus.DOWNLOADING else "disabled"
        self.pause_btn.config(state=pause_state)

        # 取消按钮：已完成/已取消时禁用
        cancel_disabled = status in (DownloadStatus.COMPLETED, DownloadStatus.CANCELLED)
        self.cancel_btn.config(state="disabled" if cancel_disabled else "normal")

    def set_view_mode(self, view_mode: ViewMode):
        """切换视图模式"""
        self.view_mode = view_mode

        if view_mode == ViewMode.COMPACT:
            self.thumb_label.config(width=3, font=("TkDefaultFont", 16))
            self.frame.configure(height=self.COMPACT_HEIGHT)
        else:
            self.thumb_label.config(width=5, font=("TkDefaultFont", 24))
            self.frame.configure(height=self.DETAIL_HEIGHT)
