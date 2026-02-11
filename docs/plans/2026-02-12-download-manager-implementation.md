# 下载管理器功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 添加可展开/折叠的下载管理器面板，支持查看和管理下载队列，包括暂停/继续/取消功能。

**Architecture:** 采用生产者-消费者模式管理下载队列，DownloadManager 核心类负责状态管理和后台处理，DownloadManagerUI 负责界面渲染和动画，与现有 GUI 通过回调集成。

**Tech Stack:** Python 3.12, tkinter, threading, dataclasses

---

## 前置准备

### 前置任务 1: 创建独立工作区

**使用 skill:** @superpowers:using-git-worktrees

**命令:**
```bash
# 创建 feature/download-manager 分支和工作区
git checkout -b feature/download-manager
git worktree add ../hcomic_downloader-download-manager feature/download-manager
cd ../hcomic_downloader-download-manager
```

---

## Task 1: 添加数据模型 (DownloadTask, DownloadStatus)

**Files:**
- Modify: `models.py:1-102`
- Test: `tests/test_download_manager.py` (新建)

**Step 1: 编写模型测试**

```python
# tests/test_download_manager.py
import pytest
from models import DownloadTask, DownloadStatus, ComicInfo


def test_download_status_enum():
    """测试下载状态枚举"""
    assert DownloadStatus.QUEUED.value == "queued"
    assert DownloadStatus.DOWNLOADING.value == "downloading"
    assert DownloadStatus.PAUSED.value == "paused"
    assert DownloadStatus.COMPLETED.value == "completed"
    assert DownloadStatus.FAILED.value == "failed"
    assert DownloadStatus.CANCELLED.value == "cancelled"


def test_download_task_creation():
    """测试创建下载任务"""
    comic = ComicInfo(
        id="123",
        title="Test Comic",
        pages=10,
        media_id="abc123"
    )
    task = DownloadTask(comic=comic, status=DownloadStatus.QUEUED)

    assert task.comic == comic
    assert task.status == DownloadStatus.QUEUED
    assert task.progress_current == 0
    assert task.progress_total == 0
    assert task.temp_dir is None
    assert task.error_message is None
    assert task.started_at is None


def test_download_task_progress_update():
    """测试更新进度"""
    comic = ComicInfo(id="123", title="Test")
    task = DownloadTask(comic=comic, status=DownloadStatus.DOWNLOADING)

    task.progress_current = 5
    task.progress_total = 10

    assert task.progress_current == 5
    assert task.progress_total == 10
```

**Step 2: 运行测试验证失败**

```bash
python -m pytest tests/test_download_manager.py -v
```

Expected: `ImportError: cannot import name 'DownloadTask'`

**Step 3: 在 models.py 添加模型代码**

```python
# models.py - 在文件末尾添加
from enum import Enum
from dataclasses import dataclass, field
import time


class DownloadStatus(Enum):
    """下载任务状态"""
    QUEUED = "queued"           # 等待中
    DOWNLOADING = "downloading" # 下载中
    PAUSED = "paused"           # 已暂停
    COMPLETED = "completed"     # 已完成
    FAILED = "failed"          # 失败
    CANCELLED = "cancelled"    # 已取消


@dataclass
class DownloadTask:
    """单个漫画的下载任务

    Attributes:
        comic: 漫画信息
        status: 当前状态
        progress_current: 当前已下载页数
        progress_total: 总页数
        temp_dir: 临时目录路径
        error_message: 错误信息
        created_at: 创建时间戳
        started_at: 开始下载时间戳
        _pause_requested: 暂停请求标志（内部使用）
        _cancel_requested: 取消请求标志（内部使用）
    """
    comic: ComicInfo
    status: DownloadStatus
    progress_current: int = 0
    progress_total: int = 0
    temp_dir: Optional[str] = None
    error_message: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    _pause_requested: bool = False
    _cancel_requested: bool = False

    @property
    def task_id(self) -> str:
        """生成唯一任务 ID"""
        return f"{self.comic.comic_source}_{self.comic.id}"

    @property
    def progress_percentage(self) -> float:
        """获取进度百分比"""
        if self.progress_total == 0:
            return 0.0
        return (self.progress_current / self.progress_total) * 100
```

