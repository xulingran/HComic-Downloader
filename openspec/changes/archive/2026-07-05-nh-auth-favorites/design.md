## 上下文

NH（nhentai）来源当前仅支持匿名 API v2 的搜索、详情、标签目录功能。解析器中的认证与收藏夹方法均为空实现，且 `sources/__init__.py` 未将 NH 纳入 `_SOURCES_WITH_FAVOURITES`。与此同时，nhentai 官方 API v2 已提供完整的认证、用户、API Key 和收藏夹操作端点，因此可以补齐 NH 的登录与收藏夹能力，而无需引入 HTML 抓取或私有接口。

## 目标 / 非目标

**目标：**
- 为 `NhParser` 实现 API Key 和账号/密码两种认证方式。
- 实现 NH 收藏夹的查看、添加、移除和状态检查。
- 将 NH 接入项目统一的来源认证与 IPC 收藏夹体系。
- 保持现有匿名搜索/详情/标签功能不变。
- 为新增能力补充单元测试与 IPC 集成测试。

**非目标：**
- 不实现 NH 的浏览器 WebView 登录（沿用 `apply_auth` 的 cookie 导入已足够作为备用）。
- 不修改其他来源的认证或收藏夹实现。
- 不在配置中新增除 `source_auth.nh` 以外的持久化字段。

## 决策

### 1. 主认证方式：API Key

**选择：** 将 API Key 作为 NH 的首选认证方式，用户在 nhentai 账户设置页手动生成后粘贴到本应用。

**理由：**
- nhentai API v2 明确支持 `Authorization: Key <api_key>`，这是官方推荐方式。
- API Key 不受浏览器 session 过期影响，也不需要存储用户密码。
- 避免 Cloudflare 挑战和 CAPTCHA 带来的不稳定性。

**替代方案：** 仅支持账号密码登录。该方案与 `moeimg_login` / `bika_login` 模式一致，但 nhentai 登录端点同样受 Cloudflare 保护，失败率高，且需要持久化用户密码。

### 2. API Key 复用现有 `bearer_token` 字段

**选择：** 将 API Key 存储在 `AuthSourceData.bearer_token` 中，但在 `NhParser.configure_auth` 内部将其映射为 `Authorization: Key <key>` 头。

**理由：**
- 不修改 `config.py` 的 `AuthSourceData` 结构，保持配置兼容。
- 复用 `apply_auth` 的 curl 提取路径（curl 中可能携带 `Authorization: Key ...`）。
- 其他解析器不受此映射影响，因为它们各自处理 `bearer_token` 为 `Authorization: Bearer ...`。

**替代方案：** 在 `AuthSourceData` 中新增 `api_key` 字段。该方案更语义化，但会波及序列化、前端类型和 IPC 契约，变更范围更大。

### 3. 账号/密码登录复用 `bearer_token` 存储 User Token

**选择：** 当用户通过账号密码登录成功后，将返回的 User Token 存入 `source_auth.nh.bearer_token`，并在 Session 中同样以 `Authorization: Key <token>` 或 `Authorization: Bearer <token>` 发送（具体以 API 响应/文档为准）。

**理由：**
- 与 API Key 方案共享同一条认证注入路径，减少代码分支。
- 允许 `verify_login_status` 统一使用 `GET /api/v2/user` 校验。

**注意：** 需要验证登录后返回的是 `Bearer` 还是 `Key` 前缀。若 `TokenResponse` 返回的 token 需作为 `User Token` 使用，则参考 OpenAPI 的 `security` 定义 `User Token` 方案。实际实现前需抓包或测试确认 header 格式。

### 4. 收藏夹列表使用 `/api/v2/favorites`

**选择：** 直接调用 nhentai API v2 的 `/api/v2/favorites?page={page}` 获取收藏夹。

**理由：**
- 官方端点，返回 `PaginatedResponse<GalleryListItem>`，与现有搜索/首页解析逻辑一致，可复用 `_parse_search_item`。
- 支持搜索/过滤参数 `q`，未来可扩展收藏夹内搜索。

**替代方案：** 解析 HTML 收藏夹页面 `https://nhentai.net/favorites/`。该方案更脆弱，且 API v2 已提供原生支持。

### 5. 收藏状态操作使用 `/api/v2/galleries/{id}/favorite`

**选择：** 使用 `GET` 检查、`POST` 添加、`DELETE` 移除。

