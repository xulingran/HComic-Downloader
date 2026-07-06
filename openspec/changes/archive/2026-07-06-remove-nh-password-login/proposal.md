## 为什么

NH 官方账号密码登录当前强制要求非零 PoW 与 Cloudflare Turnstile CAPTCHA，现有后端直登只提交空挑战字段，因而稳定返回 HTTP 400；继续展示账号密码入口会让用户误以为该方式受支持，并在失败前把密码写入本地配置。NH API Key 已完整覆盖用户信息与收藏夹能力，应将其收敛为唯一受支持的 NH 认证方式。

## 变更内容

- **BREAKING**：移除设置页中的 NH 用户名、密码及账号密码登录按钮，仅保留 API Key 输入、应用、校验和清除操作。
- **BREAKING**：移除 NH 账号密码登录的前端 API、Electron IPC 通道映射、Python handler 以及 `NhParser.login()` / 存储账号密码能力；其他来源的账号密码登录保持不变。
- 将 NH 认证契约收敛为 `Authorization: Key <api_key>`，不再把 User Token 或 Cookie 作为受支持的 NH 登录方式。
- 停止读取、回填或持久化 NH `username` / `password` / `cookie` / `user_agent`；升级时清理配置中遗留的上述 NH 凭据以及旧 `User` / `Token` 凭据，保留有效 API Key。
- 更新 NH 收藏、入口页、认证状态和文档中的登录语义，使所有提示统一指向 API Key。
- 删除失效的账号密码登录测试，补充 API Key 唯一路径、遗留凭据清理及 IPC 契约回归测试。

## 功能 (Capabilities)

### 新增功能

无。

### 修改功能

- `nh-authentication`: 将 NH 认证收敛为仅 API Key，并移除账号密码、User Token 与 Cookie 登录契约及对应 IPC/配置恢复行为。
- `nh-favourites`: 将 NH 收藏能力的有效认证前提改为 API Key，统一未认证提示。
- `nh-entry-page`: 将入口页中的“已认证”语义从 API Key/User Token 收敛为 API Key。
- `auth-password-prefill`: 从支持账号密码回填的来源集合及配置返回字段中移除 NH。
- `credential-persistence`: 从账号密码持久化与 curl 保留规则中移除 NH，并规定遗留 NH 敏感凭据的清理语义。

## 影响

- 前端：`src/components/settings/AuthSettings.tsx`、`src/pages/SettingsPage.tsx` 及相关 hooks/tests。
- Electron/共享契约：`electron/main.ts`、`electron/preload.ts`、`shared/types.ts`、IPC 一致性测试。
- Python：`sources/nh/parser.py`、`python/ipc/auth_mixin.py`、`python/ipc_server.py`、`python/ipc/config_mixin.py`、`sources/__init__.py`、配置归一化与认证解析逻辑。
- 配置：`source_auth.nh` 仅保留 API Key 所需的 `bearer_token`；旧版本中的 NH 账号密码、Cookie、User Token 不再恢复，并在后续保存时清除。
- 文档与测试：README、CHANGELOG、NH 认证/收藏测试、配置持久化测试、设置页和 IPC 契约测试。
- 不新增依赖；不影响 NH 匿名搜索/详情/排行/标签能力，也不影响其他来源的认证方式。
