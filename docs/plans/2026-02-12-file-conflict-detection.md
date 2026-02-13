# 文件冲突检测功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在批量下载漫画前检测同名文件冲突，让用户选择覆盖、跳过或批量处理。

**Architecture:** 在 `execute_batch_download()` 调用前添加冲突检测，遍历待下载漫画列表检查目标文件是否存在，如有冲突则弹出对话框让用户处理，过滤掉用户选择跳过的漫画后再添加任务到队列。

**Tech Stack:** Python, tkinter, pytest

---

## Task 1: CBZBuilder 新增 get_output_path 方法

**Files:**
- Modify: `cbz_builder.py:160-184`
- Test: `tests/test_cbz_builder.py`

**Step 1: Write the failing test**

```python
# 在 tests/test_cbz_builder.py 末尾添加

class TestGetOutputPath:
    """测试 get_output_path 方法"""

    @pytest.fixture
    def builder(self):
        return CBZBuilder()

    @pytest.fixture
    def sample_comic(self):
        return ComicInfo(
            id="123",
            title="测试漫画",
            author="测试作者",
            pages=10,
        )

    def test_get_output_path_returns_expected_format(self, builder, sample_comic):
        """测试返回正确格式的路径"""
        path = builder.get_output_path(sample_comic)
        assert path.endswith(".cbz")
        assert "测试作者-测试漫画" in path

    def test_get_output_path_does_not_create_file(self, builder, sample_comic, tmp_path):
        """测试不会创建文件"""
        # 使用临时目录作为下载目录
        from config import Config
        config = Config.load()
        original_dir = config.download_dir
        config.download_dir = str(tmp_path)
        config.save()

        try:
            path = builder.get_output_path(sample_comic)
            import os
            assert not os.path.exists(path)
        finally:
            config.download_dir = original_dir
            config.save()

    def test_get_output_path_with_special_characters(self, builder):
        """测试特殊字符被正确处理"""
        comic = ComicInfo(
            id="456",
            title="漫画/测试:标题",
            author="作者<测试>",
            pages=5,
        )
        path = builder.get_output_path(comic)
        # 特殊字符应被 sanitize_filename 处理
        assert "/" not in os.path.basename(path)
        assert ":" not in os.path.basename(path)
        assert "<" not in os.path.basename(path)
        assert ">" not in os.path.basename(path)
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/zhong/Program/hcomic_downloader && source venv/bin/activate && pytest tests/test_cbz_builder.py::TestGetOutputPath -v`

Expected: FAIL with "CBZBuilder has no attribute 'get_output_path'"

**Step 3: Write minimal implementation**

```python
# 在 cbz_builder.py 的 CBZBuilder 类中，_generate_output_path 方法之后添加

def get_output_path(self, comic: ComicInfo) -> str:
    """获取漫画的输出路径（不创建文件）

    Args:
        comic: 漫画信息

    Returns:
        输出文件路径
    """
    return self._generate_output_path(comic)
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/zhong/Program/hcomic_downloader && source venv/bin/activate && pytest tests/test_cbz_builder.py::TestGetOutputPath -v`

Expected: PASS

**Step 5: Commit**

```bash
git add cbz_builder.py tests/test_cbz_builder.py
git commit -m "feat(cbz_builder): add get_output_path method for conflict detection"
```

---

## Task 2: 创建 FileConflictDialog 对话框

**Files:**
- Create: `file_conflict_dialog.py`
- Create: `tests/test_file_conflict_dialog.py`

**Step 1: Write the failing test**