**Step 4: 运行测试验证通过**

```bash
python -m pytest tests/test_download_manager.py -v
```

Expected: `3 passed`

**Step 5: 提交**

```bash
git add models.py tests/test_download_manager.py
git commit -m "feat: add DownloadTask and DownloadStatus models"
```

---

## Task 2: 创建 DownloadManager 核心类（骨架）

**Files:**
- Create: `download_manager.py`
- Test: `tests/test_download_manager.py`

**Step 1: 编写骨架测试**

```python
# tests/test_download_manager.py - 添加测试
import threading
from download_manager import DownloadManager


def test_download_manager_init():
    """测试 DownloadManager 初始化"""
    dm = DownloadManager()

    assert dm.tasks == {}
    assert dm.queue == []
    assert dm.is_running is False
    assert dm.global_pause is False
    assert dm.current_task_id is None
    assert isinstance(dm._lock, threading.Lock)
    assert isinstance(dm._stop_event, threading.Event)


def test_add_single_task():
    """测试添加单个任务"""
    dm = DownloadManager()
    comic = ComicInfo(id="123", title="Test Comic", pages=10)

    dm.add_task(comic)

    assert len(dm.tasks) == 1
    assert len(dm.queue) == 1
    task_id = dm.queue[0]
    assert task_id in dm.tasks
    assert dm.tasks[task_id].status == DownloadStatus.QUEUED


def test_add_multiple_tasks():
    """测试添加多个任务"""
    dm = DownloadManager()
    comics = [
        ComicInfo(id="1", title="Comic 1", pages=10),
        ComicInfo(id="2", title="Comic 2", pages=20),
    ]

    dm.add_tasks(comics)

    assert len(dm.tasks) == 2
    assert len(dm.queue) == 2
```

**Step 2: 运行测试验证失败**

```bash
python -m pytest tests/test_download_manager.py::test_download_manager_init -v
```

Expected: `ModuleNotFoundError: No module named 'download_manager'`

**Step 3: 创建 DownloadManager 骨架**

```python
# download_manager.py
"""下载管理器核心模块"""
import logging
import threading
import time
from typing import Dict, List, Optional, Callable

from models import ComicInfo, DownloadTask, DownloadStatus

logger = logging.getLogger(__name__)


class DownloadManager:
    """下载管理器 - 管理下载队列和任务状态"""

    def __init__(self):
        # 任务存储
        self.tasks: Dict[str, DownloadTask] = {}
        self.queue: List[str] = []

        # 状态标志
        self.is_running: bool = False
        self.global_pause: bool = False
        self.current_task_id: Optional[str] = None

        # 线程同步
        self._lock = threading.Lock()
        self._stop_event = threading.Event()

        # 回调
        self._on_task_update: Optional[Callable[[DownloadTask], None]] = None
        self._on_queue_complete: Optional[Callable[[], None]] = None

    def add_task(self, comic: ComicInfo) -> str:
        """添加单个任务到队列"""
        task = DownloadTask(comic=comic, status=DownloadStatus.QUEUED)
        task_id = task.task_id

        with self._lock:
            self.tasks[task_id] = task
            self.queue.append(task_id)

        logger.info(f"Added task {task_id}: {comic.title}")
        return task_id

    def add_tasks(self, comics: List[ComicInfo]) -> List[str]:
        """添加多个任务到队列"""
        task_ids = []
        for comic in comics:
            task_id = self.add_task(comic)
            task_ids.append(task_id)
        return task_ids

    def set_callbacks(
        self,
        on_task_update: Optional[Callable[[DownloadTask], None]] = None,
        on_queue_complete: Optional[Callable[[], None]] = None,
    ):
        """设置状态更新回调"""
        self._on_task_update = on_task_update
        self._on_queue_complete = on_queue_complete
```

