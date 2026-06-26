## 为什么

`sources/__init__.py` 的两条懒创建路径存在 check-then-act 竞态：

1. **模块级** `_load_parser_class(source)` —— 两线程可同时通过 `cls is None`，各自 `importlib.import_module` + `getattr` 后以 last-writer-wins 覆盖 `_PARSER_CLASSES`。虽然 importlib 自带导入锁防真正重复导入，但缓存条目仍会被无意义地覆盖。
2. **实例级** `MultiSourceParser._get_parser(name)` —— 两线程可同时通过 `name not in self._parsers`，各自跑一次工厂，构造两个完整的解析器实例（含 `requests.Session` + 代理注入），且非确定性决定哪个被复用。

这不是臆测的并发：`python/ipc_server.py:189-192` 用 8-worker `_request_executor`（`ThreadPoolExecutor(max_workers=_REQUEST_POOL_MAX_WORKERS, ...)`）并发跑通用请求处理器（search/favourites/verify_login_status/...），它们全部经 `self.parser` → `_get_parser` 到达懒创建路径。当用户在多窗口/多任务场景下并发触发不同来源时，竞态窗口会被实际命中。

本变更记录并固化已经在工作树（未提交）中实现的修复：为两条路径加 `threading.Lock` 守卫的 double-checked locking，并补充回归测试。

## 变更内容

- **`sources/_load_parser_class` 加模块级锁** `_PARSER_INIT_LOCK`：快路径无锁读 `_PARSER_CLASSES.get`；命中则返回，未命中才持锁并在锁内二次检查后导入 + 缓存。
- **`MultiSourceParser._get_parser` 加实例级锁** `self._parser_lock`：同样的 double-checked locking 守卫解析器实例创建（含工厂调用 + `_apply_post_init` 后处理）。两把锁职责分离 —— 模块锁守卫类导入，实例锁守卫实例创建，避免不同 `MultiSourceParser` 实例（如测试场景）互相阻塞。
- **新增回归测试** `tests/test_sources_lazy_import.py::test_concurrent_get_parser_constructs_each_source_once`：用 `threading.Barrier` 最大化竞争，对 4 个非默认来源各发 16 个并发线程，断言每个来源的工厂**恰好被调用一次**（而非 ≥1），并校验返回实例身份一致（identity equality）。

## 功能 (Capabilities)

### 新增功能
<!-- 无新增对外功能：纯内部并发安全加固，对外行为不变 -->

### 修改功能
- `parser-lazy-init`: 强化为懒创建路径增加并发不变量 —— 相同 source 在任意并发下必须只构造一次解析器类与一次解析器实例，且后续访问返回同一实例。

## 影响

- **受影响代码**：
  - `sources/__init__.py`（`_load_parser_class`、`MultiSourceParser.__init__`、`MultiSourceParser._get_parser`；新增 `import threading`、模块级 `_PARSER_INIT_LOCK`、实例级 `self._parser_lock`）
  - `tests/test_sources_lazy_import.py`（新增并发回归测试、`import pytest`/`importlib`/`threading`）
- **受影响规范**：`parser-lazy-init`（新增并发不变量需求）
- **对外行为不变**：单线程下行为与加锁前完全一致；仅收紧了多线程下的“重复构造”非确定行为。
- **性能影响**：快路径（已有缓存）无锁，仅一次 dict.get；首次创建路径多一次锁获取（可忽略）。锁内不持有任何 I/O 或网络操作。
- **验证影响**：`tests/test_sources_lazy_import.py::test_concurrent_get_parser_constructs_each_source_once` 全绿；现有懒加载测试（`test_lazy_source_loaded_on_first_access` 等）与 `test_multi_source_parser.py` 全部不回归。

## 备注：与归档 `2026-06-25-fix-preexisting-test-failures` 的边界

本变更的生产代码改动（`sources/__init__.py` 的锁）原被误纳入 `2026-06-25-fix-preexisting-test-failures` 的工作树，而该归档的 `proposal.md`/`design.md` 明确声明“不修改任何生产代码”。此处将其拆出并独立记录，使代码与 openspec 文档一致。两个变更的关系：`fix-preexisting-test-failures` 修复测试与生产脱节（cookie jar 双域名、`_cookie` 属性、跨测试缓存污染）；本变更记录生产并发加固与并发回归测试。
