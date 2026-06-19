# Design: electron-ipc-hardening

## 架构上下文

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Renderer (src/)                              │
│   调用 window.hcomic.* → ipcRenderer.invoke(IPC_CHANNELS.*)         │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ IPC (结构化克隆)
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Preload (electron/preload.ts)                  │
│   早期契约校验（非安全边界）                                         │
│   ├─ validatePage / validateTaskId / validateDownloadDir            │
│   ├─ +validateCredentialPair (新增, 本变更)                          │
│   └─ +validateComicIdSource  (新增, 本变更)                          │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                Main (electron/main.ts) — 权威校验层                  │
│   IPC handlers                                                      │
│   ├─ +withOptionalSource (新增, 替换 13+ 处重复)                     │
│   ├─ WRITE_CLIPBOARD +assert(string, length)  (新增权威校验)         │
│   └─ 引用 DOWNLOAD_STATUSES / ACTIVE_DOWNLOAD_STATUSES / IMAGE_QUALITIES │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
┌──────────────────┐  ┌────────────────────┐  ┌─────────────────────┐
│ python-bridge.ts │  │ notification-mgr.ts│  │ login-window.ts     │
│ kill() 清 pending│  │ ACTIVE_STATUSES    │  │ cookie shlex 转义   │
│ 魔法数字命名      │  │ 提为静态常量       │  │ (仅 #7, 不动业务)   │
└──────────────────┘  └────────────────────┘  └─────────────────────┘
```

## 核心设计

### 1. 跨层常量单一来源（簇 B 核心）

**位置**：`shared/types.ts` 末尾，紧邻现有类型定义。

```ts
// ── 派生常量（单一来源）─────────────────────────────────────────
// 注意：DOWNLOAD_STATUSES 是 DownloadStatus 的来源（type 从 const 派生），
// 不是反向。这保证运行时集合与编译期类型永远同步。
export const DOWNLOAD_STATUSES = [
  'queued', 'downloading', 'pausing', 'paused',
  'completed', 'failed', 'cancelled',
] as const
export type DownloadStatus = typeof DOWNLOAD_STATUSES[number]

// 下载"活跃态"子集：用于 UI 显示活跃任务计数、NotificationManager 触发判断、
// 主窗口 close 拦截。Set 实例：所有用途都是运行时 .has() 查询。
export const ACTIVE_DOWNLOAD_STATUSES: ReadonlySet<string> = new Set([
  'queued', 'downloading', 'pausing', 'paused',
])
```

**迁移策略**：
- 原 `export type DownloadStatus = '...' | '...'` 删除，改为派生。
- 编译期验证：`type` 派生保证原联合类型在 TS 层完全等价，所有 `as DownloadStatus` 断言仍合法。
- 运行时验证：原 `main.ts:144 VALID_DOWNLOAD_STATUSES = new Set([...])` 改为 `new Set(DOWNLOAD_STATUSES)`，行为等价。

### 2. cookie→curl 拼接的 shlex posix 转义（簇 A #7）

**纯函数**，放 `electron/login-window.ts` 顶部，便于单测：

```ts
/**
 * 将 cookie value 转义为 shlex posix 单引号字符串内的安全形式。
 *
 * Python auth_parser 用 shlex.split(text, posix=True) 解析 curl 文本。
 * posix 模式下单引号字符串内无法直接表达 ' 字符，需用经典的 '\'' 切分技巧：
 * 闭合单引号 → 用反斜杠转义的单引号 → 重开单引号。
 *
 * 同时拒绝控制字符：cookie value 不应含 C0/DEL，出现即视为异常输入。
 */
function escapeCookieValueForShlex(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Cookie value contains control characters')
  }
  // posix 单引号转义：'...' 内的 ' 写作 '\''
  return `'${value.replace(/'/g, "'\\''")}'`
}
```

**调用点**改写（`extractAndApplyCookies` line 95-99）：
```ts
const cookieStr = cookies.map(c => `${c.name}=${escapeCookieValueForShlex(c.value)}`).join('; ')
// curl 文本整体仍用单引号包裹；cookie value 已自包装单引号
const curlText = `curl 'https://${cookieDomain}' -b '${cookieStr}' -H 'User-Agent: ${escapeCookieValueForShlex(userAgent)}'`
```

**验证矩阵**（单测）：

| cookie value | 转义后 | shlex.split 还原 |
|---|---|---|
| `abc123` | `'abc123'` | `abc123` ✓ |
| `a'b` | `'a'\''b'` | `a'b` ✓ |
| `a\b` | `'a\b'` | `a\b` ✓（单引号内 `\` 字面） |
| `a;b` | `'a;b'` | `a;b` ✓ |
| `a\x00b` | throw | — |

### 3. `withOptionalSource` helper（簇 C #3）

**位置**：`electron/validators.ts`（导出，供 main.ts 复用）。

```ts
/**
 * 可选 source 参数的统一校验+注入：
 * - source 为 undefined/null → 跳过（params 不变）
 * - source 为合法 COMIC_SOURCE 字符串 → 校验通过并写入 params.source
 * - 否则 → 抛 ValidationError
 *
 * 替换 main.ts 中 13+ 处镜像重复的 `if (source !== undefined && source !== null) {...}`。
 */