**Step 4: 运行测试验证通过**

```bash
python -m pytest tests/test_download_manager.py::test_download_manager_init tests/test_download_manager.py::test_add_single_task tests/test_download_manager.py::test_add_multiple_tasks -v
```

Expected: `3 passed`

**Step 5: 提交**

```bash
git add download_manager.py tests/test_download_manager.py
git commit -m "feat: add DownloadManager skeleton with task management"
```

---

## Task 3: 实现队列处理器和状态控制

**Files:**
- Modify: `download_manager.py`
- Test: `tests/test_download_manager.py`

**Step 3.1: 添加队列处理逻辑**

在 `download_manager.py` 的 `DownloadManager` 类中添加：

```python
    def start(self):
        """启动队列处理器（如果未运行）"""
        if self.is_running:
            return

        self._stop_event.clear()
        self.is_running = True

        threading.Thread(target=self._process_queue, daemon=True).start()
        logger.info("Download manager started")

    def stop(self):
        """停止队列处理器"""
        self._stop_event.set()
        logger.info("Download manager stop requested")

    def _process_queue(self):
        """队列处理主循环（在后台线程运行）"""
        logger.info("Queue processor started")

        while not self._stop_event.is_set():
            # 检查全局暂停
            if self.global_pause:
                time.sleep(0.1)
                continue

            # 获取下一个任务
            task_id = self._get_next_task()
            if not task_id:
                break

            self._process_task(task_id)

        self.is_running = False
        logger.info("Queue processor stopped")

        if self._on_queue_complete:
            self._on_queue_complete()

    def _get_next_task(self) -> Optional[str]:
        """获取下一个可处理的任务"""
        with self._lock:
            while self.queue:
                task_id = self.queue[0]
                task = self.tasks.get(task_id)

                if not task:
                    self.queue.pop(0)
                    continue

                # 跳过暂停的任务，轮转到队列尾部
                if task.status == DownloadStatus.PAUSED:
                    self.queue.append(self.queue.pop(0))
                    continue

                return task_id

            return None

    def _process_task(self, task_id: str):
        """处理单个任务（子类可覆盖）"""
        task = self.tasks.get(task_id)
        if not task or task.status != DownloadStatus.QUEUED:
            return

        self.current_task_id = task_id
        task.status = DownloadStatus.DOWNLOADING
        task.started_at = time.time()
        self._notify_task_update(task)

        # 实际下载逻辑由子类或回调实现
        # 这里仅模拟状态流转
        logger.info(f"Processing task {task_id}: {task.comic.title}")

    def _notify_task_update(self, task: DownloadTask):
        """通知任务更新"""
        if self._on_task_update:
            self._on_task_update(task)
```

**Step 3.2: 添加暂停/继续/取消方法**

