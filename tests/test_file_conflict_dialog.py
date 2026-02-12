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
        assert all(result.values()) is True
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
