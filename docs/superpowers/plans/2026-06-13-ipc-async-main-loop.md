# IPC 主循环异步化（阶段 A）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `IPCServer.run()` 从同步主循环改造为 asyncio 主循环 + 三池隔离的线程池调度，使设置页加载场景下 `get_jmcomic_domains` 与多个 `verify_auth` 能并发执行；为阶段 B（部分 handler 升级为 `async def`）保留零成本接口。

**Architecture:** 一个 daemon reader 线程阻塞读 stdin、用 `asyncio.run_coroutine_threadsafe` 把每行 JSON-RPC 请求送入主线程的 event loop；event loop 中 `_dispatch_request` 通过 `inspect.iscoroutinefunction` 判断 handler 类型，同步 handler 经 `loop.run_in_executor(_request_executor, ...)` 下放到默认请求池（8 workers），cover/preview 仍走各自的专用池（4 workers）。

**Tech Stack:** Python 3.11+（已使用），`asyncio`、`concurrent.futures.ThreadPoolExecutor`、`threading`、`inspect`、pytest、unittest.mock。

**Source spec:** `docs/superpowers/specs/2026-06-13-ipc-async-main-loop-design.md`

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `python/ipc/types.py` | 新增常量 `_REQUEST_POOL_MAX_WORKERS = 8` |
| `python/ipc_server.py` | 主循环改造：新增 `_async_main` / `_stdin_reader_loop` / `_on_dispatch_done` / `_handle_line` / `_dispatch_request` / `_shutdown_executors`；删除 `handle_request` / 三个 `_async_*` 包装器；`__init__` 中新增 `_request_executor` |
| `python/ipc/download_mixin.py` | `handle_shutdown` 末尾追加关停 `_request_executor` |
| `tests/test_ipc_async_main_loop.py` | 新增：4 个并发与调度行为单元测试 |

> 注：parser、downloader、所有非 `download_mixin` 的 mixin、所有 handler 函数体——一行不动。

---

## Task 1：新增 `_REQUEST_POOL_MAX_WORKERS` 常量

**Files:**
- Modify: `python/ipc/types.py`

- [ ] **Step 1.1：定位常量声明区**

打开 `python/ipc/types.py`，找到这两行（约 40-41 行）：

```python
_COVER_POOL_MAX_WORKERS = 4
_PREVIEW_POOL_MAX_WORKERS = 4
```

- [ ] **Step 1.2：在它们之后追加新常量**

修改后该区段为：

```python
_COVER_POOL_MAX_WORKERS = 4
_PREVIEW_POOL_MAX_WORKERS = 4
_REQUEST_POOL_MAX_WORKERS = 8
```

- [ ] **Step 1.3：运行既有测试，确认没有 import 错误**

Run: `pytest tests/test_ipc_preview.py tests/test_ipc_config_mapping.py -v`

Expected: PASS（这两个文件直接 import IPCServer，能验证 types.py 模块加载正常）

- [ ] **Step 1.4：Commit**

```bash
git add python/ipc/types.py
git commit -m "feat(ipc): 新增 _REQUEST_POOL_MAX_WORKERS 常量

为 IPC 主循环异步化阶段 A 准备：默认请求池容量 8。"
```

---

## Task 2：在 `IPCServer.__init__` 中创建 `_request_executor`

**Files:**
- Modify: `python/ipc_server.py`（约第 33-40 行 import；约第 119-128 行 executor 创建段）

- [ ] **Step 2.1：扩展 types.py 的 re-import 列表**

打开 `python/ipc_server.py`，找到这段 import（约第 33-40 行）：

```python
from ipc.types import (  # noqa: E402,F401
    _COVER_POOL_MAX_WORKERS,
    _PREVIEW_IMAGE_MAX_SIZE,
    _PREVIEW_POOL_MAX_WORKERS,
    CONFIG_KEY_MAP,
    AuthRequiredError,
    _get_config_path,
)
```

把它替换为：

```python
from ipc.types import (  # noqa: E402,F401
    _COVER_POOL_MAX_WORKERS,
    _PREVIEW_IMAGE_MAX_SIZE,
    _PREVIEW_POOL_MAX_WORKERS,
    _REQUEST_POOL_MAX_WORKERS,
    CONFIG_KEY_MAP,
    AuthRequiredError,
    _get_config_path,
)
```

