## 为什么

Python 后端冷启动实测约 **640ms**，其中 `CoverCacheDB` 在 `__init__` 时把整个 SQLite 表（实测 1396 条 / 95MB base64 data URI）一次性读入内存重建 `OrderedDict`，单独占用 **138ms（占后端启动 21%）**，且缓存越大启动越慢——这是一个反模式。此外，`ipc_server.py` 顶层 `import asyncio`（58ms）仅服务两个运行期方法，`sources/__init__.py` 顶层导入全部 5 个 parser 模块（含 requests/urllib3 151ms、PIL、lxml），导致"只用到 hcomic 也得付全部来源的导入税"。

本轮聚焦消除这三块冷启动开销，把后端启动时间从 ~640ms 压到 ~360ms（约 -43%），与 Electron 前端加载重叠后进一步缩短用户感知的"可交互"等待。

## 变更内容

- **CoverCacheDB 改为文件存储（A3）**：SQLite 仅存元数据（`url_hash, url, file_path, size, fetched_at, last_access`），图片字节以文件形式存放在磁盘目录（与 `PreviewCacheDB` 架构一致）。`__init__` 只 `SELECT url` 建立 LRU 索引，不再全表加载 base64 到内存。`get()` 改为读磁盘文件 + 按需 base64 编码返回（代价转移到 `_cover_executor` 线程池，用户不感知）。
- **旧数据一次性迁移**：启动时检测旧 `cover_cache.db` 的 `data_uri` 列，若存在则逐行 decode → 写文件 → 迁入新 schema，完成后清理。仅执行一次。
- **Parser 模块懒导入（B）**：`sources/__init__.py` 移除顶层 `from sources.<src>.parser import ...`，改为 `importlib.import_module` 在首次 `_get_parser(name)` 时按需加载。顶层 `import sources` 不再触发 5 个 parser 模块及其依赖（requests/urllib3/PIL/lxml）的加载。
- **asyncio 延迟导入（C）**：`ipc_server.py` 顶层 `import asyncio` 移至 `_async_main()` 与 `_dispatch_request()` 内部。

## 功能 (Capabilities)

### 新增功能
- `cover-cache`: 封面图片持久缓存的能力规范——定义存储模型（SQLite 元数据 + 磁盘文件字节）、LRU 淘汰、启动期行为（禁止全量预加载）、旧格式自动迁移契约。

### 修改功能
- `ipc-startup-async`: 补充 Python 后端启动期的延迟导入约束——`asyncio` 与各 source parser 模块不得在模块顶层或 `IPCServer.__init__` 前被强制导入；冷启动的可观测时序（`__init__` 各阶段）应保持可度量。

## 影响

- **代码**：
  - `python/ipc/cover_cache.py` — 整体重写为文件存储架构（保留 `get/put/get_stats/clear_all/update_max_size/db_dir` 对外 API 签名）。
  - `python/ipc/cover_mixin.py` — `put()` 改为接收 data URI 后 decode 成 raw bytes 再写入；`get()` 返回契约（data URI 字符串）不变。
  - `sources/__init__.py` — 顶层 parser 导入改为懒加载；类型注解走 `TYPE_CHECKING` + 字符串。
  - `python/ipc_server.py` — `import asyncio` 延迟到函数内。
- **数据/存储**：
  - 旧 `cover_cache.db`（95MB / 1396 条）迁移后磁盘占用降至约 71MB（base64 膨胀率 33%）。
  - 新增 `~/.hcomic_downloader/cover_cache/` 文件目录。
- **测试**：
  - `tests/test_cache_dir.py` — `CoverCacheDB` 构造签名兼容（保留 `db_path`/`max_size_mb` 参数），现有 `db_dir` 测试无需改动；新增文件存储 / 旧格式迁移专项测试。
  - 其他 4 个 mock `CoverCacheDB` 的测试文件不受影响。
- **前端**：无影响。`fetch_cover` IPC 的 `{ dataUri: string }` 契约保持不变。
- **依赖**：无新增第三方库。
