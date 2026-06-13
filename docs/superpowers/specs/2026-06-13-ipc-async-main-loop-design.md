# IPC 主循环异步化设计（阶段 A）

- **日期**：2026-06-13
- **作者**：Zhong（与 brainstorming 助手协作）
- **范围**：`python/ipc_server.py`、`python/ipc/types.py`
- **阶段**：A（asyncio 主循环 + handler 走线程池），为阶段 B（async/await + aiohttp 全链路）预留接口

## 1. 背景与问题

`IPCServer.run()` 当前实现为单线程同步循环：

```
for line in sys.stdin:
    request = json.loads(line)
    if method == "fetch_cover": ...      # 已下放 _cover_executor
    if method == "fetch_preview_image": ...  # 已下放 _preview_executor
    if method in ("search","sync_favourite_tags","refresh_tag_list"): ... # 走 _cover_executor
    response = self.handle_request(request)  # 其余全部同步执行
    self._write_response(response)
```

设置页加载时前端会连发：

- 1 个 `get_jmcomic_domains`（探测多个镜像，HTTP 请求）
- N 个 `verify_auth`（每个 source 各一次 HTTP 请求）

这些方法都未在线程池白名单中，于是在主循环里**严格串行**执行，UI 等待时间是各请求 RTT 之和。

## 2. 目标

1. **设置页场景下**多个 `verify_auth` + `get_jmcomic_domains` 并发执行，等待时间从 Σ(RTT) 降为 max(RTT)
2. **不改动 parser、downloader、所有 mixin、所有 handler 函数体**——改动面控制在主循环与执行器层
3. 为阶段 B（部分 handler 升级为 `async def` + aiohttp）预留**零成本升级路径**

非目标：

- 不引入 aiohttp / async parser
- 不实现请求级取消（仅依赖底层 `requests` timeout）
- 不实现 priority queue / Semaphore 优先级调度
- 不动 `_album_coordinator` 的回调线程模型

## 3. 架构总览

```
[stdin reader 线程]              [event loop 线程（主线程）]
sys.stdin.readline() ────► run_coroutine_threadsafe ──► _handle_line(line)
                                                             │
                                                             ├─ method == "fetch_cover"          → _cover_executor (4 workers)
                                                             ├─ method == "fetch_preview_image"  → _preview_executor (4 workers)
                                                             ├─ inspect.iscoroutinefunction      → 直接 await（B 阶段后门）
                                                             └─ 其余所有 handler                  → _request_executor (8 workers)
```

**三池隔离**：`_cover_executor`、`_preview_executor`、`_request_executor` 各自独立。cover 缩略图批量预加载不会占满 request 池，反之亦然。

**关键不变量**：

- stdout 写入仍由 `_stdout_lock` 保护，多个 handler 并发完成时响应原子写入
- 响应可乱序到达 stdout（前端 `electron/python-bridge.ts:67-71` 已按 `response.id` 在 `pendingRequests` Map 里匹配，已确认安全）
- Handler 函数体本身不动——它们仍是同步 `def`，仍调用同步 `requests`

## 4. 详细设计

### 4.1 新增常量

`python/ipc/types.py`：

```python
_REQUEST_POOL_MAX_WORKERS = 8
```

与既有 `_COVER_POOL_MAX_WORKERS = 4`、`_PREVIEW_POOL_MAX_WORKERS = 4` 并列。

### 4.2 `IPCServer.__init__()` 改动

新增一个执行器（紧挨现有 cover/preview executor）：

```python
self._request_executor = ThreadPoolExecutor(
    max_workers=_REQUEST_POOL_MAX_WORKERS,
    thread_name_prefix="request",
)
```

构造失败时同样要把已建立的 executor 释放，与现有 cover/preview 错误处理风格一致。

### 4.3 主循环改造

#### 4.3.1 入口 `run()`

```python
def run(self) -> None:
    asyncio.run(self._async_main())
```

#### 4.3.2 `_async_main`

```python
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
        "IPC Server started (asyncio main loop, request pool %d, cover pool %d, preview pool %d, cache max %d MB)",
        _REQUEST_POOL_MAX_WORKERS,
        _COVER_POOL_MAX_WORKERS,
        _PREVIEW_POOL_MAX_WORKERS,
        getattr(self.config, "preview_cache_size_limit_mb", 500),
    )
    await self._stop_event.wait()
    self._shutdown_executors()
```