- [ ] **Step 2.2：在 cover/preview executor 创建之后追加 request executor**

定位 `__init__` 中既有的两段（约第 119-128 行）：

```python
self._cover_executor = ThreadPoolExecutor(max_workers=_COVER_POOL_MAX_WORKERS, thread_name_prefix="cover")
try:
    # Reader page fetches must not queue behind cover thumbnails.
    self._preview_executor = ThreadPoolExecutor(
        max_workers=_PREVIEW_POOL_MAX_WORKERS, thread_name_prefix="preview"
    )
except Exception:
    self._cover_executor.shutdown(cancel_futures=True, wait=False)
    raise
```

把它替换为（在 try 块内追加 request executor 创建，并扩展失败处理使其释放已建立的两个池）：

```python
self._cover_executor = ThreadPoolExecutor(max_workers=_COVER_POOL_MAX_WORKERS, thread_name_prefix="cover")
try:
    # Reader page fetches must not queue behind cover thumbnails.
    self._preview_executor = ThreadPoolExecutor(
        max_workers=_PREVIEW_POOL_MAX_WORKERS, thread_name_prefix="preview"
    )
except Exception:
    self._cover_executor.shutdown(cancel_futures=True, wait=False)
    raise
try:
    # General-purpose request pool for all non-cover/non-preview handlers.
    # See docs/superpowers/specs/2026-06-13-ipc-async-main-loop-design.md
    self._request_executor = ThreadPoolExecutor(
        max_workers=_REQUEST_POOL_MAX_WORKERS, thread_name_prefix="request"
    )
except Exception:
    self._cover_executor.shutdown(cancel_futures=True, wait=False)
    self._preview_executor.shutdown(cancel_futures=True, wait=False)
    raise
```

- [ ] **Step 2.3：运行既有 IPC 测试**

Run: `pytest tests/test_ipc_preview.py tests/test_ipc_config_mapping.py tests/test_ipc_download_chapters.py tests/test_ipc_download_conflict.py -v`

Expected: PASS（既有测试 mock 了 `concurrent.futures.ThreadPoolExecutor`，新增的第三次构造调用同样被 mock 覆盖）

- [ ] **Step 2.4：Commit**

```bash
git add python/ipc_server.py
git commit -m "feat(ipc): 新增 _request_executor 默认请求池

8 worker 的通用请求池，与 cover/preview 池隔离，
为下一步主循环异步化做准备。"
```

---

## Task 3：编写 `_handle_line` 与 `_dispatch_request` 单元测试（先写失败测试）

**Files:**
- Create: `tests/test_ipc_async_main_loop.py`

- [ ] **Step 3.1：新建测试文件，写入完整骨架与第一个测试**

创建 `tests/test_ipc_async_main_loop.py`，内容如下：

```python
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
```

- [ ] **Step 3.2：运行该测试，确认它当前失败（缺 `_dispatch_request`）**

Run: `pytest tests/test_ipc_async_main_loop.py::test_dispatch_request_runs_sync_handler_in_request_executor -v`

Expected: FAIL with `AttributeError: 'IPCServer' object has no attribute '_dispatch_request'`

- [ ] **Step 3.3：Commit 失败测试**

```bash
git add tests/test_ipc_async_main_loop.py
git commit -m "test(ipc): 异步主循环 dispatch sync handler 失败用例

TDD：在实现 _dispatch_request 之前先固定行为契约。"
```

---

## Task 4：实现 `_dispatch_request`（让 Task 3 的测试通过）

**Files:**
- Modify: `python/ipc_server.py`（在 `handle_request` 之后追加新方法；保留 `handle_request` 暂不删，下一个 task 才删）

- [ ] **Step 4.1：在 import 区追加 `asyncio`**

`python/ipc_server.py` 顶部 `import inspect` 之后（约第 1-7 行附近）追加：

```python
import asyncio
```

最终 import 区前 7 行应该是：

```python
import asyncio
import inspect
import json
import logging
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
```

- [ ] **Step 4.2：在 `handle_request` 方法定义结束之后追加 `_dispatch_request`**

在 `IPCServer` 类中，紧跟现有的 `handle_request(self, request: dict) -> dict` 方法定义结束之后（约第 301 行 `}` 之后）追加：

