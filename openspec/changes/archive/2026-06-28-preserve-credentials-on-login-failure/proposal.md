## 为什么

对于支持账号密码登录的来源（hcomic、moeimg、bika），当 `parser.login()` 因网络异常或密码错误而失败时，用户输入的账号密码**从未被保存**——保存动作绑定在登录成功之后，异常抛出后保存步骤被整体跳过。用户下次打开设置页看到的是空表单，体验上等同于"被清除了"。

此外，`handle_apply_auth`（curl 登录路径）调用 `config.set_source_auth()` 时整体替换来源字典，未显式传入 username/password 时会用空字符串覆盖已有值，造成另一条路径的凭据意外丢失。这是同一个根因（保存与成功绑死、且 set_source_auth 是破坏性整体替换）的两个表现。

本变更的目标：**用户输入的账号密码无论登录成败都必须被持久化**，且 `apply_auth` 不得覆盖已存在的凭据。

## 变更内容

- **保存时机解耦**：三个账号密码登录 handler（`handle_moeimg_login` / `handle_bika_login` / `handle_hcomic_login`）在调用 `parser.login()` **之前** 先持久化 username/password 到 config 并写入 parser 的 `set_stored_credentials`。登录失败时异常正常向上抛出，但凭据已在盘上。
- **`handle_apply_auth` 合并写**：调用 `set_source_auth` 前读出已有条目，保留 username/password，避免 curl 登录覆盖凭据。
- **失败时也写 `set_stored_credentials`**：按用户明确意图，密码错误等失败场景下仍将凭据注入 parser 的懒登录路径，以便网络恢复后下次请求自动重试登录。
- 集中引入私有辅助 `_persist_credentials`，串行化复用现有 `_config_write_lock`。

## 功能 (Capabilities)

### 新增功能

- `credential-persistence`: 定义账号密码凭据在登录失败时仍被持久化的需求，以及 `apply_auth` 不得覆盖已有凭据的约束。

### 修改功能

（无。既有 `auth` capability 仅覆盖标识符/命名约定，本变更的语义层契约独立成新功能。）

## 影响

- **代码**：
  - `python/ipc/auth_mixin.py`：三个 `handle_*_login` handler 与 `handle_apply_auth` 重排顺序与合并写逻辑，新增 `_persist_credentials` 辅助。
  - `config.py`：无对外 API 变化（`set_source_auth` / `get_source_auth` 已支持所需字段，仅使用方式变化）。
- **行为语义**：
  - 登录失败时 config.json 仍写入 username/password（token/cookie 保持失败前的值）。
  - parser 懒登录路径持有失败密码，下次请求会自动重试登录（预期行为，需在 commit message 注明）。
- **测试**：新增/补充对三个 handler 失败路径与 apply_auth 合并写的单测。
- **安全**：密码仍以明文落盘到 `~/.hcomic_downloader/config.json`（既有行为，权限 0o600 / Win32 ACL 已限制到当前用户），本变更不改变安全等级。
