## 上下文

`startup-optimization-v3` 将 `CoverCacheDB` 从「SQLite 内联 base64」迁移到「文件存储 + SQLite 元数据」混合架构，并对 `MultiSourceParser` 做了解析器懒加载。代码审查发现以下问题：

1. `_finalize_legacy_migration()` 显式执行 `self._conn.execute("BEGIN")`，而 Python `sqlite3` 在任何 DML 之后已隐式开启事务——在隐式事务上下文中再 `BEGIN` 会抛 `cannot start a transaction within a transaction`。当前调用路径因前序 `commit()` 恰好掩盖了该问题，但属定时炸弹。
2. `put()` 与迁移路径中 `size = len(data_uri)`（base64 字符串长度，约为真实磁盘字节的 1.35 倍），而 `PreviewCacheDB` 用 `len(raw_bytes)`。这导致 `get_stats()["total_size_bytes"]` 系统性偏高 ~35%、LRU 淘汰提前触发，且直接违反既有 `cover-cache` 规范场景「`total_size_bytes` 等于所有磁盘文件的实际字节数之和」。
3. `get()` 命中但 `detect_image_type` 返回空（脏数据）时仅返回 `None`，不清理文件/记录，留垃圾。
4. `sources.__getattr__` 对 `ParserResponseError` 从 `sources.hcomic.parser` re-export，会拉起整个 hcomic parser（含 requests/lxml），部分抵消懒加载。
5. `tests/test_sources_lazy_import.py` 的 `_clean()` 无条件删除全部 `ipc.*` 模块，与同进程其他用例耦合。
6. `ipc_server.py` 的 `_mark` 用 `_mark._last` 函数属性 + 两处 `type: ignore` 模拟可变闭包，可读性差。

约束：对外 API（`get`/`put`/`get_stats`/`clear_all`/`update_max_size`/`db_dir`/`close`）签名与调用方零变更；迁移必须保持幂等与可恢复；启动耗时优化成果不得回退。

## 目标 / 非目标

**目标：**
- 消除 `_finalize_legacy_migration` 的事务崩溃路径，迁移在任意调用上下文下均安全。
- `cover-cache` 的 `size` 与 `get_stats()` 与 `PreviewCacheDB` 及既有规范口径一致（真实磁盘字节数）。
- `get()` 对无法识别字节的脏条目做对称清理。
- `ParserResponseError` re-export 不触发整包 parser 导入。
- 测试 `_clean()` 缩小破坏面，不波及无关 `ipc.*` 模块。
- 启动打点辅助更可读，去掉 `type: ignore`。

**非目标：**
- 不改动 `get()` 返回 `data_uri` 的对外契约（审查 #3 的接口债，超出本次范围，仅保留注释）。
- 不重构 `CoverCacheDB` 与 `PreviewCacheDB` 为共享基类（两缓存逻辑已趋同，但抽取留待后续）。
- 不调整启动优化本身（asyncio 延迟 import、打点门控）的行为。

## 决策

### D1：迁移事务用 commit/rollback，不手动 BEGIN

**选择**：移除 `_finalize_legacy_migration` 中的 `BEGIN`/`COMMIT`/`ROLLBACK` 字符串语句，改为「执行 DDL/DML → `self._conn.commit()`；异常分支 `self._conn.rollback()` 后 re-raise」。

**理由**：Python `sqlite3` 默认隔离级别下，DDL（`CREATE TABLE`/`DROP TABLE`/`ALTER TABLE`）与 DML 都会在隐式事务内执行，`commit()` 一次提交全部；显式 `BEGIN` 在已有隐式事务时报错，是当前 bug 根因。`DROP TABLE ... RENAME` 序列在单事务内原子可回滚，无需额外包装。

**替代方案**：
- 用 `with self._conn:` 上下文管理器。被否：项目其它 SQLite 代码（`config.py`、`download_history.py`）一致用显式 `commit()`/`rollback()`，保持一致优于引入第二种风格。
- 设 `isolation_level=None` 进入手动事务模式。被否：会改变整个连接的事务语义，影响 `put`/`get` 等热路径，风险大于收益。

### D2：`size` 统一记解码后的真实字节数

**选择**：`put()` 中先 decode 出 raw bytes、写文件、`size = len(raw_bytes)`；迁移分支同样 `actual_size = len(base64.b64decode(partition(",")[2]))`，不再 fallback 到 `len(data_uri)`。

**理由**：与 `PreviewCacheDB.size = len(raw_bytes)` 对齐，消除 ~35% 统计虚高，并满足 `cover-cache` 规范「磁盘文件实际字节数之和」。`put()` 已调用 `_write_bytes_for`（内部 decode 一次），为避免重复 decode，将 decode 抽为 `_decode_data_uri(data_uri) -> bytes` 小辅助，`_write_bytes_for` 与 `put` 共用其结果。