```python
    async def _dispatch_request(self, request: dict) -> None:
        """Asyncio dispatch path: route a request to its handler.

        - For ``async def`` handlers, await directly on the running loop
          (Stage B back-door).
        - For sync handlers, submit to ``_request_executor`` via
          ``loop.run_in_executor`` so the main loop stays responsive.
        """
        method = request.get("method")
        req_id = request.get("id")
        params = request.get("params", {})

        if not method or not isinstance(method, str):
            self._write_response(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32600, "message": "Missing or invalid method"},
                }
            )
            return

        attr_name = self._HANDLER_NAMES.get(method)
        if not attr_name:
            self._write_response(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32601, "message": f"Method not found: {method}"},
                }
            )
            return

        handler = getattr(self, attr_name)
        param_keys = self._handler_param_keys.get(attr_name)
        valid_params = (
            {k: v for k, v in params.items() if k in param_keys}
            if param_keys is not None
            else params
        )

        loop = asyncio.get_running_loop()
        try:
            if inspect.iscoroutinefunction(handler):
                # Stage B back-door: async handlers run directly on the loop.
                result = await handler(**valid_params)
            else:
                # NOTE: lambda must capture `handler` and `valid_params` from
                # this call's local scope. Do not refactor to reuse variables
                # across iterations without re-checking closure semantics.
                result = await loop.run_in_executor(
                    self._request_executor,
                    lambda: handler(**valid_params),
                )
            self._write_response({"jsonrpc": "2.0", "id": req_id, "result": result})
        except AuthRequiredError as e:
            self._write_response(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32001, "message": str(e)},
                }
            )
        except TypeError as e:
            logger.warning("Handler %s received invalid params: %s", method, e)
            self._write_response(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32602, "message": f"Invalid params: {e}"},
                }
            )
        except Exception as e:
            logger.error("Handler error for %s: %s", method, e, exc_info=True)
            self._write_response(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32000, "message": str(e)},
                }
            )
```

- [ ] **Step 4.3：运行 Task 3 的测试，确认通过**

Run: `pytest tests/test_ipc_async_main_loop.py::test_dispatch_request_runs_sync_handler_in_request_executor -v`

Expected: PASS

- [ ] **Step 4.4：跑一遍既有 IPC 套件回归**

Run: `pytest tests/test_ipc_preview.py tests/test_ipc_config_mapping.py tests/test_ipc_download_chapters.py tests/test_ipc_download_conflict.py -v`

Expected: PASS

- [ ] **Step 4.5：Commit**

```bash
git add python/ipc_server.py
git commit -m "feat(ipc): 实现 _dispatch_request 异步路由

按 inspect.iscoroutinefunction 区分同步/异步 handler；
同步走 run_in_executor 投递到 _request_executor，
异步走直接 await（阶段 B 后门）。错误码与
原 handle_request 保持一致。"
```

---

## Task 5：编写并发测试（重叠时间窗口）

**Files:**
- Modify: `tests/test_ipc_async_main_loop.py`（追加新测试）

- [ ] **Step 5.1：在测试文件末尾追加并发测试**

把以下函数追加到 `tests/test_ipc_async_main_loop.py` 末尾：

```python
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
                server._dispatch_request(
                    {"jsonrpc": "2.0", "id": i, "method": method, "params": {}}
                )
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
```

- [ ] **Step 5.2：运行新测试**

Run: `pytest tests/test_ipc_async_main_loop.py::test_dispatch_request_handles_concurrent_handlers -v`

Expected: PASS（4 个 handler 都进入 Barrier 即证明它们重叠执行；如果 dispatch 串行化，Barrier 会超时报错）

- [ ] **Step 5.3：Commit**

```bash
git add tests/test_ipc_async_main_loop.py
git commit -m "test(ipc): 验证 _dispatch_request 多 handler 重叠执行

用 threading.Barrier 强制 N 个 handler 必须同时进入
等待状态，串行化执行会触发 5s 超时。"
```

---

## Task 6：编写并实现 async handler 后门测试

**Files:**
- Modify: `tests/test_ipc_async_main_loop.py`

- [ ] **Step 6.1：追加 async handler 测试**

把以下函数追加到 `tests/test_ipc_async_main_loop.py` 末尾：

