# preview-error-recovery 规范

## 目的
漫画预览（阅读器）界面的失败页聚合、阈值检测、批量重试与状态反馈机制。当多页加载失败时，避免用户被迫逐页手动重试，提供"失败聚合 + 一键批量重试"的恢复路径。由归档变更 preview-retry-toast 创建。
## 需求
### 需求: 阅读器必须聚合所有失败页索引并向用户提供批量重试入口

漫画预览（阅读器）界面必须维护一个失败页索引集合作为父组件级别的状态，所有显示模式（scroll / single / double）下的叶子页组件必须将加载失败上报给父组件。当累计失败页数超过 3 时，系统必须弹出常驻 Toast 提示并提供"全部重试"按钮；用户不得被迫逐页手动重试。

#### 场景: 单页加载失败被父组件感知

- **当** scroll 模式下某个 `<ReaderPage>` 因 IPC 失败或图片解码失败进入 error 态
- **那么** 该页索引被加入父组件的失败页集合，且该页仍保留本地单页重试按钮

#### 场景: flip 模式失败页被父组件感知

- **当** flip 模式下当前可见的 `<FlipPage>` 加载失败
- **那么** 该页索引被加入父组件失败集合，且该页显示单页重试按钮（修复先前无重试入口的遗留）

#### 场景: 失败页数超过阈值触发常驻 Toast

- **当** 失败页集合的大小从 ≤ 3 变为 > 3
- **那么** 系统在阅读器顶部弹出常驻 Toast，文案为"N 页加载失败"（N 为当前失败数），带"全部重试"按钮，且该 Toast 不自动消失

#### 场景: 失败页数回落时 Toast 自动隐藏

- **当** 因重试成功或翻页加载成功，失败页集合大小从 > 3 降回 ≤ 3
- **那么** 常驻重试 Toast 自动隐藏（dismiss），不再显示

### 需求: "全部重试"必须重置所有失败页的加载状态

用户点击常驻 Toast 上的"全部重试"按钮后，系统**必须**让所有当前处于失败态的页组件重新进入加载流程（本变更适配协议 URL 形态：重试触发的具体请求从"刷新 dataUri 字符串"改为"重新 fetch 获取新 urlHash 并拼接协议 URL"，成功判断从"dataUri 存在"改为"协议 URL 就绪"；"全部重试"的总体语义——重置失败页、不影响已成功页——保持不变）：重置本地 error 状态并重新调用 `fetchPreviewImage(url, ...)` 获取新 `{ urlHash }`，以新 urlHash 拼接 `app-image://preview/{urlHash}` 作为 `<img src>` 触发重新加载。**禁止**影响已成功加载的页。成功状态判断条件从"dataUri 存在"改为"该页已拿到 urlHash 并渲染协议 URL、无 error"。

#### 场景:点击全部重试重新获取 urlHash

- **当** 用户在失败 Toast 上点击"全部重试"按钮
- **那么** 所有失败页重置 error 状态并重新调用 `fetchPreviewImage` 获取新 `{ urlHash }`
- **且** 以新 urlHash 拼接 `app-image://preview/{urlHash}` 作为 `<img src>` 触发重新加载
- **且** 不再依赖"刷新 dataUri 字符串"语义

#### 场景:协议 404 触发重试链路

- **当** `<img src="app-image://preview/{urlHash}">` 因磁盘文件被 LRU 淘汰返回 404，触发 onError
- **那么** 该失败被上报至父组件失败索引集合（与其他失败同处理）
- **且** 用户重试时重新 `fetchPreviewImage` 获取新 urlHash（重新下载落盘）

#### 场景:全部重试不影响已成功页

- **当** 某页已成功加载（已拿到 urlHash 并渲染协议 URL、无 error）
- **那么** "全部重试"触发时该页不重新请求图片，显示内容不闪烁
- **且** 成功判断条件为"协议 URL 就绪"而非"dataUri 存在"

### 需求: 失败页全部恢复后必须给出成功反馈

