# electron-ipc-contract 规范

## 目的
定义 Electron 主进程与渲染进程之间 IPC 通道的契约规范。覆盖主进程对 handler 参数的独立权威运行时校验（不依赖 preload 透传的 TypeScript 类型签名）、防御深度、超长文本与路径遍历拒绝、专用通知通道结构，以及 IPC 契约符号必须与消费方同源提交的构建闸门约束。
## 需求
### 需求:IPC handler 主进程必须独立权威校验所有参数

主进程 IPC handler 不得仅依赖 preload 透传的 TypeScript 类型签名作为安全边界。所有接受外部输入（渲染进程可触达）的 handler 必须在主进程内独立调用 `assert(...)` 或等效运行时校验，与 preload 端形成防御深度。标签列表读取通道的可选排序参数必须由主进程校验为允许值，标签同步进度通知必须使用专用通道结构。

#### 场景:WRITE_CLIPBOARD 拒绝超长文本

- **当** 渲染进程调用 `WRITE_CLIPBOARD` 通道，传入长度超过 2,000,000 字符的字符串
- **那么** 主进程 handler 必须抛出 `ValidationError`，错误信息标识 `clipboard text`，剪贴板不被写入

#### 场景:WRITE_CLIPBOARD 拒绝非字符串

- **当** 渲染进程调用 `WRITE_CLIPBOARD` 通道，传入非字符串值（如对象、数字）
- **那么** 主进程 handler 必须抛出 `ValidationError`，错误信息标识 `clipboard text`

#### 场景:可选 source 参数统一校验

- **当** 任意接受可选 `source` 参数的 IPC handler（search、random、get_favourites、add_to_favourites、check_favourite、remove_from_favourites、get_comic_detail、get_favourite_tags、clear_favourite_tags、remove_favourite_tag、sync_favourite_tags、get_tag_list、refresh_tag_list）收到非 undefined/null 且不在 `COMIC_SOURCES` 集合内的值
- **那么** handler 必须通过 `withOptionalSource` helper 抛出 `ValidationError`，错误信息包含 `<handler> source` 标签
- **且** 收到 undefined 或 null 时不写入 params.source

#### 场景:get_tag_list 拒绝非法排序参数

- **当** 渲染进程调用 `GET_TAG_LIST` 通道并传入非 undefined/null 且不等于 `popular` 或 `name` 的 sort 参数
- **那么** 主进程 handler 必须抛出 `ValidationError`，错误信息标识 `get_tag_list sort`
- **且** 禁止向 Python 后端发送非法 sort 参数

#### 场景:get_tag_list 接受合法排序参数

- **当** 渲染进程调用 `GET_TAG_LIST` 通道并传入 `popular` 或 `name` sort 参数
- **那么** 主进程 handler 必须将该 sort 参数透传给 Python 后端
- **且** 未传入 sort 参数时必须保持向后兼容

#### 场景:标签同步进度通知使用专用通道

- **当** Python 后端推送 `tag_list_progress` 通知
- **那么** 主进程必须通过 `TAG_LIST_PROGRESS` 通知通道转发给渲染进程
- **且** 通知结构必须包含 `source`、`currentPage`、`totalPages`、`totalTags`、`status`
- **且** `status` 仅可为 `running`、`completed` 或 `error` 之一

### 需求:下载状态字面量必须派生自单一来源

所有运行时引用下载状态集合（完整集合 `DOWNLOAD_STATUSES` 或活跃子集 `ACTIVE_DOWNLOAD_STATUSES`）的代码必须从 `shared/types.ts` 派生，不得在 `electron/` 或 `src/` 内重复硬编码字面量数组。`DownloadStatus` TypeScript 类型必须从 `DOWNLOAD_STATUSES` const tuple 派生，保证编译期类型与运行时集合永远同步。

#### 场景:DownloadStatus 类型派生自 const tuple

- **当** `shared/types.ts` 中 `DOWNLOAD_STATUSES` 常量数组的元素发生变化（增删状态）
- **那么** `DownloadStatus` 类型自动同步，无需单独修改类型定义
- **且** `electron/main.ts` 的 `VALID_DOWNLOAD_STATUSES` Set 由 `new Set(DOWNLOAD_STATUSES)` 派生

