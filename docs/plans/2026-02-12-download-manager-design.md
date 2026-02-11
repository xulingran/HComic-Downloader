# 下载管理器功能设计文档

**日期**: 2026-02-12
**功能**: 添加可展开/折叠的下载管理器面板，支持查看和管理下载队列

---

## 1. 核心概念

### 目标
添加一个可展开/折叠的下载管理器面板，允许用户查看和控制下载队列：
- 点击底部进度条向上展开管理器（带动画）
- 查看当前下载队列（所有待下载和进行中的漫画）
- 支持暂停/继续/取消单个漫画或整批下载
- 简洁/详细两种视图模式

### 组件架构

```
┌─────────────────────────────────────────┐
│           HComicDownloaderGUI           │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │       DownloadManager           │◄───┼── 新增：下载管理器面板
│  │  ┌─────────────────────────┐    │    │
│  │  │  Header (统计 + 控制)    │    │    │
│  │  ├─────────────────────────┤    │    │
│  │  │  View Toggle [简洁|详细] │    │    │
│  │  ├─────────────────────────┤    │    │
│  │  │  DownloadQueueList      │    │    │
│  │  │  ┌─────────────────┐    │    │    │
│  │  │  │ DownloadItem    │    │    │    │ ◄── 队列项（单个漫画）
│  │  │  │ ┌─────────────┐ │    │    │    │
│  │  │  │ │Thumbnail    │ │    │    │    │
│  │  │  │ │Title        │ │    │    │    │
│  │  │  │ │ProgressBar  │ │    │    │    │
│  │  │  │ │[▶][⏸][✕]   │ │    │    │    │
│  │  │  │ └─────────────┘ │    │    │    │
│  │  │  └─────────────────┘    │    │    │
│  │  └─────────────────────────┘    │    │
│  └─────────────────────────────────┘    │
│              ▲                          │
│  ┌───────────┴───────────┐              │
│  │   ProgressBar (可点击)  │◄────────────┼── 现有进度条，添加点击展开功能
│  └───────────────────────┘              │
└─────────────────────────────────────────┘
```

---

## 2. 数据模型

### DownloadTask 状态机

```python
@dataclass
class DownloadTask:
    """单个漫画的下载任务"""
    comic: ComicInfo
    status: DownloadStatus
    progress_current: int = 0      # 当前已下载页数
    progress_total: int = 0        # 总页数
    temp_dir: Optional[str] = None # 临时目录
    error_message: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None

class DownloadStatus(Enum):
    QUEUED = "queued"           # 等待中
    DOWNLOADING = "downloading" # 下载中
    PAUSED = "paused"           # 已暂停
    COMPLETED = "completed"     # 已完成
    FAILED = "failed"          # 失败
    CANCELLED = "cancelled"    # 已取消
```

### 状态转换

```
QUEUED ──► DOWNLOADING ──► COMPLETED
   │           │    ▲        │
   │           ▼    └────────┤
   │        PAUSED ──────────┘ (继续)
   │           │
   └──► CANCELLED ◄──────────┘
           │
           ▼
        FAILED
```

---

## 3. 动画设计

### 展开/折叠动画

动画与现有设置面板类似，但方向相反（从底部向上展开）。

**动画参数**:
- 持续时间: 250ms
- 帧率: ~60fps (16ms 间隔)
- 展开高度: 400px
- 缓动函数: ease-out cubic

**展开状态布局**:
```
展开高度 400px
┌────────────────────────────────────────┐
│ 下载队列 (3本)              [简洁 ▼] [×] │  ◄── Header (40px)
├────────────────────────────────────────┤
│ ┌────────────────────────────────────┐ │
│ │ [封面] 漫画标题1          [▶][⏸][✕] │ │  ◄── Item (简洁模式: 50px)
│ │ ████████████░░░░░░░░  45%          │ │
├────────────────────────────────────┤ │
│ │ [封面] 漫画标题2          [⏵][⏸][✕] │ │  ◄── 等待中状态显示不同图标
│ │ ░░░░░░░░░░░░░░░░░░░░  0%           │ │
├────────────────────────────────────┤ │
│ │ [封面] 漫画标题3          [⏵][⏸][✕] │ │
│ │ ░░░░░░░░░░░░░░░░░░░░  0%           │ │
└────────────────────────────────────────┘
         ▲
    点击进度条上的 ▲ 图标触发展开
```