**理由：** 这是官方 API v2 文档中的标准端点，无需 HTML 解析或 CSRF token。

### 6. 将 NH 加入 `_SOURCES_WITH_FAVOURITES` 和 `SOURCE_META`

**选择：** 在 `sources/__init__.py` 中将 `"nh"` 加入 `_SOURCES_WITH_FAVOURITES`，在 `shared/types.ts` 中设置 `SOURCE_META.nh.supportsFavourites = true` 和 `requiresAuth = true`。

**理由：** 这是让现有 `handle_get_favourites` / `handle_add_to_favourites` 等 IPC 方法自动支持 NH 的最小改动。前端来源选择器和设置页也会自动识别。

### 7. 认证错误检测

**选择：** 将 `"nh"` 加入 `search_mixin._is_source_auth_error` 的白名单，并复用现有的 `_auth_error_guard` 上下文管理器。

**理由：** 当 API 返回 401/403 时，统一转换为 `AuthRequiredError`（IPC 错误码 -32001），前端可提示用户重新登录。

## 架构草图

```
┌─────────────────────────────────────────┐
│  前端：设置页 / 收藏夹页                 │
│  - NH API Key 输入                       │
│  - NH 账号密码登录（可选）               │
│  - 收藏夹来源选择器出现 NH               │
└──────────────┬──────────────────────────┘
               │ python:apply-auth / nh-login
               ▼
┌─────────────────────────────────────────┐
│  IPCServer (auth_mixin.py)              │
│  - handle_apply_auth(source="nh")        │
│  - handle_nh_login(username, password)   │
│  - handle_verify_auth(source="nh")      │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  MultiSourceParser (sources/__init__.py) │
│  - factory 传入 nh auth 参数             │
│  - 启动时恢复 source_auth["nh"]          │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  NhParser (sources/nh/parser.py)        │
│  - configure_auth                        │
│  - verify_login_status → GET /api/v2/user│
│  - login → POST /api/v2/auth/login       │
│  - favourites → GET /api/v2/favorites    │
│  - add_to_favourites → POST .../favorite │
│  - remove_from_favourites → DELETE ...   │
│  - check_favourite → GET .../favorite    │
└─────────────────────────────────────────┘
```

## 风险 / 权衡

- **[风险] API v2 登录端点可能受 Cloudflare 或 CAPTCHA 保护** → **缓解措施**：将 API Key 作为主路径，账号密码登录作为可选路径；在登录失败时提示用户改用 API Key。
- **[风险] API Key 的 `Authorization` 前缀与项目既有 `Bearer` 假设不一致** → **缓解措施**：`NhParser.configure_auth` 内部自行设置 `Authorization: Key <key>`，不依赖 `utils.configure_session_auth` 的默认 Bearer 逻辑。
- **[风险] 登录端点请求体字段名不确定** → **缓解措施**：在编码前通过真实请求或抓包确认 `Body_login_api_v2_auth_login_post` 的字段；若无法确认，先实现 API Key 路径，密码登录作为后续增量任务。
- **[风险] `GET /api/v2/favorites` 的 `GalleryListItem` 字段与 `_parse_search_item` 不完全一致** → **缓解措施**：实现时先打印响应样本，必要时补充字段兼容逻辑。
- **[风险] 测试需要真实凭证或网络请求** → **缓解措施**：使用 `responses` / `pytest-httpx` / `unittest.mock` 对 API v2 端点打桩，不发起真实请求。

## 迁移计划

本变更无需数据库迁移或向后兼容处理：
- 新增 `source_auth.nh` 字段为空时，NH 收藏夹功能保持不可用，与现有行为一致。
- 已有 `SOURCE_META.nh` 的修改仅影响 UI 展示，不影响已有下载/搜索行为。
- 测试新增仅覆盖 NH 解析器与 IPC，不破坏其他来源测试。

## 待确认问题

1. `POST /api/v2/auth/login` 的请求体字段是 `{username, password}` 还是 `{email, password}`？需要一次真实请求或文档确认。
2. `TokenResponse` 中的 token 字段名是 `token`、`access_token` 还是 `user_token`？作为 `Authorization` 头时前缀是 `Key` 还是 `Bearer`？
3. 是否需要在前端提供“登出/清除 NH 凭证”按钮？现有其他来源是否已有统一入口？
4. 收藏夹列表是否支持 `per_page` 参数？是否使用默认值即可？
