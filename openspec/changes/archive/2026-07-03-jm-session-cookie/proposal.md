## 为什么

JM 来源的 cookie（`remember`/`remember_id`）和配套 user-agent 当前被持久化到 `config.json`，程序每次启动时主动从配置恢复。这违反了 JM 会话凭据的时效性语义：这些 cookie 是登录窗口在浏览器会话中获取的、与 Cloudflare 挑战通过状态绑定的临时凭据，跨进程复用既无意义（服务端早已失效或触发新一轮人机验证），又存在陈旧 cookie 干扰新会话的风险。JM 应像人机验证快照一样属于"会话级"凭据——进程存活期间可用，退出即丢弃，下次启动从匿名状态开始。

## 变更内容

- **启动不再恢复 JM cookie/UA**：`MultiSourceParser` 为 JM 引入独立运行期内存凭据字段 `_jm_session_auth`（启动为空 → 匿名），factory lambda 读此字段注入 `JmParser`；持久化 `source_auth["jm"]` 的存量残留被 factory 与 `_apply_post_init` 完全忽略。`_apply_post_init` 对 JM 仅保留 `jm_domain` 的 `set_custom_domain` 与 `bearer_token` 补注入（cookie/UA 已由 factory 构造参数传入）。
- **登录不再落盘 JM cookie/UA**：`handle_apply_auth` 对 JM 来源不调用 `config.set_source_auth` / `config.save`，仅通过 `parser.configure_auth` 写入运行期内存凭据（`_jm_session_auth`），使运行期请求仍可携带。
- **鉴权状态查询走运行期凭据**：`_check_source_auth` 与 `hasJmAuth` 改用新增的 `MultiSourceParser.get_runtime_auth()` 查询 JM 运行期登录态，不再读持久化 `source_auth["jm"]`，避免运行期登录被误判未登录或存量残留 cookie 假阳性。
- **并发安全**：JM `configure_auth` 持 `_parser_lock` 完成状态更新 + 实例查询 + 即时注入，与 `_get_parser` 的懒创建临界区互斥，杜绝登录注入与首次懒创建的竞态。
- **存量配置容忍**：`config.json` 中既有的 `source_auth["jm"]["cookie"]` 字段不做主动清理或迁移，但在鉴权查询与 factory 创建路径被完全忽略。文件残留视为无害脏数据，避免破坏性写操作。
- **JM domain 配置不受影响**：`jm_domain` 是用户显式配置的连接参数，与认证态无关，继续持久化与恢复。

## 功能 (Capabilities)

### 新增功能
- `jm-session-cookie`: 定义 JM 来源会话级凭据（cookie/user_agent）的生命周期不变量——禁止持久化、禁止启动恢复、运行期内存可用、存量配置容忍。

### 修改功能
- `credential-persistence`: 需求"apply_auth 不得覆盖已存在的账号密码"的场景"对无账号密码的来源应用 curl 不受影响"被**窄化**。原描述断言 JM 来源的 cookie/UA/bearer_token "按提交值写入"（隐含落盘）；本变更后 JM 来源的 cookie/UA/bearer_token **禁止落盘**，仅注入内存 parser。该需求的核心不变量（apply_auth 不得覆盖既有 username/password）不变，仅 JM 的 cookie 落盘语义随 jm-session-cookie 新需求调整。

<!-- 说明：proposal 初稿遗漏了此交叉影响。实现审查阶段发现既有测试
     test_apply_auth_jm_source_no_username_fields 直接断言 jm cookie 被持久化，
     其依据正是 credential-persistence 场景6。本变更新契约与该断言冲突，
     故必须显式修改该场景，避免 spec 间矛盾。 -->

## 影响

- **后端 Python**：
  - `sources/__init__.py`：新增 `_jm_session_auth` 字段与 `get_runtime_auth()`；改造 `_factory["jm"]` lambda、`configure_auth` 的 JM 分支（持锁）、`_apply_post_init` 的 JM 分支（bearer_token 补注入）。
  - `python/ipc/auth_mixin.py`：`handle_apply_auth` 的 JM 分支（跳过落盘，保留内存注入与 `set_jm_domain` / `set_username` 调用）。
  - `python/ipc/search_mixin.py`：`_check_source_auth` 的 JM 分支改用 `get_runtime_auth`。
  - `python/ipc/config_mixin.py`：`hasJmAuth` 改用 `get_runtime_auth`。
- **配置文件**：`~/.hcomic_downloader/config.json` 的 `source_auth.jm.cookie` / `.user_agent` 字段停止被写入；老用户的存量值残留但永不被鉴权路径读取。
- **前端 / Electron**：无行为变化。登录窗口流程不变（仍提取 cookie/UA 经 `apply_auth` 传入），仅后端落盘策略改变；用户每次启动需重新登录 JM 的体验是预期行为。
- **测试**：`tests/test_multi_source_parser.py`（含懒创建时序、并发回归、bearer_token 保留）、`tests/test_jm_runtime_auth_query.py`（鉴权状态查询）、`tests/test_ipc_auth_mixin.py`（落盘拦截 + 非 JM 回归）需补充对应断言。
