## 新增需求

### 需求:nhentai 漫画详情获取

系统必须支持获取 nhentai 漫画的完整详情，包括所有页面的图片信息。详情请求必须发送到 `https://nhentai.net/api/v2/galleries/{id}` 端点。

#### 场景:获取漫画详情成功

- **当** 用户请求某本 nhentai 漫画的详情
- **那么** 系统发送 GET 请求到 `https://nhentai.net/api/v2/galleries/{id}?include=comments,related`
- **那么** 解析 JSON 响应，返回完整的 `ComicInfo` 对象

#### 场景:详情包含完整元数据

- **当** 成功获取漫画详情
- **那么** `ComicInfo` 包含以下字段：
  - `id`: 漫画 ID
  - `title`: 优先使用 `title.japanese`，其次 `title.pretty`，最后 `title.english`
  - `author`: 从 tags 中 type="artist" 的标签提取
  - `pages`: `num_pages` 字段
  - `tags`: 所有非语言标签的名称列表
  - `language`: 从 tags 中 type="language" 的标签提取（排除 "translated"）
  - `source_site`: "nh"
  - `comic_source`: ComicSource.NH

#### 场景:详情包含图片列表

- **当** 成功获取漫画详情
- **那么** `ComicInfo.pages_data` 包含每页的图片路径信息
- **那么** 每页数据包含 `path`（相对路径）和 `number`（页码）

#### 场景:详情请求失败

- **当** API 请求超时或返回错误状态码
- **那么** 系统抛出 `ParserResponseError` 异常

#### 场景:漫画不存在

- **当** 请求的漫画 ID 不存在
- **那么** API 返回 404 或错误响应
- **那么** 系统抛出 `ParserResponseError` 异常