```python
    def pause_task(self, task_id: str) -> bool:
        """暂停指定任务"""
        with self._lock:
            task = self.tasks.get(task_id)
            if not task:
                return False

            if task.status == DownloadStatus.DOWNLOADING:
                task._pause_requested = True
                task.status = DownloadStatus.PAUSED
                self._notify_task_update(task)
                logger.info(f"Task {task_id} paused")
                return True
            elif task.status == DownloadStatus.QUEUED:
                task.status = DownloadStatus.PAUSED
                self._notify_task_update(task)
                return True

        return False

    def resume_task(self, task_id: str) -> bool:
        """继续指定任务"""
        with self._lock:
            task = self.tasks.get(task_id)
            if not task or task.status != DownloadStatus.PAUSED:
                return False

            task._pause_requested = False
            task.status = DownloadStatus.QUEUED
            self._notify_task_update(task)
            logger.info(f"Task {task_id} resumed")

            # 如果处理器未运行，启动它
            if not self.is_running:
                self.start()

            return True

    def cancel_task(self, task_id: str) -> bool:
        """取消指定任务"""
        with self._lock:
            task = self.tasks.get(task_id)
            if not task:
                return False

            if task.status == DownloadStatus.DOWNLOADING:
                task._cancel_requested = True

            task.status = DownloadStatus.CANCELLED

            # 从队列移除
            if task_id in self.queue:
                self.queue.remove(task_id)

            self._notify_task_update(task)
            logger.info(f"Task {task_id} cancelled")
            return True

    def toggle_global_pause(self) -> bool:
        """切换全局暂停状态"""
        self.global_pause = not self.global_pause
        logger.info(f"Global pause: {self.global_pause}")
        return self.global_pause

    def get_stats(self) -> dict:
        """获取队列统计信息"""
        with self._lock:
            stats = {
                "total": len(self.tasks),
                "queued": sum(1 for t in self.tasks.values() if t.status == DownloadStatus.QUEUED),
                "downloading": sum(1 for t in self.tasks.values() if t.status == DownloadStatus.DOWNLOADING),
                "paused": sum(1 for t in self.tasks.values() if t.status == DownloadStatus.PAUSED),
                "completed": sum(1 for t in self.tasks.values() if t.status == DownloadStatus.COMPLETED),
                "failed": sum(1 for t in self.tasks.values() if t.status == DownloadStatus.FAILED),
                "cancelled": sum(1 for t in self.tasks.values() if t.status == DownloadStatus.CANCELLED),
            }
            return stats
```

**Step 3.3: 测试状态控制**

```python
# tests/test_download_manager.py - 添加测试

def test_pause_resume_task():
    """测试暂停和继续任务"""
    dm = DownloadManager()
    comic = ComicInfo(id="123", title="Test", pages=10)
    task_id = dm.add_task(comic)

    # 模拟任务开始
    dm.tasks[task_id].status = DownloadStatus.DOWNLOADING

    # 暂停
    assert dm.pause_task(task_id) is True
    assert dm.tasks[task_id].status == DownloadStatus.PAUSED
    assert dm.tasks[task_id]._pause_requested is True

    # 继续
    assert dm.resume_task(task_id) is True
    assert dm.tasks[task_id].status == DownloadStatus.QUEUED
    assert dm.tasks[task_id]._pause_requested is False


def test_cancel_task():
    """测试取消任务"""
    dm = DownloadManager()
    comic = ComicInfo(id="123", title="Test", pages=10)
    task_id = dm.add_task(comic)

    assert dm.cancel_task(task_id) is True
    assert dm.tasks[task_id].status == DownloadStatus.CANCELLED
    assert task_id not in dm.queue


def test_get_stats():
    """测试统计信息"""
    dm = DownloadManager()
    comics = [
        ComicInfo(id="1", title="C1", pages=10),
        ComicInfo(id="2", title="C2", pages=10),
        ComicInfo(id="3", title="C3", pages=10),
    ]
    dm.add_tasks(comics)

    # 修改状态
    dm.tasks["_1"].status = DownloadStatus.DOWNLOADING
    dm.tasks["_2"].status = DownloadStatus.PAUSED
    dm.tasks["_3"].status = DownloadStatus.COMPLETED

    stats = dm.get_stats()

    assert stats["total"] == 3
    assert stats["downloading"] == 1
    assert stats["paused"] == 1
    assert stats["completed"] == 1
```

**Step 3.4: 运行测试**

```bash
python -m pytest tests/test_download_manager.py -v
```

Expected: `9 passed`

**Step 3.5: 提交**

```bash
git add download_manager.py tests/test_download_manager.py
git commit -m "feat: implement queue processor and state controls"
```

---

## Task 4: 创建 DownloadManagerUI 面板骨架

**Files:**
- Create: `download_manager_ui.py`
- Test: 手动测试（GUI 组件）

**Step 4.1: 创建 UI 骨架**

```python
# download_manager_ui.py
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
```

**Step 4.2: 简单测试运行**