**交互细节**:
- 展开触发: 点击底部进度条右侧的 ▲ 图标
- 折叠触发: 点击面板右上角的 × 或再次点击 ▼ 图标
- 背景: 展开时主内容区保持可滚动

---

## 4. 数据流与并发控制

### 生产者-消费者模式

```python
class DownloadManager:
    def start_download(self, comics: List[ComicInfo]):
        """添加漫画到下载队列并开始处理"""
        for comic in comics:
            task = DownloadTask(comic=comic, status=DownloadStatus.QUEUED)
            self.tasks[comic.id] = task
            self.queue.append(comic.id)

        if not self.is_running:
            self._start_processor()

    def _process_queue(self):
        """队列处理器（在后台线程运行）"""
        while self.queue and not self._stop_event.is_set():
            # 检查全局暂停
            if self.global_pause:
                time.sleep(0.1)
                continue

            task_id = self.queue[0]
            task = self.tasks[task_id]

            if task.status == DownloadStatus.PAUSED:
                self.queue.append(self.queue.pop(0))  # 轮转
                continue

            if task.status == DownloadStatus.QUEUED:
                self._download_single(task)

            # 完成后从队列移除
            if task.status in (COMPLETED, FAILED, CANCELLED):
                self.queue.pop(0)
```

### 暂停/取消实现

**暂停**: 设置 `task._pause_requested = True`，`_download_single` 中的循环会在每页下载后检查
**取消**: 设置 `task._cancel_requested = True`，等待当前页完成后退出，并清理临时文件

**线程安全**: 使用 `threading.Lock()` 保护 `tasks` 和 `queue` 的访问

---

## 5. GUI 组件设计

### 组件层次

```python
class DownloadManager:
    def __init__(self, parent):
        # 主面板（可动画容器）
        self.panel = tk.Frame(parent)

        # 内部布局
        self._create_header()         # 统计 + 控制按钮
        self._create_list_container() # 可滚动列表
```

### 队列列表

使用 Canvas + Frame 实现自定义滚动（Listbox/Treeview 不够灵活）：
- 支持动态项高度（简洁/详细模式）
- 支持封面缩略图
- 自定义控制按钮布局

### 任务项组件 (DownloadItemWidget)

```python
class DownloadItemWidget:
    COMPACT_HEIGHT = 50
    DETAIL_HEIGHT = 90

    def __init__(self, parent, task: DownloadTask):
        # 封面缩略图
        self.thumb_label = ttk.Label(...)
        # 标题
        self.title_label = ttk.Label(...)
        # 进度条
        self.progress_bar = ttk.Progressbar(...)
        # 控制按钮 [▶][⏸][✕]
        self.play_btn = ttk.Button(...)
        self.pause_btn = ttk.Button(...)
        self.cancel_btn = ttk.Button(...)
```

---

## 6. 与现有代码集成

### 修改点

1. **gui.py __init__**: 添加 DownloadManager 实例，调整布局
2. **execute_batch_download**: 改为调用 `download_manager.start_download()`
3. **进度条**: 添加展开按钮 ▲
4. **模型**: 添加 DownloadTask 和 DownloadStatus

### 新增文件

- `download_manager.py` - 下载管理器核心逻辑
- `download_manager_ui.py` - UI 组件（DownloadItemWidget 等）

### 修改文件

- `gui.py` - 集成 DownloadManager
- `models.py` - 添加新数据类

---

## 7. 技术约束说明

### 暂停延迟

由于使用 `requests` 库，`"立即暂停"`实际上是"快速检查点"策略：
- 每页图片下载完成后检查暂停标志
- 暂停延迟 = 当前页下载时间（通常 < 3 秒）
- 正在进行的 HTTP 请求无法真正中断

### 并发模型

- 队列处理：单线程顺序（一次一本漫画）
- 单本下载：ThreadPoolExecutor 多线程（同时下载多页）
- 符合现有下载器设计