```python
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
        await server._dispatch_request(
            {"jsonrpc": "2.0", "id": 42, "method": "get_proxy_status", "params": {}}
        )

    asyncio.run(_drive())

    [resp] = _drain_responses(server, 1)
    assert resp == {"jsonrpc": "2.0", "id": 42, "result": {"async": True}}
    assert captured["thread"] == main_thread_name, (
        f"async handler ran on {captured['thread']!r}, "
        "expected the test's main thread (the loop runs on the calling thread)"
    )
```

- [ ] **Step 6.2：运行**

Run: `pytest tests/test_ipc_async_main_loop.py::test_dispatch_request_runs_async_handler_directly_on_loop -v`

Expected: PASS（实现已就绪，因为 Task 4 的 `inspect.iscoroutinefunction` 分支早已写好）

- [ ] **Step 6.3：Commit**

```bash
git add tests/test_ipc_async_main_loop.py
git commit -m "test(ipc): 验证 async def handler 直接 await 而不下放 executor

阶段 B 后门契约：iscoroutinefunction(handler) 命中时
应在 event loop 线程上直接 await。"
```

---

## Task 7：编写并实现 stdout 原子性测试

**Files:**
- Modify: `tests/test_ipc_async_main_loop.py`

- [ ] **Step 7.1：追加原子性测试**

把以下函数追加到 `tests/test_ipc_async_main_loop.py` 末尾：

```python
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
                server._dispatch_request(
                    {"jsonrpc": "2.0", "id": i, "method": methods[i], "params": {}}
                )
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
```

- [ ] **Step 7.2：运行**

Run: `pytest tests/test_ipc_async_main_loop.py::test_concurrent_responses_are_written_atomically -v`

Expected: PASS

- [ ] **Step 7.3：Commit**

```bash
git add tests/test_ipc_async_main_loop.py
git commit -m "test(ipc): 并发响应原子写入断言

_stdout_lock 必须保证 N 个并发完成的 handler 输出
为 N 个独立可解析的 JSON 行。"
```

---

## Task 8：实现 `_handle_line` 异步入口

**Files:**
- Modify: `python/ipc_server.py`（在 `_dispatch_request` 之后追加新方法）

- [ ] **Step 8.1：在 `_dispatch_request` 末尾追加 `_handle_line`**

在 `IPCServer` 类内、`_dispatch_request` 方法定义结束之后追加：

```python
    async def _handle_line(self, line: str) -> None:
        """Async entry point for a single stdin line.

        Reproduces the special-case routing previously done by run() for
        cover/preview fetches, then delegates everything else to
        _dispatch_request.
        """
        req_id = None
        try:
            request = json.loads(line)
            method = request.get("method")
            req_id = request.get("id")
            params = request.get("params", {})

            if not isinstance(params, dict):
                self._write_response(
                    {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": {
                            "code": -32602,
                            "message": "Invalid params: must be an object",
                        },
                    }
                )
                return

            if method == "fetch_cover":
                url = params.get("url", "")
                try:
                    self._validate_cover_url(url)
                except ValueError as e:
                    self._write_response(
                        {
                            "jsonrpc": "2.0",
                            "id": req_id,
                            "error": {"code": -32602, "message": str(e)},
                        }
                    )
                    return
                self._cover_executor.submit(self._async_fetch_cover, url, req_id)
                return

            if method == "fetch_preview_image":
                image_url = params.get("image_url", "")
                scramble_id = params.get("scramble_id", "")
                comic_id = params.get("comic_id", "")
                try:
                    self._validate_preview_image_url(image_url)
                except ValueError as e:
                    self._write_response(
                        {
                            "jsonrpc": "2.0",
                            "id": req_id,
                            "error": {"code": -32602, "message": str(e)},
                        }
                    )
                    return
                self._preview_executor.submit(
                    self._async_fetch_preview_image,
                    image_url,
                    req_id,
                    scramble_id=scramble_id,
                    comic_id=comic_id,
                )
                return

            await self._dispatch_request(request)
        except json.JSONDecodeError as e:
            logger.error("JSON parse error: %s", e, exc_info=True)
            self._write_response(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32700, "message": f"Parse error: {e}"},
                }
            )
        except Exception as e:
            logger.error("Unexpected error: %s", e, exc_info=True)
            self._write_response(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32603, "message": f"Internal error: {e}"},
                }
            )
```

- [ ] **Step 8.2：编写并运行 `_handle_line` 的最小契约测试**

