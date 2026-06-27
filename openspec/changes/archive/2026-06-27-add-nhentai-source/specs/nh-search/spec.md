## 新增需求

### 需求:nhentai 搜索功能

系统必须支持通过关键词搜索 nhentai 平台的漫画。搜索请求必须发送到 `https://nhentai.net/api/v2/search` 端点，返回结构化的 `ComicInfo` 列表和分页信息。

#### 场景:关键词搜索成功

- **当** 用户在 nhentai 来源输入关键词并请求搜索
- **那么** 系统发送 GET 请求到 `https://nhentai.net/api/v2/search?query={keyword}&page={page}`
- **那么** 解析 JSON 响应中的 `result` 数组
- **那么** 返回 `ComicInfo` 列表，每个条目包含 id、title、pages、thumbnail_url

#### 场景:搜索结果为空

- **当** 搜索关键词无匹配结果（`result` 数组为空）
- **那么** 系统返回空列表和 None 分页信息

#### 场景:搜索分页

- **当** 搜索结果有多页
- **那么** 系统返回 `PaginationInfo`，包含 current_page、total_pages、total_items
- **那么** 用户可以请求指定页码的结果

#### 场景:搜索请求失败

- **当** API 请求超时或返回错误状态码
- **那么** 系统抛出 `ParserResponseError` 异常，包含错误描述

### 需求:nhentai 搜索结果解析

系统必须正确解析 nhentai API 返回的搜索结果，提取每条记录的元数据。

#### 场景:解析搜索结果条目

- **当** 收到搜索 API 响应
- **那么** 从每个条目提取 `id` 作为 comic_id
- **那么** 优先使用 `japanese_title`，其次 `english_title`，最后 `"未知标题"` 作为标题
- **那么** 使用 `media_id` 构建缩略图 URL
- **那么** 使用 `num_pages` 作为页数

#### 场景:提取语言和标签信息

- **当** 搜索结果包含 `tag_ids` 数组
- **那么** 从 API 响应的 `tags` 字段解析标签名称
- **那么** 识别语言标签（type="language"）设置漫画语言
