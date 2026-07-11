"""pytest 共享 fixtures 和配置"""

from pathlib import Path

import pytest

from sources.bika.parser import BikaParser
from sources.copymanga.parser import CopyMangaParser
from sources.hcomic import HComicParser
from sources.moeimg import MoeImgParser


@pytest.fixture(autouse=True)
def _isolate_config_dir(tmp_path, monkeypatch):
    """Redirect config.json and library.db to a per-test tmp dir.

    `_get_config_path()` and `get_default_library_db_path()` both read
    HCOMIC_CONFIG_DIR at call time. Setting it here redirects config bindings
    and any future unpatched IPCServer helper uniformly, preventing tests from
    clobbering the real ~/.hcomic_downloader/config.json or library.db.
    """
    config_dir = tmp_path / ".hcomic_downloader"
    monkeypatch.setenv("HCOMIC_CONFIG_DIR", str(config_dir))
    yield


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
def bika_parser():
    """创建 BikaParser 实例用于测试。"""
    return BikaParser(timeout=5)


@pytest.fixture
def moeimg_parser():
    """创建 MoeImgParser 实例用于测试。"""
    return MoeImgParser(timeout=5)


@pytest.fixture
def copymanga_parser():
    """创建 CopyMangaParser 实例用于测试。"""
    return CopyMangaParser(timeout=5)


@pytest.fixture
def json_fixture():
    """加载 fixtures/json/ 目录中的 JSON 样本。

    Returns:
        工厂函数，接受文件名并返回解析后的 dict
    """
    import json as _json

    def _load(name: str):
        path = Path(__file__).parent / "fixtures" / "json" / name
        if not path.exists():
            pytest.fail(f"JSON fixture not found: {name}")
        return _json.loads(path.read_text(encoding="utf-8"))

    return _load
