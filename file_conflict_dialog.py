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