export function withOptionalSource(
  params: Record<string, unknown>,
  source: unknown,
  label: string,
): void {
  if (source === undefined || source === null) return
  const v = and(string(), oneOf(Array.from(SOURCE_VALUES)))
  assert(v, source, `${label} source`)
  params.source = source
}
```

**问题**：`SOURCE_VALUES` 当前在 `main.ts:142` 定义，validators.ts 需要访问。两个方案：
- (a) 把 `SOURCE_VALUES` / `MODE_VALUES` 上移到 `shared/types.ts`
- (b) `withOptionalSource` 接受 `allowedValues` 参数

**选 (a)**：`COMIC_SOURCES` 已在 shared/types.ts（main.ts:12 从那 import），只需新增派生的 `SOURCE_VALUES = new Set(COMIC_SOURCES)`，与 `DOWNLOAD_STATUSES` 同位置。

### 4. preload 内部 helper（簇 C #4）

preload.ts 因 sandbox 不能 import electron/validators，helper 在 preload.ts 内自包含：

```ts
function validateCredentialPair(username: unknown, password: unknown): void {
  if (typeof username !== 'string' || username.trim().length === 0 || username.length > 256) {
    throw new Error('Invalid username')
  }
  if (typeof password !== 'string' || password.trim().length === 0 || password.length > 256) {
    throw new Error('Invalid password')
  }
}

