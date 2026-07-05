## 为什么

NH（nhentai）来源目前仅支持匿名访问，解析器的 `configure_auth`、`verify_login_status` 和所有收藏夹方法都是空实现，导致用户无法使用本应用管理 nhentai 收藏夹。nhentai 官方 API v2 已经提供完整的登录、API Key 和收藏夹操作端点，因此可以低成本接入项目统一的来源认证与收藏夹体系，补齐 NH 的完整体验。

## 变更内容

- 为 `sources/nh` 解析器增加认证配置与持久化能力，支持 **API Key** 主认证和 **账号/密码登录** 两种模式。
- 实现 NH 收藏夹的查看、添加、移除和状态检查。
- 将 NH 加入 `_SOURCES_WITH_FAVOURITES`，让前端收藏夹页来源选择器出现 NH。
- 在前端配置与 IPC 契约中增加 NH 认证标志，并在设置页提供 NH 登录/API Key 输入入口。
- 为 NH 解析器的登录与收藏夹方法补充单元测试和 IPC 集成测试。

## 功能 (Capabilities)

### 新增功能

- `nh-authentication`: NH 来源的认证机制，包括 API Key 持久化、账号/密码登录、登录态校验。
- `nh-favourites`: NH 来源收藏夹的查看、添加、移除和状态检查。

### 修改功能

- 无现有规范需求发生变更。

## 影响

- 后端：`sources/nh/parser.py`、`sources/nh/constants.py`、`sources/__init__.py`、`python/ipc/auth_mixin.py`、`python/ipc/search_mixin.py`。
- 前端：`shared/types.ts`、设置页相关组件、登录弹窗/认证流程。
- 测试：Python 解析器测试、IPC 通道一致性测试。
- 配置：向 `config.json` 的 `source_auth.nh` 写入 `cookie` / `user_agent` / `bearer_token`（API Key）/ `username` / `password`。
