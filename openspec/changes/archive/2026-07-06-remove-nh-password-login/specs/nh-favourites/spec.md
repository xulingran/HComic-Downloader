## 修改需求

### 需求:解析器必须能列出 NH 收藏夹

`NhParser.favourites(page)` 必须使用已配置的 NH API Key 返回当前用户的收藏夹漫画列表，并附带分页信息。分页必须优先读取官方响应字段 `num_pages`，仅在该字段缺失时兼容读取 `total_pages`。User Token、Cookie 或账号密码禁止被视为收藏认证。

#### 场景:已配置 API Key 且收藏夹非空

- **当** 用户已配置有效 API Key 并调用 `favourites(page=1)`，官方响应包含非空 `result`
- **那么** 返回非空 `ComicInfo` 列表、`PaginationInfo` 以及 `needs_login=False`

#### 场景:已配置 API Key 但收藏夹为空

- **当** 用户已配置有效 API Key，但收藏夹响应的 `result` 为空
- **那么** 返回空列表、`total_items=0` 的 `PaginationInfo` 以及 `needs_login=False`

#### 场景:未配置 API Key 时访问收藏夹

- **当** 未配置 NH API Key 时调用 `favourites(page=1)`
- **那么** 返回空列表、`needs_login=True`
- **且** 在 `raise_errors=True` 时抛出可转换为 `AuthRequiredError` 的认证错误

#### 场景:按官方字段解析收藏夹分页

- **当** 用户请求第 3 页且官方响应包含 `num_pages=8`、`total=180`
- **那么** `PaginationInfo.current_page` 必须等于 3、`total_pages` 必须等于 8、`total_items` 必须等于 180

#### 场景:兼容旧分页字段

- **当** 响应缺少 `num_pages` 但包含 `total_pages`
- **那么** 解析器必须使用 `total_pages`，禁止把总页数错误回退为当前页

### 需求:前端必须展示 NH 收藏夹来源入口

`shared/types.ts` 中的 `SOURCE_META.nh` 必须将 `supportsFavourites` 设为 `true`，并通过 `hasNhAuth` 使收藏夹页和设置页识别是否已配置 NH API Key。禁止把账号密码、User Token 或 Cookie 解释为 `hasNhAuth=true`。

#### 场景:收藏夹来源选择器出现 NH

- **当** 用户打开收藏夹页
- **那么** 来源选择器中必须出现“NH”选项

#### 场景:设置页显示 NH API Key 状态

- **当** 用户已配置有效 NH API Key
- **那么** 设置页中 NH 区域必须显示“已登录”状态及清除认证按钮

#### 场景:仅存在旧凭据时显示未认证

- **当** 旧配置中仅存在 NH username/password、Cookie 或 User Token
- **那么** `hasNhAuth` 必须为 false
- **且** 设置页必须提示用户配置 API Key
