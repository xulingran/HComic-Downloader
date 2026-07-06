## 新增需求

### 需求:详情抽屉收藏状态必须以 IPC 结果提交

详情抽屉执行 NH 加入收藏或移除收藏时，必须检查 IPC 返回的 `success`。只有 `success=true` 才能提交新的收藏状态并显示成功提示；`success=false` 或请求异常必须恢复操作前状态并显示失败或登录提示。

#### 场景:加入收藏真实成功

- **当** 用户在 NH 漫画详情抽屉点击加入收藏，IPC 返回 `{ success: true }`
- **那么** 按钮必须切换为已收藏状态并显示“已加入收藏夹”

#### 场景:加入收藏返回 false

- **当** 用户点击加入收藏，IPC 正常完成但返回 `{ success: false }`
- **那么** 按钮禁止切换为已收藏状态
- **且** 系统必须显示加入收藏失败提示

#### 场景:移除收藏返回 false

- **当** 已收藏漫画执行移除操作且 IPC 返回 `{ success: false }`
- **那么** 按钮必须恢复已收藏状态
- **且** 系统必须显示移除收藏失败提示

#### 场景:认证失效

- **当** 加入或移除收藏收到统一认证错误
- **那么** 系统必须保留操作前收藏状态并提示用户先登录

## 修改需求

### 需求:解析器必须能列出 NH 收藏夹

`NhParser.favourites(page)` 必须返回当前登录用户的 NH 收藏夹漫画列表，并附带分页信息。分页必须优先读取官方响应字段 `num_pages`，仅在该字段缺失时兼容读取 `total_pages`。

#### 场景:已登录且收藏夹非空

- **当** 用户已登录并调用 `favourites(page=1)`，官方响应包含非空 `result`
- **那么** 返回非空 `ComicInfo` 列表、`PaginationInfo` 以及 `needs_login=False`

#### 场景:已登录但收藏夹为空

- **当** 用户已登录但收藏夹响应的 `result` 为空
- **那么** 返回空列表、`total_items=0` 的 `PaginationInfo` 以及 `needs_login=False`

#### 场景:未登录时访问收藏夹

- **当** 未配置 API Key、User Token 或有效 Cookie 时调用 `favourites(page=1)`
- **那么** 返回空列表、`needs_login=True`，并在 `raise_errors=True` 时抛出可转换为 `AuthRequiredError` 的认证错误

#### 场景:按官方字段解析收藏夹分页

- **当** 用户请求第 3 页且官方响应包含 `num_pages=8`、`total=180`
- **那么** `PaginationInfo.current_page` 必须等于 3、`total_pages` 必须等于 8、`total_items` 必须等于 180

#### 场景:兼容旧分页字段

- **当** 响应缺少 `num_pages` 但包含 `total_pages`
- **那么** 解析器必须使用 `total_pages`，禁止把总页数错误回退为当前页

### 需求:解析器必须能将漫画加入 NH 收藏夹

`NhParser.add_to_favourites(comic_id)` 必须调用 NH API v2 添加收藏端点，并以 HTTP 成功状态和 `FavoriteResponse.favorited` 共同判定结果。只有响应明确表示 `favorited=true` 才能返回 `True`；认证、校验、限流或功能关闭错误禁止被吞掉为成功。

#### 场景:成功添加收藏

- **当** 用户已登录并调用 `add_to_favourites("12345")`，API 返回 200 和 `{ "favorited": true }`
- **那么** 方法返回 `True`

#### 场景:响应未确认收藏

- **当** 添加接口返回 200 但响应为 `{ "favorited": false }` 或缺少 `favorited`
- **那么** 方法禁止返回 `True`

#### 场景:认证失效时添加收藏

- **当** 添加接口返回 401
- **那么** 方法必须抛出可被 IPC 转换为 `AuthRequiredError` 的错误
- **且** 禁止返回假成功

#### 场景:服务端拒绝添加收藏

- **当** 添加接口返回 404、422、429、503 或其他非成功状态
- **那么** 方法必须传播明确失败，禁止把该响应视为成功

