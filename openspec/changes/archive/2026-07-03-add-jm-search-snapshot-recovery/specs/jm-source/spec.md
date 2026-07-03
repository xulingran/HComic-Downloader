## 新增需求

### 需求:JM 解析器必须支持搜索页 DOM 快照解析

JM 解析器必须提供 `parse_search_snapshot` 方法，接收 Electron 已验证窗口捕获的搜索结果页 DOM HTML、来源 URL、原始搜索词和页码，复用现有 `_parse_search_results` 解析逻辑返回漫画列表与分页信息。该方法禁止发起任何网络请求。

#### 场景:解析正常搜索结果 DOM
- **当** 传入可信 `/search/photos` URL 和包含 `thumb-overlay` 条目的渲染后 HTML
- **那么** 解析器返回漫画列表与分页信息，结构与 live `search()` 关键词路径一致
- **且** 解析器不得发起任何 HTTP 请求

#### 场景:拒绝挑战页快照
- **当** 传入的 HTML 仍包含 Cloudflare 挑战标记
- **那么** 解析器抛出 `AntiBotChallengeError`

#### 场景:拒绝不受信任的来源 URL
- **当** 来源 URL 非 HTTPS、含 userinfo、非默认端口、hostname 不匹配配置域名或路径不是 `/search/photos`
- **那么** 解析器抛出 `ValueError`

#### 场景:拒绝 search_query 不匹配
- **当** URL 中的 `search_query` 参数解码后不等于传入的原始搜索词
- **那么** 解析器抛出 `ValueError`

#### 场景:拒绝超大 HTML
- **当** 传入的 HTML 超过 5 MiB
- **那么** 解析器抛出 `ValueError`

### 需求:JM 解析器必须支持首页 DOM 快照解析

JM 解析器必须提供 `parse_home_snapshot` 方法，接收 Electron 已验证窗口捕获的首页 DOM HTML 和来源 URL，复用现有 `_parse_home_sections` 解析逻辑返回栏目列表。该方法禁止发起任何网络请求。

#### 场景:解析正常首页 DOM
- **当** 传入可信根路径 `/` URL 和包含 `talk-title` 栏目标题的渲染后 HTML
- **那么** 解析器返回栏目列表（`list[tuple[str, list[ComicInfo]]]`），结构与 live `home()` 一致
- **且** 解析器不得发起任何 HTTP 请求

#### 场景:拒绝挑战页快照
- **当** 传入的 HTML 仍包含 Cloudflare 挑战标记
- **那么** 解析器抛出 `AntiBotChallengeError`

#### 场景:拒绝不受信任的来源 URL
- **当** 来源 URL 非 HTTPS、含 userinfo、非默认端口、hostname 不匹配配置域名、路径不是 `/` 或含有查询参数
- **那么** 解析器抛出 `ValueError`

### 需求:curl_cffi TLS 指纹必须与 Electron Chromium 版本对齐

JM 会话工厂的 `IMPERSONATE_BROWSER` 常量、`HEADERS` 中的 `User-Agent` 和 `Sec-Ch-Ua` 三者的浏览器主版本号必须一致，且必须与 Electron 运行的 Chromium 主版本号对齐。项目内所有创建 `curl_cffi` 会话的位置必须引用 `IMPERSONATE_BROWSER` 常量，禁止硬编码指纹版本字面量。

#### 场景:指纹与 headers 版本一致
- **当** 检查 `IMPERSONATE_BROWSER`、`HEADERS["User-Agent"]` 和 `HEADERS["Sec-Ch-Ua"]`
- **那么** 三者的浏览器主版本号必须相同

#### 场景:所有 curl_cffi 会话引用统一常量
- **当** 项目内任何模块创建 `curl_cffi.Session(impersonate=...)`
- **那么** impersonate 参数必须引用 `IMPERSONATE_BROWSER` 常量
- **且** 禁止硬编码 `"chrome136"` 或其他版本字面量
