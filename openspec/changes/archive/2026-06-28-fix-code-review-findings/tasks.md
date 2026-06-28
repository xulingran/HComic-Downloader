## 1. 修正 preview cache 写盘失败的伪成功语义

- [x] 1.1 修改 `python/ipc/preview_mixin.py::_do_fetch_preview_image`：当 `_write_preview_cache()` 返回 `None` 时，删除"降级计算 hash"分支（含原注释"协议 handler on-demand fetch fallback"），改为抛 `RuntimeError`（消息描述写盘失败原因）。保留成功路径返回形态。
- [x] 1.2 移除 `_do_fetch_preview_image` 内为此降级路径引入的 `import hashlib`（成功 hash 已由 `_write_preview_cache` 内部计算返回，调用处不再需要本地算 hash）。
- [x] 1.3 更新 `_do_fetch_preview_image` docstring：明确"写盘失败必须抛错，因为协议层无 on-demand fallback"。
- [x] 1.4 新增/更新 pytest 用例（`tests/`）：(a) mock `_write_preview_cache` 返回 `None` → 断言 `_do_fetch_preview_image` 抛错（且不返回 hash）；(b) 缓存命中路径仍返回 hash；(c) 写盘成功路径仍返回 hash。回归现有 preview 相关用例。

## 2. 认证保存串行化（复用 _config_write_lock）

- [x] 2.1 在 `python/ipc/auth_mixin.py::AuthMixin` 类声明 `_config_write_lock: threading.Lock` 类型注解（参照 `config_mixin.py:31`），并 `import threading`。
- [x] 2.2 修改 `handle_apply_auth`：将 `set_source_auth(...)` + `self.config.save(_get_config_path())` 包入 `with self._config_write_lock:`；parser 配置（`configure_auth` / `set_jm_domain` / `set_username`）与 downloader `configure_auth` 留在锁外。
- [x] 2.3 对 `handle_moeimg_login` / `handle_bika_login` / `handle_hcomic_login` 做同样处理：`set_source_auth + save` 进锁，网络 `login()` 与 parser `configure_auth` / `set_stored_credentials` 留锁外。
- [x] 2.4 新增 pytest 用例：用 monkeypatch 让 `config.save` 在并发调用时检测锁未持有则置位标志 → 断言认证 handler 内 `save` 始终在锁内；并验证两个认证 handler 并发不会相互损坏 `source_auth` 字典（可用 fake executor 串行模拟 + 断言最终状态正确）。

## 3. 清理 EOF 空白行（通过 git diff --check）

- [x] 3.1 移除以下 5 个 spec.md 末尾多余空白行：`openspec/specs/cover-cache/spec.md`、`openspec/specs/image-protocol-delivery/spec.md`、`openspec/specs/login-overlay/spec.md`、`openspec/specs/moeimg-metadata-fields/spec.md`、`openspec/specs/preview-error-recovery/spec.md`。
- [x] 3.2 移除 `tests/unit/main/login-window.test.ts` 末尾多余空白行。
- [x] 3.3 运行 `git diff --check origin/master...HEAD` 确认 exit 0、无输出。（注：三点 diff 仅看已提交内容，当前修复在工作区；`git diff --check origin/master` 含工作区已 exit 0，提交后三点 diff 即通过）

## 4. 全量验证（提交前必须全绿）

- [x] 4.1 `pytest`（含新增用例，预期 ≥920 通过，无新增失败）。— 实测 **932 passed**（新增 12 用例）
- [x] 4.2 `npx tsc --noEmit` exit 0 无输出。
- [x] 4.3 `npm test`（前端 vitest，预期 1144 通过）。— 实测 **83 files / 1144 tests passed**
- [x] 4.4 `npm run lint:py` → `All checks passed!`。
- [x] 4.5 `node scripts/format-py.mjs --check` → 全部 unchanged。（123 files unchanged）
- [x] 4.6 `npm run lint` exit 0。
- [x] 4.7 再次确认 `git diff --check origin/master...HEAD` exit 0。（工作区 vs origin/master 已无 EOF 空白错误；三点 diff 仅含已提交内容，提交后即通过）