```bash
python -c "
import tkinter as tk
from tkinter import ttk
from download_manager import DownloadManager
from download_manager_ui import DownloadManagerUI

root = tk.Tk()
root.geometry('800x600')

# 创建主布局
main_frame = ttk.Frame(root)
main_frame.pack(fill='both', expand=True)

# 创建下载管理器
dm = DownloadManager()
dm_ui = DownloadManagerUI(main_frame, dm)

# 添加一些测试任务
from models import ComicInfo
dm.add_tasks([
    ComicInfo(id='1', title='测试漫画1', pages=10),
    ComicInfo(id='2', title='测试漫画2', pages=20),
])

# 展开按钮
btn = ttk.Button(main_frame, text='展开/折叠', command=dm_ui.toggle)
btn.pack(side='bottom', pady=10)

root.mainloop()
"
```

Expected: 窗口显示，点击按钮面板展开/折叠带动画。

**Step 4.3: 提交**

```bash
git add download_manager_ui.py
git commit -m "feat: add DownloadManagerUI panel with animation"
```

---

## Task 5: 创建 DownloadItemWidget 任务项组件

**Files:**
- Modify: `download_manager_ui.py`
- Test: 手动测试

**Step 5.1: 添加 DownloadItemWidget 类**

```python
# download_manager_ui.py - 在文件末尾添加

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

        # 缩略图（使用标签占位，实际图片异步加载）
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
            font=("TkDefaultFont", 10, "bold"),
            truncate=True
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

        # 根据状态调整颜色（可选）
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
```

**Step 5.2: 在 DownloadManagerUI 中集成任务项**

在 `DownloadManagerUI` 类中添加：

```python
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

        # 如果任务完成/取消/失败，可能需要重排
        if task.status in (DownloadStatus.COMPLETED, DownloadStatus.CANCELLED, DownloadStatus.FAILED):
            # 延迟刷新，让用户看到最终状态
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
```

**Step 5.3: 测试任务项组件**

```bash
python -c "
import tkinter as tk
from tkinter import ttk
from models import ComicInfo, DownloadTask, DownloadStatus
from download_manager_ui import DownloadItemWidget, ViewMode

root = tk.Tk()
root.geometry('600x200')

comic = ComicInfo(id='1', title='测试漫画', pages=10)
task = DownloadTask(comic=comic, status=DownloadStatus.DOWNLOADING)
task.progress_current = 5
task.progress_total = 10

widget = DownloadItemWidget(root, task, ViewMode.COMPACT)
widget.frame.pack(fill='x', padx=10, pady=10)

# 模拟状态变化
def toggle_status():
    if task.status == DownloadStatus.DOWNLOADING:
        task.status = DownloadStatus.PAUSED
    elif task.status == DownloadStatus.PAUSED:
        task.status = DownloadStatus.DOWNLOADING
    else:
        task.status = DownloadStatus.COMPLETED
    widget.update(task)

btn = ttk.Button(root, text='切换状态', command=toggle_status)
btn.pack(pady=10)

root.mainloop()
"
```

Expected: 窗口显示任务项，有进度条和控制按钮，点击"切换状态"按钮状态变化。

**Step 5.4: 提交**

```bash
git add download_manager_ui.py
git commit -m "feat: add DownloadItemWidget with progress and controls"
```

---

## Task 6: 集成到 GUI（修改 gui.py）

**Files:**
- Modify: `gui.py:1-100` (添加导入)
- Modify: `gui.py:60-70` (初始化 DownloadManager)
- Modify: `gui.py:310-325` (修改进度条区域)
- Test: 手动测试

**Step 6.1: 添加导入和初始化**

```python
# gui.py - 在现有导入后添加
from download_manager import DownloadManager
from download_manager_ui import DownloadManagerUI
```

**Step 6.2: 在 __init__ 中初始化 DownloadManager**

在 `HComicDownloaderGUI.__init__` 的下载器初始化之后添加：

```python
# gui.py - 在 __init__ 中，约 line 67 后

# 下载管理器
self.download_manager = DownloadManager()
self.download_manager.set_callbacks(
    on_task_update=self._on_download_task_update,
    on_queue_complete=self._on_download_queue_complete,
)
```

