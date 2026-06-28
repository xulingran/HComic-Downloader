## 上下文

本轮 L4 代码审查在待推送的 23 个提交中发现三个待修问题。当前实现现状（均已核实）：

- **preview 写盘失败伪成功**：`python/ipc/preview_mixin.py:238-247` 的 `_do_fetch_preview_image()`，当 `_write_preview_cache()` 返回 `None` 时，仍然用 `hashlib.sha256(url)` 算出 `url_hash` 当成功结果返回。注释声称依赖"协议 handler 的 on-demand fetch fallback"，但 `electron/main.ts:381-402` 的 `app-image://` handler **没有**任何 fallback——它只 `fs.existsSync` 后 `net.fetch('file://...')`，文件不存在直接 404。结果：前端拿到一个永不存在的 hash，显示"图片加载失败"，真正根因（写盘失败/SQLite/权限）被吞掉，且 `preview-error-recovery` 的失败聚合/重试链路因收到"成功"响应而不被触发。
- **认证保存未串行化**：`python/ipc/auth_mixin.py` 的四个 handler（`handle_apply_auth`、`handle_moeimg_login`、`handle_bika_login`、`handle_hcomic_login`）各自直接调 `self.config.save()`，未持锁。而 `ConfigMixin.handle_set_config`（`config_mixin.py:233-244`）已经为同类竞态（并发 `os.replace` → `WinError 5`）引入了 `_config_write_lock`，该锁在 `ipc_server.py:202` 实例化、`config_mixin.py:31` 声明为类属性。认证 handler 同样跑在 `_request_executor` 线程池里，存在完全相同的并发写盘竞态，外加 `set_source_auth` 对 `source_auth` 字典的读改写竞态。
- **EOF 空白**：`git diff --check origin/master...HEAD` 报 6 处文件末尾多余空白行。

约束：`_config_write_lock` 是 `IPCServer` 级别的可重入锁（threading.Lock，所有 mixin 共享同一实例属性）；`app-image://` 协议层刻意不持有 Python 回源能力（避免渲染进程→主进程→Python 的同步往返）。

## 目标 / 非目标

**目标：**
- 让 preview 写盘失败时 IPC 正确返回 error，使前端既有失败聚合/重试链路被触发，并消除"伪成功 hash"。
- 让所有触发 `config.save()` 的 IPC handler 共享同一 `_config_write_lock` 串行化，消除认证路径的并发写盘与字典竞态。
- 通过 `git diff --check` whitespace gate。

**非目标：**
- **不**为 `app-image://` 协议层新增按 hash 回源下载的 on-demand fallback（见 Risks 中的权衡）。保持协议层"只读磁盘 + 不存在即 404"的简单语义。
- **不**重构 preview 缓存的存储后端或 LRU 策略。
- **不**改变 `fetch_preview_image` 的成功返回形态 `{ urlHash }`，不改变任何 IPC 方法签名。
- **不**处理审查报告 🔵 Minor 中测试 stderr 的 `act(...)` warning 与 mock 缺失（属信号比问题，另案）。

## 决策

### 决策 1：写盘失败时抛错而非返回伪 hash

`_write_preview_cache()` 失败时（返回 `None`）→ `_do_fetch_preview_image()` 抛 `RuntimeError`（或专门的 `PreviewCacheError`）。`_async_fetch_preview_image()` 的 `except Exception` 已将异常转为 JSON-RPC error 下发，前端 `fetchPreviewImage` 的既有 error 分支会触发 `preview-error-recovery` 的失败聚合与重试。

**为何不引入"无 cache 属性时降级返回 in-memory bytes"**：当前架构下协议层无法消费内存字节（只读文件），任何不落盘的字节都无法通过 `app-image://` 交付，返回 hash 必然导致 404。因此"未落盘"等价于"失败"，必须报错。

**为何不区分"无 `_preview_cache` 属性"与"有 cache 但 put 失败"**：两种情况结果相同（没有磁盘文件可交付），统一抛错即可。原注释把"无 `_preview_cache`"当作可降级路径是错误的——生产环境 `_preview_cache` 始终存在，且即便缺失，下游协议层也无法回源。

**替代方案考虑过**：(a) 协议层加 fallback 回调 Python 重新拉取——被否，破坏协议层"纯磁盘流式"边界，且引入同步往返与重入；(b) 后端写盘失败后返回 bytes 让前端走 data URI——被否，违背 `app-image://` 管道"消除 base64 全栈拷贝"的核心设计目标（见提交 `0a16208`）。

### 决策 2：复用 `_config_write_lock` 保护认证保存

在 `AuthMixin` 类声明 `_config_write_lock: threading.Lock`（与 `ConfigMixin` 同样的类型注解，指向同一实例属性），把每个 handler 中"`set_source_auth` + `save`"包入 `with self._config_write_lock:`，使字典读改写与原子写盘成为一个临界区。不在锁内做网络操作（`login()`、`extract_auth_from_curl`、`verify_login_status` 等网络/解析仍在锁外，仅最后落库加锁），避免长事务阻塞。

**为何复用而非新锁**：`config.save` 的竞态本质是"同一 config_path 上的并发 `os.replace`"，必须与 `handle_set_config` 互斥，故必须用**同一把锁**。新开锁无法跨 handler 互斥。

**替代方案考虑过**：(a) 把 `save` 本身改成内部加锁——被否，`save` 是 `Config` 类方法，可能在不持有 IPCServer 的上下文调用，且会让锁语义扩散到数据类；(b) 改用 `threading.RLock`——无需可重入，标准 `Lock` 足够且 `ConfigMixin` 已用 `Lock`，保持一致。

### 决策 3：仅删 EOF 空白，不改 spec/测试逻辑

对 `git diff --check` 报出的 6 个文件，仅移除末尾多余空行，不动任何内容。注意：其中 5 个是 `openspec/specs/` 下已归档的 spec.md（本次变更会再为 `preview-error-recovery`、`config` 生成增量，但 EOF 修复独立于增量内容）。

## 风险 / 权衡

- **[写盘失败转为 error，可能放大瞬时失败可见性]** → 缓解：写盘失败本就是真实故障，原先"伪成功 + 静默 404"对用户更糟（看不到根因、无重试入口）。转为 error 后接入既有重试链路，且 `_write_preview_cache` 的 `(OSError, sqlite3.Error)` 已是"真实磁盘/DB 问题"，重试有恢复可能。
- **[认证加锁增加一次锁竞争]** → 缓解：锁仅覆盖 `set_source_auth + save`（纯本地、毫秒级），网络登录在锁外；并发登录场景罕见（单用户 UI），且消除了 `WinError 5` 数据损坏风险，收益远大于微小的等待。
- **[协议层无 fallback 的边界对外不显式]** → 缓解：在 `preview-error-recovery` 与 `image-protocol-delivery` 规范中已明确"协议层只读磁盘"，本次增量进一步约束"后端写盘失败必须报错"，使契约两端自洽。
- **[spec.md 的 EOF 修复与本次规范增量混在一起]** → 缓解：EOF 修复是纯 whitespace，与增量需求内容正交；apply 时分别处理即可。

## Migration Plan

无需数据迁移。改动对前端透明：
- `fetch_preview_image` 成功路径形态不变（`{ urlHash }`）；失败路径从"伪成功"变为标准 JSON-RPC error，前端 `fetchPreviewImage` 既有 `try/catch` 与 error 态分支无需改动。
- 认证 IPC 调用方无感知（锁在后端内部）。

回滚策略：纯代码改动，`git revert` 即可；无不可逆状态变更。

## Open Questions

无。三个问题根因、调用链与约束均已核实，方案无歧义。
