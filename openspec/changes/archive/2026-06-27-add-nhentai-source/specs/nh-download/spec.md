## 新增需求

### 需求:nhentai 图片 URL 构建

系统必须正确构建 nhentai 图片的完整 URL。图片托管在 `i.nhentai.net`，缩略图托管在 `t.nhentai.net`。

#### 场景:构建完整图片 URL

- **当** 需要下载 nhentai 漫画的某一页
- **那么** 系统使用格式 `https://i.nhentai.net/galleries/{media_id}/{page_number}.{ext}` 构建 URL
- **那么** `{ext}` 从 API 返回的页面 `path` 字段提取

#### 场景:构建缩略图 URL

- **当** 需要显示 nhentai 漫画的封面缩略图
- **那么** 系统使用格式 `https://t.nhentai.net/galleries/{media_id}/thumb.{ext}` 构建 URL

#### 场景:图片路径格式验证

- **当** API 返回的图片路径不以 `galleries/` 开头
- **那么** 系统抛出异常，提示路径格式错误

### 需求:nhentai 图片下载

系统必须使用正确的 headers 下载 nhentai 图片，包括 Referer 和 User-Agent。

#### 场景:成功下载图片

- **当** 下载 nhentai 漫画图片
- **那么** 请求包含 `Referer: https://nhentai.net/` header
- **那么** 请求包含标准 User-Agent header
- **那么** 请求通过系统代理
- **那么** 返回图片二进制数据

#### 场景:图片下载失败重试

- **当** 图片下载请求失败（超时、5xx 错误）
- **那么** 系统自动重试，最多 3 次
- **那么** 最终失败时抛出异常

#### 场景:prepare_for_download 填充图片 URL

- **当** 调用 `prepare_for_download(comic)` 方法
- **那么** 系统为漫画的每一页构建完整的图片 URL
- **那么** 填充 `ComicInfo.image_urls` 列表
- **那么** 返回更新后的 `ComicInfo` 对象