把以下函数追加到 `tests/test_ipc_async_main_loop.py` 末尾：

```python
def test_handle_line_routes_unknown_method_to_minus32601():
    server = _create_test_server()
    _capture_stdout(server)

    asyncio.run(
        server._handle_line(
            json.dumps({"jsonrpc": "2.0", "id": 9, "method": "no_such_method"})
        )
    )

    [resp] = _drain_responses(server, 1)
    assert resp["error"]["code"] == -32601


def test_handle_line_rejects_non_object_params():
    server = _create_test_server()
    _capture_stdout(server)

    asyncio.run(
        server._handle_line(
            json.dumps({"jsonrpc": "2.0", "id": 11, "method": "x", "params": [1, 2]})
        )
    )

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
```

Run: `pytest tests/test_ipc_async_main_loop.py -v`

Expected: 全部 PASS（包括前面 4 个）

- [ ] **Step 8.3：Commit**

```bash
git add python/ipc_server.py tests/test_ipc_async_main_loop.py
git commit -m "feat(ipc): 实现 _handle_line 异步行入口

JSON 解析、params 校验、cover/preview 特判仍走专用池，
其余委托 _dispatch_request。错误码与既有同步主循环一致。"
```

---

## Task 9：实现 reader 线程与 `_async_main` / `_shutdown_executors`，替换 `run()`

**Files:**
- Modify: `python/ipc_server.py`

- [ ] **Step 9.1：在文件顶部追加 `concurrent.futures` 的额外 import**

把第 7 行的 import 行改为：

```python
from concurrent.futures import Future as _ConcurrentFuture
from concurrent.futures import ThreadPoolExecutor
```

- [ ] **Step 9.2：在 `_handle_line` 之后追加 reader、main、shutdown 方法**

```python
    @staticmethod
    def _on_dispatch_done(future: _ConcurrentFuture) -> None:
        """Log scheduling-layer failures (e.g. event loop already closed).

        _handle_line owns its own try/except for normal handler errors;
        this callback only catches exceptions raised before _handle_line ran.
        """
        exc = future.exception()
        if exc is not None:
            logger.error("dispatch failed: %s", exc, exc_info=exc)

    def _stdin_reader_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Daemon reader thread: pump stdin lines into the event loop.

        Uses a blocking ``for raw_line in sys.stdin`` exactly like the old
        synchronous run(); this keeps Windows pipe behaviour identical.
        On EOF the function signals _stop_event so _async_main returns.
        """
        try:
            for raw_line in sys.stdin:
                line = raw_line.strip()
                if not line:
                    continue
                future = asyncio.run_coroutine_threadsafe(self._handle_line(line), loop)
                future.add_done_callback(self._on_dispatch_done)
        except Exception:
            logger.exception("stdin reader crashed")
        finally:
            logger.info("stdin closed, shutting down executors...")
            loop.call_soon_threadsafe(self._stop_event.set)

    async def _async_main(self) -> None:
        self._stop_event = asyncio.Event()
        loop = asyncio.get_running_loop()
        reader_thread = threading.Thread(
            target=self._stdin_reader_loop,
            args=(loop,),
            name="stdin-reader",
            daemon=True,
        )
        reader_thread.start()
        logger.info(
            "IPC Server started (asyncio main loop, request pool %d, "
            "cover pool %d, preview pool %d, cache max %d MB)",
            _REQUEST_POOL_MAX_WORKERS,
            _COVER_POOL_MAX_WORKERS,
            _PREVIEW_POOL_MAX_WORKERS,
            getattr(self.config, "preview_cache_size_limit_mb", 500),
        )
        await self._stop_event.wait()
        self._shutdown_executors()

    def _shutdown_executors(self) -> None:
        self._cover_executor.shutdown(wait=False, cancel_futures=True)
        self._preview_executor.shutdown(wait=False, cancel_futures=True)
        self._request_executor.shutdown(wait=False, cancel_futures=True)
```

- [ ] **Step 9.3：替换原有 `run()` 方法**

定位现有 `def run(self):` 整个方法（约第 364-470 行），把它整段替换为：

```python
    def run(self):
        asyncio.run(self._async_main())
```

- [ ] **Step 9.4：删除三个旧的 `_async_*` 包装器**

