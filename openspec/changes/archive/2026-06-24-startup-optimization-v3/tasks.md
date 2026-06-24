## 1. CoverCacheDB 文件存储架构重写

- [x] 1.1 在 `python/ipc/cover_cache.py` 中重写 `CoverCacheDB`：新增 `files_dir` 参数（默认 `~/.hcomic_downloader/cover_cache`），schema 改为 `url_hash PK, url, file_path, size, fetched_at, last_access`，删除 `data_uri` 字段使用
- [x] 1.2 重写 `__init__`：建表 + 索引（`idx_cover_last_access`、`idx_cover_url`）后，仅 `SELECT url FROM cover_cache ORDER BY last_access ASC` 建内存 LRU `OrderedDict`（key→None），不再读取任何图片字节
- [x] 1.3 重写 `get(url)`：LRU 命中后 `SELECT file_path` → 读磁盘文件 → `detect_image_type()` 探测 MIME → base64 编码 → 返回 data URI；文件不存在时清理记录并返回 None
- [x] 1.4 重写 `put(url, data_uri)`：从 data URI 解析出 MIME + base64 → decode 为原始字节 → 写 `{files_dir}/{url_hash}` 文件 → 写 SQLite 元数据 → 更新 LRU → 触发淘汰
- [x] 1.5 重写 `clear_all()`：遍历 `SELECT file_path` 删除磁盘文件（best-effort，失败记 debug 日志）+ `DELETE FROM cover_cache` + 清空 LRU
- [x] 1.6 重写 `get_stats()`：`SELECT COUNT(*), COALESCE(SUM(size),0)` 返回 `{file_count, total_size_bytes}`
- [x] 1.7 重写 `update_max_size()`：更新上限后触发淘汰（与 PreviewCacheDB 的 `_evict_if_needed` 对齐）
- [x] 1.8 实现 `_evict_if_needed()`：按 LRU 最旧顺序，删文件 + 删记录 + 移除索引，循环至总大小回到上限内；文件删除失败仅记日志不阻断
- [x] 1.9 保留 `db_dir` 属性与 `close()` 方法签名不变；`_DEFAULT_DB_NAME` 保持 `cover_cache.db`，新增 `_DEFAULT_FILES_DIR_NAME = "cover_cache"`

## 2. 旧格式数据自动迁移

- [x] 2.1 在 `__init__` 建表后检测旧 schema：`PRAGMA table_info(cover_cache)` 若含 `data_uri` 列则进入迁移流程
- [x] 2.2 迁移流程：确保新列 `file_path`、`last_access`、`migrated`（DEFAULT 0）存在；`SELECT url_hash, url, data_uri, size, fetched_at WHERE migrated = 0` 逐条处理
- [x] 2.3 每条迁移：base64 decode `data_uri` → 写 `{files_dir}/{url_hash}` → `UPDATE` 设置 `file_path`、`last_access = fetched_at`、`migrated = 1`；批量提交（如每 50 条 commit 一次）控制事务大小
- [x] 2.4 全部 `migrated = 1` 后，`ALTER TABLE` 丢弃 `data_uri` 与 `migrated` 列（或重建为干净的新表），并 `VACUUM`（失败仅记日志不阻断）
- [x] 2.5 已是新 schema（无 `data_uri`）时跳过迁移，零开销
- [x] 2.6 迁移日志：开始时记 info（条数、估计大小），完成时记 info（耗时、迁移条数、VACUUM 结果）

## 3. CoverMixin 适配

- [x] 3.1 检查 `python/ipc/cover_mixin.py:126` 的 `_async_fetch_cover`：`get()` 返回值仍为 data URI 字符串，无需改动调用方逻辑
- [x] 3.2 检查 `cover_mixin.py:138` 的 `put(url, data_uri)`：新 `put` 内部自行 decode，调用方仍传 data URI 字符串，无需改动
- [x] 3.3 验证 `_cover_executor` 线程池内 `get`/`put` 调用路径无回归（data URI 字节一致性）

