## 新增需求

### 需求:JM 搜索请求必须检测反爬挑战并抛出结构化信号

JM 搜索请求（`JmParser.search`）遇到 Cloudflare 反爬挑战时，必须复用收藏夹同款检测逻辑（`_is_challenge_response` / `_is_challenge_page`）识别挑战，并抛出包含受挑战搜索 URL 的 `AntiBotChallengeError`。禁止将挑战页 HTML 静默解析为空结果列表返回；禁止在 `search()` 的异常兜底中吞掉 `AntiBotChallengeError`。

#### 场景:搜索响应头标记挑战

- **当** JM 搜索响应包含 `cf-mitigated: challenge` 响应头
- **那么** `search()` 必须抛出 `AntiBotChallengeError`，其 `challenge_url` 为本次搜索请求的 URL
- **且** 禁止返回空列表 `([], None)`

#### 场景:搜索正文包含稳定挑战标记

- **当** JM 搜索响应正文包含 Cloudflare 挑战平台或 "Just a moment" 等稳定挑战标记
- **那么** `search()` 必须抛出 `AntiBotChallengeError`，其 `challenge_url` 为本次搜索请求的 URL
- **且** 禁止将该正文交给 `_parse_search_results` 解析

#### 场景:正常搜索结果不受影响

- **当** JM 搜索返回正常 HTML（无挑战响应头、无稳定挑战页标记）
- **那么** `search()` 必须正常解析并返回搜索结果
- **且** 禁止因误判挑战而抛出 `AntiBotChallengeError`

#### 场景:搜索真无结果不伪装成挑战

- **当** JM 搜索返回正常 HTML 但确无匹配结果（解析后为空列表）
- **那么** `search()` 必须返回空列表 `([], None)`
- **且** 禁止将"无结果"误判为挑战

#### 场景:非挑战异常仍走兜底

- **当** JM 搜索因网络抖动等非挑战、非 `ParserResponseError` 异常失败
- **那么** `search()` 的 `except Exception` 兜底必须保持原行为，记录日志并返回 `([], None)`
- **且** `AntiBotChallengeError` 与 `ParserResponseError` 必须在兜底之前显式重新抛出，不被吞掉

### 需求:搜索 IPC handler 必须经 auth_error_guard 传播挑战错误

`handle_search` 中调用 `MultiSourceParser.search` 的主搜索分支必须使用 `_auth_error_guard` 上下文管理器，与 `handle_get_favourites` 对齐。`AntiBotChallengeError` 必须经 guard 冒泡到 `ipc_server.py` 顶层捕获，序列化为 JSON-RPC `-32002` 结构化信号 `{source: 'jm', challengeUrl, message}`。禁止在 `handle_search` 内捕获并吞掉 `AntiBotChallengeError`。

#### 场景:搜索挑战错误序列化为 -32002

- **当** JM 搜索抛出 `AntiBotChallengeError`
- **那么** `handle_search` 必须让其冒泡（经 `_auth_error_guard`）
- **且** `ipc_server.py` 顶层捕获后必须返回 JSON-RPC error code `-32002`，data 含 `source: 'jm'`、`challengeUrl`、`message`
- **且** 该错误可被 Electron 主进程 `isJmChallengeError` 精确识别

#### 场景:非 JM 来源搜索不受影响

- **当** hcomic / moeimg / bika / nh / copymanga 来源搜索请求
- **那么** 这些来源的 parser 不会抛出 `AntiBotChallengeError`（挑战检测仅在 JM parser 内）
- **且** `handle_search` 的行为对这些来源保持不变

### 需求:挑战恢复编排必须支持搜索请求复用

`jm-challenge-recovery.ts` 的核心恢复编排（打开挑战窗口 → cookie 同步 → 重试原请求一次）必须抽取为可复用函数，供收藏夹与搜索请求共用。搜索请求的恢复流程必须：复用 `openJmChallengeWindow` 让用户验证、复用 `apply_auth` 同步 cookie 到全局 parser session、用原搜索参数重试 `bridge.call('search', ...)` 一次。搜索恢复流程禁止调用收藏夹快照兜底（`parse_jm_favourites_snapshot`）或静默快照恢复。

#### 场景:搜索请求触发验证窗口

- **当** 用户主动搜索 JM 且 Python 搜索请求返回结构化挑战信号（`-32002`，`allowInteractiveChallenge=true`）
- **那么** 主进程必须打开 JM 挑战窗口加载受挑战的搜索 URL
- **且** 窗口叠层必须表达"人机验证"语义（复用 mode='challenge'）

#### 场景:验证后用原搜索参数重试

- **当** 用户在挑战窗口完成验证，cookie 已同步到 Python parser session
- **那么** 恢复编排必须用原始 `query / mode / page / source / tag` 参数调用 `bridge.call('search', ...)` 重试一次
- **且** 禁止递归进入恢复（重试再次被挑战时直接返回可重试错误）

#### 场景:搜索重试成功

- **当** 验证后第一次搜索重试返回正常结果
- **那么** 恢复编排必须返回该结果
- **且** 禁止调用任何收藏夹快照解析入口

#### 场景:搜索重试仍被挑战

- **当** 验证后第一次搜索重试仍返回结构化挑战错误
- **那么** 恢复编排必须停止并返回带手动重试入口的可恢复错误
- **且** 禁止调用收藏夹快照兜底（搜索无快照入口）
- **且** 一次用户动作不得触发第二次验证窗口

#### 场景:用户取消搜索验证

- **当** 用户取消或关闭搜索挑战窗口
- **那么** 恢复编排必须停止，返回 `cancelled=true` 的可恢复错误
- **且** 禁止清除认证信息或把挑战报告为登录失效

#### 场景:收藏夹恢复流程回归不变

- **当** 收藏夹请求触发 `recoverJmChallenge`（收藏专用入口）
- **那么** 其行为必须与重构前完全一致：开窗 → 重试 `get_favourites` → 必要时快照兜底 → 静默恢复状态管理
- **且** 重构不得改变收藏页恢复的任何既有场景

### 需求:搜索与收藏验证数据必须经共享 session 跨界面复用

JM 来源全进程只有一个 `JmParser` 实例和一个 `self.session`。无论用户在搜索页还是收藏页完成人机验证，提取的 Cookie + User-Agent 必须经 `apply_auth` → `configure_auth` → `_sync_cookies_to_jar` 注入该共享 session，使后续搜索请求和收藏夹请求都自动携带已验证 cookie，无需用户在另一界面重新验证。

#### 场景:搜索页验证后收藏页免重验

- **当** 用户在搜索页完成人机验证，cookie 已同步到全局 parser session
- **且** 用户随后切换到收藏页主动加载 JM 收藏夹
- **那么** 收藏夹请求必须自动携带已验证 cookie
- **且** 若 cookie 仍有效，收藏夹请求不得再次触发挑战窗口

#### 场景:收藏页验证后搜索页免重验

- **当** 用户在收藏页完成人机验证，cookie 已同步到全局 parser session
- **且** 用户随后在搜索页主动搜索 JM
- **那么** 搜索请求必须自动携带已验证 cookie
- **且** 若 cookie 仍有效，搜索不得再次触发挑战窗口
