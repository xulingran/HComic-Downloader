## 1. 配置迁移与认证模型收敛

- [x] 1.1 为 NH 配置归一化补充失败优先测试：保留无前缀/`Key ` API Key，清空 username、password、cookie、user_agent 及 `User ` / `Token ` / `Bearer ` 凭据。
- [x] 1.2 修改 `normalize_source_auth` / `Config.load` 的 NH 分支，并在检测到旧敏感字段时通过既有原子写入机制一次性回写清理后的配置。
- [x] 1.3 更新配置读取契约：删除 `nhUsername` / `nhPassword` 输出，`hasNhAuth` 仅由有效 API Key 决定且禁止回显完整 Key。
- [x] 1.4 增加配置磁盘往返与升级回归测试，证明旧 NH 密码和 User Token 已从磁盘删除、现有 API Key 不丢失、其他来源配置不变。

## 2. Python NH API Key 唯一链路

- [x] 2.1 重构 `NhParser` 认证接口为仅 API Key：始终构造 `Authorization: Key <api_key>`，并删除 Cookie/User-Agent/User Token 兼容状态、`login()`、`set_stored_credentials()` 及账号密码属性。
- [x] 2.2 更新 `MultiSourceParser` 的 NH factory、懒创建恢复和运行期 `configure_auth` 分支，只注入 API Key并删除 NH 账号密码恢复逻辑。
- [x] 2.3 新增专用 `handle_nh_apply_api_key`：校验空白、控制字符、长度和非法认证前缀，持久化纯 Key、清空其他 NH 认证字段并立即注入 parser。
- [x] 2.4 从 `AuthMixin`、`IPCServer.METHOD_MAP` 及相关调度测试中删除 `handle_nh_login` / `nh_login`，同时注册并覆盖 `nh_apply_api_key`。
- [x] 2.5 收紧 NH 认证查询、校验与清除流程，使收藏夹和 `hasNhAuth` 只接受 API Key，并将缺失/失效提示统一为“配置 API Key”。
- [x] 2.6 更新 Python 定向测试，删除空 PoW/CAPTCHA 和 User Token/Cookie 成功夹具，覆盖 API Key 应用、恢复、验证、清除、非法前缀拒绝及收藏回归。

## 3. Electron 与共享 IPC 契约

- [x] 3.1 在 `shared/types.ts` 中以 `nhApplyApiKey(apiKey)` 和 `python:nh-apply-api-key` 替换 `nhLogin(username, password)` 与 `python:nh-login`，同步 Python 通道映射。
- [x] 3.2 更新 preload 输入验证和 Electron main handler，确保 API Key 类型、去空白、长度和控制字符校验后才转发到 `nh_apply_api_key`。
- [x] 3.3 更新 IPC 通道一致性、main/preload 和 validator 测试，正向验证新通道，并负向验证旧 `nh-login` 通道不再注册或暴露。

## 4. 设置页与用户交互

- [x] 4.1 删除 `AuthSettings` 的 NH 用户名/密码 state、props、输入框、显示密码按钮和账号登录按钮，仅保留 API Key、测试认证与清除认证控件。
- [x] 4.2 删除 `SettingsPage` 的 NH 密码登录 handler、保存凭据回填和相关配置 state，改为调用 `nhApplyApiKey` 并在成功后执行现有认证校验。
- [x] 4.3 更新 NH 设置页文案与错误提示，明确 API Key 是唯一方式，并保留“前往 NH 账户设置生成 API Key”的外链。
- [x] 4.4 更新设置页组件测试：验证 API Key 唯一路径可用、Key 不回填，且 NH 用户名/密码/账号登录元素完全不存在。

## 5. 残留清理、文档与完整验证

- [x] 5.1 全仓搜索并清除应用代码和测试中的 `nhLogin`、`nh_login`、`nhUsername`、`nhPassword`、NH `User/Token` 兼容及空 PoW/CAPTCHA 登录残留；保留归档 OpenSpec 历史不改。
- [x] 5.2 更新 README 与 CHANGELOG，将 NH 认证说明统一为仅 API Key，并记录旧账号密码/User Token 配置会在升级时清理。
- [x] 5.3 运行 NH/配置/Python IPC 定向 pytest 与设置页、main、IPC 一致性定向 Vitest，修复所有回归。
- [x] 5.4 依次运行完整质量门槛：`pytest`、`npx tsc --noEmit`、`npm test`、`npm run lint:py`、`black --check .`、`npm run lint`、`npm run lint:test-quality`。