**Step 6.3: 添加回调方法**

在 `HComicDownloaderGUI` 类中添加：

```python
    def _on_download_task_update(self, task: DownloadTask):
        """下载任务更新回调"""
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
        self.after(0, lambda: self.update_status("所有下载已完成"))
        self.after(0, lambda: self.progress_var.set(0))
```

**Step 6.4: 修改进度条区域，添加展开按钮**

找到 `_create_progress_section` 方法（约 line 310-321），修改为：

```python
    def _create_progress_section(self):
        """创建进度区域（修改后）"""
        # ===== 下载管理器面板（初始隐藏）=====
        self.download_manager_ui = DownloadManagerUI(self, self.download_manager)
        self.download_manager_ui.panel.grid(row=2, column=0, sticky="ew")
        self.download_manager_ui.panel.grid_remove()

        # ===== 进度区域 =====
        progress_frame = ttk.Frame(self)
        progress_frame.grid(row=3, column=0, sticky=(tk.W, tk.E))
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

    def _toggle_download_manager(self):
        """切换下载管理器显示"""
        self.download_manager_ui.toggle()
        # 更新按钮图标
        icon = "▼" if self.download_manager_ui.is_expanded else "▲"
        self.expand_btn.config(text=icon)
```

注意：需要确保 `main_frame` 的行配置正确，可能需要调整其他行的 row 编号。

**Step 6.5: 提交**

```bash
git add gui.py
git commit -m "feat: integrate DownloadManagerUI into GUI with toggle button"
```

---

## Task 7: 重构批量下载逻辑

**Files:**
- Modify: `download_manager.py` (添加实际下载逻辑)
- Modify: `gui.py` (替换 execute_batch_download)
- Test: 手动测试

**Step 7.1: 在 DownloadManager 中添加下载逻辑**

```python
# download_manager.py - 在 DownloadManager 类中添加

class ComicDownloadManager(DownloadManager):
    """漫画下载管理器 - 集成 ComicDownloader"""

    def __init__(self, downloader, cbz_builder, output_dir: str):
        super().__init__()
        self.downloader = downloader
        self.cbz_builder = cbz_builder
        self.output_dir = output_dir

    def set_output_dir(self, output_dir: str):
        """设置输出目录"""
        self.output_dir = output_dir

    def _process_task(self, task_id: str):
        """处理单个下载任务"""
        task = self.tasks.get(task_id)
        if not task or task.status != DownloadStatus.QUEUED:
            return

        self.current_task_id = task_id
        task.status = DownloadStatus.DOWNLOADING
        task.started_at = time.time()
        self._notify_task_update(task)

        temp_dir = None
        try:
            # 下载图片
            def progress_callback(current: int, total: int, status: str, comic_info: dict = None):
                task.progress_current = current
                task.progress_total = total
                self._notify_task_update(task)

            temp_dir = self.downloader.download_comic(
                task.comic,
                self.output_dir,
                progress_callback=progress_callback,
            )

            # 检查是否被取消
            if task._cancel_requested:
                raise Exception("Download cancelled")

            task.temp_dir = temp_dir
            self._notify_task_update(task)

            # 打包为 CBZ
            output_path = self.cbz_builder.build_cbz(temp_dir, task.comic)

            # 清理临时目录
            self.downloader.cleanup_temp_dir(temp_dir)

            task.status = DownloadStatus.COMPLETED
            logger.info(f"Task {task_id} completed: {output_path}")

        except Exception as e:
            logger.error(f"Task {task_id} failed: {e}")
            task.status = DownloadStatus.FAILED
            task.error_message = str(e)

            if temp_dir and os.path.exists(temp_dir):
                self.downloader.cleanup_temp_dir(temp_dir)

        finally:
            self.current_task_id = None
            self._notify_task_update(task)
```

**Step 7.2: 修改 gui.py 初始化**

