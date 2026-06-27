## 上下文

当前项目已有 5 个漫画来源（hcomic、moeimg、jm、bika、copymanga），采用鸭子类型插件架构。每个来源是一个独立目录，实现相同的接口方法（search、get_comic_detail、prepare_for_download 等），通过 `MultiSourceParser` 统一分发。

nhentai 是全球最大的同人漫画平台，提供完善的 JSON API（v2），无需登录即可访问。ComicGUISpider 项目已有成熟的 nhentai 实现可供参考。

## 目标 / 非目标

**目标：**
- 实现 nhentai 来源解析器，支持搜索、详情、下载完整流程
- 遵循现有源架构模式，保持一致性
- 复用现有代理机制，支持中国区访问
- 提供标签/语言元数据

**非目标：**
- 不实现收藏功能（nhentai 无登录机制）
- 不实现标签数据库系统（简化版本，直接从 API 响应解析标签）
- 不支持 nhentai 的"随机"功能（API 无直接支持）

## 决策

### 1. API 版本选择：使用 v2 API

**选择**: `https://nhentai.net/api/v2/`

**理由**:
- v2 API 返回结构化 JSON，解析简单可靠
- ComicGUISpider 已验证其稳定性
- 搜索和详情端点分离，职责清晰

**替代方案**:
- HTML 解析：脆弱，容易因页面改版失效
- v1 API：已废弃

### 2. 目录结构：sources/nh/

**选择**: 创建 `sources/nh/` 目录，包含 `parser.py` 和 `constants.py`

**理由**:
- 与现有源结构一致（jm/、bika/ 等）
- constants.py 集中管理 URL、headers 等常量
- 命名使用 `nh` 而非 `nhentai` 保持简洁（类似 `jm` 而非 `jmcomic`）

### 3. ComicSource 常量：NH

**选择**: 在 models.py 中添加 `NH = "NH"` 到 ComicSource

**理由**:
- 与现有命名模式一致（JM、BIKA、COPYMANGA）
- 简短且唯一

### 4. 代理策略：强制代理

**选择**: 所有请求必须通过系统代理

**理由**:
- nhentai 在中国被墙
- 复用现有 `apply_system_proxy_to_session()` 机制
- 与 jm 来源的代理策略一致

### 5. 认证方式：无需登录

**选择**: 不实现登录功能

**理由**:
- nhentai API 公开访问，无需认证
- 简化实现，减少维护负担
- configure_auth 和 verify_login_status 返回空/成功

### 6. 标签处理：直接从 API 解析

**选择**: 从 API 响应的 `tags` 数组直接提取标签名称

**理由**:
- 避免引入 SQLite 标签数据库的复杂性
- API 响应已包含完整的标签信息
- 标签仅用于展示，不影响核心功能

**替代方案**:
- 预构建标签数据库（如 ComicGUISpider）：过度设计，增加部署复杂度

## 风险 / 权衡

| 风险 | 缓解措施 |
|------|----------|
| nhentai API 变更或不可用 | 实现清晰的错误处理，API 版本化 URL 易于更新 |
| 代理不可用导致访问失败 | 复用现有系统代理机制，错误信息明确提示检查代理 |
| 图片 CDN 域名变更 | 将 image_host 和 thumbnail_host 提取到 constants.py |
| 大量搜索结果导致内存压力 | 使用 PaginationInfo 控制分页，与现有模式一致 |
| 429 限流 | 复用现有 session retry 策略，设置合理的超时时间 |