```python
# 创建 tests/test_file_conflict_dialog.py

"""测试 file_conflict_dialog.py 文件冲突对话框"""
import pytest
from unittest.mock import Mock, patch
from dataclasses import dataclass
from typing import List, Tuple


@dataclass
class MockComicInfo:
    """模拟 ComicInfo 用于测试"""
    id: str
    title: str
    author: str

    @property
    def safe_title(self):
        return self.title

    @property
    def safe_author(self):
        return self.author or "unknown"


class TestFileConflictDialogData:
    """测试 FileConflictDialog 数据处理（不依赖 tkinter）"""

    def test_conflict_item_structure(self):
        """测试冲突项数据结构"""
        from file_conflict_dialog import ConflictItem

        item = ConflictItem(
            index=0,
            filename="作者-漫画.cbz",
            comic_title="漫画标题",
        )
        assert item.index == 0
        assert item.filename == "作者-漫画.cbz"
        assert item.comic_title == "漫画标题"

    def test_prepare_conflicts_creates_items(self):
        """测试准备冲突列表"""
        from file_conflict_dialog import prepare_conflict_items, ConflictItem

        comics = [
            MockComicInfo(id="1", title="漫画A", author="作者1"),
            MockComicInfo(id="2", title="漫画B", author="作者2"),
        ]
        filenames = ["作者1-漫画A.cbz", "作者2-漫画B.cbz"]

        items = prepare_conflict_items(comics, filenames)

        assert len(items) == 2
        assert items[0].filename == "作者1-漫画A.cbz"
        assert items[1].filename == "作者2-漫画B.cbz"

    def test_resolve_decisions_all_overwrite(self):
        """测试全部覆盖决策"""
        from file_conflict_dialog import resolve_decisions, ConflictAction

        items_count = 3
        action = ConflictAction.OVERWRITE_ALL
        individual_selections = {}

        result = resolve_decisions(items_count, action, individual_selections)

        # 全部覆盖：所有索引都应该返回 True
        assert all(result.values())
        assert len(result) == items_count

    def test_resolve_decisions_all_skip(self):
        """测试全部跳过决策"""
        from file_conflict_dialog import resolve_decisions, ConflictAction

        items_count = 3
        action = ConflictAction.SKIP_ALL
        individual_selections = {}

        result = resolve_decisions(items_count, action, individual_selections)

        # 全部跳过：所有索引都应该返回 False
        assert all(v is False for v in result.values())
        assert len(result) == items_count

    def test_resolve_decisions_individual_override(self):
        """测试单独选择覆盖默认行为"""
        from file_conflict_dialog import resolve_decisions, ConflictAction

        items_count = 3
        action = ConflictAction.SKIP  # 默认跳过
        # 索引 1 选择覆盖（覆盖默认行为）
        individual_selections = {1: True}

        result = resolve_decisions(items_count, action, individual_selections)

        assert result[0] is False  # 默认跳过
        assert result[1] is True   # 单独选择覆盖
        assert result[2] is False  # 默认跳过
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/zhong/Program/hcomic_downloader && source venv/bin/activate && pytest tests/test_file_conflict_dialog.py -v`

Expected: FAIL with "ModuleNotFoundError: No module named 'file_conflict_dialog'"

**Step 3: Write minimal implementation**