## 4. Parser 模块懒导入

- [x] 4.1 在 `sources/__init__.py` 顶部加 `from __future__ import annotations`，将所有 parser 类的顶层 `from sources.<src>.parser import <Class>` 移入 `if TYPE_CHECKING:` 块（仅类型注解用）
- [x] 4.2 定义 `_PARSER_MODULES: dict[str, tuple[str, str]]` 映射 source → `(模块路径, 类名)`
- [x] 4.3 改造 `MultiSourceParser._get_parser(source)`（或等价懒实例化入口）：首次访问时 `importlib.import_module(mod_name)` + `getattr` 取类，缓存到 `self._parsers`
- [x] 4.4 确认 `MultiSourceParser.__init__` 若预实例化默认来源（hcomic），仍只触发 hcomic 模块加载，不波及其他来源
- [x] 4.5 验证类型注解（返回类型、参数类型）在 mypy/pyright 下仍可解析（依赖 `from __future__ import annotations` + `TYPE_CHECKING`）

## 5. asyncio 延迟导入

- [x] 5.1 删除 `python/ipc_server.py:1` 的顶层 `import asyncio`
- [x] 5.2 在 `_async_main()`、`_dispatch_request()`、`_stdin_reader_loop()` 内部首次使用前加 `import asyncio`
- [x] 5.3 验证 `run()` → `asyncio.run(self._async_main())` 路径正常（`run` 内首行 import）

## 6. 启动时序度量与验证

- [x] 6.1 在 `IPCServer.__init__` 各阶段（Config、Parser、Downloader、DownloadManager、CoverCacheDB、其余 DB、handler 注册）临时加 `time.perf_counter()` 打点（可通过环境变量开关），输出到 logger
- [x] 6.2 用 `python -X importtime -c "import ipc_server"` 对比改动前后：asyncio、各 parser 模块、requests 是否从顶层加载链消失
- [x] 6.3 实测 `IPCServer()` 全程耗时：确认从 ~640ms 降到 < 450ms，CoverCacheDB 从 138ms → < 10ms
- [x] 6.4 度量打点验证完成后，保留可开关的打点机制（环境变量控制），便于后续回归监控

## 7. 测试

- [x] 7.1 新增 `tests/test_cover_cache_file_storage.py`：覆盖 put→get 字节一致性、get 缺失返回 None、LRU 淘汰删文件、clear_all 删文件、get_stats 准确性、文件被外部删除后 get 返回 None
- [x] 7.2 新增 `tests/test_cover_cache_migration.py`：构造旧 schema DB（含 `data_uri` 列 + 若干 base64 记录），验证迁移后 get 返回字节一致、迁移幂等（二次启动跳过）、迁移中断后续传（部分 migrated=1 时只处理剩余）
- [x] 7.3 新增/更新 `tests/test_sources_lazy_import.py`：验证 `import sources` 后 `bika`/`jmcomic` 等模块未加载，`_get_parser("bika")` 后才加载
- [x] 7.4 验证 `tests/test_cache_dir.py` 现有用例（db_dir 绝对路径、默认目录）在新架构下仍通过；如需补 `files_dir` 参数则更新
- [x] 7.5 跑 `pytest` 全套，确认 4 个 mock `CoverCacheDB` 的测试文件不受影响
- [x] 7.6 跑完整验证流程：`pytest` + `npx tsc --noEmit` + `npm test` + `npm run lint:py` + `black --check .` + `npm run lint`

## 8. 文档与收尾

- [x] 8.1 更新 `docs/superpowers/specs/` 下相关启动/缓存设计文档（如存在），注明 CoverCacheDB 架构与 PreviewCacheDB 统一
- [x] 8.2 在 design.md 的"开放问题"中确认 VACUUM 决策（迁移后是否 VACUUM）并落地到代码
- [x] 8.3 提交前确认 `AGENTS.md` 中关于缓存/启动的描述无需更新