#### 场景:未配置认证时添加收藏

- **当** 未配置有效认证时调用 `add_to_favourites("12345")`
- **那么** 方法必须返回 `False` 或抛出认证错误，且 IPC 用户路径必须呈现为认证失败

### 需求:解析器必须能移除 NH 收藏

`NhParser.remove_from_favourites(comic_id)` 必须调用 NH API v2 移除收藏端点，并以 HTTP 成功状态和 `FavoriteResponse.favorited` 共同判定结果。只有响应明确表示 `favorited=false` 才能返回 `True`。

#### 场景:成功移除收藏

- **当** 用户已登录并调用 `remove_from_favourites("12345")`，API 返回 200 和 `{ "favorited": false }`
- **那么** 方法返回 `True`

#### 场景:响应仍为已收藏

- **当** 移除接口返回 200 但响应为 `{ "favorited": true }` 或缺少 `favorited`
- **那么** 方法禁止返回 `True`

#### 场景:认证失效或服务端拒绝移除

- **当** 移除接口返回 401、404、422、429、503 或其他非成功状态
- **那么** 方法必须传播明确失败
- **且** 401 必须能被 IPC 转换为 `AuthRequiredError`

#### 场景:未配置认证时移除收藏

- **当** 未配置有效认证时调用 `remove_from_favourites("12345")`
- **那么** 方法必须返回 `False` 或抛出认证错误，且禁止呈现为移除成功

### 需求:解析器必须能检查 NH 收藏状态

`NhParser.check_favourite(comic_id)` 必须从官方 `FavoriteResponse.favorited` 字段返回指定漫画的收藏状态，禁止使用不存在的 `is_favorited` 或 `is_favourited` 作为主要契约。

#### 场景:漫画已收藏

- **当** 状态接口返回 200 和 `{ "favorited": true }`
- **那么** `check_favourite("12345")` 返回 `True`

#### 场景:漫画未收藏

- **当** 状态接口返回 200 和 `{ "favorited": false }`
- **那么** `check_favourite("12345")` 返回 `False`

#### 场景:状态检查认证失效

- **当** 状态接口返回 401
- **那么** 方法必须传播可转换为 `AuthRequiredError` 的错误，禁止静默解释为未收藏

#### 场景:未配置认证时检查收藏

- **当** 未配置有效认证时调用 `check_favourite("12345")`
- **那么** 方法必须返回 `False` 或抛出认证错误，且 IPC 用户路径必须提示认证缺失

### 需求:收藏夹操作必须接入项目统一 IPC 接口

`handle_get_favourites`、`handle_add_to_favourites`、`handle_check_favourite`、`handle_remove_from_favourites` 必须支持 `source="nh"`。四个入口都必须在调用 parser 前检查 NH 认证，并复用 `_auth_error_guard` 将解析器认证失败转换为统一 `AuthRequiredError`；其他失败必须保留失败语义返回或抛出，禁止被前端误判为成功。

#### 场景:通过 IPC 获取 NH 收藏夹

- **当** 前端调用 `getFavourites(page=1, source="nh")` 且用户已登录
- **那么** 后端返回 `{ comics: [...], pagination: {...}, needsLogin: false }`

#### 场景:通过 IPC 添加 NH 收藏

- **当** 前端调用 `addToFavourites(comicId="12345", source="nh")`，parser 由官方响应确认收藏成功
- **那么** 后端返回 `{ success: true }`

#### 场景:通过 IPC 添加失败

- **当** parser 未确认收藏成功或返回非认证类失败
- **那么** IPC 必须返回 `{ success: false }` 或抛出明确错误
- **且** 禁止返回 `{ success: true }`

#### 场景:未登录时调用任一 NH 收藏 IPC

- **当** 用户未配置有效 NH 认证并调用获取、检查、添加或移除收藏中的任一操作
- **那么** 后端必须抛出 `AuthRequiredError`（序列化为 IPC 错误码 -32001）