#### 场景:活跃状态判断统一使用 ACTIVE_DOWNLOAD_STATUSES

- **当** 任何代码需要判断任务是否处于活跃状态（queued/downloading/pausing/paused，含手动暂停）
- **那么** 必须使用 `ACTIVE_DOWNLOAD_STATUSES.has(status)`，不得写 `status === 'downloading' || status === 'queued' || ...` 字面量重复
- **且** `NotificationManager` 内部活跃状态判断直接 import 复用 `ACTIVE_DOWNLOAD_STATUSES`，不得在本地重新构造同语义 Set

#### 场景:运行中状态判断使用 RUNNING_DOWNLOAD_STATUSES

- **当** 代码需要判断任务是否处于"运行中"（queued/downloading/pausing，**不含** paused）——如 DownloadPage 的 `'active'` 过滤器
- **那么** 必须使用 `RUNNING_DOWNLOAD_STATUSES.has(status)`，不得写 `status === 'downloading' || status === 'queued' || status === 'pausing'` 字面量
- **且** 不得误用 `ACTIVE_DOWNLOAD_STATUSES`（后者含 paused，语义不同）

### 需求:图片质量枚举必须派生自单一来源

所有引用图片质量字面量（`'low'`/`'medium'`/`'high'`/`'original'`）的运行时校验与 UI 渲染必须从 `shared/types.ts` 的 `IMAGE_QUALITIES` 派生。

#### 场景:bikaImageQuality 配置校验从 IMAGE_QUALITIES 派生

- **当** `main.ts` 的 `CONFIG_VALIDATORS.bikaImageQuality` 验证配置值
- **那么** 必须使用 `oneOf(IMAGE_QUALITIES)` 而非硬编码 `oneOf(['low','medium','high','original'] as const)`

#### 场景:FETCH_PREVIEW_IMAGE 的 imageQuality 校验

- **当** `main.ts` 与 `preload.ts` 校验 `imageQuality` 参数
- **那么** 必须使用 `IMAGE_QUALITIES.includes(imageQuality)` 而非硬编码数组

#### 场景:前端图片质量选项渲染

- **当** `src/components/ComicReaderModal.tsx` 渲染质量选项按钮
- **那么** 必须遍历 `IMAGE_QUALITIES` 而非硬编码 `['low','medium','high','original'] as const`

### 需求:PythonBridge 资源释放必须清理所有 pending 请求

`PythonBridge.kill()` 与 `handleProcessFailure()` 在终止进程前必须调用 `_clearPendingRequests()` reject 所有 pending 请求，避免调用方 Promise 永久悬挂。

#### 场景:kill 清理 pending 请求

- **当** `bridge.call()` 返回的 Promise 尚未 settle 时调用 `bridge.kill()`
- **那么** 该 Promise 必须 reject，错误信息为 `Python bridge killed`
- **且** `pendingRequests` Map 必须为空

#### 场景:handleProcessFailure 复用 _clearPendingRequests

- **当** 后端进程故障触发 `handleProcessFailure`
- **那么** pending 请求清理必须通过 `_clearPendingRequests(reason)` 调用，而非内联重复 for 循环

### 需求:登录窗口 cookie 注入 curl 必须正确转义

Electron 端从 session 提取 cookie value 拼接为 curl 文本传递给 Python `apply_auth` 时，必须按 POSIX shell 单引号转义规则处理整个 cookie/UA 字符串，确保 Python 端 `shlex.split(text, posix=True)` 能正确还原。

实现要点（`shellQuoteForShlex` + `applyAndVerifyAuth`）：
- 先构造**原始** cookie 字符串（`name=value; name2=value2`，不预转义每个 value），然后对**整个字符串**调用 `shellQuoteForShlex` 作为单个 POSIX shell token。
- 模板中 `-b` 与 `-H` 参数后**不加外层单引号**：`curl 'https://${domain}' -b ${shellQuoteForShlex(rawCookieStr)} -H ${shellQuoteForShlex(rawUaHeader)}`。`shellQuoteForShlex` 返回值自带外层引号，再加外层会形成 `'...'<已带引号>'...'` 嵌套，shlex 会因引号不匹配抛 `No closing quotation`。
- `shellQuoteForShlex` 用经典 `'\''` 切分技巧转义 `'`：闭合单引号 → 反斜杠转义单引号 → 重开单引号。

