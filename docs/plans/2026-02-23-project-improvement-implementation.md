# HComic Downloader 项目改进实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 渐进式重构 GUI 巨石类、修复稳定性问题、增强下载进度反馈、提升代码质量。

**Architecture:** 将 `gui.py`（1800+ 行）拆分为独立面板模块，面板间通过回调函数通信。保持 tkinter 框架不变。

**Tech Stack:** Python 3.12, tkinter, threading, dataclasses

**Design Doc:** `docs/plans/2026-02-23-project-improvement-design.md`

---

## 阶段一：提交现有变更并稳定基线

### Task 1: 整理并提交当前未提交变更

**Files:** 所有已修改和新增文件

**Step 1:** 运行所有现有测试，确认当前代码状态可用

```bash
cd E:/Developing/hcomic_downloader
source venv/bin/activate
python -m pytest tests/ -v
```

**Step 2:** 按功能分组提交变更

```bash
# 提交 1: 多源解析支持
git add parser.py models.py config.py
git commit -m "feat: add multi-source parser support (HComic + MoeImg)"

# 提交 2: 下载管理器核心 + UI
git add download_manager.py download_manager_ui.py downloader.py
git commit -m "feat: add queue-based download manager with UI panel"

# 提交 3: GUI 逻辑提取和主界面更新
git add gui.py gui_logic.py
git commit -m "refactor: extract GUI logic and integrate multi-source/download manager"

# 提交 4: 新测试文件
git add tests/
git commit -m "test: add tests for multi-source parser, download manager, GUI logic"

# 提交 5: 启动脚本
git add run.sh run.bat
git commit -m "chore: update launch scripts"
```

**Step 3:** 打基线 tag

```bash
git tag v0.9-pre-refactor
```

**验收标准:**
- [ ] 所有测试通过
- [ ] 所有变更已提交，`git status` 干净
- [ ] 基线 tag 已创建

---

## 阶段二：GUI 面板拆分

### Task 2: 创建 panels 包和 SettingsPanel

**Files:**
- Create: `panels/__init__.py`
- Create: `panels/settings_panel.py`
- Modify: `gui.py`

**Step 1:** 创建 `panels/__init__.py`

```python
"""GUI 面板模块"""
```

**Step 2:** 从 `gui.py` 提取设置面板到 `panels/settings_panel.py`

提取以下方法（保持原有逻辑不变）：
- `toggle_settings_panel` (gui.py:606)
- `_set_settings_button_text` (gui.py:610)
- `_animate_settings_panel` (gui.py:615)
- `_run_settings_animation_step` (gui.py:641)
- `_on_font_changed` (gui.py:920)
- `_on_font_size_changed` (gui.py:937)
- `_get_font_list` (gui.py:907)
- `_on_preview_changed` (gui.py:978)
- `_save_all_settings` (gui.py:950)
- `_validate_batch_delay` (gui.py:818)
- `_get_batch_delay_seconds` (gui.py:828)
- `browse_download_dir` (gui.py:1745)
- `open_download_dir` (gui.py:1752)
- `_refresh_proxy_status` (gui.py:1191)
- `_format_proxy_status` (gui.py:1178)
- 设置面板 UI 构建代码（`create_widgets` 中设置区域部分）

SettingsPanel 类签名：

```python
class SettingsPanel(tk.Frame):
    def __init__(
        self,
        parent: tk.Widget,
        config: Config,
        font_config: FontConfig,
        on_config_change: Callable[[Config], None],
        on_font_change: Callable[[str, int], None],
        on_preview_change: Callable[[bool], None],
        on_theme_change: Callable[[str], None],
    ):
```

**Step 3:** 在 `gui.py` 中用 `SettingsPanel` 替换原有设置代码

```python
# gui.py __init__ 中
self.settings_panel = SettingsPanel(
    self.main_frame,
    config=self.config,
    font_config=self.font_config,
    on_config_change=self._on_config_changed,
    on_font_change=self._on_font_changed,
    on_preview_change=self._on_preview_changed,
    on_theme_change=self._on_theme_change,
)
```

**验收标准:**
- [ ] 设置面板展开/折叠动画正常
- [ ] 字体切换、主题切换、预览开关正常
- [ ] 下载目录浏览/打开正常
- [ ] 所有测试通过

---

### Task 3: 提取 ComicCard 组件

**Files:**
- Create: `panels/comic_card.py`
- Modify: `gui.py`

**Step 1:** 从 `gui.py` 提取漫画卡片相关方法到 `panels/comic_card.py`

