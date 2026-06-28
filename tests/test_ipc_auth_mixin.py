"""Tests for AuthMixin config-save serialization (fix-code-review-findings).

验证认证 handler 的 set_source_auth + config.save 临界区被 _config_write_lock
串行化：save() 必须始终在锁内调用，避免并发 os.replace (WinError 5) 与
source_auth 字典读改写竞态。
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

from config import Config
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


# ---------------------------------------------------------------------------
# 三个登录 handler: login() 留锁外，set_source_auth + save 进锁
# ---------------------------------------------------------------------------


def test_moeimg_login_saves_under_config_write_lock():
    server = _create_test_server()
    save_calls = _wrap_save_with_lock_check(server)

    moeimg_parser = MagicMock()
    moeimg_parser.login.return_value = "moeimg-cookie"
    server.parser.parsers = {"moeimg": moeimg_parser}

    result = server.handle_moeimg_login("user1", "pass1")

    assert result == {"success": True, "message": "登录成功"}
    assert len(save_calls) == 1
    assert save_calls[0] is True, "config.save 必须在 _config_write_lock 持有期间调用"
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
    assert len(save_calls) == 1
    assert save_calls[0] is True, "config.save 必须在 _config_write_lock 持有期间调用"
    assert server.config.get_source_auth("bika")["bearer_token"] == "bika-token"


def test_hcomic_login_saves_under_config_write_lock():
    server = _create_test_server()
    save_calls = _wrap_save_with_lock_check(server)

    hcomic_parser = MagicMock()
    hcomic_parser.login.return_value = "hcomic-token"
    server.parser.parsers = {"hcomic": hcomic_parser}

    result = server.handle_hcomic_login("user3", "pass3")

    assert result["success"] is True
    assert len(save_calls) == 1
    assert save_calls[0] is True, "config.save 必须在 _config_write_lock 持有期间调用"
    assert server.config.get_source_auth("hcomic")["bearer_token"] == "hcomic-token"


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


# ---------------------------------------------------------------------------
# 登录失败（网络）时不应触达 save 临界区
# ---------------------------------------------------------------------------


def test_moeimg_login_network_failure_skips_save():
    """login() 抛错时不应落库（save 不被调用）。"""
    server = _create_test_server()
    save_calls = _wrap_save_with_lock_check(server)

    moeimg_parser = MagicMock()
    moeimg_parser.login.side_effect = RuntimeError("network error")
    server.parser.parsers = {"moeimg": moeimg_parser}

    import pytest

    with pytest.raises(RuntimeError, match="network error"):
        server.handle_moeimg_login("u", "p")

    assert save_calls == [], "login 失败时不应调用 config.save"