```python
# 创建 file_conflict_dialog.py

"""文件冲突对话框模块"""
import tkinter as tk
from tkinter import ttk
from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional


class ConflictAction(Enum):
    """冲突处理动作"""
    OVERWRITE = "overwrite"       # 覆盖
    SKIP = "skip"                 # 跳过
    OVERWRITE_ALL = "overwrite_all"  # 覆盖全部
    SKIP_ALL = "skip_all"         # 跳过全部


@dataclass
class ConflictItem:
    """单个冲突项"""
    index: int
    filename: str
    comic_title: str


def prepare_conflict_items(comics: List, filenames: List[str]) -> List[ConflictItem]:
    """准备冲突项列表

    Args:
        comics: 漫画列表
        filenames: 对应的文件名列表

    Returns:
        ConflictItem 列表
    """
    items = []
    for i, (comic, filename) in enumerate(zip(comics, filenames)):
        items.append(ConflictItem(
            index=i,
            filename=filename,
            comic_title=comic.title,
        ))
    return items


def resolve_decisions(
    items_count: int,
    action: ConflictAction,
    individual_selections: Dict[int, bool],
) -> Dict[int, bool]:
    """解析用户决策

    Args:
        items_count: 冲突项数量
        action: 选择的动作
        individual_selections: 单独选择 {index: overwrite?}

    Returns:
        {index: overwrite?} 字典，True 表示覆盖，False 表示跳过
    """
    result = {}

    for i in range(items_count):
        if action == ConflictAction.OVERWRITE_ALL:
            result[i] = True
        elif action == ConflictAction.SKIP_ALL:
            result[i] = False
        elif i in individual_selections:
            # 单独选择覆盖默认行为
            result[i] = individual_selections[i]
        else:
            # 使用默认行为
            result[i] = (action == ConflictAction.OVERWRITE)

    return result


class FileConflictDialog(tk.Toplevel):
    """文件冲突对话框"""

    def __init__(self, parent, conflict_items: List[ConflictItem]):
        """
        Args:
            parent: 父窗口
            conflict_items: 冲突项列表
        """
        super().__init__(parent)
        self.title("文件冲突")
        self.transient(parent)
        self.grab_set()

        self.conflict_items = conflict_items
        self.result: Optional[Dict[int, bool]] = None
        self.cancelled = False

        self._action_var = tk.StringVar(value=ConflictAction.OVERWRITE.value)
        self._checkbox_vars: Dict[int, tk.BooleanVar] = {}

        self._setup_ui()
        self._center_window()

        # 等待窗口关闭
        self.wait_window(self)

    def _setup_ui(self):
        """设置 UI"""
        # 主框架
        main_frame = ttk.Frame(self, padding="10")
        main_frame.pack(fill=tk.BOTH, expand=True)

        # 提示标签
        count = len(self.conflict_items)
        label = ttk.Label(
            main_frame,
            text=f"以下 {count} 本漫画与已存在文件同名：",
        )
        label.pack(anchor=tk.W, pady=(0, 10))

        # 单选按钮框架
        radio_frame = ttk.LabelFrame(main_frame, text="默认操作", padding="5")
        radio_frame.pack(fill=tk.X, pady=(0, 10))

        actions = [
            (ConflictAction.OVERWRITE, "覆盖"),
            (ConflictAction.SKIP, "跳过"),
            (ConflictAction.OVERWRITE_ALL, "覆盖全部"),
            (ConflictAction.SKIP_ALL, "跳过全部"),
        ]

        for action, text in actions:
            rb = ttk.Radiobutton(
                radio_frame,
                text=text,
                value=action.value,
                variable=self._action_var,
                command=self._on_action_change,
            )
            rb.pack(side=tk.LEFT, padx=5)

        # 文件列表框架
        list_frame = ttk.LabelFrame(main_frame, text="冲突文件", padding="5")
        list_frame.pack(fill=tk.BOTH, expand=True, pady=(0, 10))

        # 创建滚动区域
        canvas = tk.Canvas(list_frame, height=200)
        scrollbar = ttk.Scrollbar(list_frame, orient=tk.VERTICAL, command=canvas.yview)
        scrollable_frame = ttk.Frame(canvas)

        scrollable_frame.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
        )

        canvas.create_window((0, 0), window=scrollable_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        # 添加冲突项复选框
        for item in self.conflict_items:
            var = tk.BooleanVar(value=False)
            self._checkbox_vars[item.index] = var

            cb = ttk.Checkbutton(
                scrollable_frame,
                text=f"{item.filename}",
                variable=var,
            )
            cb.pack(anchor=tk.W, pady=2)

        # 按钮框架
        btn_frame = ttk.Frame(main_frame)
        btn_frame.pack(fill=tk.X, pady=(10, 0))

        ttk.Button(btn_frame, text="确定", command=self._on_ok, width=10).pack(side=tk.RIGHT, padx=5)
        ttk.Button(btn_frame, text="取消", command=self._on_cancel, width=10).pack(side=tk.RIGHT)

    def _on_action_change(self):
        """单选按钮变化时更新复选框状态"""
        action = ConflictAction(self._action_var.get())
        is_all = action in (ConflictAction.OVERWRITE_ALL, ConflictAction.SKIP_ALL)

        for var in self._checkbox_vars.values():
            if is_all:
                var.set(action == ConflictAction.OVERWRITE_ALL)

    def _on_ok(self):
        """确定按钮"""
        action = ConflictAction(self._action_var.get())

        # 收集单独选择
        individual_selections = {
            idx: var.get()
            for idx, var in self._checkbox_vars.items()
            if var.get()  # 只收集勾选的（表示选择覆盖）
        }

        self.result = resolve_decisions(
            len(self.conflict_items),
            action,
            individual_selections,
        )
        self.destroy()

    def _on_cancel(self):
        """取消按钮"""
        self.cancelled = True
        self.result = None
        self.destroy()

    def _center_window(self):
        """窗口居中"""
        self.update_idletasks()
        width = 500
        height = 350
        x = (self.winfo_screenwidth() // 2) - (width // 2)
        y = (self.winfo_screenheight() // 2) - (height // 2)
        self.geometry(f"{width}x{height}+{x}+{y}")

    def get_result(self) -> Optional[Dict[int, bool]]:
        """获取用户选择结果

        Returns:
            {index: overwrite?} 字典，None 表示取消
        """
        if self.cancelled:
            return None
        return self.result


def show_conflict_dialog(
    parent,
    comics: List,
    filenames: List[str],
) -> Optional[Dict[int, bool]]:
    """显示文件冲突对话框

    Args:
        parent: 父窗口
        comics: 冲突的漫画列表
        filenames: 对应的文件名列表

    Returns:
        {index: overwrite?} 字典，None 表示取消
    """
    items = prepare_conflict_items(comics, filenames)
    dialog = FileConflictDialog(parent, items)
    return dialog.get_result()
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/zhong/Program/hcomic_downloader && source venv/bin/activate && pytest tests/test_file_conflict_dialog.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add file_conflict_dialog.py tests/test_file_conflict_dialog.py
git commit -m "feat(ui): add FileConflictDialog for batch download conflict handling"
```