提取方法：
- `create_comic_card` (gui.py:2327) — 重命名为 `ComicCard.__init__`
- `_schedule_cover_load` (gui.py:2476)
- `load_cover` (gui.py:2495)
- `_show_cover_retry_icon` (gui.py:2552)
- `_retry_cover_load` (gui.py:2567)
- `_restore_cover_click_binding` (gui.py:2585)
- `_safe_update_image` (gui.py:2594)
- `_render_title_widget` (gui.py:2269)
- `_on_title_click_press` (gui.py:2282)
- `_on_title_drag` (gui.py:2290)
- `_on_title_click_release` (gui.py:2298)
- `_copy_selected_text` (gui.py:2311)
- `_is_title_expanded` (gui.py:2213)
- `_wrap_text_lines` (gui.py:2217)
- `_truncate_text_to_lines` (gui.py:2239)
- `_set_text_widget_content` (gui.py:2256)
- `_get_frame_background` (gui.py:2323)

ComicCard 类签名：

```python
class ComicCard(tk.Frame):
    def __init__(
        self,
        parent: tk.Widget,
        comic: ComicInfo,
        card_width: int,
        show_preview: bool,
        cover_executor: ThreadPoolExecutor,
        image_cache: dict,
        on_click: Callable[[ComicInfo], None],
        on_select_toggle: Optional[Callable[[ComicInfo], None]] = None,
        batch_mode: bool = False,
        selected: bool = False,
    ):
```

**Step 2:** 在 `gui.py` 的 `display_results` 中用 `ComicCard` 替换 `create_comic_card` 调用

**验收标准:**
- [ ] 漫画卡片渲染正常（封面、标题、元数据）
- [ ] 封面加载/重试正常
- [ ] 标题展开/折叠/复制正常
- [ ] 批量选择模式下卡片选中状态正常

---

### Task 4: 提取 SearchPanel

**Files:**
- Create: `panels/search_panel.py`
- Modify: `gui.py`

提取方法：
- `search` (gui.py:1969)
- `search_error` (gui.py:2006)
- `display_results` (gui.py:2013)
- `_start_result_detail_prefetch` (gui.py:2182)
- `_on_result_detail_prefetched` (gui.py:2203)
- `_refresh_results_layout` (gui.py:885)
- `_calculate_columns` (gui.py:867)
- 分页相关: `update_pagination_controls`, `go_previous_page`, `go_next_page`, `go_to_page_dialog`, `_load_page`
- 批量工具栏: `create_batch_toolbar`, `select_all`, `clear_selection`, `update_toolbar_buttons`, `_on_batch_mode_changed`
- 收藏夹: `view_favourites`, `_handle_favourites_login_required`
- 滚动相关: `_on_mousewheel`, `_on_touchpad_scroll`, `_scroll_canvas_smooth`, `_bind_scroll_events` 等
- 搜索栏 + 结果画布 UI 构建代码

SearchPanel 类签名：

```python
class SearchPanel(tk.Frame):
    def __init__(
        self,
        parent: tk.Widget,
        parser: MultiSourceParser,
        config: Config,
        font_config: FontConfig,
        on_download: Callable[[ComicInfo], None],
        on_batch_download: Callable[[List[ComicInfo]], None],
        on_status_update: Callable[[str], None],
    ):
```

**验收标准:**
- [ ] 搜索/翻页正常
- [ ] 结果网格布局和窗口缩放正常
- [ ] 批量选择/全选/清除正常
- [ ] 收藏夹视图正常
- [ ] 滚动（鼠标滚轮/触摸板）正常

---

### Task 5: 提取 StatusBar

**Files:**
- Create: `panels/status_bar.py`
- Modify: `gui.py`

提取方法：
- `update_status` (gui.py:1864)
- `_update_login_status_for_current_source` (gui.py:251)
- 底部状态栏 UI 构建代码

```python
class StatusBar(tk.Frame):
    def __init__(self, parent: tk.Widget):

    def update_message(self, text: str): ...
    def update_login_status(self, logged_in: bool, source: str): ...
```

**验收标准:**
- [ ] 状态消息更新正常
- [ ] 登录状态显示正常

---

### Task 6: 适配 DownloadPanel 接口

**Files:**
- Create: `panels/download_panel.py`
- Modify: `gui.py`
- Modify: `download_manager_ui.py`（如需要）

`download_manager_ui.py` 已基本独立。此 Task 创建一个薄包装层：

```python
class DownloadPanel(tk.Frame):
    def __init__(
        self,
        parent: tk.Widget,
        download_manager: ComicDownloadManager,
        on_status_update: Callable[[str], None],
    ):
```