#### 场景:cookie value 含单引号被正确转义

- **当** cookie value 含 `'` 字符（如 `a'b`）
- **那么** `shellQuoteForShlex("name=a'b")` 返回 `'name=a'\\''b'`，shlex.split 还原为 `name=a'b`
- **且** Python `extract_auth_from_curl` 提取的 cookie 字符串包含原始 `name=a'b`
- **且** 整个 curl 文本（含 `-b`、`-H User-Agent`）经 shlex.split 不抛 `ValueError`

#### 场景:cookie value 含分号 + 空格被正确还原

- **当** cookie value 含 `;` 与空格（RFC 6265 合法字符，如 `val; path=/`）
- **那么** shlex.split 还原后 cookie 字符串含原始 `val; path=/`，不丢字符、不多引号

#### 场景:cookie value 含控制字符被拒绝

- **当** cookie value 含 C0 控制字符（`\x00`-`\x1f`）或 DEL（`\x7f`）
- **那么** `shellQuoteForShlex` 必须抛出错误，cookie 不被注入 curl 文本

### 需求:预加载层凭据校验必须去重

preload.ts 中用户名/密码对与 comicId+source 组合的校验必须通过本地 helper 函数（`validateCredentialPair` / `validateComicIdAndOptionalSource`）统一处理，不得在多个 API 方法内重复展开。

#### 场景:三个登录函数复用 validateCredentialPair

- **当** `moeimgLogin` / `bikaLogin` / `hcomicLogin` 三个 API 方法校验凭据
- **那么** 三处必须调用同一个 `validateCredentialPair(username, password)` helper

#### 场景:三个收藏函数复用 validateComicIdAndOptionalSource

- **当** `addToFavourites` / `checkFavourite` / `removeFromFavourites` 三个 API 方法校验 comicId 与可选 source
- **那么** 三处必须调用同一个 `validateComicIdAndOptionalSource(comicId, source)` helper

### 需求:主进程关键超时与延迟常量必须命名

主进程与 PythonBridge 中用于关键时序的魔法数字必须提取为命名常量，与同模块其他已命名常量（如 `SHUTDOWN_TIMEOUT_MS`、`REQUEST_TIMEOUT_MS`）风格一致。

#### 场景:启动更新检查延迟命名

- **当** `main.ts` 的 `scheduleStartupUpdateCheck` 设置启动后更新检查的延迟
- **那么** 必须使用命名常量 `STARTUP_UPDATE_CHECK_DELAY_MS`，不得使用裸数字 `3000`

#### 场景:后端重启延迟命名

- **当** `python-bridge.ts` 的 `handleProcessFailure` 设置重启延迟
- **那么** 必须使用命名常量 `BACKEND_RESTART_DELAY_MS`，不得使用裸数字 `2000`

### 需求:图片获取通道结果契约必须返回 urlHash 而非 dataUri

`fetch_cover` 与 `fetch_preview_image` 通道的 JSON-RPC 结果**必须**为 `{ urlHash: string }`，其中 `urlHash` 为 `sha256(url).hexdigest()`（64 位十六进制），由 Python 后端权威计算。结果**禁止**包含 `dataUri` 或任何 base64 字符串。渲染进程据 `urlHash` 拼接自定义协议 URL（`app-image://cover/{urlHash}` 或 `app-image://preview/{urlHash}`）交给 `<img>`。

`shared/types.ts` 中的契约定义**必须**同步：
- `PreviewImageResult` 改为 `{ urlHash: string }`。
- `fetch_cover.result` 与 `fetch_preview_image.result` 改为 `{ urlHash: string }`。
- `preload.ts` 的 `fetchCover`/`fetchPreviewImage` 返回类型适配。

`ImageQuality` 参数校验（从 `IMAGE_QUALITIES` 派生）**保持不变**，本需求不影响该校验。

#### 场景:fetch_cover 返回 urlHash

