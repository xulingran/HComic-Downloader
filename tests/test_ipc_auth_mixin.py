"""Tests for AuthMixin: config-save serialization + credential persistence.

覆盖两条契约：
1. _config_write_lock 串行化：set_source_auth + config.save 必须始终在锁内调用，
   parser.login() 必须在锁外，避免并发 os.replace (WinError 5) 与 source_auth
   字典读改写竞态（fix-code-review-findings）。
2. 凭据持久化解耦：登录失败时账号密码仍必须落盘且注入懒登录；apply_auth 不得
   覆盖既有账号密码（credential-persistence spec）。
"""

import os
import sys
import threading
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"),
)

import pytest

from config import AuthSourceData, Config
from python.ipc_server import IPCServer


def _create_test_server():
    """Create an IPCServer instance with all constructor dependencies mocked."""
    with (
        patch("config.Config.load", return_value=Config()),
        patch("sources.MultiSourceParser", return_value=MagicMock()),
        patch("downloader.ComicDownloader", return_value=MagicMock()),
        patch("cbz_builder.CBZBuilder", return_value=MagicMock()),
        patch("download_manager.ComicDownloadManager", return_value=MagicMock()),
        patch("download_history.DownloadHistoryDB", return_value=MagicMock()),
        patch("concurrent.futures.ThreadPoolExecutor", MagicMock()),
        patch("python.ipc_server.CoverCacheDB", return_value=MagicMock()),
    ):
        return IPCServer()


def _wrap_save_with_lock_check(server):
    """包装 config.save，记录调用时 _config_write_lock 是否被持有。

    返回 (save_calls 列表)。threading.Lock 无法直接查询持有状态，故用
    非阻塞 acquire 探测：若能 acquire，说明锁未被持有（save 在锁外）。
    """
    save_calls = []
    original_save = server.config.save

    def _checking_save(path):
        # 非阻塞尝试获取锁：成功 = 锁未被持有（违规），失败 = 锁已持有（正确）
        lock_held = not server._config_write_lock.acquire(blocking=False)
        if lock_held:
            # 释放刚才的 acquire（其实没成功，这里 no-op 安全）
            pass
        else:
            # 探测 acquire 成功，立即释放，恢复原状态
            server._config_write_lock.release()
        save_calls.append(lock_held)
        return original_save(path)

    server.config.save = _checking_save
    return save_calls


# ---------------------------------------------------------------------------
# handle_apply_auth: set_source_auth + save 必须在 _config_write_lock 内
# ---------------------------------------------------------------------------


def test_apply_auth_saves_under_config_write_lock():
    server = _create_test_server()
    save_calls = _wrap_save_with_lock_check(server)

    server.handle_apply_auth(
        "curl 'https://h-comic.link/' -H 'Cookie: sid=abc' -H 'User-Agent: UA'",
        source="hcomic",
    )

    assert len(save_calls) == 1
    assert save_calls[0] is True, "config.save 必须在 _config_write_lock 持有期间调用"


def test_apply_auth_persists_source_auth():
    """apply_auth 落库后 config.source_auth 应包含提取的 cookie/ua。"""
    server = _create_test_server()

    server.handle_apply_auth(
        "curl 'https://h-comic.link/' -H 'Cookie: sid=abc' -H 'User-Agent: UA'",
        source="hcomic",
    )

    hcomic_auth = server.config.get_source_auth("hcomic")
    assert hcomic_auth["cookie"] == "sid=abc"
    assert hcomic_auth["user_agent"] == "UA"


def test_apply_auth_preserves_existing_credentials():
    """curl 登录不得覆盖既有 username/password（credential-persistence spec 场景5）。"""
    server = _create_test_server()
    # 预设已有账号密码（模拟先前账号密码登录成功）
    server.config.set_source_auth(
        "hcomic",
        AuthSourceData(cookie="", user_agent="", bearer_token="old-token", username="alice", password="secret"),
    )

    server.handle_apply_auth(
        "curl 'https://h-comic.link/' -H 'Cookie: sid=abc' -H 'User-Agent: UA'",
        source="hcomic",
    )

    hcomic_auth = server.config.get_source_auth("hcomic")
    # 新 cookie 已写入
    assert hcomic_auth["cookie"] == "sid=abc"
    # 既有账号密码被保留，未被空串覆盖
    assert hcomic_auth["username"] == "alice"
    assert hcomic_auth["password"] == "secret"


def test_apply_auth_jm_source_no_username_fields():
    """jm 来源无 username/password 字段，apply_auth 合并写后行为与原实现一致
    （credential-persistence spec 场景6）。"""
    server = _create_test_server()

    server.handle_apply_auth(
        "curl 'https://jmcomic.example/' -H 'Cookie: jmsid=xyz' -H 'User-Agent: UA'",
        source="jm",
    )

    jm_auth = server.config.get_source_auth("jm")
    # jm 来源不维护 username/password 字段
    assert jm_auth["cookie"] == "jmsid=xyz"
    # get_source_auth 对 jm 不 setdefault username/password，回填值缺失或为空
    assert jm_auth.get("username", "") == ""
    assert jm_auth.get("password", "") == ""