将 `gui.py` 中以下方法移入：
- `_on_download_task_update` (gui.py:1787)
- `_update_ui_for_task` (gui.py:1797)
- `_on_download_queue_complete` (gui.py:1811)
- `_toggle_download_manager` (gui.py:1857)
- `batch_download_selected` (gui.py:1541)
- `confirm_batch_download` (gui.py:1522)
- `execute_batch_download` (gui.py:1667)
- `show_batch_download_summary` (gui.py:1715)
- `download_comic` (gui.py:2651)
- `_continue_single_download` (gui.py:2688)

**验收标准:**
- [ ] 单本下载正常
- [ ] 批量下载正常（队列、暂停、继续、取消）
- [ ] 下载管理器面板展开/折叠动画正常
- [ ] 下载完成汇总弹窗正常

---

### Task 7: 精简 gui.py 主窗口类

**Files:**
- Modify: `gui.py`

**目标:** 将 `gui.py` 精简到 ~200 行，仅保留：
- 窗口初始化和布局组装
- 面板实例化和回调连接
- 源/查询模式选择
- 主题轮询
- 窗口生命周期（`destroy`、`center_window`）
- 配置加载/保存协调

**验收标准:**
- [ ] `gui.py` 行数 < 300 行
- [ ] 应用完整功能正常（搜索、下载、设置、收藏夹）
- [ ] 所有测试通过

---

## 阶段三：稳定性与健壮性修复

### Task 8: 修复下载管理器轮转逻辑

**Files:**
- Modify: `download_manager.py:128-170`
- Modify: `tests/test_download_manager.py`

**问题:** `_get_next_task_locked()` 使用 `paused_count`/`failed_count` 计数器判断是否遍历完队列。当队列中混合 COMPLETED（被移除导致长度变化）和 PAUSED/FAILED 任务时，计数器重置可能导致重复遍历。

**修复方案:** 改用已检查 task_id 集合，遍历一轮即退出。

```python
def _get_next_task_locked(self) -> Optional[str]:
    seen = set()
    while self.queue:
        task_id = self.queue[0]
        if task_id in seen:
            return None
        task = self.tasks.get(task_id)
        if not task:
            self.queue.pop(0)
            continue
        if task.status in (DownloadStatus.COMPLETED, DownloadStatus.CANCELLED):
            self.queue.pop(0)
            continue
        if task.status in (DownloadStatus.FAILED, DownloadStatus.PAUSED):
            seen.add(task_id)
            self.queue.append(self.queue.pop(0))
            continue
        return task_id
    return None
```

**验收标准:**
- [ ] 全 PAUSED 队列不死循环，返回 None
- [ ] 全 FAILED 队列不死循环，返回 None
- [ ] 混合状态队列正确找到 QUEUED 任务
- [ ] 测试覆盖以上场景

---

### Task 9: Parser 容错增强

**Files:**
- Modify: `parser.py`（`_extract_payload_data` 及网络请求方法）

**Step 1:** 为 `_extract_payload_data()` 添加 fallback 正则

当主正则 `PAYLOAD_REGEX` 匹配失败时，尝试备用模式（更宽松的匹配），并记录警告日志。

**Step 2:** 统一网络请求错误处理

为 `_get_response_text()` 添加结构化异常处理，解析失败时返回包含错误原因的异常而非静默返回空值。

**验收标准:**
- [ ] 正则匹配失败时尝试 fallback 而非直接报错
- [ ] 网络超时/连接错误有明确的错误消息

---

### Task 10: 下载器单页失败容错

**Files:**
- Modify: `downloader.py`

**目标:** 单页下载失败不中断整本漫画下载。失败页面记录到 `failed_pages`，下载完成后由上层决定是否重试。

当前 `download_comic_resume` 已有 `failed_pages` 支持，需确认：
- 单页失败时继续下载后续页面
- 最终 `DownloadResult.success` 在有失败页时为 `False`，但 `completed_pages` 仍包含已成功的页面

**验收标准:**
- [ ] 单页超时不中断整本下载
- [ ] `DownloadResult` 正确记录 failed_pages 和 completed_pages

---

## 阶段四：下载进度反馈增强

### Task 11: DownloadTask 运行时统计

**Files:**
- Modify: `models.py`（DownloadTask 类）
- Modify: `download_manager.py`

在 `DownloadTask` 中增加运行时统计字段：

```python
# models.py DownloadTask 新增字段
download_speed: float = 0.0          # 页/秒
current_downloading_page: int = 0    # 当前正在下载的页码
```

