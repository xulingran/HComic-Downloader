## 新增需求

### 需求:模块级缓存与模块身份禁止跨测试泄漏

当某测试模块（如 `test_sources_lazy_import.py`）通过真实工厂填充模块级缓存（如 `sources._PARSER_CLASSES`）时，该缓存必须在每个测试用例结束时被复位，禁止残留到后续测试。同时，清理逻辑禁止通过删除并重导入顶层模块造成模块对象身份漂移；若其他测试文件在 pytest 收集期已从该模块导入类或函数，则这些对象的闭包 `__globals__` 必须继续指向当前模块字典，以保证 `monkeypatch.setattr` 能命中真实调用路径。

#### 场景:懒加载测试后缓存被清空

- **当** `test_sources_lazy_import.py` 中任一用例通过真实 `_load_parser_class` 构造解析器类并缓存进 `sources._PARSER_CLASSES` 后
- **那么** 该用例的 teardown 必须清空 `sources._PARSER_CLASSES`，使下一个用例（无论同文件还是其他文件）从空缓存开始

#### 场景:清理保持顶层模块身份稳定

- **当** `test_sources_lazy_import.py::_clean()` 需要为懒加载测试提供干净导入状态时
- **那么** 它必须清理 `sources.*` 子模块并通过 `importlib.reload(sys.modules["sources"])` 原地重载顶层 `sources`，禁止使用 `del sys.modules["sources"]` 产生新模块对象

#### 场景:后续 monkeypatch 测试不受污染

- **当** `test_multi_source_parser.py::test_jm_domain_applies_after_lazy_parser_creation` 在 `test_sources_lazy_import.py` 之后运行，并通过 `monkeypatch.setattr(sources, "_load_parser_class", fake_factory)` 注入假解析器类时
- **那么** `MultiSourceParser` 必须调用 fake_factory 返回的类，而非 `_PARSER_CLASSES` 中残留的真实类或废弃模块字典中的真实 `_load_parser_class`
