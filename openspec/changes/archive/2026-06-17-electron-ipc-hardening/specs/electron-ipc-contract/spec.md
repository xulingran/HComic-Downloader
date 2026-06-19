# Spec Delta: electron-ipc-contract

## 新增需求

### 需求:IPC handler 主进程必须独立权威校验所有参数

主进程 IPC handler 不得仅依赖 preload 透传的 TypeScript 类型签名作为安全边界。所有接受外部输入（渲染进程可触达）的 handler 必须在主进程内独立调用 `assert(...)` 或等效运行时校验，与 preload 端形成防御深度。

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

### 需求:下载状态字面量必须派生自单一来源

所有运行时引用下载状态集合（完整集合 `DOWNLOAD_STATUSES` 或活跃子集 `ACTIVE_DOWNLOAD_STATUSES`）的代码必须从 `shared/types.ts` 派生，不得在 `electron/` 或 `src/` 内重复硬编码字面量数组。`DownloadStatus` TypeScript 类型必须从 `DOWNLOAD_STATUSES` const tuple 派生，保证编译期类型与运行时集合永远同步。

#### 场景:DownloadStatus 类型派生自 const tuple

- **当** `shared/types.ts` 中 `DOWNLOAD_STATUSES` 常量数组的元素发生变化（增删状态）
- **那么** `DownloadStatus` 类型自动同步，无需单独修改类型定义
- **且** `electron/main.ts` 的 `VALID_DOWNLOAD_STATUSES` Set 由 `new Set(DOWNLOAD_STATUSES)` 派生

#### 场景:活跃状态判断统一使用 ACTIVE_DOWNLOAD_STATUSES

- **当** 任何代码需要判断任务是否处于活跃状态（queued/downloading/pausing/paused）
- **那么** 必须使用 `ACTIVE_DOWNLOAD_STATUSES.has(status)`，不得写 `status === 'downloading' || status === 'queued' || ...` 字面量重复
- **且** `NotificationManager` 内部活跃状态判断与此集合语义一致（4 个状态全覆盖）

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

Electron 端从 session 提取 cookie value 拼接为 curl 文本传递给 Python `apply_auth` 时，必须按 POSIX shell 单引号转义规则处理 value 中的特殊字符，确保 Python 端 `shlex.split(text, posix=True)` 能正确还原。

#### 场景:cookie value 含单引号被正确转义

- **当** cookie value 含 `'` 字符（如 `a'b`）
- **那么** 转义后为 `'a'\''b'`，shlex.split 还原为 `a'b`
- **且** Python `extract_auth_from_curl` 提取的 cookie 字符串包含原始 `a'b`

#### 场景:cookie value 含控制字符被拒绝

- **当** cookie value 含 C0 控制字符（`\x00`-`\x1f`）或 DEL（`\x7f`）
- **那么** 转义函数必须抛出错误，cookie 不被注入 curl 文本

### 需求:预加载层凭据校验必须去重

preload.ts 中用户名/密码对与 comicId+source 组合的校验必须通过本地 helper 函数（`validateCredentialPair` / `validateComicIdAndSource`）统一处理，不得在多个 API 方法内重复展开。

#### 场景:三个登录函数复用 validateCredentialPair

- **当** `moeimgLogin` / `bikaLogin` / `hcomicLogin` 三个 API 方法校验凭据
- **那么** 三处必须调用同一个 `validateCredentialPair(username, password)` helper

#### 场景:三个收藏函数复用 validateComicIdAndSource

- **当** `addToFavourites` / `checkFavourite` / `removeFromFavourites` 三个 API 方法校验 comicId 与可选 source
- **那么** 三处必须调用同一个 `validateComicIdAndSource(comicId, source)` helper

### 需求:主进程关键超时与延迟常量必须命名

主进程与 PythonBridge 中用于关键时序的魔法数字必须提取为命名常量，与同模块其他已命名常量（如 `SHUTDOWN_TIMEOUT_MS`、`REQUEST_TIMEOUT_MS`）风格一致。

#### 场景:启动更新检查延迟命名

- **当** `main.ts` 的 `scheduleStartupUpdateCheck` 设置启动后更新检查的延迟
- **那么** 必须使用命名常量 `STARTUP_UPDATE_CHECK_DELAY_MS`，不得使用裸数字 `3000`

#### 场景:后端重启延迟命名

- **当** `python-bridge.ts` 的 `handleProcessFailure` 设置重启延迟
- **那么** 必须使用命名常量 `BACKEND_RESTART_DELAY_MS`，不得使用裸数字 `2000`