在 `ComicDownloadManager._process_task` 的 `progress_callback` 中计算速度：

```python
def progress_callback(current, total, status, comic_info=None):
    task.progress_current = current
    task.progress_total = total
    elapsed = time.time() - task.started_at if task.started_at else 0
    task.download_speed = current / elapsed if elapsed > 0 else 0
    self._notify_task_update(task)
```

**验收标准:**
- [ ] `download_speed` 在下载过程中实时更新
- [ ] 速度计算合理（不为 0，不为 inf）

---

### Task 12: 下载项 UI 进度信息丰富化

**Files:**
- Modify: `download_manager_ui.py`（DownloadItemWidget）

在 `DownloadItemWidget` 的进度显示中增加：
- 文本格式：`3/25页 | 1.2 页/秒`
- 失败页提示：`2页失败`（仅在有失败页时显示）

从 `DownloadTask` 的新字段读取 `download_speed` 和 `failed_pages`。

**验收标准:**
- [ ] 下载中显示页数和速度
- [ ] 有失败页时显示失败数

---

### Task 13: 批量下载总览和完成通知

**Files:**
- Modify: `download_manager_ui.py`（DownloadManagerUI 顶部区域）
- Modify: `panels/download_panel.py`

**Step 1:** 在下载面板顶部添加汇总行

利用已有的 `DownloadManager.get_stats()` 方法，在面板顶部显示：
`下载中 2/10 | 已完成 5 | 失败 1 | 排队 2` + 整体进度条

**Step 2:** 下载完成通知

- 全部完成时弹出汇总对话框（成功数、失败数、失败列表）
- 复用现有 `show_batch_download_summary` 逻辑

**验收标准:**
- [ ] 面板顶部实时显示队列统计
- [ ] 全部完成后弹出汇总

---

## 阶段五：代码质量与工程化

### Task 14: 扩展 gui_logic.py

**Files:**
- Modify: `gui_logic.py`
- Modify: `tests/test_gui_logic.py`

从各面板中提取更多无 Tk 依赖的纯逻辑函数到 `gui_logic.py`：

```python
# 新增函数示例
def calculate_grid_columns(window_width: int, min_card_width: int, padding: int) -> int:
    """计算结果网格列数"""

def format_download_speed(pages_per_sec: float) -> str:
    """格式化下载速度显示"""

def build_batch_summary(stats: dict) -> str:
    """构建批量下载汇总文本"""
```

**验收标准:**
- [ ] 新增函数均有对应单元测试
- [ ] 测试无需 Tk 环境即可运行

---

### Task 15: 补充关键路径测试

**Files:**
- Modify: `tests/test_download_manager.py`
- Create: `tests/test_parser_fallback.py`

**Step 1:** 下载管理器状态转换测试

```python
# 测试场景
def test_task_lifecycle_queued_to_completed(): ...
def test_task_lifecycle_queued_to_failed_to_retry(): ...
def test_task_pause_during_download(): ...
def test_task_cancel_during_download(): ...
def test_auto_retry_respects_max_attempts(): ...
```

**Step 2:** Parser fallback 路径测试

```python
def test_extract_payload_data_primary_regex_fails(): ...
def test_extract_payload_data_fallback_succeeds(): ...
def test_network_timeout_returns_error_message(): ...
```

**验收标准:**
- [ ] 下载管理器状态转换全覆盖
- [ ] Parser fallback 路径有测试保护

---

### Task 16: 为新增/修改的公共 API 添加类型注解

**Files:**
- Modify: `panels/*.py`（所有新建面板文件）
- Modify: `gui_logic.py`

仅为阶段二~四中新增或修改的公共方法添加参数和返回值类型注解。不修改未改动的旧代码。

**验收标准:**
- [ ] 所有面板类的 `__init__` 和公共方法有类型注解
- [ ] `gui_logic.py` 所有函数有类型注解
- [ ] `mypy --ignore-missing-imports panels/ gui_logic.py` 无错误

---

## 总结

| 阶段 | Task | 内容 |
|------|------|------|
| 一 | 1 | 提交现有变更，建立基线 |
| 二 | 2-7 | GUI 面板拆分（Settings → ComicCard → Search → StatusBar → Download → 精简主类） |
| 三 | 8-10 | 下载管理器轮转修复、Parser 容错、单页失败容错 |
| 四 | 11-13 | 运行时统计、进度 UI 丰富化、批量总览和完成通知 |
| 五 | 14-16 | 扩展 gui_logic、补充测试、类型注解 |

每个 Task 完成后运行 `python -m pytest tests/ -v` 确认无回归。
