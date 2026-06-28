## 新增需求

### 需求:所有触发配置持久化的 IPC handler 必须串行化写盘

任何触发 `Config.save()` 的 IPC handler——包括但不限于 `handle_set_config` 以及登录/应用认证类 handler（`handle_apply_auth`、`handle_moeimg_login`、`handle_bika_login`、`handle_hcomic_login`）——**必须**通过 `IPCServer` 级别统一的 `_config_write_lock` 串行化其"修改 `config` 状态 + `save()` 原子写盘"的临界区。该锁**必须**与 `ConfigMixin.handle_set_config` 复用同一实例（同一 `IPCServer` 实例上的所有 mixin 共享），以保证跨 handler 的 `os.replace` 与字典读改写互斥。

理由：认证 handler 与 `set_config` handler 同样运行在 `_request_executor` 线程池中，并发执行时会对同一 `config_path` 触发 `os.replace`（在 Windows 上抛 `WinError 5`），并对 `config.source_auth` 字典产生读改写竞态。`handle_set_config` 已为此引入 `_config_write_lock`，认证路径必须复用同一把锁才能形成有效互斥。

#### 场景:认证保存临界区持锁

- **当** 任意认证 handler（apply_auth / moeimg_login / bika_login / hcomic_login）在完成网络登录后准备落库
- **那么** 其 `set_source_auth(...)` 与 `self.config.save(_get_config_path())` **必须**整体包裹在 `with self._config_write_lock:` 内
- **且** 网络登录（`login()` / `extract_auth_from_curl()` / `verify_login_status()`）与 parser 配置（`configure_auth` / `set_jm_domain` / `set_username`）等可在锁外执行，避免长事务阻塞

#### 场景:并发认证保存不竞态

- **当** 两个认证 handler 在 `_request_executor` 中并发执行并先后到达落库阶段
- **那么** 二者的 `os.replace` 由 `_config_write_lock` 串行化，不再触发 `WinError 5`
- **且** 二者对 `source_auth` 字典的写操作互斥，不再出现后写覆盖先写的字典竞态

#### 场景:认证保存与 set_config 互斥

- **当** 一个认证 handler 正在持锁落库，同时另一个请求触发 `handle_set_config` 准备落库
- **那么** 二者通过同一 `_config_write_lock` 实例互斥
- **且** 任一方先完成，另一方在其后安全执行，不产生损坏的 config.json

#### 场景:锁失败/落库失败时回退为 IPC error

- **当** 认证 handler 在持锁落库阶段 `save()` 抛异常
- **那么** 异常向上冒泡为 JSON-RPC error 下发前端（认证 handler 不吞异常），用户可见失败提示
- **且** **禁止**在网络登录已成功但落库失败时返回 `success: True`
