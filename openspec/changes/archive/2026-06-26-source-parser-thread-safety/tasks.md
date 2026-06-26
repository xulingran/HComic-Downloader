## 1. 模块级类导入加锁

- [x] 1.1 在 `sources/__init__.py` 顶部新增 `import threading`。
- [x] 1.2 在 `_PARSER_CLASSES` 定义后新增模块级 `_PARSER_INIT_LOCK = threading.Lock()`，附注释说明守卫对象与并发来源（IPC server 8-worker 请求池）。
- [x] 1.3 将 `_load_parser_class` 改为 double-checked locking：无锁 `_PARSER_CLASSES.get(source)` 快路径；未命中才 `with _PARSER_INIT_LOCK:`，锁内二次 `.get` 后才 `import_module` + `getattr` + 缓存赋值。

## 2. 实例级解析器创建加锁

- [x] 2.1 在 `MultiSourceParser.__init__` 中、`self._parsers` 初始化后，新增 `self._parser_lock = threading.Lock()`，附注释说明与模块锁分离的理由（避免不同实例互相阻塞）。
- [x] 2.2 将 `_get_parser` 改为 double-checked locking：无锁 `self._parsers.get(name)` 快路径；未命中才 `with self._parser_lock:`，锁内二次 `.get` 后才调用工厂、写入缓存、执行 `_apply_post_init`（构造+配置原子化），最后 `return parser`。

## 3. 并发回归测试

- [x] 3.1 在 `tests/test_sources_lazy_import.py` 顶部新增 `import importlib`、`import threading`、`import pytest`。
- [x] 3.2 新增 `test_concurrent_get_parser_constructs_each_source_once`：对 jm/bika/moeimg/copymanga 各发 16 线程（共 64），用 `threading.Barrier(64)` 同时释放最大化竞争；用计数包装的工厂断言每个 source 工厂**恰好调用 1 次**，并断言后续 `_get_parser` 返回的实例身份一致（identity equality）。

## 4. 验证

- [x] 4.1 运行 `venv/Scripts/python.exe -m pytest tests/test_sources_lazy_import.py -q`，确认新增并发测试通过、现有懒加载用例无回归。
- [x] 4.2 运行 `venv/Scripts/python.exe -m pytest tests/test_sources_lazy_import.py tests/test_multi_source_parser.py tests/test_jm_parser.py -q`（含相关测试），确认全部通过、无跨文件污染。
- [x] 4.3 运行 `npm run lint:py` 与 `venv/Scripts/python.exe -m black --check sources/__init__.py tests/test_sources_lazy_import.py`，确认 lint/格式通过。