- **当** 渲染进程调用 `fetchCover(url)`，后端命中缓存或下载落盘成功
- **那么** JSON-RPC 结果为 `{ urlHash: "<64 位 hex>" }`
- **且** 渲染进程以 `app-image://cover/{urlHash}` 作为 img src
- **且** **禁止**结果包含 `dataUri` 或任何 base64 字符串

#### 场景:fetch_preview_image 返回 urlHash

- **当** 渲染进程调用 `fetchPreviewImage(url, scrambleId, comicId, imageQuality)`，后端 fetch（jm 场景含反混淆）落盘成功
- **那么** JSON-RPC 结果为 `{ urlHash: "<64 位 hex>" }`
- **且** 渲染进程以 `app-image://preview/{urlHash}` 作为 img src
- **且** jm 场景下落盘的已是反混淆后字节，urlHash 对应文件可直接显示

#### 场景:imageQuality 校验不受影响

- **当** `main.ts` 与 `preload.ts` 校验 `fetchPreviewImage` 的 `imageQuality` 参数
- **那么** 仍使用 `IMAGE_QUALITIES.includes(imageQuality)`，本变更不修改该校验逻辑

### 需求:反爬挑战错误必须跨 PythonBridge 保留结构化数据

Python JSON-RPC 返回专用反爬挑战错误时，Electron `PythonBridge` 必须在主进程 Error 上保留数值 `code` 和经过类型检查的 `data`；禁止仅保留 message 后依靠字符串匹配恢复类型。

#### 场景:保留合法挑战错误
- **当** Python 返回反爬挑战错误码及 `{ source: "jm", challengeUrl, message }`
- **那么** 主进程捕获的错误必须含相同错误码和合法数据字段
- **且** 该错误可被收藏夹主进程 handler 精确识别

#### 场景:拒绝异常数据载荷
- **当** Python 错误的 `data` 不是对象、来源不是 `jm`、URL 超长或字段类型不符
- **那么** PythonBridge 或消费 handler 必须将其视为无可信上下文的普通错误
- **且** 禁止用该载荷打开 BrowserWindow

### 需求:收藏夹交互标志必须逐层验证并默认关闭

前端到 Electron 主进程的收藏夹调用可携带可选 `allowInteractiveChallenge` 布尔值；preload 和主进程必须验证其类型，缺省时必须视为 `false`，并禁止将该 UI 控制参数转发给 Python handler。搜索调用同样支持可选 `allowInteractiveChallenge` 布尔值，遵守完全相同的逐层校验、缺省 `false`、不转发 Python 的契约，与收藏夹交互标志保持同构。搜索的 `languageFilter` 是独立的数据查询参数，禁止与交互控制参数混用。

#### 场景:缺省为非交互

- **当** 调用 `getFavourites` 未提供交互标志
- **那么** 主进程按 `allowInteractiveChallenge=false` 处理
- **且** 挑战错误不得打开窗口

#### 场景:非法交互参数

- **当** renderer 为交互标志传入非布尔值
- **那么** preload 在调用主进程前拒绝请求

#### 场景:主进程消费控制参数

- **当** 合法请求携带 `allowInteractiveChallenge=true`
- **那么** 主进程可用它决定是否运行挑战编排
- **且** 发给 Python `get_favourites` 的参数只包含其支持的页码和来源字段

#### 场景:搜索调用缺省为非交互

- **当** 调用 `search` 未提供交互标志
- **那么** 主进程按 `allowInteractiveChallenge=false` 处理
- **且** 搜索挑战错误不得打开窗口

#### 场景:搜索非法交互参数

- **当** renderer 为搜索交互标志传入非布尔值
- **那么** preload 在调用主进程前拒绝请求

#### 场景:搜索主进程消费控制参数

- **当** 合法搜索请求携带 `allowInteractiveChallenge=true`
- **那么** 主进程可用它决定是否运行搜索挑战编排
- **且** 发给 Python `search` 的参数只包含其支持的 `query / mode / page / source / tag / language_filter` 字段，禁止包含 `allowInteractiveChallenge`

#### 场景:仅 JM 来源搜索触发交互恢复

- **当** 搜索请求携带 `allowInteractiveChallenge=true` 但来源不是 `jm`
- **那么** 即使返回挑战错误，主进程也禁止打开验证窗口
- **且** 按普通错误处理（非 JM 来源不产生 `AntiBotChallengeError`）

