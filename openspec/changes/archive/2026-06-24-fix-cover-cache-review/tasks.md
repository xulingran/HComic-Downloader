## 1. 迁移事务修复（cover_cache.py）

- [x] 1.1 移除 `_finalize_legacy_migration` 中的 `self._conn.execute("BEGIN")` 与末尾的 `self._conn.execute("COMMIT")`，改为执行完所有 DDL（CREATE/INSERT/DROP/RENAME/CREATE INDEX）后调用 `self._conn.commit()`
- [x] 1.2 将 `except Exception:` 分支改为 `self._conn.rollback()` 后 `raise`，删除原 `self._conn.execute("ROLLBACK")`
- [x] 1.3 VACUUM best-effort 块保留不变（仍在事务外执行）

## 2. size 字节口径修正（cover_cache.py）

- [x] 2.1 新增私有辅助 `_decode_data_uri(data_uri: str) -> bytes`：按 `partition(",")` 切分后 `base64.b64decode` 返回原始字节
- [x] 2.2 改造 `_write_bytes_for` 复用 `_decode_data_uri` 解码结果写入文件，仍返回文件名
- [x] 2.3 `put()` 中改为先取 `raw = self._decode_data_uri(data_uri)`，`size = len(raw)`，写文件用同一 raw（避免重复 decode）；INSERT 的 `size` 参数用 `len(raw)` 而非 `len(data_uri)`
- [x] 2.4 `_migrate_legacy` 迁移分支 `actual_size` 改为 `len(self._decode_data_uri(data_uri))`，删除 `size if size else len(data_uri)` 的 fallback

## 3. get 脏数据对称清理（cover_cache.py）

- [x] 3.1 `get()` 中 `detect_image_type(content)` 返回空时，复用「文件外部删除」清理：`DELETE` 记录、删文件、`self._lru.pop(url, None)`、`commit()`，再 `return None`
- [x] 3.2 文件删除用 `try/except OSError` + `logger.debug`（与现有清理分支一致），不阻断流程

## 4. ParserResponseError re-export 修复（sources/__init__.py）

- [x] 4.1 `__getattr__` 中 `ParserResponseError` 分支改为 `from sources.base import ParserResponseError as _Err`（替换 `sources.hcomic.parser`）
- [x] 4.2 确认 `sources.base` 不在顶层导入（已是 parser 公共基类依赖，无重依赖）；`__all__` 保持不变

## 5. 启动打点可读性（ipc_server.py）

- [x] 5.1 将 `_mark._last = _t0` 与函数属性读写改为闭包 `state = {"last": _t0}`，`_mark` 内读写 `state["last"]`
- [x] 5.2 删除两处 `# type: ignore[attr-defined]`；保持 `HCOMIC_PROFILE_STARTUP` 门控与日志格式不变

## 6. 测试隔离与断言修正

- [x] 6.1 `tests/test_sources_lazy_import.py` 的 `_clean()`：移除对 `m.startswith("ipc.")` 的删除，仅保留 `sources.*`、`requests`、`PIL`、`lxml` 清理；保留 `asyncio` 保护
- [x] 6.2 新增/调整 `test_parser_response_error_lazy_re_export`：断言访问 `sources.ParserResponseError` 后 `sources.hcomic.parser`、`requests`、`lxml` 均不在 `sys.modules`
- [x] 6.3 `tests/test_cover_cache_file_storage.py::test_get_stats_accuracy`：断言 `total_size_bytes == len(_PNG_1x1)`（真实字节）而非 `len(_PNG_DATA_URI)`
- [x] 6.4 `tests/test_cover_cache_migration.py::test_migrate_legacy_db`：迁移后断言每条 `size` 等于解码后真实字节数（`len(_PNG_1x1)`），并补 `pending==0` 直达 finalize 的幂等 reopen 路径覆盖（已由 `test_migration_idempotent` 提供，确认其通过即可）
- [x] 6.5 新增 `test_get_unrecognized_bytes_cleans_entry`：写入非图片字节（如 `b"\x00"*64`，但需绕过 `put` 的合法 data_uri 路径，直接造文件 + 记录），验证 `get` 返回 None 且记录/文件被清理

## 7. 验证（提交前必须全部通过）

- [x] 7.1 `pytest tests/test_cover_cache_file_storage.py tests/test_cover_cache_migration.py tests/test_sources_lazy_import.py -q`
- [x] 7.2 `pytest`（全套，确保无回归）
- [x] 7.3 `npx tsc --noEmit`
- [x] 7.4 `npm test`
- [x] 7.5 `npm run lint:py`
- [x] 7.6 `black --check .`
- [x] 7.7 `npm run lint`
