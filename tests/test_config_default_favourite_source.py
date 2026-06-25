"""Config.default_favourite_source 归一化测试。

验证 dataclass 默认值与 __post_init__ 归一化逻辑：
- 默认值为空字符串（未设置）
- 合法值（SOURCES_WITH_FAVOURITES）保留
- 非法值 / copymanga / 不支持收藏的来源回退为空字符串
对应 config spec 的「后端配置归一化」场景。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import SOURCES_WITH_FAVOURITES, Config


class TestDefaultFavouriteSource:
    def test_default_value_is_empty(self):
        """未传值时默认为空字符串（未设置）。"""
        config = Config()
        assert config.default_favourite_source == ""

    def test_legal_source_preserved(self):
        """SOURCES_WITH_FAVOURITES 中的合法来源应原样保留。"""
        for source in SOURCES_WITH_FAVOURITES:
            config = Config(default_favourite_source=source)
            assert config.default_favourite_source == source, f"合法来源 {source} 未保留"

    def test_copymanga_falls_back_to_empty(self):
        """copymanga 不支持收藏，应回退为空字符串。"""
        config = Config(default_favourite_source="copymanga")
        assert config.default_favourite_source == ""

    def test_illegal_value_falls_back_to_empty(self):
        """非法来源键应回退为空字符串。"""
        config = Config(default_favourite_source="unknown")
        assert config.default_favourite_source == ""

    def test_empty_string_preserved(self):
        """显式空字符串应保留（表示未设置）。"""
        config = Config(default_favourite_source="")
        assert config.default_favourite_source == ""

    def test_legacy_alias_normalized(self):
        """旧版别名（jmcomic）应被 normalize_source_key 归一化为 jm 后保留。"""
        # normalize_source_key 将 jmcomic → jm，jm 在 SOURCES_WITH_FAVOURITES 中
        config = Config(default_favourite_source="jmcomic")
        assert config.default_favourite_source == "jm"