function validateComicIdAndSource(comicId: unknown, source: unknown): void {
  if (typeof comicId !== 'string' || comicId.length === 0 || comicId.length > 256) {
    throw new Error('Invalid comicId')
  }
  if (source !== undefined && source !== null && typeof source !== 'string') {
    throw new Error('Invalid source')
  }
}
```

3 个登录函数 + 3 个收藏函数收敛为 2 行调用。

### 5. PythonBridge.kill() 资源清理（簇 A #1）

```ts
kill() {
  this.isShuttingDown = true
  if (this.restartTimer) {
    clearTimeout(this.restartTimer)
    this.restartTimer = null
  }
  // 新增：清理 pending 请求，避免 Promise 悬挂
  this._clearPendingRequests('Python bridge killed')
  if (this.process) {
    this.process.kill()
    this.process = null
  }
}
```

`_clearPendingRequests` 已存在（line 68），复用即可。同时 `handleProcessFailure` line 194-198 的内联清理也改为调用 `_clearPendingRequests(message)`（簇 C #15）。

### 6. NotificationManager 静态常量（簇 B #11）

```ts
export class NotificationManager {
  // 4 个活跃态：与 shared.ACTIVE_DOWNLOAD_STATUSES 同语义，但此处不 import
  // （notification-manager 是独立模块，运行时语义一致即可，类型耦合非必要）
  private static readonly ACTIVE_STATUSES = new Set(['queued', 'downloading', 'paused', 'pausing'])
  // ...
  handleProgress(event: { taskId: string; status: string; title: string }) {
    if (NotificationManager.ACTIVE_STATUSES.has(event.status)) {
```

**为何不直接用 shared.ACTIVE_DOWNLOAD_STATUSES**：notification-manager.ts 当前不 import shared，引入会形成新的依赖边。语义同步通过测试保证（在 notification-manager.test.ts 加用例：4 个状态各自触发 activeTaskSet.add）。

### 7. 魔法数字命名（簇 B #12）

```ts
// main.ts
const STARTUP_UPDATE_CHECK_DELAY_MS = 3_000
// scheduleStartupUpdateCheck: setTimeout(..., STARTUP_UPDATE_CHECK_DELAY_MS)

// python-bridge.ts
const BACKEND_RESTART_DELAY_MS = 2_000
// handleProcessFailure: setTimeout(() => this.start(), BACKEND_RESTART_DELAY_MS)
```

## 替代方案与权衡

### A1: cookie 修复为何不选结构化传递（方案 c）

结构化传递需：
1. Python `apply_auth` 新增 `cookie_str`/`user_agent`/`domain` 参数，保留 `curl_text` 兼容旧入口
2. Electron 端 `extractAndApplyCookies` 改 IPC 调用参数
3. `tests/test_auth_parser.py` 加新参数路径用例
4. IPC 契约测试 `ipc-arity-parity.test.ts` 更新

收益是"彻底"，但扩散到 Python 层且需维护两套解析路径（curl + 结构化），违反 N3。**单边转义方案**把风险局限在 Electron 端一个纯函数，且 shlex posix 转义是 30 年成熟的 shell 转义规则，可靠。

### A2: DownloadStatus 为何用 const tuple 派生而非 enum

TS `enum` 在 `as const` 时代被认为是反模式（编译产物污染、tree-shaking 困难）。项目其他联合类型都用 string literal union，派生 `typeof X[number]` 是 idiomatic TS，零运行时开销。

### A3: preload helper 为何不与 main 共享

preload 在 sandbox 下只能 import 极少数模块（electron + 项目内纯类型/常量模块）。强行让 preload import `electron/validators.ts` 会引入 `ValidationError` 类等运行时代码，可能触发 sandbox 限制。两端校验语义对齐通过测试保证，不强求代码共享。

## 测试策略

### 新增测试

| 文件 | 用例 |
|---|---|
| `tests/unit/main/python-bridge.test.ts` | `kill()` 后 pending request 被 reject with 'Python bridge killed' |
| `tests/unit/main/python-bridge.test.ts` | `handleProcessFailure` 复用 `_clearPendingRequests`（行为等价） |
| `tests/unit/main/main.test.ts` | `WRITE_CLIPBOARD` 拒绝超长（>2M）、非字符串、空字符串 |
| `tests/unit/main/validators.test.ts` | `withOptionalSource`: undefined 跳过、null 跳过、合法值注入、非法值抛错 |
| `tests/unit/main/cookie-escape.test.ts`（新建） | `escapeCookieValueForShlex`: 5 个 value 场景 + 控制字符拒绝 |
| `tests/unit/main/notification-manager.test.ts` | 4 个 active 状态各自触发 add；completed/failed/cancelled 触发 delete |
| `tests/unit/preload/preload.test.ts` | `validateCredentialPair` / `validateComicIdAndSource` 拒绝路径 |

### 必须仍通过的现有测试

- `tests/unit/main/ipc-arity-parity.test.ts` — IPC 参数数量对称
- `tests/unit/main/ipc-channel-consistency.test.ts` — IPC 通道名一致
- `tests/unit/main/main.test.ts` — 全部现有用例（1016 行）
- `tests/test_auth_parser.py` — Python 端 curl 解析（确认转义后仍能解析）

## 时序与原子性

三个簇按依赖顺序提交：

```
Commit 1 (簇 B): shared/types.ts 常量 + 各处引用替换
   ├─ 不依赖任何其他簇
   └─ 编译期可验证类型等价

Commit 2 (簇 A): kill 清 pending + WRITE_CLIPBOARD + cookie 转义
   ├─ 依赖 Commit 1 已合并（避免冲突）
   └─ 每项独立可 revert

Commit 3 (簇 C): withOptionalSource + preload helper + 杂项
   ├─ 依赖 Commit 1（SOURCE_VALUES 上移）
   └─ 13+ 处替换需全量收敛
```

任一簇验证失败可独立 revert，不影响其他簇。