# ---------------------------------------------------------------------------
# 三个登录 handler: login() 留锁外，set_source_auth + save 进锁
# 成功路径为双 save（先凭据、后 token/cookie），断言改为全部在锁内
# ---------------------------------------------------------------------------


def test_moeimg_login_saves_under_config_write_lock():
    server = _create_test_server()
    save_calls = _wrap_save_with_lock_check(server)

    moeimg_parser = MagicMock()
    moeimg_parser.login.return_value = "moeimg-cookie"
    server.parser.parsers = {"moeimg": moeimg_parser}

    result = server.handle_moeimg_login("user1", "pass1")

    assert result == {"success": True, "message": "登录成功"}
    # 成功路径双 save：先持久化凭据，成功后落 cookie；均必须在锁内
    assert len(save_calls) >= 1
    assert all(c is True for c in save_calls), "所有 config.save 必须在 _config_write_lock 持有期间调用"
    moeimg_parser.login.assert_called_once_with("user1", "pass1")
    assert server.config.get_source_auth("moeimg")["cookie"] == "moeimg-cookie"


def test_bika_login_saves_under_config_write_lock():
    server = _create_test_server()
    save_calls = _wrap_save_with_lock_check(server)

    bika_parser = MagicMock()
    bika_parser.login.return_value = "bika-token"
    server.parser.parsers = {"bika": bika_parser}

    result = server.handle_bika_login("user2", "pass2")

    assert result["success"] is True
    assert len(save_calls) >= 1
    assert all(c is True for c in save_calls), "所有 config.save 必须在 _config_write_lock 持有期间调用"
    assert server.config.get_source_auth("bika")["bearer_token"] == "bika-token"


def test_hcomic_login_saves_under_config_write_lock():
    server = _create_test_server()
    save_calls = _wrap_save_with_lock_check(server)

    hcomic_parser = MagicMock()
    hcomic_parser.login.return_value = "hcomic-token"
    server.parser.parsers = {"hcomic": hcomic_parser}

    result = server.handle_hcomic_login("user3", "pass3")

    assert result["success"] is True
    assert len(save_calls) >= 1
    assert all(c is True for c in save_calls), "所有 config.save 必须在 _config_write_lock 持有期间调用"
    assert server.config.get_source_auth("hcomic")["bearer_token"] == "hcomic-token"


# ---------------------------------------------------------------------------
# 登录成功路径：username/password 与 token/cookie 同时写入（spec 场景3）
# ---------------------------------------------------------------------------


def test_moeimg_login_success_persists_credentials_and_cookie():
    server = _create_test_server()
    server.config.save = lambda path: None
    moeimg_parser = MagicMock()
    moeimg_parser.login.return_value = "moeimg-cookie"
    server.parser.parsers = {"moeimg": moeimg_parser}

    server.handle_moeimg_login("u", "p")

    auth = server.config.get_source_auth("moeimg")
    assert auth["cookie"] == "moeimg-cookie"
    assert auth["username"] == "u"
    assert auth["password"] == "p"
    moeimg_parser.set_stored_credentials.assert_called_once_with("u", "p")


def test_bika_login_success_persists_credentials_and_token():
    server = _create_test_server()
    server.config.save = lambda path: None
    bika_parser = MagicMock()
    bika_parser.login.return_value = "bika-token"
    server.parser.parsers = {"bika": bika_parser}

    server.handle_bika_login("u", "p")

    auth = server.config.get_source_auth("bika")
    assert auth["bearer_token"] == "bika-token"
    assert auth["username"] == "u"
    assert auth["password"] == "p"
    bika_parser.set_stored_credentials.assert_called_once_with("u", "p")


def test_hcomic_login_success_persists_credentials_and_token():
    server = _create_test_server()
    server.config.save = lambda path: None
    hcomic_parser = MagicMock()
    hcomic_parser.login.return_value = "hcomic-token"
    server.parser.parsers = {"hcomic": hcomic_parser}

    server.handle_hcomic_login("u", "p")

    auth = server.config.get_source_auth("hcomic")
    assert auth["bearer_token"] == "hcomic-token"
    assert auth["username"] == "u"
    assert auth["password"] == "p"
    hcomic_parser.set_stored_credentials.assert_called_once_with("u", "p")


# ---------------------------------------------------------------------------
# 登录失败路径：凭据仍落盘 + 注入懒登录（spec 场景1/2/4）
# ---------------------------------------------------------------------------


