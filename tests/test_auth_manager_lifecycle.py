"""AuthManager lifecycle safety tests."""
from unittest.mock import Mock, patch

import pytest
import tkinter as tk

from auth_manager import AuthManager
from config import Config
from gui import HComicDownloaderGUI


class _FakeRoot:
    def __init__(self):
        self.exists = True
        self.after_calls = []

    def winfo_exists(self):
        return int(self.exists)

    def after(self, delay, callback):
        self.after_calls.append((delay, callback))
        return "after-id"


class _FakeParser:
    current_source = "hcomic"

    def configure_auth(self, cookie="", user_agent="", source=None):
        pass

    def verify_login_status(self):
        return True, "ok"


class _FakeDownloader:
    def configure_auth(self, cookie="", user_agent=""):
        pass


class _FakeVar:
    def __init__(self):
        self.value = ""

    def set(self, value):
        self.value = value


def _make_auth_manager(root):
    return AuthManager(
        root=root,
        config=Config(),
        parser=_FakeParser(),
        downloader=_FakeDownloader(),
        login_status_var=_FakeVar(),
        go_login_btn=Mock(),
        on_status_update=Mock(),
    )


def test_auth_manager_destroy_prevents_late_ui_dispatch():
    root = _FakeRoot()
    manager = _make_auth_manager(root)

    manager.destroy()
    manager._safe_ui_dispatch(lambda: pytest.fail("callback should not be scheduled"))

    assert root.after_calls == []


def test_auth_manager_guarded_callback_skips_after_root_disappears():
    root = _FakeRoot()
    manager = _make_auth_manager(root)
    called = []

    manager._safe_ui_dispatch(lambda: called.append(True))
    assert len(root.after_calls) == 1

    root.exists = False
    _delay, callback = root.after_calls[0]
    callback()

    assert called == []


def test_auth_manager_safe_dispatch_swallows_destroyed_tk_errors():
    class RaisingRoot(_FakeRoot):
        def winfo_exists(self):
            raise tk.TclError("application has been destroyed")

    manager = _make_auth_manager(RaisingRoot())

    manager._safe_ui_dispatch(lambda: pytest.fail("callback should not run"))


def test_gui_destroy_marks_auth_manager_before_other_cleanup():
    app = object.__new__(HComicDownloaderGUI)
    call_order = []

    app.dl_ctrl = Mock()
    app.dl_ctrl.set_destroying.side_effect = lambda value: call_order.append(("dl_ctrl", value))
    app.auth_manager = Mock()
    app.auth_manager.destroy.side_effect = lambda: call_order.append(("auth_manager", "destroy"))
    app._save_all_settings = lambda: call_order.append(("settings", "save"))
    app.theme_bridge = Mock()
    app.theme_bridge.destroy.side_effect = lambda: call_order.append(("theme", "destroy"))
    app.scroll_handler = Mock()
    app.scroll_handler.destroy.side_effect = lambda: call_order.append(("scroll", "destroy"))
    app.cover_loader = Mock()
    app.cover_loader.clear_pending.side_effect = lambda: call_order.append(("cover", "clear"))
    app.cover_loader.shutdown.side_effect = lambda: call_order.append(("cover", "shutdown"))
    app.download_manager = Mock()

    with patch("gui_app.stop_download_manager_for_shutdown") as stop_manager, \
            patch("tkinter.Tk.destroy", autospec=True) as tk_destroy:
        stop_manager.side_effect = lambda manager: call_order.append(("download_manager", manager))
        tk_destroy.side_effect = lambda _self: call_order.append(("tk", "destroy"))

        HComicDownloaderGUI.destroy(app)

    app.auth_manager.destroy.assert_called_once_with()
    assert call_order.index(("auth_manager", "destroy")) < call_order.index(("settings", "save"))
    assert call_order[-1] == ("tk", "destroy")
