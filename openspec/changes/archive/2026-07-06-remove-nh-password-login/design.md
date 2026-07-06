## 上下文

NH 的账号密码登录端点要求先获取 `GET /api/v2/pow?action=login` 的挑战并完成非零难度 PoW，同时提交 Cloudflare Turnstile CAPTCHA token。当前 `NhParser.login()` 固定提交三个空挑战字段，真实请求返回 HTTP 400；测试通过 mock 固化了空字段，因此无法证明该链路可用。与此同时，通用密码登录 helper 会在网络请求前持久化 NH 用户名和密码，使一个不可用入口仍长期保存敏感数据。

NH 官方 API Key 能访问用户信息、收藏夹列表及收藏状态接口，已经覆盖应用需要的全部认证能力。当前实现把 API Key 复用在 `source_auth.nh.bearer_token`，并由解析器映射为 `Authorization: Key <api_key>`。

本变更跨越 React 设置页、Electron preload/main IPC、Python JSON-RPC、解析器工厂和配置迁移。系统代理约束不变：NH 的所有网络请求仍必须使用已调用 `apply_system_proxy_to_session()` 的 Session。

## 目标 / 非目标

**目标：**

- 让 API Key 成为 NH 唯一受支持、唯一可配置、唯一可恢复的认证方式。
- 完整删除 NH 账号密码登录的 UI、类型、IPC、handler、解析器方法和测试，不保留不可达死代码。
- 删除 NH Cookie、User Token 与账号密码的运行期恢复入口，并清理旧配置中的敏感遗留值。
- 保持 NH 匿名浏览、API Key 收藏能力和其他来源认证行为不变。
- 让 API Key 的输入、持久化、校验和清除具有明确的端到端契约，且不在 UI、日志或配置读取响应中回显完整 Key。

**非目标：**

- 不实现 PoW 求解、Turnstile、浏览器交互式 NH 登录或 User Token 刷新。
- 不改变 HComic、MoeImg、JM、哔咔、拷贝漫画的认证方式。
- 不更改 NH API Key 在配置中的物理字段名，也不引入新的加密存储依赖。
- 不改变 NH 搜索、详情、排行、标签及收藏接口的数据解析。

## 决策

### 1. API Key 是 NH 唯一支持的认证凭据

NH parser 仅从配置接收 API Key，并始终发送 `Authorization: Key <api_key>`。删除 Cookie/User-Agent 认证状态、User Token 前缀兼容、账号密码存储与 `login()`。认证判定仅取决于非空且通过归一化的 API Key。

替代方案是保留 User Token 作为隐藏兼容路径。该方案会让“仅 API Key”在配置和运行期不成立，并继续保留无刷新机制的短期凭据，因此不采用。

### 2. 用专用 API Key IPC 替换账号密码 IPC

移除 renderer 暴露的 `nhLogin(username, password)`、`python:nh-login` 与 Python `nh_login` JSON-RPC 方法，新增语义明确的 `nhApplyApiKey(apiKey)` / `python:nh-apply-api-key` / `nh_apply_api_key` 链路。专用 handler 负责：去除首尾空白、拒绝空值/控制字符/异常长度、写入 `source_auth.nh.bearer_token`、清空 NH 其他认证字段、保存配置并立即注入 parser。

这避免设置页继续构造伪 curl 字符串后借用通用 `apply_auth`，也避免通用 curl 解析丢失 Authorization scheme 后无法区分 API Key 与 Bearer/User Token。

替代方案是继续调用 `apply_auth`。虽然改动较少，但它仍允许 Cookie/Bearer 进入 NH 配置，无法在边界上表达“仅 API Key”，因此不采用。

### 3. 保留 `bearer_token` 配置槽，但限定 NH 语义

不新增 `api_key` 字段；`source_auth.nh.bearer_token` 对 NH 专门表示不带 `Key ` 前缀的原始 API Key。这样可直接兼容当前设置页已经保存的 Key，并避免全局 `AuthSourceData` 数据迁移。配置/日志/`get_config` 响应不得返回完整 Key，只暴露 `hasNhAuth`。

若输入带有 `Key ` 前缀，专用 handler 可归一化后仅保存其值；`User `、`Token `、`Bearer ` 以及 Cookie 输入必须拒绝或清除，禁止误当 API Key 使用。

### 4. 旧 NH 敏感凭据采用收敛式迁移

配置加载归一化 NH 条目时：

- 保留无前缀的非空 `bearer_token`，将其解释为既有 API Key；带 `Key ` 前缀时去前缀后保留。
- 清空 `username`、`password`、`cookie`、`user_agent`。
- 清空带 `User `、`Token ` 或 `Bearer ` 前缀的 `bearer_token`，要求用户重新配置 API Key。

若归一化改变了磁盘值，启动配置加载流程必须通过既有原子写入机制回写清理后的配置，避免密码只在内存中消失、磁盘仍长期残留。迁移不尝试把 User Token 转换成 API Key，因为二者不可互换。

### 5. 删除链路必须以契约可达性验证

测试不只断言 UI 不显示输入框，还必须验证以下负向契约：共享 API 不含 `nhLogin`、preload/main 不注册 `python:nh-login`、Python dispatcher 不含 `nh_login`、`NhParser` 不提供密码登录/存储凭据方法、配置响应不含 `nhUsername`/`nhPassword`。正向测试覆盖 API Key 应用、重启恢复、校验、收藏操作与清除。

## 风险 / 权衡

- **[旧 User Token 用户升级后失去 NH 收藏认证]** → 明确显示“请配置 API Key”，不把 User Token 猜测为 Key；这是收敛认证方式的预期破坏性变化。
- **[原始 Key 与无前缀历史 token 无法完全区分]** → 当前账号登录保存值始终带 `User ` 或旧 `Token ` 前缀；无前缀值按既有契约保留为 API Key，并用校验接口决定有效性。
- **[新增专用 IPC 扩大修改面]** → 同时删除旧密码 IPC，并用通道一致性测试、validators 和类型契约覆盖；换取来源边界明确且不再依赖伪 curl。
- **[配置加载时自动回写产生启动期 I/O]** → 仅当检测到遗留 NH 字段时执行一次，继续使用 temp file + rename 和既有配置写锁/原子写入语义。
- **[删除 parser 通用参数影响懒创建]** → NH factory 与 `MultiSourceParser.configure_auth` 使用显式 NH 分支；其他来源的通用三元组认证接口不变。

## 迁移计划

1. 先实现配置归一化与测试，确保升级过程中旧密码/User Token 被安全清理、现有 API Key 被保留。
2. 增加专用 API Key handler 与 IPC 契约，并让设置页切换到新接口。
3. 删除旧账号密码 UI、共享类型、Electron/Python 通道、parser 登录与恢复代码。
4. 更新 NH 收藏/入口提示、README、CHANGELOG 与 OpenSpec 基线措辞。
5. 运行 NH 定向测试和项目七项完整验证流程。

回滚旧版本不会恢复已清理的 NH 密码或 User Token；用户可在新旧版本中重新配置 API Key。API Key 沿用现有字段，因此无需反向数据迁移。

## 待确认问题

无。
