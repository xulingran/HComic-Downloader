## 1. Bika 基础结构

- [x] 1.1 创建 `sources/bika/__init__.py` 模块
- [x] 1.2 创建 `sources/bika/constants.py`，定义 API 密钥、端点、默认 headers
- [x] 1.3 创建 `sources/bika/parser.py`，实现 `BikaParser` 类骨架

## 2. Bika 认证系统

- [x] 2.1 实现 HMAC-SHA256 签名计算函数 `get_signature()`
- [x] 2.2 实现登录方法 `login(username, password)`，调用 `auth/sign-in` 获取 token
- [x] 2.3 实现认证状态验证方法 `verify_login_status()`，调用 `users/profile`
- [x] 2.4 实现 `configure_auth()` 方法，支持 token 注入

## 3. Bika 搜索功能

- [x] 3.1 实现 `search(keyword, page)` 方法，调用 `comics/advanced-search`
- [x] 3.2 实现搜索结果解析，映射到 `ComicInfo` 对象
- [x] 3.3 实现分页信息解析，返回 `PaginationInfo`

## 4. Bika 详情功能

- [x] 4.1 实现 `get_comic_detail(comic_id)` 方法，调用 `comics/{id}`
- [x] 4.2 实现章节列表获取 `get_chapters(comic_id)`，调用 `comics/{id}/eps`
- [x] 4.3 实现详情解析，包含章节数量和章节列表

## 5. Bika 收藏功能

- [x] 5.1 实现 `favourites(page)` 方法，调用 `users/favourite`
- [x] 5.2 实现 `add_to_favourites(comic_id)` 方法，调用 `comics/{id}/favourite`
- [x] 5.3 实现 `check_favourite(comic_id)` 方法
- [x] 5.4 实现 `remove_from_favourites(comic_id)` 方法

## 6. Bika 下载支持

- [x] 6.1 实现图片 URL 构造，从 `fileServer` + `path` 组合
- [x] 6.2 实现章节图片获取 `get_chapter_images(chapter_id, order)`
- [x] 6.3 实现 `prepare_for_download(comic)` 方法，处理多章节下载

## 7. 集成到 MultiSourceParser

- [x] 7.1 修改 `sources/__init__.py`，添加 Bika 到 `SOURCE_OPTIONS`
- [x] 7.2 修改 `MultiSourceParser.__init__()`，初始化 BikaParser
- [x] 7.3 修改 `get_source_options()` 返回 Bika 选项

## 8. 配置系统集成

- [x] 8.1 修改 `config.py` 的 `get_source_auth()`，为 bika 添加 username/password/bearer_token 字段
- [x] 8.2 修改 `config.py` 的 `set_source_auth()`，支持 bika 认证信息保存
- [x] 8.3 修改 `sources/__init__.py` 的 `configure_auth()`，支持 bika 认证

## 9. 前端类型更新

- [x] 9.1 修改 `shared/types.ts` 的 `COMIC_SOURCES`，添加 `'bika'`
- [x] 9.2 修改 `shared/types.ts` 的 `AppConfig`，添加 `hasBikaAuth` 字段
- [x] 9.3 修改 `shared/types.ts` 的 `IPCMethods`，添加 `bika_login` 方法

## 10. 前端 UI 更新

- [x] 10.1 修改 `ComicInfoDrawer.tsx`，添加章节数量显示
- [x] 10.2 修改 `ComicInfoDrawer.tsx`，为 bika 来源显示收藏按钮
- [x] 10.3 添加 Bika 登录界面组件

## 11. 测试

- [x] 11.1 创建 `tests/test_bika_parser.py`，测试签名计算
- [x] 11.2 添加搜索结果解析测试
- [x] 11.3 添加详情解析测试
- [x] 11.4 添加章节列表解析测试
