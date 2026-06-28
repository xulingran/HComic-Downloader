## 为什么

本轮 L4（核心关键）代码审查在待推送的 23 个提交中识别出三个必须修复的问题：

1. **preview cache 写入失败却返回成功 hash** — `preview_mixin._do_fetch_preview_image()` 在 `_write_preview_cache()` 返回 `None`（磁盘写失败 / SQLite 错误 / 权限错误）时，仍计算出 `url_hash` 并作为成功结果下发。但 `app-image://` 协议 handler 只读磁盘文件，没有"按 hash 回源下载"的 fallback（已核实 `electron/main.ts:381-402` 仅 `fs.existsSync` 后流式返回，文件不存在即 404）。前端拿到不存在的 hash 拼成协议 URL，用户看到的是"图片加载失败"，真实根因被吞掉。这违背错误处理完整性（不要把未落盘的 hash 当成功）。
2. **认证配置保存未串行化** — `auth_mixin` 的四个登录/应用认证方法（`handle_apply_auth` / `handle_moeimg_login` / `handle_bika_login` / `handle_hcomic_login`）都直接调 `self.config.save()`，但**没有**像 `config_mixin.handle_set_config` 那样持 `_config_write_lock`。认证 handler 在 `_request_executor` 线程池中并发执行，两个登录操作并发会触发 `os.replace` 的 `WinError 5`（与 `handle_set_config` 注释中已修的同类竞态）。同时 `set_source_auth` 对 `source_auth` 字典的并发读写也无保护。
3. **`git diff --check` 失败** — 6 个文件末尾有多余空白行（5 个 spec.md + 1 个测试文件），Git 原生 whitespace gate 不通过。

这些是核心图片管道与认证路径的正确性/健壮性问题，应在推送前修复。

## 变更内容

1. **修正 preview cache 写入失败的语义** — 当 `_write_preview_cache()` 返回 `None` 时，`_do_fetch_preview_image()` **必须**抛错（让 IPC 返回 error，前端走既有重试链路），**禁止**再计算并返回一个无文件支撑的 `url_hash`。明确"无 `_preview_cache` 属性"的极稀路径与"有 cache 但本次 put 失败"的区分处理。
2. **认证保存串行化** — `AuthMixin` 引入对 `_config_write_lock` 的复用（该锁已在 `ipc_server.py` 初始化，`ConfigMixin` 已声明为类属性），将四个 handler 中 `self.config.save()` 调用包入锁，并把 `set_source_auth` + `save` 作为临界区整体保护（防止读改写竞态）。
3. **清理 EOF 空白行** — 移除 `git diff --check` 报出的 6 个文件末尾多余空白行，使 whitespace gate 通过。

## 功能 (Capabilities)

### 新增功能

无。

### 修改功能

- `preview-error-recovery`: 新增需求——后端在预览缓存写入失败时必须返回错误而非伪成功 hash，与协议层"无 on-demand fallback"的现实对齐，使前端的失败聚合/重试链路能在写盘失败时被正确触发（而非显示一个永远 404 的协议 URL）。
- `config`: 新增需求——所有触发配置持久化的 IPC handler（含登录/应用认证类）必须通过统一的 `_config_write_lock` 串行化写盘与读改写临界区，避免并发 `os.replace` 与字典竞态。

### 未变更但需说明

- `image-protocol-delivery`: 本次**不**为协议层新增 on-demand fallback。协议层继续只读磁盘，由后端写盘失败时直接报错来保证"下发的 hash 一定有文件支撑"。该能力的现有需求（文件被 LRU 淘汰返回 404 触发重试）保持不变。

## 影响

- **受影响文件**:
  - `python/ipc/preview_mixin.py`（`_do_fetch_preview_image` 写盘失败分支）
  - `python/ipc/auth_mixin.py`（四个 handler 加锁；`_config_write_lock` 类型声明）
  - `openspec/specs/{cover-cache,image-protocol-delivery,login-overlay,moeimg-metadata-fields,preview-error-recovery}/spec.md` + `tests/unit/main/login-window.test.ts`（删除 EOF 空白行）
  - 新增/更新规范增量：`preview-error-recovery`、`config`
- **测试**: 现有 pytest（920）与 vitest（1144）应保持通过；需新增覆盖"写盘失败 → IPC error"与"并发认证保存不竞态"的用例。
- **对外接口**: 无破坏性变更。`fetch_preview_image` 的成功返回形态（`{ urlHash }`）不变，仅失败时从"伪成功"改为"正确 error"，前端已有 error 分支。
- **安全**: `_config_write_lock` 复用不放宽任何校验；写盘失败显式报错反而避免向渲染进程下发无文件支撑的 hash。
