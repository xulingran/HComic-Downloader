## 1. Python 硬死代码删除（零风险，先建立信心）

- [x] 1.1 删除 `python/ipc/config_mixin.py:106` `_apply_jm_domain` 中的死分支——`v.strip()` 后非空才进入 `if v:`，内层 `not v` 子条件永不触发，从 `if " " in v or "/" in v or not v or len(v) > 256:` 中移除 `or not v`
- [x] 1.2 删除 `python/maintenance/health_checker.py:24` 未使用类型别名 `HealthCheckKind = str`（全仓零引用）
- [x] 1.3 删除 `python/maintenance/scanner.py:299-301` 的 `is_image_file()` 函数定义
- [x] 1.4 从 `python/maintenance/scanner.py` 的 `__all__` 列表（约第 305-310 行）中移除 `"is_image_file"` 条目
- [x] 1.5 删除 `tests/test_maintenance_scanner.py` 中仅覆盖 `is_image_file` 的 `test_is_image_file` 用例（第 44-47 行），并从文件顶部 import 块（第 18-28 行）移除 `is_image_file`
- [x] 1.6 运行 `pytest tests/test_maintenance_scanner.py tests/test_health_check*.py tests/test_config*.py -q` 确认无回归

## 2. 前端硬死代码删除（anim.ts）

- [x] 2.1 删除 `src/lib/anim.ts:38-42` 的 `standardTransition` 导出（连文件内部都未引用）
- [x] 2.2 删除 `src/lib/anim.ts:51-64` 的 `createPresenceVariants` 导出（工厂函数定义后从未被调用，各组件直接用具体 variants）
- [x] 2.3 删除 `src/lib/anim.ts:165` 的 `PAGE_FLIP_DURATION` 常量
- [x] 2.4 删除 `src/lib/anim.ts:168-172` 的 `pageFlipTransition` 导出
- [x] 2.5 删除 `src/lib/anim.ts:215` 的 `void pageFlipTransition` 防 tree-shake 占位语句
- [x] 2.6 删除 `src/lib/anim.ts` 中 **导出的** `STAGGER_LIMIT = 20`，并将文件内部常量**重命名为 `CARD_STAGGER_LIMIT`**（同步更新 `getCardItemVariants` 的比较与 docstring）。命名带 CARD 前缀以从命名层面与 `ComicInfoDrawer.tsx:444` 本地 `STAGGER_LIMIT = 40`（tag 列表阈值，**不动**）分化。详见 design.md 决策 7
- [x] 2.7 运行 `npx tsc --noEmit` 与 `npm test` 确认无 import 残留、无回归

## 3. 黑名单校验器抽象（C2，有测试覆盖，作为抽象"模板"）

- [x] 3.1 在 `electron/validators.ts` 新增**非导出**工厂函数 `blacklistValidator(label: 'duplicateBlacklist' | 'missingBlacklist')`，函数体为现有 `duplicateBlacklist` 的完整逻辑，所有硬编码的 `'duplicateBlacklist'` 字符串改用 `${label}` 模板
- [x] 3.2 将 `duplicateBlacklist()` 导出退化为 `return blacklistValidator('duplicateBlacklist')` 一行
- [x] 3.3 将 `missingBlacklist()` 导出退化为 `return blacklistValidator('missingBlacklist')` 一行
- [x] 3.4 删除 `missingBlacklist` 的 docstring 中"校验规则与 duplicateBlacklist 完全一致"的冗余说明（合并后该说明失效）
- [x] 3.5 运行 `npm test` 确认 validator 测试全绿（应已覆盖两种 label 的错误消息文案）

## 4. "打开目录" handler 抽象（C1）

- [x] 4.1 在 `python/ipc/download_mixin.py` 新增私有方法 `_open_in_file_manager(self, directory: str) -> None`，封装 `import platform/subprocess` + 平台分支 + `os.startfile`/`Popen(["open",...])`/`Popen(["xdg-open",...])` + `except Exception` 转 `RuntimeError`（实现见 design.md 决策 2）
- [x] 4.2 重写 `handle_open_download_dir`（第 525-544 行）退化为：取 `self.config.download_dir` → 存在性校验 → `self._open_in_file_manager(directory)` → `return {"success": True}`
- [x] 4.3 重写 `handle_open_cache_dir`（第 546-572 行）退化为：取 `self._cover_cache.db_dir` → 存在性校验 → `self._open_in_file_manager(directory)` → `return {"success": True}`；保留 docstring 中关于"python:open-cache-dir 通道对称性"的说明
- [x] 4.4 运行 `pytest tests/test_cache_dir.py tests/test_download*.py -q` 确认无回归

## 5. 登录 handler 抽象（C3，最复杂）

