"""pytest 共享 fixtures 和配置"""
import pytest
from pathlib import Path
from parser import HComicParser
from config import Config


@pytest.fixture
def html_sample():
    """加载 fixtures/html/ 目录中的 HTML 样本"""
    def _load(name: str) -> str:
        path = Path(__file__).parent / "fixtures" / "html" / name
        if not path.exists():
            pytest.fail(f"HTML sample not found: {name}")
        return path.read_text(encoding="utf-8")
    return _load


@pytest.fixture
def parser():
    """创建 HComicParser 实例用于测试"""
    return HComicParser(timeout=30)


@pytest.fixture
def temp_config(tmp_path, monkeypatch):
    """创建临时配置目录的 fixture"""
    config_dir = tmp_path / ".hcomic_downloader"
    config_dir.mkdir()
    config_file = config_dir / "config.json"

    def _load_config() -> Config:
        if config_file.exists():
            return Config.load(str(config_file))
        return Config()

    # monkeypatch 确保测试使用临时目录
    monkeypatch.setattr("config.os.path.join", lambda *args: str(config_file))

    return _load_config