#### 4.3.3 Reader 线程

```python
def _stdin_reader_loop(self, loop: asyncio.AbstractEventLoop) -> None:
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

@staticmethod
def _on_dispatch_done(future: "concurrent.futures.Future") -> None:
    """Log any exception raised during coroutine scheduling itself
    (e.g. event loop already closed). _handle_line owns its own try/except,
    so this only catches scheduling-layer failures."""
    exc = future.exception()
    if exc is not None:
        logger.error("dispatch failed: %s", exc, exc_info=exc)
```

stdin 是阻塞的；`for raw_line in sys.stdin` 会一直读到 EOF。EOF 触发 `_stop_event` 让 `_async_main` 退出。

**Windows 注意**：`for raw_line in sys.stdin` 在 Windows 管道模式下与 `readline()` 行为一致（既有 `run()` 已使用此模式且工作正常），保持当前模式。

#### 4.3.4 `_handle_line`

```python
async def _handle_line(self, line: str) -> None:
    req_id = None
    try:
        request = json.loads(line)
        method = request.get("method")
        req_id = request.get("id")
        params = request.get("params", {})

        if not isinstance(params, dict):
            self._write_response({
                "jsonrpc": "2.0", "id": req_id,
                "error": {"code": -32602, "message": "Invalid params: must be an object"},
            })
            return

        # cover 缩略图：保留专用路径（含 URL 校验）
        if method == "fetch_cover":
            url = params.get("url", "")
            try:
                self._validate_cover_url(url)
            except ValueError as e:
                self._write_response({"jsonrpc": "2.0", "id": req_id,
                    "error": {"code": -32602, "message": str(e)}})
                return
            self._cover_executor.submit(self._async_fetch_cover, url, req_id)
            return

        # 阅读器图片：保留专用路径
        if method == "fetch_preview_image":
            image_url = params.get("image_url", "")
            scramble_id = params.get("scramble_id", "")
            comic_id = params.get("comic_id", "")
            try:
                self._validate_preview_image_url(image_url)
            except ValueError as e:
                self._write_response({"jsonrpc": "2.0", "id": req_id,
                    "error": {"code": -32602, "message": str(e)}})
                return
            self._preview_executor.submit(
                self._async_fetch_preview_image, image_url, req_id,
                scramble_id=scramble_id, comic_id=comic_id,
            )
            return

        await self._dispatch_request(request)
    except json.JSONDecodeError as e:
        logger.error(f"JSON parse error: {e}", exc_info=True)
        self._write_response({"jsonrpc": "2.0", "id": None,
            "error": {"code": -32700, "message": f"Parse error: {e}"}})
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        self._write_response({"jsonrpc": "2.0", "id": req_id,
            "error": {"code": -32603, "message": f"Internal error: {e}"}})
```

#### 4.3.5 `_dispatch_request`（核心）

```python
async def _dispatch_request(self, request: dict) -> None:
    method = request.get("method")
    req_id = request.get("id")
    params = request.get("params", {})

    if not method or not isinstance(method, str):
        self._write_response({"jsonrpc": "2.0", "id": req_id,
            "error": {"code": -32600, "message": "Missing or invalid method"}})
        return

    attr_name = self._HANDLER_NAMES.get(method)
    if not attr_name:
        self._write_response({"jsonrpc": "2.0", "id": req_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"}})
        return

    handler = getattr(self, attr_name)
    param_keys = self._handler_param_keys.get(attr_name)
    valid_params = (
        {k: v for k, v in params.items() if k in param_keys}
        if param_keys is not None else params
    )

    loop = asyncio.get_running_loop()
    try:
        if inspect.iscoroutinefunction(handler):           # B 阶段后门
            result = await handler(**valid_params)
        else:
            # NOTE: lambda 必须在每次调用 _dispatch_request 时捕获独立的局部
            # 变量（handler / valid_params）。不要在循环里复用变量后再传 lambda。
            result = await loop.run_in_executor(
                self._request_executor,
                lambda: handler(**valid_params),
            )
        self._write_response({"jsonrpc": "2.0", "id": req_id, "result": result})
    except AuthRequiredError as e:
        self._write_response({"jsonrpc": "2.0", "id": req_id,
            "error": {"code": -32001, "message": str(e)}})
    except TypeError as e:
        logger.warning("Handler %s received invalid params: %s", method, e)
        self._write_response({"jsonrpc": "2.0", "id": req_id,
            "error": {"code": -32602, "message": f"Invalid params: {e}"}})
    except Exception as e:
        logger.error("Handler error for %s: %s", method, e, exc_info=True)
        self._write_response({"jsonrpc": "2.0", "id": req_id,
            "error": {"code": -32000, "message": str(e)}})
```

