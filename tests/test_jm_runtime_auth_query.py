"""JM 运行期鉴权状态查询测试（jm-session-cookie spec）。

覆盖 hasJmAuth 与 _check_source_auth 走运行期凭据而非持久化 source_auth 的契约。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"),
)

from config import Config
from python.ipc.config_mixin import ConfigMixin
from python.ipc.types import AuthRequiredError
from sources import MultiSourceParser


def _config_mixin_with(parser: MultiSourceParser, config: Config) -> ConfigMixin:
    """ConfigMixin.handle_get_config 只读 self.config 与 self.parser，裸实例 + 挂属性即可。"""
    mixin = ConfigMixin()
    mixin.config = config
    mixin.parser = parser
    return mixin


def test_has_jm_auth_false_when_not_logged_in_with_persisted_residue():
    """未运行期登录时，即使持久化残留 jm cookie，hasJmAuth 必须为 false（禁止假阳性）。"""
    config = Config()
    config.source_auth["jm"] = {"cookie": "remember=PERSISTED", "user_agent": "OLD-UA"}
    parser = MultiSourceParser(
        timeout=5,
        default_source="hcomic",
        source_auth={"jm": {"cookie": "remember=PERSISTED", "user_agent": "OLD-UA"}},
    )
    mixin = _config_mixin_with(parser, config)

    result = mixin.handle_get_config()
    assert result["config"]["hasJmAuth"] is False


def test_has_jm_auth_true_after_runtime_login():
    """运行期登录后 hasJmAuth 必须为 true，即使 config.source_auth["jm"] 为空。"""
    config = Config()  # 无 jm cookie
    parser = MultiSourceParser(timeout=5, default_source="hcomic")
    parser.configure_auth(cookie="remember=runtime", user_agent="RUNTIME-UA", source="jm")
    mixin = _config_mixin_with(parser, config)

    result = mixin.handle_get_config()
    assert result["config"]["hasJmAuth"] is True


def test_check_source_auth_jm_passes_after_runtime_login():
    """运行期登录后 _check_source_auth("jm") 必须放行（不抛 AuthRequiredError）。"""
    from python.ipc.search_mixin import SearchMixin

    mixin = SearchMixin()
    mixin.config = Config()
    mixin.parser = MultiSourceParser(timeout=5, default_source="hcomic")
    mixin.parser.configure_auth(cookie="remember=runtime", user_agent="UA", source="jm")
    # 不抛即通过
    mixin._check_source_auth("jm")


def test_check_source_auth_jm_rejects_when_only_persisted_residue():
    """未运行期登录、仅持久化残留时，_check_source_auth("jm") 必须抛 AuthRequiredError。"""
    from python.ipc.search_mixin import SearchMixin

    mixin = SearchMixin()
    mixin.config = Config()
    mixin.config.source_auth["jm"] = {"cookie": "remember=PERSISTED", "user_agent": "OLD-UA"}
    mixin.parser = MultiSourceParser(
        timeout=5,
        default_source="hcomic",
        source_auth={"jm": {"cookie": "remember=PERSISTED", "user_agent": "OLD-UA"}},
    )
    try:
        mixin._check_source_auth("jm")
    except AuthRequiredError as e:
        assert "jm 未登录" in str(e)
        return
    raise AssertionError("Expected AuthRequiredError for JM with only persisted residue")
