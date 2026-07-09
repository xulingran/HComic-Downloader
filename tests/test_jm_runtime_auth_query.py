"""JM 运行期鉴权状态查询测试（jm-session-cookie spec）。

覆盖 hasJmAuth 与 _check_source_auth 走运行期凭据而非持久化 source_auth 的契约。
同时覆盖清除认证必须归零运行期鉴权态的契约（auth-clear-runtime-state spec）。
"""

import os
import sys
import threading
from unittest.mock import MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"),
)

from config import Config
from python.ipc.auth_mixin import AuthMixin
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


# ---------------------------------------------------------------------------
# 清除认证必须归零运行期鉴权态（auth-clear-runtime-state spec）
#
# handle_clear_source_auth 必须走 MultiSourceParser.configure_auth（与登录同通道），
# 使 _jm_session_auth（JM）与 source_auth（非 JM）运行期字典归零，而非只清单个
# parser 实例。以下测试用真实 MultiSourceParser 断言运行期状态真实重置，
# 而非仅断言 mock 被调用。证伪：若回退为 per-source parser.configure_auth，
# _jm_session_auth/source_auth 字典不会被清空，get_runtime_auth 仍返回旧值。
# ---------------------------------------------------------------------------


def _auth_mixin_with_real_parser(parser: MultiSourceParser, config: Config) -> AuthMixin:
    """AuthMixin.handle_clear_source_auth 读 self.config/parser/downloader/_config_write_lock。

    用真实 MultiSourceParser + 真实 config + 真实锁 + mock downloader 挂属性即可，
    无需构造完整 IPCServer。
    """
    mixin = AuthMixin()
    mixin.config = config
    mixin.parser = parser
    mixin.downloader = MagicMock()
    mixin._config_write_lock = threading.Lock()
    return mixin


def test_clear_source_auth_jm_resets_runtime_state():
    """清除 JM 认证后运行期 _jm_session_auth 必须归零，get_runtime_auth 返回匿名。

    真实 MultiSourceParser 链路：先运行期登录使 _jm_session_auth 非空，再调
    handle_clear_source_auth("jm")，断言字典、get_runtime_auth、_check_source_auth
    三处都反映为未登录。
    """
    from python.ipc.search_mixin import SearchMixin

    config = Config()
    parser = MultiSourceParser(timeout=5, default_source="hcomic")
    # 运行期登录：_jm_session_auth 非空
    parser.configure_auth(cookie="remember=runtime", user_agent="RUNTIME-UA", source="jm")
    assert parser.get_runtime_auth("jm") == ("remember=runtime", "RUNTIME-UA")
    mixin = _auth_mixin_with_real_parser(parser, config)

    result = mixin.handle_clear_source_auth("jm")

    assert result == {"success": True}
    # 运行期字典归零
    assert parser._jm_session_auth == {"cookie": "", "user_agent": "", "bearer_token": ""}
    # get_runtime_auth 立即反映匿名
    assert parser.get_runtime_auth("jm") == ("", "")
    # _check_source_auth 立即判定未登录
    search = SearchMixin()
    search.config = config
    search.parser = parser
    try:
        search._check_source_auth("jm")
    except AuthRequiredError:
        return
    raise AssertionError("Expected AuthRequiredError for JM after clear")


def test_clear_source_auth_non_jm_resets_runtime_source_auth():
    """清除非 JM 来源认证后运行期 source_auth[<source>] 必须归零。

    真实 MultiSourceParser 链路：对 hcomic 注入运行期 bearer_token 使
    source_auth["hcomic"] 非空，再清除，断言字典与 get_runtime_auth 均归零。
    """
    config = Config()
    parser = MultiSourceParser(timeout=5, default_source="hcomic")
    # 运行期注入：source_auth["hcomic"] 非空
    parser.configure_auth(bearer_token="hcomic-token-xxx", source="hcomic")
    assert parser.source_auth["hcomic"]["bearer_token"] == "hcomic-token-xxx"
    mixin = _auth_mixin_with_real_parser(parser, config)

    result = mixin.handle_clear_source_auth("hcomic")

    assert result == {"success": True}
    # 运行期字典归零
    assert parser.source_auth["hcomic"] == {"cookie": "", "user_agent": "", "bearer_token": ""}
    # get_runtime_auth 立即反映匿名
    assert parser.get_runtime_auth("hcomic") == ("", "")
