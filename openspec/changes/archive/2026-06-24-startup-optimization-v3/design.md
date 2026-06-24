## 上下文

Python 后端冷启动实测约 640ms，三大开销：

1. **CoverCacheDB 启动预加载全表（138ms）**——`__init__` 执行 `SELECT url, data_uri, size FROM cover_cache ORDER BY fetched_at DESC`，把 95MB / 1396 条 base64 data URI 全部读入 Python 内存并逐行 `reversed()` 重建 `OrderedDict`。缓存越大启动越慢。
2. **`import sources` 强制加载 5 个 parser 模块（约 90ms）**——`sources/__init__.py` 顶层 `from sources.<src>.parser import <Class>` 一次性触发 requests/urllib3(151ms)、PIL、lxml 的加载链。绝大多数会话只用一个来源，却付了全部来源的导入税。
3. **`import asyncio`（58ms）**——`ipc_server.py` 顶层导入，但实际只有 `_async_main()` 与 `_dispatch_request()` 两个运行期方法用到。

`PreviewCacheDB` 已经验证了"SQLite 存元数据 + 磁盘文件存字节"的架构（启动仅 3ms），是 `CoverCacheDB` 改造的现成参照。

## 目标 / 非目标

**目标：**
- 把 Python 后端冷启动（`import + __init__`）从 ~640ms 压到 < 450ms。
- CoverCacheDB 启动耗时从 138ms 降到与 PreviewCacheDB 同量级（< 10ms），且与缓存规模弱相关。
- CoverCacheDB 对外 API 签名保持兼容，调用方零改动。
- 旧 `cover_cache.db` 数据自动、幂等、可中断恢复地迁移到新架构。
- `import sources` 与 `import ipc_server` 不再强制加载未用到的来源解析器与 asyncio。

**非目标：**
- 不改动 Electron 侧 ready gate / PythonBridge 契约（前端零感知）。
- 不并行化其余 DB 的初始化（修复 CoverCacheDB 后剩余 DB 总耗时约 15ms，并行化收益 < 10ms，不值得引入跨线程 SQLite 的复杂度）。
- 不调整 `fetch_cover` 的 IPC 响应格式（仍是 `{ dataUri: string }`）。
- 不优化 HTTP 请求本身的耗时（那是运行期、线程池内的开销，与冷启动无关）。

## 决策

### 决策 1：CoverCacheDB 完全采用 PreviewCacheDB 的文件存储架构

**选择**：SQLite 表结构与 PreviewCacheDB 对齐——`url_hash PRIMARY KEY, url, file_path, size, fetched_at, last_access`；图片字节写到 `{files_dir}/{url_hash}`；`__init__` 只 `SELECT url FROM cover_cache ORDER BY last_access ASC` 建 LRU 索引。

**理由**：
- PreviewCacheDB 在本代码库已稳定运行（2.7ms 启动），架构经过验证。
- 两个 cache 架构统一，降低长期维护成本。
- 启动期不再触碰任何图片字节，从根本上消除"缓存越大启动越慢"。

**替代方案（已否决）**：
- *A1（get 改单条 SELECT、仍存 base64）*：SQLite 页缓存能缓解，但 95MB 单库仍会让 SQLite 启动时读多页；且未根治"存大字段"问题。
- *A2（后台线程异步预热）*：实现复杂，预热完成前的 `get()` 需回退逻辑，且仍把 95MB 读进内存（内存峰值不变）。

### 决策 2：get() 改为读文件 + 按需 base64 编码

**选择**：`get(url)` 命中 LRU 后，读磁盘文件 → `detect_image_type()` 探测 MIME → `base64.b64encode()` → 拼 data URI 返回。复用 `preview_mixin._read_preview_cache()` 已有的同款逻辑（该函数已是生产代码）。

**理由**：
- 封面请求全部经 `_cover_executor` 线程池异步处理，单次约 5-10ms 的磁盘读 + 编码对用户不可见。
- 与冷启动节省的 138ms 相比是划算的权衡——把开销从"启动阻塞主线程"挪到"运行期线程池"。

**权衡**：密集 `get()` 场景（首屏搜索结果列表 N 个封面）会产生 N 次磁盘读。但 OS page cache 会缓存热文件，且这些请求本就是并发的（线程池），实测影响可忽略。

### 决策 3：旧数据迁移——单次、幂等、可恢复

**选择**：`__init__` 打开 DB 后检测 schema：
- 若存在 `data_uri` 列 → 进入迁移模式：逐行 `SELECT url_hash, url, data_uri, size, fetched_at`，base64 decode → 写文件 → `INSERT OR REPLACE` 到新 schema（带 `file_path`/`last_access`）→ 全部完成后 `ALTER TABLE` 删除 `data_uri` 列（或重建表）。
- 迁移前给新表加一列 `migrated INTEGER DEFAULT 0`，每条迁移完置 1；中断后下次只处理 `migrated = 0` 的记录，保证可恢复。
- 已是新 schema（无 `data_uri` 列）→ 跳过。

