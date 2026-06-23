## 新增需求

### 需求:迁移完成回调落库必须串行化

下载目录迁移完成回调（`_migration_complete_callback`）在工作线程中持久化新 `download_dir` 时，必须持有与 `handle_set_config` 相同的 `_config_write_lock`，确保迁移落库路径与配置变更落库路径串行化，禁止两处 `config.save` 的 `os.replace` 并发执行。

#### 场景:迁移进行中用户改其它配置

- **当** 下载目录迁移在工作线程执行，用户同时通过 `set_config` 修改另一配置项（如 timeout）
- **那么** 迁移回调的 `config.save` 与 `set_config` 的 `config.save` 必须通过 `_config_write_lock` 串行执行，不得并发触发 `os.replace`

#### 场景:迁移成功后落库新目录

- **当** 迁移完成且至少一个文件成功移动（满足既有落库条件）
- **那么** 回调必须在持有 `_config_write_lock` 的情况下执行 `_apply_runtime` + `config.download_dir = target_dir` + `config.save`，落库成功后释放锁

#### 场景:落库失败必须可观测

- **当** 回调持锁落库仍失败（如磁盘满）
- **那么** 必须记录 error 级日志（保持既有行为），不得静默吞掉

### 需求:并发改下载目录必须拒绝

当用户在迁移进行中（含 ready 等待确认态）再次变更下载目录时，系统必须拒绝本次配置变更并向上抛出错误，禁止退化为"只更新运行时目录 + 让调用方落库新 download_dir"的脱节路径。

#### 场景:迁移 ready 态时改目录被拒

- **当** 引擎 state.status == "ready"（已 plan 等待前端确认），用户再次改下载目录
- **那么** `_apply_download_dir_change` 必须让 `trigger_download_dir_migration` 抛出的"迁移进行中"错误向上冒泡，由 `handle_set_config` 透传给前端；禁止 catch 后调 `set_output_dir` 并返回 None 触发落库

#### 场景:迁移 running 态时改目录被拒

- **当** 引擎 state.status == "running"，用户改下载目录
- **那么** 同上，必须抛错拒绝，禁止脱节落库

#### 场景:无迁移时改目录走既有快速路径

- **当** 引擎 state 为终态（none/cancelled/completed/failed），用户改下载目录
- **那么** 走既有快速路径或正常 plan 流程，行为不变
