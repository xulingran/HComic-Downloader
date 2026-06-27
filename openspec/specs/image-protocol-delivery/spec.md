# image-protocol-delivery 规范

## 目的
待定 - 由归档变更 optimize-image-memory-pipeline 创建。归档后请更新目的。
## 需求
### 需求:自定义协议 app-image:// 必须流式交付磁盘缓存图片

Electron 主进程**必须**注册自定义协议 `app-image://`，将封面与阅读器预览图的磁盘缓存文件以流式响应交付给 Chromium。协议 URL 形如 `app-image://cover/{url_hash}` 或 `app-image://preview/{url_hash}`，其中 `url_hash` 为 `sha256(url).hexdigest()`（64 位十六进制），同时也是磁盘缓存文件名。图片字节**禁止**经过渲染进程 JS 堆——`<img>` 元素直接以协议 URL 为 src，由 Chromium 流式读取并自行管理解码与内存 LRU。

#### 场景:合法 url_hash 流式返回图片字节

- **当** `<img src="app-image://cover/{合法 64 位 hex}">` 发起请求，对应磁盘文件存在
- **那么** 协议 handler 流式读取该文件并返回 HTTP 200 响应，Content-Type 由文件 magic bytes 探测
- **且** 响应体字节不经过渲染进程 JS 堆（无 base64 编码、无 JSON 序列化）
- **且** Chromium 自行解码与缓存该图片

#### 场景:文件被 LRU 淘汰时返回 404 触发重试

- **当** 协议请求的 `url_hash` 对应磁盘文件已被缓存层 LRU 淘汰删除
- **那么** 协议 handler 返回 HTTP 404
- **且** 渲染进程 `<img onError>` 触发重新 `fetchCover`/`fetchPreviewImage` 获取新 urlHash（重新下载落盘）

#### 场景:cover 与 preview 路径段路由到各自缓存目录

- **当** 协议 URL 首段为 `cover`
- **那么** handler 定位到 `CoverCacheDB` 的 `files_dir`
- **当** 首段为 `preview`
- **那么** handler 定位到 `PreviewCacheDB` 的 `files_dir`
- **且** 其他首段值一律拒绝

### 需求:协议 handler 必须严格校验 url_hash 防路径遍历

协议 handler **必须**对所有 `url_hash` 路径段执行严格校验：(1) 仅匹配 `^[A-Fa-f0-9]{64}$`（SHA-256 hex）；(2) 用 `path.resolve` 计算最终路径后验证其仍在授权缓存目录内（前缀检查）。校验失败**必须**返回 HTTP 400/404，**禁止**读取任何文件。这复用 `cache-directory-access` 能力的路径约束语义。

#### 场景:合法 hex 路径通过校验

- **当** 请求 `app-image://cover/a1b2...（64 位 hex）`
- **那么** 校验通过，handler 拼接 `{cover_files_dir}/a1b2...` 读取文件

#### 场景:非 hex 字符被拒绝

- **当** 请求 `app-image://cover/../../etc/passwd` 或含非 hex 字符的路径段
- **那么** 校验失败，handler 返回 4xx，不读取任何文件

#### 场景:路径遍历被前缀检查拦截

- **当** 即便 url_hash 形似合法 hex，但 `path.resolve` 后的路径逃出缓存目录（理论上的符号链接等绕过）
- **那么** 前缀检查失败，handler 返回 4xx

### 需求:CSP 必须允许 app-image: 协议来源

Electron 主进程的 Content-Security-Policy 的 `img-src` 指令**必须**包含 `app-image:`，使 `<img>` 能加载该协议资源。**禁止**为此放宽 `file:` 或其他无关来源。

#### 场景:img-src 包含 app-image:

- **当** 主窗口加载页面
- **那么** CSP 头的 `img-src` 指令包含 `'self' data: https: app-image:`
- **且** `<img src="app-image://...">` 不被 CSP 阻断

### 需求:url_hash 必须由后端权威计算并下发给前端

`url_hash`（`sha256(url).hexdigest()`）**必须**由 Python 后端计算，通过 `fetch_cover`/`fetch_preview_image` 的 JSON-RPC 结果（`{ urlHash }`）下发给渲染进程。渲染进程**禁止**自行计算 `url_hash`，**必须**直接透传后端下发的值拼接协议 URL。这避免 url 规范化差异（尾斜杠、query 参数排序、大小写）导致的缓存键不一致。

#### 场景:前端透传后端下发的 urlHash

- **当** 渲染进程调用 `fetchCover(url)` 收到 `{ urlHash: "a1b2..." }`
- **那么** 渲染进程以 `app-image://cover/a1b2...` 作为 `<img src>`
- **且** 不在前端执行任何 sha256 计算