### 需求:收藏夹推荐标签同步进度通知必须使用专用通道

`sync_favourite_tags` 的实时进度必须通过专用 Python notification 与渲染进程 notification 通道传递，禁止复用 `tag_list_progress` / `TAG_LIST_PROGRESS`。共享契约必须定义 favourite tags 同步进度事件结构，Electron 主进程必须将 Python notification 转发到对应 renderer channel，preload 必须暴露订阅 API。

事件结构必须包含 `source`、`phase`、`current`、`total`、`status` 或等价状态信息。其中阶段或状态必须能区分运行中、完成与错误，并且必须能表达收藏夹分页扫描和详情补全两个阶段。

**错误事件契约**：每个失败路径**必须恰好推送一次** `error` 事件，禁止重复推送。外层异常兜底是错误事件的**唯一**推送点，内层站点（如第一页预检失败）不得额外推送，避免第一页网络失败路径双发而 `needs_login` 失败路径单发的契约不一致。

#### 场景:Python favourite_tags_progress 被转发到 renderer 专用通道

- **当** Python 后端推送 `favourite_tags_progress` 通知
- **那么** Electron 主进程必须通过 `FAVOURITE_TAGS_PROGRESS` 通知通道转发给渲染进程
- **且** 禁止通过 `TAG_LIST_PROGRESS` 通道转发该事件

#### 场景:preload 暴露 favourite tags 进度订阅 API

- **当** 渲染进程调用 `window.hcomic.onFavouriteTagsProgress(callback)`
- **那么** preload 必须订阅 favourite tags 进度通知通道
- **且** 必须返回取消订阅函数
- **且** callback 参数必须符合共享的 favourite tags 进度事件结构

#### 场景:收藏页扫描事件包含页码语义

- **当** 后端完成任一收藏夹页面的扫描和标签索引更新
- **那么** 推送的 favourite tags 进度事件必须包含当前页与总页数，或包含足以让前端显示 `currentPage/totalPages` 的等价字段
- **且** 事件必须包含当前来源 `source`

#### 场景:详情补全事件包含补全数量语义

- **当** 后端正在对无标签漫画执行详情补全
- **那么** 推送的 favourite tags 进度事件必须包含已补全数量与待补全总数，或包含足以让前端显示 `current/total` 的等价字段
- **且** 事件必须能与收藏页扫描阶段区分

#### 场景:错误事件不吞掉原始 IPC 错误

- **当** `sync_favourite_tags` 同步过程中发生异常
- **那么** 后端必须推送 favourite tags 错误进度事件（包含可显示 message）
- **且** 原 `sync_favourite_tags` 请求仍必须按现有 JSON-RPC 错误路径失败，禁止只靠进度事件表示失败

#### 场景:每个失败路径恰好推送一次 error 事件

- **当** `sync_favourite_tags` 在第一页网络请求阶段失败（最常见的失败路径）
- **那么** 后端必须恰好推送一次 `phase: "error"` 进度事件
- **且** 禁止内层第一页异常处理与外层兜底同时各推送一次（双发）
- **且** 第一页失败路径与 `needs_login` 失败路径推送的 `error` 事件数量必须一致（均为一次）

#### 场景:错误事件 total 字段表达未知总数

- **当** 同步在尚未确定 `total_pages`（如第一页请求即失败）时推送 error 事件
- **那么** 事件的 `total` 字段必须为 0，明确表达「总页数未知」
- **且** 禁止使用误导性的默认值 1（会被前端误读为「总共 1 页全部失败」）

### 需求:IPC 契约符号必须与消费方同源提交，禁止部分提交导致主干不可构建

当某条 IPC 通道（含共享类型、preload API、renderer hook、Python 事件源、测试 mock）被前端代码引用时，该通道的全部定义必须与引用方落在同一变更内纳入主干。禁止出现「引用方已提交、定义方仅存在于工作区未提交改动」的部分状态——此类状态会让干净检出（无工作区改动）的主干无法通过 `tsc --noEmit` 与完整 Vitest，从而被开发者的本地未提交改动掩盖。