**理由**：
- 1396 条 / 95MB 的一次性迁移约 100-200ms，仅发生一次，可接受。
- 用 `migrated` 标记列而非"全量完成后一次性删列"，避免崩溃中断导致已迁移数据丢失或重复。

**替代方案（已否决）**：
- *冷启动丢弃旧数据*：简单但首屏部分封面会暂时不显示（需重新 fetch），用户体验回退。当前缓存有效数据量大（95MB），不值得丢。

### 决策 4：Parser 模块懒导入用 importlib + TYPE_CHECKING

**选择**：`sources/__init__.py` 顶层改为：
```python
from __future__ import annotations
import importlib
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sources.hcomic.parser import HComicParser
    # ... 其余仅用于类型注解

_PARSER_MODULES = {
    "hcomic": ("sources.hcomic.parser", "HComicParser"),
    "moeimg": ("sources.moeimg.parser", "MoeimgParser"),
    ...
}

class MultiSourceParser:
    def _get_parser(self, source: str):
        if source not in self._parsers:
            mod_name, cls_name = _PARSER_MODULES[source]
            module = importlib.import_module(mod_name)
            self._parsers[source] = getattr(module, cls_name)(...)
        return self._parsers[source]
```

**理由**：
- `_get_parser` 已是懒实例化入口，只需把"模块导入"也挪进来。
- `from __future__ import annotations` 让所有注解变字符串，配合 `TYPE_CHECKING` 块，类型检查器仍能解析，运行期不触发导入。

**权衡**：`MultiSourceParser` 若在 `__init__` 里就实例化了默认来源的 parser（hcomic），则 hcomic 的导入仍会发生在 `IPCServer.__init__` 阶段——但那已是 `__init__` 内部（不再是 `import ipc_server` 阶段），且只加载一个来源而非全部。

### 决策 5：asyncio 延迟到方法内导入

**选择**：删除 `ipc_server.py:1` 的 `import asyncio`，在 `_async_main()`、`_dispatch_request()`、`_stdin_reader_loop()` 内部首次使用前 `import asyncio`。Python 模块缓存保证后续无重复开销。

**理由**：最小改动、零风险、直接省 58ms。

## 风险 / 权衡

- **[迁移中断数据一致性]** → 用 `migrated` 标记列 + 逐条 `INSERT OR REPLACE`，崩溃后可从断点续迁；迁移期间旧 `data_uri` 列保留，不丢数据。
- **[并发读写迁移期 DB]** → 迁移在 `__init__` 同步完成（持有 `__init__` 单线程上下文），迁移完成前不接受任何请求（IPCServer 未启动），无并发风险。
- **[get() 磁盘读退化]** → 线程池异步 + OS page cache 缓解；如未来出现密集访问瓶颈，可在内存 LRU 中再加一层小容量字节缓存（预览缓存也未做，证明非必要）。
- **[Parser 懒导入导致首次请求变慢]** → 首次访问某来源时多付一次该模块的导入开销（如 bika 约 5-15ms），但发生在请求线程池内，对启动无影响，且仅一次。
- **[测试 mock 路径变化]** → 4 个测试文件 `patch("python.ipc_server.CoverCacheDB")` 仍有效（类名与导入路径不变）；`test_cache_dir.py` 的 `db_dir` 测试因 API 兼容无需改动，仅需新增迁移与文件存储专项测试。
- **[磁盘文件孤儿]** → 与 PreviewCacheDB 同款风险，已有 `clear_all()` 删文件目录的清理路径；不在本轮额外处理。

## 迁移计划

1. 实现 CoverCacheDB 新架构 + 迁移逻辑。
2. 验证迁移：用当前生产 `cover_cache.db`（95MB / 1396 条）跑一次迁移，比对迁移前后 `get()` 返回字节的 SHA256 一致性。
3. 验证启动耗时：`python -X importtime` + `__init__` 阶段打点，确认 CoverCacheDB 从 138ms → < 10ms。
4. 跑全部测试 + lint + black。
5. 无回滚需求——迁移是单向且数据无损的；若新架构出问题，旧 `cover_cache.db` 的 `data_uri` 列在迁移完成前不会被删除。

## 开放问题

- 是否需要在迁移完成后主动 `VACUUM` 旧 SQLite 文件回收 95MB 空间？倾向**是**（迁移后立即 VACUUM 一次），但 VACUUM 会临时翻倍磁盘占用——需确认用户磁盘空间。**倾向：迁移完成后 VACUUM，失败则跳过并记日志。**
