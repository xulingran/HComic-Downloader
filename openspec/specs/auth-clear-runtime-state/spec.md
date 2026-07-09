# auth-clear-runtime-state 规范

## 目的
确保清除任一来源认证时，运行期鉴权态与持久化配置一致归零，杜绝"持久化已清但运行期仍判已登录"的幽灵态。
## 需求
### 需求:清除认证必须同时归零运行期内存鉴权态

当用户通过 IPC 清除任一来源（`handle_clear_source_auth`）的认证时，清除操作**必须**经过 `MultiSourceParser.configure_auth(cookie="", user_agent="", bearer_token="", source=source)`（即登录/应用凭据时使用的同一通道），使该来源的**运行期**鉴权态与持久化 `config.json` 一致地归零。对于 JM 来源，清除**必须**重置 `MultiSourceParser._jm_session_auth`（`get_runtime_auth("jm")` 的真值来源）；对于非 JM 来源，清除**必须**重置 `MultiSourceParser.source_auth[<source>]`（`get_runtime_auth(<非jm>)` 的真值来源）。清除**禁止**仅作用于单个解析器实例（如 `JmParser.configure_auth`）而留下 `MultiSourceParser` 级别的运行期字典为旧值。清除完成后，`get_runtime_auth(source)` **必须**立即返回匿名（空 cookie、空 user_agent），使 `_check_source_auth` 等鉴权门立即反映为未登录。

#### 场景:清除 JM 认证后运行期登录态立即归零

- **当** 用户已通过登录窗口登录 JM（`_jm_session_auth` 含非空 cookie/user_agent），随后在设置页清除 JM 认证（调用 `handle_clear_source_auth("jm")`）
- **那么** `MultiSourceParser._jm_session_auth` **必须**被重置为全空（cookie/user_agent/bearer_token 均为空串）
- **且** `get_runtime_auth("jm")` **必须**立即返回 `("", "")`
- **且** `_check_source_auth` 在下次调用时**必须**判定 JM 为未登录（触发 `AuthRequiredError`）
- **且** 活动 `JmParser` 实例的 `_cookie`/`_user_agent` 及会话头**必须**同步被清空

#### 场景:清除非 JM 来源认证后运行期鉴权态归零

- **当** 用户已应用某非 JM 来源（如 hcomic/bika/copymanga/moeimg/nh）的凭据（`MultiSourceParser.source_auth[<source>]` 含非空值），随后清除该来源认证
- **那么** `MultiSourceParser.source_auth[<source>]` **必须**被重置为全空 cookie/user_agent/bearer_token
- **且** `get_runtime_auth(<source>)` **必须**立即返回 `("", "")`
- **且** 对应活动解析器实例的认证头**必须**同步被清空

#### 场景:清除后持久化配置与运行期一致

- **当** 清除任一来源认证完成
- **那么** `config.json` 的 `source_auth[<source>]`（cookie/user_agent/bearer_token/username/password）**必须**全为空串
- **且** `get_runtime_auth(<source>)` 返回值**必须**与持久化配置一致（均为匿名），**禁止**出现"持久化已清但运行期仍判已登录"的幽灵态

#### 场景:清除路径与登录路径使用同一通道

- **当** 审查 `handle_clear_source_auth` 实现
- **那么** 其对 `MultiSourceParser` 的调用签名**必须**与 `handle_apply_auth`（登录/应用路径）一致，即 `self.parser.configure_auth(..., source=source)`
- **且** **禁止**通过 `self.parser.parsers.get(source).configure_auth(...)`（绕过 `MultiSourceParser` 的单实例方法）来清除运行期状态