定位并删除以下三个方法（约第 303-336 行）：
- `_async_search`
- `_async_sync_favourite_tags`
- `_async_refresh_tag_list`

它们都已经被通用的 `_dispatch_request` 路径替代。

- [ ] **Step 9.5：删除 `handle_request` 方法**

定位并删除整个 `handle_request(self, request: dict) -> dict` 方法（约第 252-301 行）。它已无任何调用方（验证：`grep -rn "handle_request\b" python/ tests/` 应只剩 `_dispatch_request` 内的注释行——没有则更好）。

- [ ] **Step 9.6：运行新测试 + 既有 IPC 测试套件**

Run: `pytest tests/test_ipc_async_main_loop.py tests/test_ipc_preview.py tests/test_ipc_config_mapping.py tests/test_ipc_download_chapters.py tests/test_ipc_download_conflict.py -v`

Expected: 全部 PASS

- [ ] **Step 9.7：grep 确认没有残留引用**

Run: `grep -rn "handle_request\|_async_search\|_async_sync_favourite_tags\|_async_refresh_tag_list" python/ tests/`

Expected: 无任何输出（或仅出现在 spec/plan 文档中——这些不在 grep 范围内）

- [ ] **Step 9.8：Commit**

```bash
git add python/ipc_server.py
git commit -m "feat(ipc): 主循环改造为 asyncio + 三池隔离

- run() 改为 asyncio.run(_async_main())
- 新增 daemon reader 线程读 stdin，run_coroutine_threadsafe 投递
- _on_dispatch_done 记录调度层异常
- 删除 handle_request 与三个 _async_* 包装器（通用路径已覆盖）
- _shutdown_executors 关停三池

设计：docs/superpowers/specs/2026-06-13-ipc-async-main-loop-design.md"
```

---

## Task 10：更新 `handle_shutdown` 关停 `_request_executor`

**Files:**
- Modify: `python/ipc/download_mixin.py`（第 244-245 行附近）

- [ ] **Step 10.1：先编写关停断言测试**

在 `tests/test_ipc_async_main_loop.py` 末尾追加：

```python
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

    server._cover_executor.shutdown.assert_called_once_with(
        cancel_futures=True, wait=False
    )
    server._preview_executor.shutdown.assert_called_once_with(
        cancel_futures=True, wait=False
    )
    server._request_executor.shutdown.assert_called_once_with(
        cancel_futures=True, wait=False
    )
```

- [ ] **Step 10.2：运行测试，确认它失败**

Run: `pytest tests/test_ipc_async_main_loop.py::test_handle_shutdown_shuts_down_request_executor -v`

Expected: FAIL（`_request_executor.shutdown` 没被调用）

- [ ] **Step 10.3：编辑 `python/ipc/download_mixin.py`**

定位 `handle_shutdown` 方法体里这两行（约第 244-245 行）：

```python
        self._cover_executor.shutdown(cancel_futures=True, wait=False)
        self._preview_executor.shutdown(cancel_futures=True, wait=False)
```

在它们之后追加一行：

```python
        self._cover_executor.shutdown(cancel_futures=True, wait=False)
        self._preview_executor.shutdown(cancel_futures=True, wait=False)
        self._request_executor.shutdown(cancel_futures=True, wait=False)
```

- [ ] **Step 10.4：再次运行测试**

Run: `pytest tests/test_ipc_async_main_loop.py::test_handle_shutdown_shuts_down_request_executor -v`

Expected: PASS

- [ ] **Step 10.5：跑完整测试套件回归**

Run: `pytest tests/ -v -x`

Expected: 全部 PASS（如有非 IPC 模块的预先失败，记录但不要为此阻塞 commit；只要 IPC 相关测试都过）

- [ ] **Step 10.6：Commit**

```bash
git add tests/test_ipc_async_main_loop.py python/ipc/download_mixin.py
git commit -m "fix(ipc): handle_shutdown 同步关停 _request_executor

补完三池关停闭环：handle_shutdown 主动关停的池要与
_async_main 在 EOF 路径上关停的池一致，避免 shutdown
返回后到 stdin EOF 之间的窗口期残留任务在跑。"
```

---

## Task 11：手动冒烟与文档收尾

**Files:**
- 无代码改动；冒烟流程 + 可选的 README/CLAUDE.md 增量