**替代方案**：
- `put` 写完文件后 `size = os.path.getsize(file_path)`。被否：多一次系统调用，且文件系统报告的字节可能因压缩/对齐与字节长度不一致，不如 `len(raw)` 直接、可测。
- 保持 base64 口径，修改规范。被否：规范「实际字节数」是正确语义，base64 口径会让 500 MB 限额实际只占 ~370 MB，对用户是感知损失。

### D3：`get()` 对不可识别字节做对称清理

**选择**：`detect_image_type` 返回空时，复用「文件外部删除」分支的清理逻辑（`DELETE` 记录 + 删文件 + `lru.pop`），再返回 `None`。

**理由**：脏字节既无法构造合法 data URI，又会持续占空间且每次 `get` 重复解码失败；与「文件被外部删」对称处理，行为可预期。

### D4：`ParserResponseError` re-export 改从 `sources.base`

**选择**：`sources.__getattr__` 中 `from sources.base import ParserResponseError`。

**理由**：`ParserResponseError` 定义在 `sources/base.py`（仅继承 `RuntimeError`，无重依赖）；`hcomic.parser` 虽 re-import 它，但本身携带 requests/lxml。改从 base 导入使 `except sources.ParserResponseError` 不再触发整包 parser 加载，兑现懒加载收益。`sources.base` 已是 parser 模块的公共基类依赖，不引入新耦合。

### D5：`_mark` 改用可变闭包状态

**选择**：用 `state = {"last": _t0}` 字典持有上次时间戳，`_mark` 闭包内读写 `state["last"]`，去掉 `_mark._last` 属性赋值与两处 `# type: ignore[attr-defined]`。

**理由**：函数属性模拟可变状态需 `type: ignore` 且语义晦涩；字典闭包是 Python 惯用写法，类型检查器友好，零运行时差异。也可用 `nonlocal`，但需额外嵌套一层函数，字典更直接。

### D6：测试 `_clean()` 缩小模块清理范围

**选择**：`_clean()` 仅删除 `sources.*`、`requests`、`PIL`、`lxml`（懒加载真正关心的重依赖）；不再删除 `ipc.*`，避免破坏同进程的 cover_cache 等用例对已 import 模块的复用。

**理由**：懒加载测试的断言对象是 `sources.*` 与三个重依赖；`ipc.*` 与本测试无关，删除它们纯属副作用。

## 风险 / 权衡

- **[迁移事务行为变更] → 缓解**：D1 改为 commit/rollback 后，事务边界语义与原「BEGIN..COMMIT」等价（都是单事务原子完成 rebuild-via-temp-table），且消除了崩溃路径。新增/已有迁移测试（中断恢复、幂等、全新库）覆盖回归。
- **[旧库迁移后 `size` 数值变小] → 缓解**：迁移分支重算真实字节数，旧库迁移一次后 `get_stats()` 数值会下降 ~35%。这是规范要求的纠正（非破坏性，用户感知是统计更准、限额更贴近实际）。测试断言改为真实字节数。
- **[已迁移但未 finalize 的旧库（`pending==0` 分支）] → 缓解**：该路径现在也走 D1 的安全事务模式；`test_migration_interrupt_resume` 已覆盖「部分行已迁移」场景，新增对 `pending==0` 直达 finalize 的隐式覆盖（幂等测试 reopen 即此路径）。
- **[re-export 改 base 后 `ParserResponseError` 身份一致性] → 缓解**：`hcomic.parser` 仍是 `from sources.base import ParserResponseError`，故 `sources.ParserResponseError is sources.hcomic.parser.ParserResponseError` 恒成立，`except` 捕获不受影响；测试显式断言二者同一对象。
- **[`_clean()` 不再删 `ipc.*` 后懒加载断言是否仍有效] → 缓解**：断言针对 `sources.*` 与 `requests/PIL/lxml`，与 `ipc.*` 无关，去掉该清理不影响断言有效性，反而提升隔离性。

## 迁移计划

本变更本身是对已有迁移代码的修复，无额外数据迁移：

1. 实现 D1–D6 代码改动。
2. 调整三组测试断言：cover_cache 字节口径测试改为真实字节数；迁移测试覆盖重算；懒加载测试新增 `sources.ParserResponseError` 不触发 `sources.hcomic.parser` 导入的断言。
3. 验证：`pytest`（含三组新/改测试）→ `npx tsc --noEmit` → `npm test` → `npm run lint:py` → `black --check .` → `npm run lint`。
4. 回滚：全部改动集中在 `cover_cache.py`、`sources/__init__.py`、`ipc_server.py` 及三组测试，`git revert` 单提交即可回退；旧库数据不受影响（迁移幂等）。

## 开放问题

（无——所有决策已在审查中明确，范围限于修复既有代码。）
