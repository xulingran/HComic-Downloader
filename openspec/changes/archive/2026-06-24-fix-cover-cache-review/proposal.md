## 为什么

`startup-optimization-v3` 落地了封面缓存的文件存储迁移与解析器懒加载，但代码审查发现一处会崩溃的事务缺陷、一处违反既有 `cover-cache` 规范的字节口径偏差（`size` 记 base64 长度而非磁盘真实字节数，使统计偏高约 35%、淘汰阈值提前），以及若干次要的一致性与测试隔离问题。本次变更在保持对外 API 与启动优化成果不变的前提下，修复这些问题，使行为与既有规范重新对齐。

## 变更内容

- **修复迁移崩溃风险**：`CoverCacheDB._finalize_legacy_migration` 不再手动执行 `BEGIN`，改用 `commit()`/`rollback()` 的标准模式，避免在已开启的隐式事务上下文中再次 `BEGIN` 抛 `cannot start a transaction within a transaction`。
- **修正 `size` 字节口径**：`put` 与 `_migrate_legacy` 中 `size` 改为存储解码后的原始图片字节数（与 `PreviewCacheDB` 一致、与既有规范「`total_size_bytes` 等于所有磁盘文件的实际字节数之和」对齐），而非 base64 data URI 字符串长度。
- **修复迁移残留数据**：迁移分支对已存在 `size` 的旧行也按真实字节数重算，修正旧库迁移后的口径偏差。
- **清理无法识别字节**：`get()` 命中但 `detect_image_type` 返回空时，删除对应的磁盘文件与 SQLite 记录并移出 LRU 索引（与「文件外部被删」分支对称），避免脏数据持续占空间。
- **改进懒加载 re-export**：`sources.__getattr__` 对 `ParserResponseError` 改从轻量的 `sources.base` 导入，而非拉起整个 `sources.hcomic.parser`（含 requests/lxml），避免部分抵消懒加载收益。
- **改进测试隔离**：`tests/test_sources_lazy_import.py` 的 `_clean()` 缩小模块清理范围，不再无条件删除全部 `ipc.*` 模块，降低与同进程其他用例的耦合。
- **改进启动打点可读性**：`ipc_server.py` 中 `_mark` 计时辅助从函数属性（`_mark._last` + `type: ignore`）改为闭包可变状态，去掉晦涩写法。

> 注：`get()` 每次命中重算 base64 的接口债（审查 #3）涉及对外 `data_uri` 契约，超出本次修复范围，本次仅保留注释标注，不改动接口。

## 功能 (Capabilities)

### 新增功能

（无）

### 修改功能

- `cover-cache`: 修正 `size` 口径与字节统计、`get_stats()` 行为，使其与「磁盘文件实际字节数之和」规范对齐；补充迁移中断恢复时 `size` 重算与无法识别字节清理两条场景的规范化行为。
- `parser-lazy-init`: 收紧 `ParserResponseError` re-export 不得触发整包 hcomic parser 导入，避免削弱懒加载保证。

## 影响

- **代码**：`python/ipc/cover_cache.py`（事务、`size` 口径、`get` 清理逻辑）、`sources/__init__.py`（re-export 来源）、`python/ipc_server.py`（`_mark` 写法）。
- **测试**：`tests/test_cover_cache_file_storage.py`、`tests/test_cover_cache_migration.py`（断言改为真实字节数）、`tests/test_sources_lazy_import.py`（`_clean` 范围 + 新增 re-export 不触发 hcomic 的断言）。
- **数据**：旧库迁移路径行为不变（仍可恢复、幂等），但迁移后 `size` 数值会变小为真实字节数——属规范要求的纠正，非破坏性。
- **API**：对外方法签名零变更，`cover_mixin`/`config_mixin`/`ipc_server`/`download_mixin` 调用方无需改动。
- **依赖**：无新增。