### 4.4 既有"白名单旁路"简化

旧代码里 `search` / `sync_favourite_tags` / `refresh_tag_list` 显式投到 `_cover_executor`，并各自有 `_async_search` / `_async_sync_favourite_tags` / `_async_refresh_tag_list` 包装器。新设计下通用路径已经能把任何同步 handler 下放线程池——这三个旁路成为冗余。

**改动**：

- 删除 `_async_search`、`_async_sync_favourite_tags`、`_async_refresh_tag_list` 三个方法
- 删除 `_handle_line` 里对这三个方法的 `if` 特判
- 它们走通用路径，跑在 `_request_executor`（8 workers）

收益：

- 三个长任务从 cover 池（4）转到 request 池（8），不再跟 cover 缩略图抢线程
- cover 池只剩 fetch_cover 用，专注度更高

### 4.5 `handle_request()` 移除

旧 `handle_request(self, request: dict) -> dict` 仅在主循环内被调用一次（`ipc_server.py:451`），无外部测试或模块依赖（已 grep 验证）。

**改动**：删除整个方法（约 50 行）。其全部职责由 `_dispatch_request` 替代。

### 4.6 关停顺序

```python
def _shutdown_executors(self) -> None:
    self._cover_executor.shutdown(wait=False, cancel_futures=True)
    self._preview_executor.shutdown(wait=False, cancel_futures=True)
    self._request_executor.shutdown(wait=False, cancel_futures=True)
```

在 `_async_main` 收到 `_stop_event` 后调用。`cancel_futures=True` 让仍在队列等待的任务被丢弃；已经在跑的等待 `requests` 自身 timeout 自然结束。reader 线程是 daemon，进程退出时随之退出。

### 4.7 `handle_shutdown` 的同步更新（必做）

`python/ipc/download_mixin.py:231-247` 的 `handle_shutdown` 当前关停 `_cover_executor` 和 `_preview_executor`。新增 `_request_executor` 后必须一并关停，否则 shutdown 请求返回后、stdin EOF 触发 `_stop_event` 之前的窗口期，`_request_executor` 中可能仍有任务在跑。

**改动**（在 `handle_shutdown` 现有 cover/preview shutdown 之后追加）：

```python
self._request_executor.shutdown(cancel_futures=True, wait=False)
```

**双重关停说明**：路径是 `handle_shutdown`（在 `_request_executor` 自身的某个线程里执行）→ 关停三池 → 返回响应 → Electron 关闭 stdin → reader 线程 EOF → `_stop_event.set()` → `_async_main` 调 `_shutdown_executors` 再次关停。`ThreadPoolExecutor.shutdown` 重复调用是安全的；保留这种"双重关停"以应对 Electron 异常退出（仅触发 EOF 路径，未发 shutdown）和正常退出（先 shutdown 再 EOF）两种场景。

**`handle_shutdown` 在 `_request_executor` 中跑的阻塞分析**：`handle_shutdown` 内 `wait_active_downloads(timeout=10.0)` 最多阻塞 10 秒，期间占用 `_request_executor` 一个 slot。剩余 7 个 slot 足够其他请求继续工作；这是已知且可接受的行为。

## 5. 并发场景验证

### 5.1 设置页加载（目标场景）

```
T=0ms   reader → run_coroutine_threadsafe (req1: get_jmcomic_domains)
T=0ms   _handle_line → run_in_executor → thread1 (request pool)
T=1ms   reader → req2: verify_auth(hcomic) → thread2
T=2ms   reader → req3: verify_auth(jmcomic) → thread3
T=3ms   reader → req4..req6 → thread4..thread6
...
T=600ms thread4 完成（最快） → _write_response（持锁）
T=900ms thread2 完成 → _write_response
T=1100ms thread1 完成 → _write_response
```