def test_moeimg_login_network_failure_persists_credentials():
    """网络异常导致登录失败时，凭据仍必须落盘且注入懒登录（spec 场景1/4）。"""
    server = _create_test_server()
    save_calls = _wrap_save_with_lock_check(server)

    moeimg_parser = MagicMock()
    moeimg_parser.login.side_effect = RuntimeError("network error")
    server.parser.parsers = {"moeimg": moeimg_parser}

    with pytest.raises(RuntimeError, match="network error"):
        server.handle_moeimg_login("u", "p")

    # 失败路径也必须 save 一次（凭据），且在锁内
    assert len(save_calls) == 1, "登录失败时应 save 一次以持久化凭据"
    assert save_calls[0] is True, "凭据 save 必须在 _config_write_lock 持有期间调用"
    auth = server.config.get_source_auth("moeimg")
    assert auth["username"] == "u"
    assert auth["password"] == "p"
    # 失败也注入懒登录
    moeimg_parser.set_stored_credentials.assert_called_once_with("u", "p")


def test_bika_login_failure_persists_credentials():
    """bika 登录失败（ParserResponseError）时凭据仍落盘且注入懒登录（spec 场景2/4）。"""
    from sources.base import ParserResponseError

    server = _create_test_server()
    save_calls = _wrap_save_with_lock_check(server)

    bika_parser = MagicMock()
    bika_parser.login.side_effect = ParserResponseError("invalid credentials")
    server.parser.parsers = {"bika": bika_parser}

    with pytest.raises(ParserResponseError, match="invalid credentials"):
        server.handle_bika_login("u", "p")

    assert len(save_calls) == 1, "登录失败时应 save 一次以持久化凭据"
    assert save_calls[0] is True
    auth = server.config.get_source_auth("bika")
    assert auth["username"] == "u"
    assert auth["password"] == "p"
    bika_parser.set_stored_credentials.assert_called_once_with("u", "p")


def test_hcomic_login_failure_persists_credentials():
    """hcomic 登录失败时凭据仍落盘且注入懒登录（spec 场景4）。"""
    server = _create_test_server()
    save_calls = _wrap_save_with_lock_check(server)

    hcomic_parser = MagicMock()
    hcomic_parser.login.side_effect = RuntimeError("network error")
    server.parser.parsers = {"hcomic": hcomic_parser}

    with pytest.raises(RuntimeError, match="network error"):
        server.handle_hcomic_login("u", "p")

    assert len(save_calls) == 1, "登录失败时应 save 一次以持久化凭据"
    assert save_calls[0] is True
    auth = server.config.get_source_auth("hcomic")
    assert auth["username"] == "u"
    assert auth["password"] == "p"
    hcomic_parser.set_stored_credentials.assert_called_once_with("u", "p")


def test_failed_login_then_successful_relogin_updates_token():
    """登录失败保留旧 token，再次成功登录后写入新 token（边界回归）。"""
    server = _create_test_server()
    server.config.save = lambda path: None
    hcomic_parser = MagicMock()
    hcomic_parser.login.side_effect = [RuntimeError("network"), "new-token"]
    server.parser.parsers = {"hcomic": hcomic_parser}

    with pytest.raises(RuntimeError):
        server.handle_hcomic_login("u", "p")
    # 失败后凭据已存，token 仍空
    auth_after_fail = server.config.get_source_auth("hcomic")
    assert auth_after_fail["username"] == "u"
    assert auth_after_fail["bearer_token"] == ""

    # 成功重登后写入新 token
    server.handle_hcomic_login("u", "p")
    auth_after_ok = server.config.get_source_auth("hcomic")
    assert auth_after_ok["bearer_token"] == "new-token"
    assert auth_after_ok["username"] == "u"


# ---------------------------------------------------------------------------
# 并发：两个登录 handler 并发不应相互损坏 source_auth 字典
# 用真实线程 + 真实 _config_write_lock 验证串行化正确性
# ---------------------------------------------------------------------------


def test_concurrent_logins_do_not_corrupt_source_auth():
    """moeimg 与 bika 登录并发执行，最终两个来源的 source_auth 都应正确落库。"""
    server = _create_test_server()
    # save 直接写内存（不落盘），保留真实 set_source_auth 字典操作
    server.config.save = lambda path: None

    moeimg_parser = MagicMock()
    moeimg_parser.login.return_value = "moeimg-cookie"
    bika_parser = MagicMock()
    bika_parser.login.return_value = "bika-token"
    server.parser.parsers = {"moeimg": moeimg_parser, "bika": bika_parser}

    errors = []

    def _do_moeimg():
        try:
            server.handle_moeimg_login("u", "p")
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    def _do_bika():
        try:
            server.handle_bika_login("u", "p")
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    threads = [threading.Thread(target=_do_moeimg) for _ in range(5)] + [
        threading.Thread(target=_do_bika) for _ in range(5)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == [], f"并发登录不应抛错: {errors}"
    # 两个来源的认证信息都应被保留（未被对方覆盖）
    assert server.config.get_source_auth("moeimg")["cookie"] == "moeimg-cookie"
    assert server.config.get_source_auth("moeimg")["username"] == "u"
    assert server.config.get_source_auth("bika")["bearer_token"] == "bika-token"
    assert server.config.get_source_auth("bika")["username"] == "u"
