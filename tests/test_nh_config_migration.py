"""NH 配置归一化与升级迁移测试（remove-nh-password-login spec）。

验证配置加载收敛 NH 认证为仅 API Key：
- 保留无前缀 / ``Key `` API Key；
- 清空 username / password / cookie / user_agent；
- 清空带 ``User `` / ``Token `` / ``Bearer `` 前缀的旧 bearer_token；
- 检测到旧敏感字段时通过既有原子写入回写磁盘；
- 其他来源配置保持不变。
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest

from config import AuthSourceData, Config


def _write_config(tmpdir: str, raw: dict) -> str:
    path = os.path.join(tmpdir, "config.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(raw, f)
    return path


class TestNhConfigNormalization(unittest.TestCase):
    """``normalize_source_auth`` 收敛 NH 认证为仅 API Key。"""

    def test_preserves_unprefixed_api_key(self):
        normalized = Config._normalize_source_auth(
            {"nh": {"bearer_token": "nh-api-key-xxx"}},
        )
        self.assertEqual(normalized["nh"]["bearer_token"], "nh-api-key-xxx")
        self.assertEqual(normalized["nh"]["cookie"], "")
        self.assertEqual(normalized["nh"]["user_agent"], "")
        self.assertEqual(normalized["nh"].get("username", ""), "")
        self.assertEqual(normalized["nh"].get("password", ""), "")

    def test_preserves_key_prefixed_api_key_without_username_password(self):
        normalized = Config._normalize_source_auth(
            {
                "nh": {
                    "bearer_token": "Key nh-api-key-xxx",
                    "username": "legacy-user",
                    "password": "legacy-pass",
                },
            },
        )
        self.assertEqual(normalized["nh"]["bearer_token"], "nh-api-key-xxx")
        self.assertEqual(normalized["nh"].get("username", ""), "")
        self.assertEqual(normalized["nh"].get("password", ""), "")

    def test_clears_user_token_bearer_token(self):
        normalized = Config._normalize_source_auth(
            {"nh": {"bearer_token": "User legacy-user-token"}},
        )
        self.assertEqual(normalized["nh"]["bearer_token"], "")
        self.assertEqual(normalized["nh"].get("username", ""), "")

    def test_clears_token_prefixed_legacy_bearer_token(self):
        normalized = Config._normalize_source_auth(
            {"nh": {"bearer_token": "Token legacy-token"}},
        )
        self.assertEqual(normalized["nh"]["bearer_token"], "")

    def test_clears_bearer_prefixed_legacy_bearer_token(self):
        normalized = Config._normalize_source_auth(
            {"nh": {"bearer_token": "Bearer legacy-bearer"}},
        )
        self.assertEqual(normalized["nh"]["bearer_token"], "")

    def test_clears_legacy_username_password_cookie_user_agent(self):
        normalized = Config._normalize_source_auth(
            {
                "nh": {
                    "username": "legacy-user",
                    "password": "legacy-pass",
                    "cookie": "sessionid=legacy",
                    "user_agent": "Mozilla/5.0 legacy",
                    "bearer_token": "nh-api-key",
                },
            },
        )
        nh = normalized["nh"]
        self.assertEqual(nh["bearer_token"], "nh-api-key")
        self.assertEqual(nh["cookie"], "")
        self.assertEqual(nh["user_agent"], "")
        self.assertEqual(nh.get("username", ""), "")
        self.assertEqual(nh.get("password", ""), "")

    def test_other_sources_left_intact(self):
        normalized = Config._normalize_source_auth(
            {
                "hcomic": {
                    "cookie": "hc=1",
                    "user_agent": "HC-UA",
                    "bearer_token": "hc-token",
                    "username": "hc-user",
                    "password": "hc-pass",
                },
                "moeimg": {"cookie": "mi=2", "username": "mi-user", "password": "mi-pass"},
                "nh": {"bearer_token": "User old-token", "username": "nh-user", "password": "nh-pass"},
            },
        )
        self.assertEqual(normalized["hcomic"]["cookie"], "hc=1")
        self.assertEqual(normalized["hcomic"]["username"], "hc-user")
        self.assertEqual(normalized["hcomic"]["password"], "hc-pass")
        self.assertEqual(normalized["moeimg"]["cookie"], "mi=2")
        self.assertEqual(normalized["moeimg"]["username"], "mi-user")
        # NH 旧凭据被清空
        self.assertEqual(normalized["nh"]["bearer_token"], "")
        self.assertEqual(normalized["nh"].get("username", ""), "")


class TestNhConfigLoadRewrite(unittest.TestCase):
    """``Config.load`` 检测旧 NH 敏感字段时通过原子写入回写磁盘。"""

    def setUp(self):
        self._tmpdir = tempfile.mkdtemp(prefix="nh-cfg-")
        self.addCleanup(self._cleanup)

    def _cleanup(self):
        import shutil

        shutil.rmtree(self._tmpdir, ignore_errors=True)

    def test_load_strips_legacy_nh_password_from_disk(self):
        raw = {
            "source_auth": {
                "nh": {
                    "username": "nh-user",
                    "password": "nh-password",
                    "bearer_token": "nh-api-key",
                },
            },
        }
        path = _write_config(self._tmpdir, raw)

        Config.load(path)

        with open(path, encoding="utf-8") as f:
            on_disk = json.load(f)
        nh = on_disk["source_auth"]["nh"]
        self.assertEqual(nh.get("bearer_token"), "nh-api-key")
        self.assertEqual(nh.get("username", ""), "")
        self.assertEqual(nh.get("password", ""), "")
        self.assertEqual(nh.get("cookie", ""), "")
        self.assertEqual(nh.get("user_agent", ""), "")

    def test_load_strips_user_token_from_disk_and_marks_unauthenticated(self):
        raw = {
            "source_auth": {
                "nh": {"bearer_token": "User legacy-user-token"},
            },
        }
        path = _write_config(self._tmpdir, raw)

        loaded = Config.load(path)

        self.assertEqual(loaded.get_source_auth("nh")["bearer_token"], "")
        with open(path, encoding="utf-8") as f:
            on_disk = json.load(f)
        self.assertEqual(on_disk["source_auth"]["nh"].get("bearer_token", ""), "")
        self.assertEqual(on_disk["source_auth"]["nh"].get("username", ""), "")

    def test_load_preserves_api_key_and_other_sources(self):
        raw = {
            "source_auth": {
                "hcomic": {
                    "cookie": "hc=1",
                    "user_agent": "HC-UA",
                    "username": "hc-user",
                    "password": "hc-pass",
                },
                "nh": {
                    "bearer_token": "Key nh-api-key",
                    "username": "nh-user",
                    "password": "nh-pass",
                    "cookie": "nh-cookie",
                    "user_agent": "NH-UA",
                },
            },
        }
        path = _write_config(self._tmpdir, raw)

        loaded = Config.load(path)

        # NH 保留 API Key（去 Key 前缀），其余字段清空
        self.assertEqual(loaded.get_source_auth("nh")["bearer_token"], "nh-api-key")
        self.assertEqual(loaded.get_source_auth("nh").get("username", ""), "")
        self.assertEqual(loaded.get_source_auth("nh").get("cookie", ""), "")
        # hcomic 完全保留
        self.assertEqual(loaded.get_source_auth("hcomic")["cookie"], "hc=1")
        self.assertEqual(loaded.get_source_auth("hcomic")["username"], "hc-user")

        with open(path, encoding="utf-8") as f:
            on_disk = json.load(f)
        self.assertEqual(on_disk["source_auth"]["hcomic"]["cookie"], "hc=1")
        self.assertEqual(on_disk["source_auth"]["nh"]["bearer_token"], "nh-api-key")
        self.assertEqual(on_disk["source_auth"]["nh"].get("username", ""), "")

    def test_load_does_not_rewrite_when_nh_already_clean(self):
        raw = {
            "source_auth": {
                "nh": {"bearer_token": "nh-api-key"},
            },
        }
        path = _write_config(self._tmpdir, raw)

        loaded = Config.load(path)
        self.assertEqual(loaded.get_source_auth("nh")["bearer_token"], "nh-api-key")
        # 仅含纯 API Key 的配置不触发回写：内容稳定。
        reloaded = Config.load(path)
        self.assertEqual(reloaded.get_source_auth("nh")["bearer_token"], "nh-api-key")


class TestNhConfigRoundTrip(unittest.TestCase):
    """配置磁盘往返必须保留 API Key，清空其他 NH 字段。"""

    def setUp(self):
        self._tmpdir = tempfile.mkdtemp(prefix="nh-cfg-rt-")
        self.addCleanup(self._cleanup)

    def _cleanup(self):
        import shutil

        shutil.rmtree(self._tmpdir, ignore_errors=True)

    def test_nh_api_key_round_trip_keeps_only_bearer_token(self):
        path = os.path.join(self._tmpdir, "config.json")
        config = Config()
        config.set_source_auth(
            "nh",
            AuthSourceData(bearer_token="nh-api-key"),
        )
        config.save(path)

        loaded = Config.load(path)
        nh = loaded.get_source_auth("nh")
        self.assertEqual(nh["bearer_token"], "nh-api-key")
        self.assertEqual(nh["cookie"], "")
        self.assertEqual(nh["user_agent"], "")
        # set_source_auth 不为 NH 写 username/password（见 1.3/2.x）
        self.assertEqual(nh.get("username", ""), "")
        self.assertEqual(nh.get("password", ""), "")


if __name__ == "__main__":
    unittest.main()