具体到 favourite tags 同步进度通道：`shared/types.ts` 的 `FavouriteTagsProgressEvent` 类型与 `onFavouriteTagsProgress` 方法签名、`src/hooks/useIpc.ts` 的 `useFavouriteTagsProgress` hook、`electron/main.ts` 与 `electron/preload.ts` 的转发与订阅桥接、`python/ipc/favourite_tags_mixin.py` / `search_mixin.py` 的事件源，必须与 `src/components/settings/FavouriteTagSettings.tsx` 的进度订阅消费在同一提交内闭合。

#### 场景:干净主干必须能通过类型检查

- **当** 主干在干净工作区状态下（无未提交改动）执行 `npx tsc --noEmit`
- **那么** 必须以 exit code 0 通过
- **且** 禁止因 `FavouriteTagsProgressEvent` / `useFavouriteTagsProgress` 等 symbol 未导出而报 `TS2305` / `TS2724`

#### 场景:干净主干必须能通过完整 Vitest

- **当** 主干在干净工作区状态下执行 `npm test`
- **那么** 必须无失败用例
- **且** 禁止出现因 mock 缺失进度通道订阅 API 导致的组件渲染崩溃

#### 场景:进度通道定义与消费同源提交

- **当** `FavouriteTagSettings.tsx` 引用 `useFavouriteTagsProgress` / `FavouriteTagsProgressEvent`
- **那么** 提交该引用的同一变更必须包含 `shared/types.ts`、`src/hooks/useIpc.ts`、`electron/main.ts`、`electron/preload.ts` 中对应通道的定义
- **且** 必须包含相关测试 mock 的更新，禁止依赖测试文件单独的未提交改动

### 需求:搜索 IPC 必须验证并转发受支持来源的语言筛选参数

搜索公共 API 必须支持可选 `languageFilter` 参数，当前唯一合法非空值为 `chinese`。preload 与 Electron 主进程必须逐层校验该参数；主进程只能在 `source="nh"` 或 `source="moeimg"` 时将其以 `language_filter` 字段转发给 Python `search`，缺省或空值必须视为未启用筛选。

#### 场景:合法 NH 中文筛选逐层转发

- **当** renderer 对 `source="nh"` 的搜索传入 `languageFilter="chinese"`
- **那么** preload 和主进程必须接受请求
- **且** Python `search` 参数必须包含 `language_filter="chinese"`

#### 场景:合法 moeimg 中文筛选逐层转发

- **当** renderer 对 `source="moeimg"` 的搜索传入 `languageFilter="chinese"`
- **那么** preload 和主进程必须接受请求
- **且** Python `search` 参数必须包含 `language_filter="chinese"`

#### 场景:缺省筛选参数

- **当** renderer 调用搜索但未提供 `languageFilter`
- **那么** 系统必须按未启用语言筛选处理
- **且** 主进程发给 Python 的参数必须省略 `language_filter`

#### 场景:拒绝非法筛选值

- **当** renderer 为 `languageFilter` 传入非字符串、控制字符或除 `chinese` 外的非空值
- **那么** preload 或主进程必须在发起 Python 调用前拒绝请求

#### 场景:拒绝不支持来源的语言筛选

- **当** 搜索来源既不是 NH 也不是 moeimg 且请求携带非空 `languageFilter`
- **那么** 主进程必须拒绝请求
- **且** 禁止把语言筛选转发给对应来源解析器

### 需求:Bika 自动签到 IPC 契约必须逐层闭合
系统必须为 Bika 自动签到定义无输入参数的共享契约、preload API、Electron 主进程 handler 与 Python JSON-RPC handler，并在各层返回结构化签到状态。

#### 场景:自动签到调用成功
- **当** renderer 调用 Bika 自动签到 API
- **那么** preload 必须通过专用 IPC 通道调用主进程
- **且** 主进程必须以空参数对象调用 Python `bika_check_in`
- **且** 返回结果必须包含 `status`，其值仅可为 `checked_in` 或 `already_checked_in`

#### 场景:自动签到通道无外部参数
- **当** renderer 调用 Bika 自动签到 API
- **那么** API 禁止接受或转发用户名、密码、token 或任意用户输入
- **且** Python 必须复用运行期 Bika parser 的认证状态