当失败页集合因重试或自然加载从非空变为空时，系统必须将 Toast 切换为成功提示并让其自动消失，向用户确认恢复完成。

#### 场景: 全部失败页恢复

- **当** 失败页集合大小从 > 0 变为 0（且此前曾显示过失败 Toast）
- **那么** Toast 切换为 success 类型，文案为"已恢复全部页面"，取消常驻属性，按默认时长自动消失

#### 场景: 部分恢复仍保留 Toast

- **当** 用户点击"全部重试"后，部分页恢复成功但仍有页失败（集合大小仍 > 3）
- **那么** 常驻 Toast 继续显示，文案中的失败数 N 更新为当前剩余失败数

### 需求: flip 模式失败页必须提供单页重试入口

翻页模式（single / double）下当前可见页加载失败时，系统必须在失败占位处提供单页重试按钮，不得仅显示失败文字。

#### 场景: flip 模式单页重试

- **当** flip 模式下当前页加载失败，用户点击该页上的"重试"按钮
- **那么** 仅该页重置 error 状态并重新加载，不触发父级"全部重试"，不影响其他失败页的状态

### 需求:预览缓存写入失败时必须返回错误而非伪成功 hash

当后端预览图片管道（`fetch_preview_image` / `_do_fetch_preview_image`）已成功从源站下载图片字节、但**持久化缓存写入失败**（`_write_preview_cache()` 返回 `None`，根因包括磁盘写失败、SQLite 错误、权限错误，或运行时缺少 `_preview_cache` 属性）时，后端**必须**向渲染进程返回 JSON-RPC error，**禁止**计算并返回一个无磁盘文件支撑的 `url_hash` 当作成功结果。

理由：`app-image://` 协议 handler（见 `image-protocol-delivery` 能力）只读磁盘文件、不存在 on-demand 回源 fallback，任何未落盘的 hash 必然导致协议 404。若后端返回伪成功 hash，前端会渲染一个永不存在的协议 URL，用户看到"图片加载失败"而真正根因被吞掉，且本能力的失败聚合/批量重试链路因收到成功响应而不会被触发。

#### 场景:写盘失败时 IPC 返回 error

- **当** `_write_preview_cache(url, raw_bytes)` 因 OSError / sqlite3.Error / 权限错误返回 `None`
- **那么** `_do_fetch_preview_image()` **必须**抛错，使 `_async_fetch_preview_image` 的 except 分支下发 JSON-RPC error（`code: -32000`，message 描述失败原因）
- **且** **禁止**计算 `sha256(url)` 并作为 `urlHash` 成功结果返回

#### 场景:运行时缺少 _preview_cache 属性时返回 error

- **当** 运行时未注入 `_preview_cache`（`hasattr(self, "_preview_cache")` 为假），`_write_preview_cache()` 直接返回 `None`
- **那么** `_do_fetch_preview_image()` **必须**抛错并返回 IPC error
- **且** **禁止**走"降级计算 hash"的旧路径（原注释所谓"协议 handler on-demand fetch fallback"不存在，必须移除该降级分支）

#### 场景:写盘失败错误接入既有失败聚合/重试链路

- **当** 渲染进程 `fetchPreviewImage(url, ...)` 因后端写盘失败收到 error
- **那么** 该页进入 error 态、其页索引被加入父组件失败页集合
- **且** 当失败页数超过阈值时，触发本能力既有的常驻 Toast + "全部重试"
- **且** 用户重试时重新调用 `fetchPreviewImage` 重新下载并落盘（写盘恢复后即可成功）

#### 场景:成功路径返回形态不变

- **当** 缓存命中（`_read_preview_cache` 返回非空 hash）或缓存写入成功（`_write_preview_cache` 返回 hash）
- **那么** IPC 返回 `{ result: { urlHash } }`，渲染进程以 `app-image://preview/{urlHash}` 作为 `<img src>`
- **且** 成功路径行为与本变更前完全一致（仅失败路径从"伪成功"修正为"正确 error"）
