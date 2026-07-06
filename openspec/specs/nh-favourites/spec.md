## 新增需求

### 需求:解析器必须能列出 NH 收藏夹
`NhParser.favourites(page)` 必须返回当前登录用户的 NH 收藏夹漫画列表，并附带分页信息。

#### 场景:已登录且收藏夹非空
- **当** 用户已登录并调用 `favourites(page=1)`
- **那么** 返回非空 `ComicInfo` 列表、`PaginationInfo` 以及 `needs_login=False`

#### 场景:已登录但收藏夹为空
- **当** 用户已登录但收藏夹为空
- **那么** 返回空列表、`total_items=0` 的 `PaginationInfo` 以及 `needs_login=False`

#### 场景:未登录时访问收藏夹
- **当** 未配置认证时调用 `favourites(page=1)`
- **那么** 返回空列表、`needs_login=True`，并可通过 `raise_errors=True` 抛出 `AuthRequiredError`

#### 场景:收藏夹翻页
- **当** 用户已登录并调用 `favourites(page=3)`
- **那么** 返回对应页码的收藏夹数据，且 `PaginationInfo.current_page` 等于 3

### 需求:解析器必须能将漫画加入 NH 收藏夹
`NhParser.add_to_favourites(comic_id)` 必须调用 nhentai API v2 添加收藏端点，成功返回 `True`。

#### 场景:成功添加收藏
- **当** 用户已登录并调用 `add_to_favourites("12345")` 且漫画存在
- **那么** 方法返回 `True`

#### 场景:重复添加收藏
- **当** 用户已登录并调用 `add_to_favourites("12345")` 且该漫画已在收藏夹中
- **那么** 方法返回 `True`（幂等成功）或 `False`（如 API 返回 409），但不得抛出异常

#### 场景:未登录时添加收藏
- **当** 未配置认证时调用 `add_to_favourites("12345")`
- **那么** 方法返回 `False`

### 需求:解析器必须能移除 NH 收藏
`NhParser.remove_from_favourites(comic_id)` 必须调用 nhentai API v2 移除收藏端点，成功返回 `True`。

#### 场景:成功移除收藏
- **当** 用户已登录并调用 `remove_from_favourites("12345")` 且漫画在收藏夹中
- **那么** 方法返回 `True`

#### 场景:移除不存在的收藏
- **当** 用户已登录并调用 `remove_from_favourites("12345")` 但漫画不在收藏夹中
- **那么** 方法返回 `True`（幂等成功）或 `False`（如 API 返回 404），但不得抛出异常

#### 场景:未登录时移除收藏
- **当** 未配置认证时调用 `remove_from_favourites("12345")`
- **那么** 方法返回 `False`

### 需求:解析器必须能检查 NH 收藏状态
`NhParser.check_favourite(comic_id)` 必须返回指定漫画是否在当前用户收藏夹中。

#### 场景:漫画已收藏
- **当** 用户已登录且漫画 `12345` 在收藏夹中
- **那么** `check_favourite("12345")` 返回 `True`

#### 场景:漫画未收藏
- **当** 用户已登录且漫画 `12345` 不在收藏夹中
- **那么** `check_favourite("12345")` 返回 `False`

#### 场景:未登录时检查收藏
- **当** 未配置认证时调用 `check_favourite("12345")`
- **那么** 方法返回 `False`

### 需求:收藏夹操作必须接入项目统一 IPC 接口
`handle_get_favourites`、`handle_add_to_favourites`、`handle_check_favourite`、`handle_remove_from_favourites` 必须支持 `source="nh"`，并复用现有的 `_auth_error_guard` 和 `_check_source_auth` 机制。

#### 场景:通过 IPC 获取 NH 收藏夹
- **当** 前端调用 `getFavourites(page=1, source="nh")` 且用户已登录
- **那么** 后端返回 `{ comics: [...], pagination: {...}, needsLogin: false }`

#### 场景:通过 IPC 添加 NH 收藏
- **当** 前端调用 `addToFavourites(comicId="12345", source="nh")` 且用户已登录
- **那么** 后端返回 `{ success: true }`

#### 场景:未登录时通过 IPC 获取收藏夹
- **当** 前端调用 `getFavourites(source="nh")` 但用户未登录
- **那么** 后端抛出 `AuthRequiredError`（序列化为 IPC 错误码 -32001）

### 需求:前端必须展示 NH 收藏夹来源入口
`shared/types.ts` 中的 `SOURCE_META.nh` 必须将 `supportsFavourites` 设为 `true`，并新增 `hasNhAuth` 配置键，使收藏夹页和设置页能识别 NH。

#### 场景:收藏夹来源选择器出现 NH
- **当** 用户打开收藏夹页
- **那么** 来源选择器中必须出现“NH”选项

#### 场景:设置页显示 NH 登录状态
- **当** 用户已配置 NH API Key 或登录成功
- **那么** 设置页中 NH 区域必须显示“已登录”状态及登出按钮
