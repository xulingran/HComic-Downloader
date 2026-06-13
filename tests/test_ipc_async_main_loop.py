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
    raise AssertionError(f"timed out waiting for {count} responses; got: " f"{server._captured_stdout.getvalue()!r}")


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
        await server._dispatch_request({"jsonrpc": "2.0", "id": 1, "method": "get_proxy_status", "params": {}})

    asyncio.run(_drive())
    server._request_executor.shutdown(wait=True)

    [resp] = _drain_responses(server, 1)
    assert resp == {"jsonrpc": "2.0", "id": 1, "result": {"ok": True}}
    assert captured_thread["name"].startswith("request"), (
        f"handler ran on {captured_thread['name']!r}, " "expected a thread from _request_executor (prefix 'request')"
    )


def test_dispatch_request_handles_concurrent_handlers():
    """N concurrently-dispatched sync handlers must be able to overlap in time.

    Uses a Barrier: every handler blocks until all N participants arrive.
    If dispatch were serialized, the Barrier would dead-lock and time out.
    """
    server = _create_test_server()
    _capture_stdout(server)

    n = 4
    barrier = threading.Barrier(n, timeout=5.0)
    arrived = []
    arrived_lock = threading.Lock()

    def make_blocking_handler(idx):
        def _h():
            with arrived_lock:
                arrived.append(idx)
            barrier.wait()
            return {"idx": idx}

        return _h

    # Register fake handlers under existing method names so _HANDLER_NAMES routes.
    fake_method_to_handler = {
        "get_proxy_status": make_blocking_handler(0),
        "get_available_fonts": make_blocking_handler(1),
        "get_cache_stats": make_blocking_handler(2),
        "get_history": make_blocking_handler(3),
    }
    for method, fn in fake_method_to_handler.items():
        attr = server._HANDLER_NAMES[method]
        setattr(server, attr, fn)
        # 重新计算 handler_param_keys（fake handler 是无参 def _h()）
        server._handler_param_keys[attr] = set()

    async def _drive():
        await asyncio.gather(
            *[
                server._dispatch_request({"jsonrpc": "2.0", "id": i, "method": method, "params": {}})
                for i, method in enumerate(fake_method_to_handler.keys())
            ]
        )

    asyncio.run(_drive())
    server._request_executor.shutdown(wait=True)

    assert sorted(arrived) == [0, 1, 2, 3], (
        f"not all handlers reached the barrier: {arrived!r}; "
        "this means dispatch was serialized rather than concurrent"
    )
    responses = _drain_responses(server, n)
    response_ids = sorted(r["id"] for r in responses)
    assert response_ids == [0, 1, 2, 3]


def test_dispatch_request_runs_async_handler_directly_on_loop():
    """If a handler is `async def`, _dispatch_request must await it on the
    loop directly (not submit to executor). This is the Stage B back-door."""
    server = _create_test_server()
    _capture_stdout(server)

    main_thread_name = threading.current_thread().name
    captured = {}

    async def fake_async_handler():
        captured["thread"] = threading.current_thread().name
        return {"async": True}

    server.handle_get_proxy_status = fake_async_handler  # type: ignore[attr-defined]
    server._handler_param_keys[server._HANDLER_NAMES["get_proxy_status"]] = set()

    async def _drive():
        await server._dispatch_request({"jsonrpc": "2.0", "id": 42, "method": "get_proxy_status", "params": {}})

    asyncio.run(_drive())

    [resp] = _drain_responses(server, 1)
    assert resp == {"jsonrpc": "2.0", "id": 42, "result": {"async": True}}
    assert captured["thread"] == main_thread_name, (
        f"async handler ran on {captured['thread']!r}, "
        "expected the test's main thread (the loop runs on the calling thread)"
    )


def test_concurrent_responses_are_written_atomically():
    """Even if multiple handlers complete simultaneously and each emits a
    multi-line-ish JSON payload, _stdout_lock must serialize writes so the
    captured output parses as N independent JSON objects (one per line)."""
    server = _create_test_server()
    _capture_stdout(server)

    n = 6
    payload_chars = 200  # large enough to expose partial-write interleaving

    def big_payload_handler():
        return {"blob": "X" * payload_chars}

    methods = [
        "get_proxy_status",
        "get_available_fonts",
        "get_cache_stats",
        "get_history",
        "get_jmcomic_domains",
        "get_favourite_tags",
    ]
    for m in methods:
        attr = server._HANDLER_NAMES[m]
        setattr(server, attr, big_payload_handler)
        server._handler_param_keys[attr] = set()

    async def _drive():
        await asyncio.gather(
            *[
                server._dispatch_request({"jsonrpc": "2.0", "id": i, "method": methods[i], "params": {}})
                for i in range(n)
            ]
        )

    asyncio.run(_drive())
    server._request_executor.shutdown(wait=True)

    raw = server._captured_stdout.getvalue()
    lines = [ln for ln in raw.splitlines() if ln.strip()]
    assert len(lines) == n, f"expected {n} lines, got {len(lines)}: {raw!r}"
    parsed_ids = sorted(json.loads(ln)["id"] for ln in lines)
    assert parsed_ids == list(range(n))


def test_handle_line_routes_unknown_method_to_minus32601():
    server = _create_test_server()
    _capture_stdout(server)

    asyncio.run(server._handle_line(json.dumps({"jsonrpc": "2.0", "id": 9, "method": "no_such_method"})))

    [resp] = _drain_responses(server, 1)
    assert resp["error"]["code"] == -32601


def test_handle_line_rejects_non_object_params():
    server = _create_test_server()
    _capture_stdout(server)

    asyncio.run(server._handle_line(json.dumps({"jsonrpc": "2.0", "id": 11, "method": "x", "params": [1, 2]})))

    [resp] = _drain_responses(server, 1)
    assert resp["error"]["code"] == -32602
    assert "must be an object" in resp["error"]["message"]


def test_handle_line_handles_invalid_json():
    server = _create_test_server()
    _capture_stdout(server)

    asyncio.run(server._handle_line("{not json"))

    [resp] = _drain_responses(server, 1)
    assert resp["error"]["code"] == -32700
    assert resp["id"] is None


def test_handle_shutdown_shuts_down_request_executor():
    """handle_shutdown must shut down all three executors so no work
    survives between the response being sent and stdin EOF arriving."""
    server = _create_test_server()
    server._download_manager.tasks = {}
    server._download_manager.stop = MagicMock()
    server._download_manager._worker_thread = None

    server._cover_executor = MagicMock()
    server._preview_executor = MagicMock()
    server._request_executor = MagicMock()

    server.handle_shutdown()

    server._cover_executor.shutdown.assert_called_once_with(cancel_futures=True, wait=False)
    server._preview_executor.shutdown.assert_called_once_with(cancel_futures=True, wait=False)
    server._request_executor.shutdown.assert_called_once_with(cancel_futures=True, wait=False)