总耗时 ≈ max(单个 RTT) ≈ 1-1.5s，旧串行总耗时 ≈ Σ(RTT) ≈ 4-6s。

### 5.2 设置页 + 浏览页同时活跃

- 设置页占用 request 池 6 个 slot
- 浏览页同时滚动触发 cover 预加载 20+ 请求 → 占用 cover 池（4），其余在 cover 池队列里排队
- 两类请求互不影响

### 5.3 stdout 并发安全

多个 handler 并发完成 → 各自调用 `_write_response` → `_stdout_lock` 串行化 `print(json.dumps(...), flush=True)`。响应原子写入，无交错。

### 5.4 共享状态竞争（已知限制）

| 共享状态 | 旧模型 | 新模型 |
|---|---|---|
| `self.config` | 串行天然安全 | 多 handler 并发读/写存在窗口 |
| `self.parser` | 串行天然安全 | `apply_auth`（写）与 `verify_auth`（读）并发存在窗口 |
| `self.downloader.configure_auth` | 串行天然安全 | 与 `apply_auth` 并发存在窗口 |
| `_history_db` / `_cover_cache` / `_preview_cache` | SQLite 自带连接级锁 | 不受影响 |
| stdout | `_stdout_lock` | `_stdout_lock` |

**具体可能并发的场景**：

1. `handle_set_config`（写 `self.config`）与 `handle_verify_auth`（读 `self.config.source_auth`）——设置页用户切换配置项时若 UI 也触发自动 verify，可能同时到达
2. `handle_apply_auth`（写 `self.parser` + `self.config` + `self.downloader`）与并发的 `handle_verify_auth`（读 `self.parser`）
3. `handle_apply_auth` 与并发的下载/预览请求（间接读 `self.parser` 中的 cookie/token）

**评估**：场景 1 在多 source 设置页中真实可触发；场景 2-3 需要用户明显的并发操作，频率较低。A 阶段允许这些罕见窗口，写入"已知限制"作为后续观察项。如果出现实际问题，B 阶段加 `asyncio.Lock` 或在 mixin 内对写路径加 `threading.Lock` 即可。

## 6. 错误处理

| 错误位置 | 处理 |
|---|---|
| stdin 行解析失败 | `JSONDecodeError` → `-32700` |
| 缺失/非字符串 method | `-32600` |
| 未知 method | `-32601` |
| handler 参数不匹配 | `TypeError` → `-32602` |
| `AuthRequiredError` | `-32001` |
| 其他 handler 异常 | `-32000` |
| `_handle_line` 兜底 | `-32603` |
| `run_in_executor` 抛出（罕见，executor shutdown） | 落到通用 Exception → `-32000` |
| reader 线程内部异常 | `logger.exception`，触发 `_stop_event` |

## 7. 测试策略

### 7.1 现有测试兼容性

测试文件 import 的符号：`IPCServer` 类、`CONFIG_KEY_MAP`、`_get_config_path`、`IPCServer._detect_image_type`。这些不变。

外部代码无 `handle_request()` 调用（已 grep 验证）。

### 7.2 测试入口（如需要）

如有测试需要直接走"路由 → handler → result"的同步路径而不进 executor / event loop，提供：

```python
def _dispatch_request_sync(self, request: dict) -> dict:
    """测试专用：同步路由，绕过 executor 和 event loop。"""
    # 复用 _dispatch_request 的路由逻辑，handler 直接调用
```

仅在确认有测试需要时再加；优先让既有测试用更高层 fixture。

### 7.3 新增单元测试

- `test_async_main_loop_dispatches_handler` — mock 一个 handler，验证经由 stdin → reader → run_coroutine_threadsafe → run_in_executor → handler 调用链
- `test_async_main_loop_handles_concurrent_requests` — 同时 stdin 写入 N 个请求，验证它们能在**重叠时间窗口内**并发执行（用 `threading.Event` / `Barrier` 让所有 handler 进入"等待信号"状态后再统一释放，断言"所有 handler 都进入了 barrier"），不要断言它们一定落在不同线程上以避免线程调度时序导致 flaky
- `test_async_main_loop_async_handler_path` — 注册一个 mock `async def` handler，验证 `iscoroutinefunction` 路径直接 await（B 阶段后门）
- `test_async_main_loop_response_atomicity` — 多个 handler 同时返回，验证 stdout 输出可解析为多个独立 JSON 对象