- [ ] **Step 11.1：本地启动 Electron + Python 后端，打开设置页观察 verify_auth 并发**

Run: `npm run dev`

打开应用后切到设置页，在 Python 进程日志中应能看到：

```
INFO ... IPC Server started (asyncio main loop, request pool 8, cover pool 4, preview pool 4, cache max 500 MB)
```

并且多个 `verify_auth` / `get_jmcomic_domains` 几乎同一时刻进入处理（旧版本是逐个返回）。

- [ ] **Step 11.2：手动制造 cover 批量请求 + 设置页同时活跃，确认互不阻塞**

在浏览页快速滚动触发 cover 缩略图加载；同时在另一个 tab 切到设置页。观察设置页 verify_auth 不会被 cover 缩略图阻塞。

- [ ] **Step 11.3：触发主进程关闭（Cmd/Ctrl+W 或 quit）观察 shutdown 顺畅退出**

Python 进程日志末尾应包含：

```
INFO ... Shutdown: cancelled <N> active tasks
INFO ... stdin closed, shutting down executors...
```

不应有 `RuntimeError: cannot schedule new futures after shutdown` 等异常堆栈。

- [ ] **Step 11.4：（可选）追加发版说明片段**

如果项目维护 changelog 或 release-notes，追加一行：

> IPC 主循环改造为 asyncio + 三池隔离，设置页加载等场景下多请求改为并发执行。

- [ ] **Step 11.5：合并所有 commit 消息检查、推送前 review**

Run: `git log --oneline master..HEAD`

确认提交序列符合预期（约 9-10 个 commit），无杂乱内容。

---

## 验收清单（对应 spec §11）

- [ ] 设置页加载场景下，前端 6 个并发请求总耗时 ≈ max(RTT)，而非 Σ(RTT)
- [ ] 既有 IPC 测试全部通过：`pytest tests/test_ipc_*.py -v`
- [ ] 启动日志包含三池容量信息（"asyncio main loop, request pool 8, cover pool 4, preview pool 4"）
- [ ] cover 缩略图批量预加载与设置页 verify_auth 互不阻塞（手动验证）
- [ ] `handle_shutdown` 关停三池后，进程能在 stdin EOF 路径上干净退出（手动验证）

---

## Plan Self-Review

**Spec coverage check：**

| Spec 条目 | 对应 Task |
|---|---|
| §4.1 `_REQUEST_POOL_MAX_WORKERS` 常量 | Task 1 |
| §4.2 `__init__` 增加 `_request_executor` + 失败回滚 | Task 2 |
| §4.3.1 `run()` → `asyncio.run(_async_main())` | Task 9.3 |
| §4.3.2 `_async_main` | Task 9.2 |
| §4.3.3 reader 线程 + `_on_dispatch_done` + Windows 注释 | Task 9.2 |
| §4.3.4 `_handle_line`（含 cover/preview 特判 + JSON/params 校验） | Task 8.1 |
| §4.3.5 `_dispatch_request`（iscoroutinefunction + lambda NOTE + 错误码） | Task 4.2 |
| §4.4 删除三个 `_async_*` 包装器 | Task 9.4 |
| §4.5 删除 `handle_request` | Task 9.5 |
| §4.6 `_shutdown_executors` | Task 9.2 |
| §4.7 `handle_shutdown` 同步更新 | Task 10 |
| §7.3 四个新单元测试（dispatch / concurrent / async / atomicity） | Task 3、5、6、7 |
| §11 验收标准 | Task 11 + 验收清单 |

**Placeholder scan：**所有"实现 X"步骤都给出了完整代码块；测试步骤都给出了具体 assert；commit 信息都已写明；无 TBD/TODO。

**类型/命名一致性：**

- `_request_executor` 在 Task 2、4、9、10 中名字一致
- `_dispatch_request` / `_handle_line` / `_async_main` / `_stdin_reader_loop` / `_on_dispatch_done` / `_shutdown_executors` 在所有 task 中拼写一致
- `_REQUEST_POOL_MAX_WORKERS` 在 Task 1（声明）、Task 2（import）、Task 9（日志）中一致
- `_HANDLER_NAMES` / `_handler_param_keys` 在测试和实现中一致
- 错误码 `-32600/-32601/-32602/-32603/-32700/-32000/-32001` 与 spec §6 完全一致

自审通过。
