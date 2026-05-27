"""pytest 共享 fixtures 和配置"""
from pathlib import Path

import pytest

from parser import HComicParser


@pytest.fixture
def html_sample():
    """加载 fixtures/html/ 目录中的 HTML 样本

    Returns:
        工厂函数，接受文件名并返回 HTML 内容字符串
    """
    def _load(name: str) -> str:
        path = Path(__file__).parent / "fixtures" / "html" / name
        if not path.exists():
            pytest.fail(f"HTML sample not found: {name}")
        return path.read_text(encoding="utf-8")
    return _load


@pytest.fixture
def parser():
    """创建 HComicParser 实例用于测试

    Returns:
        配置了 timeout=30 的 HComicParser 实例
    """
    return HComicParser(timeout=30)


@pytest.fixture
def temp_config(tmp_path):
    """创建临时配置目录

    Returns:
        临时配置目录的 Path 对象
    """
    config_dir = tmp_path / ".hcomic_downloader"
    config_dir.mkdir()
    return config_dir