## 8. 改动清单

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `python/ipc/types.py` | 新增 | `_REQUEST_POOL_MAX_WORKERS = 8` |
| `python/ipc_server.py` | 修改 | 替换 `run()`；新增 `_async_main` / `_stdin_reader_loop` / `_on_dispatch_done` / `_handle_line` / `_dispatch_request` / `_shutdown_executors`；删除 `handle_request` / `_async_search` / `_async_sync_favourite_tags` / `_async_refresh_tag_list`；`__init__` 增加 `_request_executor` |
| `python/ipc/download_mixin.py` | 修改 | `handle_shutdown` 末尾追加 `self._request_executor.shutdown(cancel_futures=True, wait=False)`（详见 §4.7） |
| `tests/` | 新增 | 第 7.3 节四个用例 |

**parser、downloader、所有非 download_mixin 的 mixin、所有 handler 函数体——一行不动。**

**路由覆盖说明**：`fetch_cover` 与 `fetch_preview_image` 不在 `_HANDLER_NAMES` 注册表里，它们走 `_handle_line` 中的特判路径（带 URL 校验，分别投到 `_cover_executor` / `_preview_executor`）；其余所有方法走 `_dispatch_request` 通用路径。

## 9. 阶段 B 升级路径（信息性）

阶段 B 的工作（不在本 spec 范围）：

1. 选定一个 source（如 hcomic），把其 parser 的 `verify_login_status` 改为 `async def`
2. 在该 mixin 里把 `handle_verify_auth` 改为 `async def`
3. **路由代码不变**——`inspect.iscoroutinefunction(handler)` 已经覆盖

后续可逐 source、逐 handler 升级，无破坏性变更。最终 aiohttp 化 parser 时，request 池可以缩小或移除。

## 10. 已知限制

- A 阶段不实现请求级取消，长请求只能等 `requests` 自身 timeout
- A 阶段不为 `self.config` / `self.parser` / `self.downloader.configure_auth` 加并发锁，依赖 UI 不会同时触发互斥操作（详见 §5.4 列出的具体场景）
- 默认池容量 8 是经验值，未做压测；如设置页未来增加更多并发 handler，需要重新评估
- `handle_shutdown` 在 `_request_executor` 中执行，期间 `wait_active_downloads(timeout=10.0)` 最多阻塞该线程 10 秒，占用一个 slot；其余 7 个 slot 仍可服务并发请求

## 11. 验收标准

- 设置页加载场景下，前端 6 个并发请求总耗时 ≈ max(RTT)，而非 Σ(RTT)
- 既有 IPC 测试全部通过
- 启动日志包含三池容量信息
- cover 缩略图批量预加载与设置页 verify_auth 互不阻塞
- `handle_shutdown` 关停三池后，进程能在 stdin EOF 路径上干净退出（不依赖任一路径单独完成）

## 12. Review 修订记录

针对 2026-06-13 review 反馈做了以下修订：

| Review 项 | 修订位置 |
|---|---|
| `handle_shutdown` 与 `_request_executor` 的关停遗漏 | §4.7、§8、§11 |
| `_shutdown_executors` 双重关停说明 | §4.7 |
| `run_coroutine_threadsafe` 返回的 Future 未处理 | §4.3.3 新增 `_on_dispatch_done` |
| 共享状态竞争窗口具体场景 | §5.4 列出三个具体场景 |
| `_dispatch_request` 中的 lambda 闭包注释 | §4.3.5 NOTE 注释 |
| `handle_shutdown` 阻塞行为说明 | §4.7、§10 |
| 并发测试用例可能 flaky | §7.3 改为重叠时间窗口验证 |
| `for raw_line in sys.stdin` 的 Windows 行为说明 | §4.3.3 末尾 |
| `fetch_cover` / `fetch_preview_image` 不在 `_HANDLER_NAMES` | §8 末尾路由覆盖说明 |
| §8 改动清单缺 `download_mixin.py` | §8 新增一行 |