---

## Task 3: GUI 集成冲突检测

**Files:**
- Modify: `gui.py:1280-1302`

**Step 1: Read current implementation**

Read `gui.py:1280-1302` to understand `execute_batch_download` structure.

**Step 2: Add import and conflict detection method**

```python
# 在 gui.py 顶部的 import 区域添加
from file_conflict_dialog import show_conflict_dialog

# 在 HComicDownloaderGUI 类中添加新方法（约在 execute_batch_download 之前）

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

    for i, comic in enumerate(comics):
        output_path = self.cbz_builder.get_output_path(comic)
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
```

**Step 3: Modify execute_batch_download**

```python
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
```

**Step 4: Run syntax check**

Run: `cd /Users/zhong/Program/hcomic_downloader && source venv/bin/activate && python -m py_compile gui.py`

Expected: No output (success)

**Step 5: Commit**

```bash
git add gui.py
git commit -m "feat(gui): integrate file conflict detection into batch download"
```

---

## Task 4: 端到端测试

**Files:**
- Test: Manual testing

**Step 1: Run existing tests**

Run: `cd /Users/zhong/Program/hcomic_downloader && source venv/bin/activate && pytest tests/ -v`

Expected: All tests PASS

**Step 2: Manual test - No conflicts**

1. 启动应用: `python main.py`
2. 搜索漫画
3. 开启批量选择模式
4. 选择多本漫画（确保下载目录中不存在同名文件）
5. 点击批量下载
6. 验证：直接开始下载，没有冲突对话框

**Step 3: Manual test - Has conflicts**

1. 在下载目录中创建几个 .cbz 文件（模拟已存在文件）
2. 搜索同名漫画
3. 开启批量选择模式，选择这些漫画
4. 点击批量下载
5. 验证：弹出冲突对话框
6. 测试"覆盖全部"：验证文件被覆盖
7. 测试"跳过全部"：验证漫画被跳过
8. 测试"取消"：验证所有下载被取消

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete file conflict detection feature"
```

---

## Summary

| Task | Description | Files Changed |
|------|-------------|---------------|
| 1 | CBZBuilder.get_output_path | cbz_builder.py, tests/test_cbz_builder.py |
| 2 | FileConflictDialog | file_conflict_dialog.py, tests/test_file_conflict_dialog.py |
| 3 | GUI integration | gui.py |
| 4 | Testing | Manual verification |