- [x] 5.1 在 `python/ipc/auth_mixin.py` 新增私有方法 `_do_password_login(self, source, username, password, *, credential_kind, apply_to_downloader=False) -> dict`，按 design.md 决策 4 实现：空值校验 → 取 parser → 持久化凭证（保留 credential-persistence spec 注释）→ `parser.login()` → 加锁写 `set_source_auth` + `save` → `configure_auth` → 条件 `downloader.configure_auth` → 返回 `{"success": True, "message": "登录成功"}`
- [x] 5.2 重写 `handle_moeimg_login`（第 108-135 行）退化为 `return self._do_password_login("moeimg", username, password, credential_kind="cookie")`
- [x] 5.3 重写 `handle_bika_login`（第 137-164 行）退化为 `return self._do_password_login("bika", username, password, credential_kind="bearer_token")`
- [x] 5.4 重写 `handle_hcomic_login`（第 166-194 行）退化为 `return self._do_password_login("hcomic", username, password, credential_kind="bearer_token", apply_to_downloader=True)`
- [x] 5.5 运行 `pytest tests/test_auth*.py tests/test_moeimg_login*.py tests/test_bika*.py -q` 确认三个登录路径行为等价

## 6. 收藏夹去重抽象（D）

- [x] 6.1 在 `python/ipc/search_mixin.py` 模块级新增私有函数 `_dedupe_comics(comics: list[ComicInfo]) -> tuple[list[ComicInfo], int]`，返回 `(deduped_list, original_count)`。`ComicInfo` 经 `TYPE_CHECKING` 块导入（详见 design.md 决策 5）
- [x] 6.2 重写 `handle_get_favourites`（第 299-306 行）的去重块为 `deduped, original_count = _dedupe_comics(comics)`，保留后续 `if len(deduped) < original_count: logger.info(...)` 日志
- [x] 6.3 重写 `handle_parse_jm_favourites_snapshot`（第 329-335 行）的去重块为 `deduped, _ = _dedupe_comics(comics)`（不记日志，保持现状）
- [x] 6.4 运行 `pytest tests/test_search*.py tests/test_favourites*.py tests/test_jm*.py -q` 确认去重行为与日志行为等价

## 7. auth 关键字检查去重（E，注意行为等价陷阱）

- [x] 7.1 在 `python/ipc/search_mixin.py` 模块级新增私有函数 `_matches_auth_keywords(message: str) -> bool`，实现 `msg = message.lower(); return any(kw in msg for kw in _AUTH_KEYWORDS)`（**纯字符串匹配，不含 source 白名单**）
- [x] 7.2 重写 `_is_source_auth_error`（第 130-135 行）：保留 source 白名单前置检查 `if source not in ("jm","copymanga","hcomic"): return False`，将其后的关键字匹配改为 `return _matches_auth_keywords(str(error))`
- [x] 7.3 重写 `_auth_error_guard` 的 `ParserResponseError` 分支（第 145-149 行）：保留**不**做 source 白名单的当前行为，仅将 `any(kw in msg.lower() for kw in _AUTH_KEYWORDS)` 改为 `_matches_auth_keywords(msg)`。**禁止**改为调用 `_is_source_auth_error(source, e)`（会引入 source 白名单回归，详见 design.md 风险 R3）
- [x] 7.4 运行 `pytest tests/test_search*.py -q` 确认 auth 错误转换行为等价

## 8. 全套验证（提交前必须全部通过）

- [x] 8.1 `pytest`（Python 全套，确认死代码测试删除后总数略降、其余全绿）
- [x] 8.2 `npx tsc --noEmit`（确认无 import 残留、无类型错误）
- [x] 8.3 `npm test`（前端全套）
- [x] 8.4 `npm run lint:py`（ruff 检查，确认无未使用 import 残留）
- [x] 8.5 `black --check .`（Python 格式化）
- [x] 8.6 `npm run lint`（ESLint）
- [x] 8.7 人工核对：抽象后的错误消息字符串、返回结构、异常类型与抽象前**字面等价**（抽查每个抽象点至少一处错误路径）

## 9. Review 反馈修正（2026-06-28）

针对 review 指出的两个 Important 问题（均非行为缺陷，属"新抽出函数的类型契约"与"本次变更自身目标的命名收尾"）：

- [x] 9.1 **`_dedupe_comics` 类型契约修复**（`python/ipc/search_mixin.py`）—— 在 `TYPE_CHECKING` 块新增 `from models import ComicInfo`，将签名由 `comics: list -> tuple[list, int]` 改为 `comics: list[ComicInfo] -> tuple[list[ComicInfo], int]`，局部变量同步标注。理由：初版 design 称"避免 import 循环"经复核不成立（`download_mixin.py:12` 已顶层运行时 import ComicInfo 无循环），强类型符合项目"所有函数必须有完整类型注解"规范并消除 `.source_site`/`.id`/`.comic_source` 的隐式契约。详见 design.md 决策 5 修订段
- [x] 9.2 **`STAGGER_LIMIT` 命名收尾**（`src/lib/anim.ts`）—— 在 2.6 删除 export 的基础上，进一步将文件内部常量重命名为 `CARD_STAGGER_LIMIT`，更新 `getCardItemVariants` 比较与 docstring。理由：仅取消 export 仍会在注释层面与 `ComicInfoDrawer` 同名常量（=40）混淆，命名分化后全仓仅剩一处 `STAGGER_LIMIT`，从根上消除同名异值陷阱。详见 design.md 决策 7
- [x] 9.3 重跑验证：`npx tsc --noEmit`、`npm run lint:py`、`pytest tests/test_search_mixin.py tests/test_jm_favourites.py tests/test_parser_favourites.py`、`npx vitest run tests/unit/main/validators.test.ts` 全绿
