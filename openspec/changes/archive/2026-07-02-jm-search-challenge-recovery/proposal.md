## 为什么

JM 搜索请求遇到 Cloudflare 反爬挑战时，Python 的 `JmParser.search()` 走 `_request_text()`，该方法只做 `raise_for_status()`，而 CF 挑战页通常返回 HTTP 200。结果就是：挑战页 HTML 被原样传入 `_parse_search_results()`，解析不到 `thumb-overlay` 节点，`search()` 在 `except Exception` 里**静默返回空列表**。用户在 JM 搜索页被拦截时只看到"无结果"，没有任何错误提示，也无法触发已有的、为收藏页构建的人机验证恢复链路（`AntiBotChallengeError → -32002 → recoverJmChallenge → openJmChallengeWindow`）。

与此同时，收藏页那套验证恢复机制在验证后提取的 Cookie + User-Agent 会通过 `apply_auth` 注入到全局唯一的 JM parser session，**搜索与收藏本就共享同一个 session**。也就是说，只要让搜索请求能检测并抛出挑战错误，用户在任意一个界面完成验证后，验证数据会自动对另一个界面生效——无需重新验证。

## 变更内容

- **Python 搜索端补挑战检测**：`JmParser.search()` / `_request_text()` 在请求后用现有 `_is_challenge_response` / `_is_challenge_page` 检测 CF 挑战，命中则抛 `AntiBotChallengeError(challenge_url=url)`，不再静默吞错返回空列表。`search` 的 `except` 必须放行 `AntiBotChallengeError` / `ParserResponseError` 向上传播。
- **搜索 IPC handler 接入 auth_error_guard**：`handle_search` 改用与 `handle_get_favourites` 一致的 `_auth_error_guard`，让 `AntiBotChallengeError` 经 `ipc_server.py:410` 顶层捕获序列化为 `-32002` 结构化信号。
- **搜索 IPC 契约扩展交互标志**：`HcomicAPI.search` 新增可选 `allowInteractiveChallenge?: boolean` 参数，逐层（前端 hook → preload → main handler）校验，缺省 `false`，且不转发给 Python。复用 `electron-ipc-contract` 中"收藏夹交互标志逐层验证并默认关闭"的同构契约。
- **挑战恢复编排泛化为可复用**：将 `jm-challenge-recovery.ts` 的 `recoverJmChallenge` 重构为接受"重试回调"的通用编排器，收藏与搜索各传自己的重试操作；搜索场景省略不适用的"收藏夹快照兜底"步骤。
- **前端搜索页接入交互恢复**：`useSearch` hook 和 `SearchPage` 对用户主动搜索传 `allowInteractiveChallenge=true`，对预加载/后台刷新传 `false`；`withLoading` 的 catch 扩展挑战错误处理，展示可重试提示而非空结果。

## 功能 (Capabilities)

### 新增功能

无。

### 修改功能

- `jm-challenge-recovery`：将交互恢复编排从"收藏夹专用"泛化为"任意 JM 受挑战请求可复用"，搜索请求在用户主动触发时也能启动验证窗口、同步 Cookie、重试原请求一次。
- `electron-ipc-contract`：`search` IPC 调用支持可选 `allowInteractiveChallenge` 标志，逐层校验、缺省 `false`、不转发给 Python handler；与 `getFavourites` 的交互标志保持同构契约。
- `paginated-preload-interruption`：搜索预加载（`useSearchPreloader`）调用 `search` 时必须传 `allowInteractiveChallenge=false`，确保后台预加载被挑战时静默失败保缓存，绝不弹窗。

## 影响

**Python 层**
- `sources/jm/parser.py`：`search()`、`_request_text()`（或新增搜索专用请求方法）补挑战检测与 `AntiBotChallengeError` 抛出。
- `python/ipc/search_mixin.py`：`handle_search` 接入 `_auth_error_guard`，与 `handle_get_favourites` 对齐。

**Electron 层**
- `electron/main.ts`：`SEARCH` handler 增加挑战恢复分支（仿照 `GET_FAVOURITES` handler 的 `isJmChallengeError` 判断 + 恢复器调用）。
- `electron/jm-challenge-recovery.ts`：`recoverJmChallenge` 重构为接受重试回调的通用编排；新增/调整搜索恢复入口。
- `electron/preload.ts`：`search` 桥接增加 `allowInteractiveChallenge` 参数校验与透传。

**前端层**
- `src/hooks/useIpc.ts`：`useSearch` 的 `search()` 增加可选 `allowInteractiveChallenge` 参数。
- `src/pages/SearchPage.tsx`：用户主动 `handleSearch` 传 `true`，`useSearchPreloader` 传 `false`；catch 处理挑战错误。

**共享契约**
- `shared/types.ts`：`HcomicAPI.search` 签名与 `IPCMethods.search` 契约增加可选交互标志。

**测试**
- Python：搜索挑战检测单元测试（CF 挑战页 → 抛 `AntiBotChallengeError`；正常页 → 正常解析）；`handle_search` 经 guard 抛 `-32002`。
- Electron：搜索 handler 挑战恢复编排测试；恢复器泛化后收藏路径回归测试。
- 前端：搜索页交互标志传递；预加载静默失败测试更新。