```python
# gui.py - 修改下载管理器初始化

# 下载管理器（使用 ComicDownloadManager）
from download_manager import ComicDownloadManager

self.download_manager = ComicDownloadManager(
    downloader=self.downloader,
    cbz_builder=self.cbz_builder,
    output_dir=self.config.download_dir,
)
self.download_manager.set_callbacks(
    on_task_update=self._on_download_task_update,
    on_queue_complete=self._on_download_queue_complete,
)
```

**Step 7.3: 替换 execute_batch_download**

```python
# gui.py - 替换 execute_batch_download 方法

    def execute_batch_download(self, comics: list[ComicInfo]):
        """执行批量下载（使用下载管理器）"""
        if not comics:
            return

        # 更新输出目录
        self.download_manager.set_output_dir(self.download_dir_var.get())

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

    def _on_download_queue_complete(self):
        """下载队列完成回调（重写）"""
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
```

**Step 7.4: 添加 clear_completed 方法到 DownloadManager**

```python
# download_manager.py - 在 DownloadManager 类中添加

    def clear_completed(self):
        """清理已完成/已取消/已失败的任务"""
        with self._lock:
            to_remove = [
                task_id for task_id, task in self.tasks.items()
                if task.status in (
                    DownloadStatus.COMPLETED,
                    DownloadStatus.CANCELLED,
                    DownloadStatus.FAILED
                )
            ]
            for task_id in to_remove:
                del self.tasks[task_id]
                if task_id in self.queue:
                    self.queue.remove(task_id)
```

**Step 7.5: 提交**

```bash
git add download_manager.py gui.py
git commit -m "feat: integrate actual download logic with ComicDownloadManager"
```

---

## Task 8: 最终集成测试

**Files:**
- All modified files
- Test: 手动完整测试

**Step 8.1: 运行应用测试**

```bash
./run.sh
```

**测试检查清单:**

- [ ] 应用正常启动
- [ ] 点击进度条旁的 ▲ 按钮，下载管理器从下向上展开带动画
- [ ] 搜索漫画并选择批量下载
- [ ] 下载管理器显示任务列表
- [ ] 点击暂停按钮，任务状态变为暂停
- [ ] 点击继续按钮，任务恢复下载
- [ ] 点击取消按钮，任务被取消
- [ ] 点击全部暂停，所有下载中任务暂停
- [ ] 点击全部继续，队列恢复处理
- [ ] 点击 × 或 ▼ 按钮，面板折叠
- [ ] 下载完成后显示汇总弹窗

**Step 8.2: 修复发现的问题**

根据测试结果修复问题。

**Step 8.3: 提交最终版本**

```bash
git add -A
git commit -m "feat: complete download manager with queue control and animations"
```

---

## Task 9: 代码审查和优化

**Files:**
- All files
- Test: 运行单元测试

**Step 9.1: 运行所有测试**

```bash
python -m pytest tests/ -v
```

**Step 9.2: 代码清理**

- 检查未使用的导入
- 检查日志记录是否完整
- 检查异常处理

```bash
python -m py_compile download_manager.py download_manager_ui.py gui.py models.py
```

**Step 9.3: 提交优化**

```bash
git add -A
git commit -m "refactor: code cleanup and test fixes for download manager"
```

---

## 总结

### 新建文件
- `download_manager.py` - 下载管理器核心 (~250 行)
- `download_manager_ui.py` - UI 组件 (~350 行)
- `tests/test_download_manager.py` - 单元测试 (~100 行)

### 修改文件
- `models.py` - 添加 DownloadTask, DownloadStatus (~50 行)
- `gui.py` - 集成 DownloadManagerUI (~80 行)

### 总代码量
约 830 行新代码

### 主要功能
1. 可展开/折叠的下载管理器面板（从下向上动画）
2. 实时显示下载队列和进度
3. 支持暂停/继续/取消单个任务
4. 支持全局暂停/继续
5. 简洁/详细两种视图模式
