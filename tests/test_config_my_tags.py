"""Tests for the my_tags config field (推荐标签白名单).

对称 tag_blacklist 的存储、归一化、默认值补齐与往返行为。
"""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"),
)

from config import VALID_SOURCE_KEYS, Config, _normalize_source_list_map
from python.ipc_server import CONFIG_KEY_MAP


class TestMyTagsDefaults(unittest.TestCase):
    def test_default_my_tags_has_all_source_keys(self):
        config = Config()
        self.assertEqual(set(config.my_tags.keys()), set(VALID_SOURCE_KEYS))
        for source in VALID_SOURCE_KEYS:
            self.assertEqual(config.my_tags[source], [])

    def test_default_my_tags_is_independent_instance(self):
        """每个 Config 实例的默认 my_tags 必须是独立对象（避免可变默认值共享）。"""
        c1 = Config()
        c2 = Config()
        c1.my_tags["hcomic"].append("NTR")
        self.assertEqual(c2.my_tags["hcomic"], [])

    def test_my_tags_independent_from_tag_blacklist(self):
        """my_tags 与 tag_blacklist 必须独立存储。"""
        config = Config()
        config.my_tags["jm"] = ["NTR"]
        self.assertEqual(config.tag_blacklist["jm"], [])
        config.tag_blacklist["hcomic"] = ["bad"]
        self.assertEqual(config.my_tags["hcomic"], [])


class TestMyTagsNormalization(unittest.TestCase):
    def test_post_init_normalizes_my_tags(self):
        """__post_init__ 必须补齐缺失的来源键。"""
        config = Config(my_tags={"hcomic": ["NTR"]})
        # 必须补齐全部 5 个来源键
        self.assertEqual(set(config.my_tags.keys()), set(VALID_SOURCE_KEYS))
        self.assertEqual(config.my_tags["hcomic"], ["NTR"])
        self.assertEqual(config.my_tags["jm"], [])

    def test_post_init_rejects_non_dict_my_tags(self):
        """非 dict 的 my_tags 必须被归一化为默认空 map。"""
        config = Config(my_tags=None)  # type: ignore[arg-type]
        self.assertEqual(set(config.my_tags.keys()), set(VALID_SOURCE_KEYS))
        for source in VALID_SOURCE_KEYS:
            self.assertEqual(config.my_tags[source], [])

    def test_post_init_rejects_non_list_entries(self):
        """非数组的来源条目必须被丢弃。"""
        config = Config(my_tags={"hcomic": "not-a-list", "jm": ["ok"]})  # type: ignore[arg-type]
        self.assertEqual(config.my_tags["hcomic"], [])
        self.assertEqual(config.my_tags["jm"], ["ok"])

    def test_post_init_drops_illegal_source_keys(self):
        """非法来源键（不在 VALID_SOURCE_KEYS 中）必须被丢弃；合法旧键归一化。"""
        config = Config(my_tags={"unknown": ["x"], "jmcomic": ["legacy"], "jm": ["ok"]})
        # jmcomic 经 normalize_source_key 归一化为 jm，legacy 条目并入 jm
        self.assertNotIn("unknown", config.my_tags)
        self.assertEqual(config.my_tags["jm"], ["legacy", "ok"])


class TestMyTagsRoundTrip(unittest.TestCase):
    def test_save_load_round_trip(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "config.json")
            config = Config()
            config.my_tags["jm"] = ["NTR", "人妻"]
            config.my_tags["hcomic"] = ["触手"]
            config.save(path)

            loaded = Config.load(path)
            self.assertEqual(loaded.my_tags["jm"], ["NTR", "人妻"])
            self.assertEqual(loaded.my_tags["hcomic"], ["触手"])
            # 其他来源必须保持空数组
            self.assertEqual(loaded.my_tags["bika"], [])

    def test_load_legacy_config_without_my_tags_defaults_empty(self):
        """旧版本配置文件不含 my_tags 时，必须默认补齐 5 来源空数组。"""
        legacy = {
            "download_dir": "/tmp/downloads",
            "tag_blacklist": {"hcomic": ["bad"]},
            # 注意：不含 my_tags 键
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "config.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(legacy, f)

            loaded = Config.load(path)
            self.assertEqual(set(loaded.my_tags.keys()), set(VALID_SOURCE_KEYS))
            for source in VALID_SOURCE_KEYS:
                self.assertEqual(loaded.my_tags[source], [])

    def test_load_preserves_my_tags_alongside_tag_blacklist(self):
        """my_tags 与 tag_blacklist 必须能同时持久化与读取，互不干扰。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "config.json")
            config = Config()
            config.tag_blacklist["jm"] = ["blocked"]
            config.my_tags["jm"] = ["recommended"]
            config.save(path)

            loaded = Config.load(path)
            self.assertEqual(loaded.tag_blacklist["jm"], ["blocked"])
            self.assertEqual(loaded.my_tags["jm"], ["recommended"])

    def test_load_drops_unknown_keys_but_keeps_my_tags(self):
        """Config.load 的「只保留已知字段」逻辑必须保留 my_tags（已知字段）。"""
        data = {
            "my_tags": {"hcomic": ["NTR"]},
            "unknown_future_field": "should-be-dropped",
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "config.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f)

            loaded = Config.load(path)
            self.assertEqual(loaded.my_tags["hcomic"], ["NTR"])


class TestNormalizeSourceListMapForMyTags(unittest.TestCase):
    """验证通用归一化函数对 my_tags 的适用性。"""

    def test_normalize_none_returns_default(self):
        result = _normalize_source_list_map(None)
        self.assertEqual(set(result.keys()), set(VALID_SOURCE_KEYS))

    def test_normalize_keeps_existing_values(self):
        result = _normalize_source_list_map({"jm": ["a", "b"]})
        self.assertEqual(result["jm"], ["a", "b"])
        self.assertEqual(result["hcomic"], [])


class TestMyTagsInIpcKeyMap(unittest.TestCase):
    """验证 myTags 在 CONFIG_KEY_MAP 中正确映射（handle_get_config/set_config 依赖）。"""

    def test_my_tags_mapped_in_config_key_map(self):
        assert CONFIG_KEY_MAP["myTags"] == "my_tags"

    def test_my_tags_field_exists_on_config(self):
        config = Config()
        assert hasattr(config, "my_tags")


if __name__ == "__main__":
    unittest.main()
