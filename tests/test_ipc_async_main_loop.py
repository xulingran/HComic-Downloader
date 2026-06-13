"""Tests for the asyncio-based IPC main loop (Stage A).

See docs/superpowers/specs/2026-06-13-ipc-async-main-loop-design.md
"""

import asyncio
import io
import json
import os
import sys
import threading
import time
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"),
)

from config import Config
from python.ipc_server import IPCServer


def _create_test_server():
    """IPCServer with all heavy constructor deps mocked.

    Mirrors the helper in tests/test_ipc_preview.py.
    """
    with (
        patch("config.Config.load", return_value=Config()),
        patch("sources.MultiSourceParser", return_value=MagicMock()),
        patch("downloader.ComicDownloader", return_value=MagicMock()),
        patch("cbz_builder.CBZBuilder", return_value=MagicMock()),
        patch("download_manager.ComicDownloadManager", return_value=MagicMock()),
        patch("download_history.DownloadHistoryDB", return_value=MagicMock()),
        patch("python.ipc_server.CoverCacheDB", return_value=MagicMock()),
    ):
        # NOTE: do NOT mock ThreadPoolExecutor here — these tests want a real
        # _request_executor so we can observe concurrent dispatch.
        server = IPCServer()
    return server


def _drain_responses(server, count, timeout=5.0):
    """Wait until `count` responses have been written to the captured stdout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        text = server._captured_stdout.getvalue()
        lines = [ln for ln in text.splitlines() if ln.strip()]
        if len(lines) >= count:
            return [json.loads(ln) for ln in lines[:count]]
        time.sleep(0.01)
    raise AssertionError(
        f"timed out waiting for {count} responses; got: "
        f"{server._captured_stdout.getvalue()!r}"
    )


def _capture_stdout(server):
    """Redirect server._write_response output to an in-memory buffer."""
    buf = io.StringIO()
    server._captured_stdout = buf
    lock = server._stdout_lock

    def _write(response):
        with lock:
            buf.write(json.dumps(response) + "\n")

    server._write_response = _write


def test_dispatch_request_runs_sync_handler_in_request_executor():
    """A registered sync handler is dispatched to _request_executor and its
    result is written as a JSON-RPC response."""
    server = _create_test_server()
    _capture_stdout(server)

    captured_thread = {}

    def fake_handler():
        captured_thread["name"] = threading.current_thread().name
        return {"ok": True}

    server.handle_get_proxy_status = fake_handler  # type: ignore[attr-defined]

    async def _drive():
        await server._dispatch_request(
            {"jsonrpc": "2.0", "id": 1, "method": "get_proxy_status", "params": {}}
        )

    asyncio.run(_drive())
    server._request_executor.shutdown(wait=True)

    [resp] = _drain_responses(server, 1)
    assert resp == {"jsonrpc": "2.0", "id": 1, "result": {"ok": True}}
    assert captured_thread["name"].startswith("request"), (
        f"handler ran on {captured_thread['name']!r}, "
        "expected a thread from _request_executor (prefix 'request')"
    )
