## 上下文

hcomic_downloader 当前支持三个漫画来源：hcomic、moeimg、jmcomic。每个来源都有独立的 Parser 类，通过 `MultiSourceParser` 统一分发。Bika（哔咔/Picacomic）是一个独立的漫画平台，使用 REST API + HMAC-SHA256 签名认证，与现有来源的认证方式不同。

参考实现：`E:\Developing\haka_comic`（Flutter + Dart）

## 目标 / 非目标

**目标：**
- 实现 Bika 来源的搜索、详情、收藏、下载功能
- 使用 username/password 登录获取 JWT token
- 在 UI 中显示章节数量（适用于所有多章节来源）

**非目标：**
- 实现 Bika 的评论、排行榜等社交功能
- 支持 Bika 的图片质量选择（默认使用 original）
- 实现 Bika 的代理 API（go2778.com）

## 决策

### 1. 认证方式：username/password → JWT token

**选择**：用户输入 username/password，后端调用 `auth/sign-in` 获取 JWT token，保存到配置。

**理由**：
- Bika API 不支持 Cookie 认证
- JWT token 有过期时间，需要支持刷新
- 参考项目 haka_comic 使用相同方式

**替代方案**：
- 直接让用户输入 token → 用户体验差，token 过期后需要重新获取
- 使用 refresh token 自动刷新 → 增加复杂度，暂不实现

### 2. 签名计算：Python hmac 标准库

**选择**：使用 Python 标准库 `hmac` + `hashlib` 实现 HMAC-SHA256 签名。

**理由**：
- 无需额外依赖
- 签名逻辑简单：`HMAC-SHA256(secret, (url + timestamp + nonce + method + apiKey).toLowerCase())`

**替代方案**：
- 使用第三方库 `pycryptodome` → 不必要，标准库足够

### 3. 章节处理：详情页获取章节列表

**选择**：搜索结果只返回 `epsCount`（章节数），详情页才获取完整章节列表。

**理由**：
- 搜索 API 不返回章节详情
- 减少搜索时的 API 调用次数
- 与 jmcomic 的处理方式一致

### 4. 图片 URL 构造

**选择**：从 `ImageDetail.fileServer` 和 `ImageDetail.path` 动态构造图片 URL。

**理由**：
- Bika 的图片服务器不固定，每个图片都有独立的 `fileServer`
- 格式：`{fileServer}/static/{path}`

## 风险 / 权衡

| 风险 | 缓解措施 |
|------|----------|
| Bika API 可能有反爬机制 | 添加请求延迟，限制并发数 |
| JWT token 过期 | 登录失败时提示用户重新登录 |
| 图片服务器不可用 | 支持重试机制，复用现有 downloader 的重试逻辑 |
| HMAC 签名算法变更 | 从配置读取 secretKey，便于更新 |

## 迁移计划

1. 新增 `sources/bika/` 模块，不影响现有功能
2. 修改 `config.py` 的 `get_source_auth()` 为 bika 添加 username/password 字段
3. 修改 `shared/types.ts` 的 `COMIC_SOURCES` 添加 `'bika'`
4. 修改 `ComicInfoDrawer.tsx` 添加章节数量显示

## 开放问题

1. 是否需要支持 Bika 的代理 API（go2778.com）？
2. 是否需要实现 Bika 的随机漫画功能？
3. 图片质量是否需要暴露给用户配置？
