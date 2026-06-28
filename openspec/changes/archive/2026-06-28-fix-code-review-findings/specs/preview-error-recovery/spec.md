## 新增需求

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
