## 为什么

上一轮代码审查发现两个独立的 P2 缺陷，都会让用户看到与现实不符的陈旧状态：

1. **清除 JM 认证不清运行期状态**：JM 登录态实际存放在 `MultiSourceParser._jm_session_auth`，但 `handle_clear_source_auth` 调用的是 `self.parser.parsers.get(source).configure_auth(...)`（即 `JmParser.configure_auth`），该方法碰不到 `_jm_session_auth`。而鉴权判定 `get_runtime_auth("jm")` 读的恰恰是 `_jm_session_auth`。结果用户在设置页"清除 JM"后，`config.json` 已清空、UI 仍判定为"已登录"，但旧 cookie 早已失效，陷入显示已登录却无法搜索/收藏的幽灵态。登录路径走的是 `self.parser.configure_auth(..., source=source)`（正确的 `MultiSourceParser.configure_auth`），清除路径与登录路径不对称是根因。

2. **换章后复用上一章图片缓存**：`usePreloadManager` 的共享缓存 `imageCacheRef` 以纯页码 index 为键，换章时 `imageUrls`/`comicId`/`scrambleId` 变化但缓存未清；消费者（`ReaderPage`/`FlipPage`）命中 `imageCacheRef.get(idx)` 即无条件采用并跳过 IPC 重取。换章后当前页及相邻页可能直接渲染上一章同页码图片，且预加载队列把残留 index 视作"已加载"而跳过补取，错误图片会卡住直到手动重试。

现在做，因为两者都是"数据已更新但读到的还是旧值"的同构陈旧状态缺陷，最小改动即可闭环修复，且两处缺陷都已有明确的对称修复路径。

## 变更内容

- **对齐 JM 清除路径与登录路径**：`handle_clear_source_auth` 不再调 `self.parser.parsers.get(source).configure_auth(...)`，改为调 `self.parser.configure_auth(cookie="", user_agent="", bearer_token="", source=source)`，走 `MultiSourceParser.configure_auth` —— 该方法会同时清 `_jm_session_auth`（鉴权判定来源）并把空值传播到活动 `JmParser` 实例。与登录路径（`handle_apply_auth` 已是此写法）形成对称。
- **换章时清空阅读器共享缓存**：在 `usePreloadManager` 内新增一个 effect，当 `imageUrls`/`comicId`/`scrambleId`/`imageQuality` 引用变化时调用 `clearCache()`，把缓存清空逻辑收敛进 hook 内部，使换章（`ComicReaderModal.goToChapter` → `fetchChapterUrls` → `setImageUrls` 等）自动触发清缓存，无需调用方手工接线。
- **保留模态关闭清缓存路径不变**：`ComicReaderModal` 关闭分支（`open=false`）的 `clearCache()` 调用保留，新 effect 与其互不冲突（关闭时输入也会变 → 触发清空，行为幂等）。

## 功能 (Capabilities)

### 新增功能

- `auth-clear-runtime-state`: 认证清除的不变量 —— 清除任一来源认证后，该来源的运行期内存鉴权态（尤其 JM 的 `_jm_session_auth`）必须与持久化 `config.json` 一致地归零，`get_runtime_auth` 立即反映为匿名。
- `reader-chapter-cache-invalidation`: 阅读器章节切换的不变量 —— 当章节的图片 URL 集合或解码参数（`scrambleId`/`comicId`/`imageQuality`）变化时，共享图片缓存必须在该变化被消费前清空，禁止跨章复用缓存项。

### 修改功能

- `reader-image-cache`: 新增"换章必须清空共享缓存"需求，补齐现有规范只覆盖"模式切换不清、关闭才清"而漏掉的"换章必须清"场景。

## 影响

- **代码**：
  - `python/ipc/auth_mixin.py`（`handle_clear_source_auth` 的 parser 调用改走 `MultiSourceParser.configure_auth`）。
  - `src/hooks/usePreloadManager.ts`（新增监听输入变化清缓存的 effect）。
- **行为**：清除 JM 认证后 `_check_source_auth` 立即返回未登录（与 UI/配置一致）；多章节漫画换章后页面正确渲染新章节图片，不再残留上一章图片。
- **规范**：新增 `auth-clear-runtime-state`、`reader-chapter-cache-invalidation` 两个 capability；修改 `reader-image-cache` 增补换章清缓存需求。
- **不受影响**：登录路径（`handle_apply_auth` / `_do_password_login` / `handle_nh_apply_api_key` 均已走正确通道）、非 JM 来源的清除（`MultiSourceParser.configure_auth` 对非 JM 来源同样正确传播）、阅读器模式切换与关闭清缓存语义、预加载队列构建逻辑本身。
