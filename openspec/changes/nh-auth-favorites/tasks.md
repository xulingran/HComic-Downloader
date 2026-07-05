## 1. NH 解析器认证与收藏夹后端

- [x] 1.1 在 `sources/nh/constants.py` 新增 API v2 端点常量：`AUTH_LOGIN_URL`、`USER_URL`、`FAVORITES_URL`、`FAVORITE_URL_TEMPLATE`。
- [x] 1.2 修改 `NhParser.__init__` 接受 `cookie`、`user_agent`、`bearer_token` 参数，并保存内部状态。
- [x] 1.3 实现 `NhParser.configure_auth`，支持 API Key（`Authorization: Key <key>`）和 cookie/user_agent 注入。
- [x] 1.4 实现 `NhParser.verify_login_status`，通过 `GET /api/v2/user` 校验登录态。
- [x] 1.5 实现 `NhParser.login(username, password)`，调用 `POST /api/v2/auth/login` 并应用返回的 User Token。
- [x] 1.6 实现 `NhParser.favourites(page)`，调用 `GET /api/v2/favorites?page={page}` 并复用 `_parse_search_item`。
- [x] 1.7 实现 `NhParser.add_to_favourites`、`remove_from_favourites`、`check_favourite`，调用对应 `/api/v2/galleries/{id}/favorite` 端点。
- [x] 1.8 在 `sources/__init__.py` 的 NH parser factory 中传入 `source_auth["nh"]` 的认证参数，并将 `"nh"` 加入 `_SOURCES_WITH_FAVOURITES`。
- [x] 1.9 在 `_apply_post_init` 中恢复 NH 认证信息。

## 2. IPC 与配置集成

- [x] 2.1 在 `python/ipc/auth_mixin.py` 新增 `handle_nh_login(username, password)`，复用 `_do_password_login` 模式。
- [x] 2.2 确保 `handle_apply_auth(source="nh")` 正确将 cookie/UA/API Key 注入 `NhParser` 并持久化到 `source_auth.nh`。
- [x] 2.3 在 `python/ipc/search_mixin.py` 的 `_check_source_auth` 和 `_is_source_auth_error` 中加入 `"nh"` 分支。
- [x] 2.4 验证 `handle_get_favourites`、`handle_add_to_favourites`、`handle_check_favourite`、`handle_remove_from_favourites` 在 `source="nh"` 时自动路由到 `NhParser`。

## 3. 前端类型与 UI

- [x] 3.1 在 `shared/types.ts` 的 `AppConfig` 与 `ConfigValueMap` 中新增 `hasNhAuth` 配置键。
- [x] 3.2 更新 `SOURCE_META.nh`：`supportsFavourites` 设为 `true`，`requiresAuth` 设为 `true`。
- [x] 3.3 在 `HcomicAPI` 接口中确认 `applyAuth` / `verifyAuth` / `nhLogin` 等方法的 source 参数已支持 `"nh"`。
- [x] 3.4 在设置页新增 NH 认证区域：API Key 输入框、账号密码登录按钮、登录状态显示、登出按钮。
- [x] 3.5 验证收藏夹页来源选择器出现 NH 选项，且未登录时点击正确提示登录。

## 4. 测试

- [x] 4.1 为 `NhParser.configure_auth` 编写单元测试，覆盖 API Key 和 cookie 两种模式。
- [x] 4.2 为 `NhParser.verify_login_status` 编写单元测试，覆盖成功、401 未登录、未配置凭证三种情况。
- [x] 4.3 为 `NhParser.login` 编写单元测试，覆盖成功与失败路径。
- [x] 4.4 为 `NhParser.favourites` / `add_to_favourites` / `remove_from_favourites` / `check_favourite` 编写单元测试，使用 mock API 响应。
- [x] 4.5 更新或新增 IPC 集成测试，确保 `source="nh"` 的收藏夹调用被正确路由。
- [x] 4.6 运行 `pytest`、前端测试、ruff、black、`npm run lint` 与 `npm run lint:test-quality`，确保全量通过。

## 5. 文档与收尾

- [x] 5.1 在 README 或设置页文案中补充 NH API Key 的获取方式（`https://nhentai.net/user/settings#apikeys`）。
- [x] 5.2 运行 `openspec-cn validate --changes "nh-auth-favorites"` 确认产出物合规。
- [x] 5.3 提交变更并生成 CHANGELOG 条目。
