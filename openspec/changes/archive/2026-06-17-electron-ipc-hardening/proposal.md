# Proposal: electron-ipc-hardening

## 变更 ID
electron-ipc-hardening

## 模式
spec-driven

## 为什么

针对代码审查在 Electron 端发现的 14 项问题（2 Critical + 7 Important + 5 Minor）进行集中加固。这些问题集中在 IPC 边界防御缺口（kill 未清 pending、WRITE_CLIPBOARD 缺主进程校验、cookie 拼接未转义）、跨层常量重复（DownloadStatus/ImageQuality 字面量在 main/preload/src 4-8 处硬编码）、DRY 违规（可选 source 校验模式在 main.ts 重复 13+ 次）。不修复会导致 Promise 悬挂、契约缺口、状态字符串不同步等隐患。

## 变更内容

覆盖 IPC 边界防御、跨层常量单一来源、DRY 抽取三个内聚簇，全部限定在 `electron/` + `shared/types.ts` + 少量前端字面量替换，**不触碰 login-window 业务逻辑**（推迟到独立变更 `login-window-refactor`）。

## 背景与动机

源自对 `electron/` 全部 10 个 .ts 文件（约 3300 行）的代码审查。问题集中在三类：

1. **防御深度缺口**：`kill()` 不清 pending 导致 Promise 悬挂；`WRITE_CLIPBOARD` 主进程未独立校验；login-window 拼接 cookie 到 curl 文本时未转义单引号，Python 端用 `shlex.split(posix=True)` 解析会被破坏。
2. **跨层常量重复**：`DownloadStatus` 字面量集合、`IMAGE_QUALITIES` 数组在 `main.ts`/`preload.ts`/`src/` 至少 4-8 处重复硬编码，任一处增删状态都需要多点同步，存在不同步风险。
3. **DRY 重复**：`source !== undefined && source !== null` 可选参数校验模式在 `main.ts` 重复 13+ 次；preload 端 username/password/comicId+source 校验在 3 个登录函数和 3 个收藏函数中镜像重复 6 次。

## 目标

- **G1**：补齐 `kill()` 的 pending 清理，消除 Promise 悬挂与潜在内存泄漏。
- **G2**：补齐 `WRITE_CLIPBOARD` 主进程权威校验，与项目其他 IPC handler 的"主进程必校验"契约对齐。
- **G3**：消除 cookie→curl 拼接的 shlex 解析风险。
- **G4**：把 `DownloadStatus` 字面量集合、`IMAGE_QUALITIES`、`ACTIVE_DOWNLOAD_STATUSES` 抽到 `shared/types.ts` 作为单一来源，`electron/` 与 `src/` 复用。
- **G5**：抽取 `withOptionalSource` / preload 凭据校验 helper，消除 13+ 处和 6 处镜像重复。
- **G6**：命名残留魔法数字（`STARTUP_UPDATE_CHECK_DELAY_MS`、`BACKEND_RESTART_DELAY_MS`），把 NotificationManager 的 `activeStatuses` Set 提为静态常量。
- **G7**：所有改动不改变 IPC 通道名、参数顺序、Python 后端契约；现有测试全部通过；为新增 helper 补单元测试。

## 非目标

- **N1**：不重构 `login-window.ts` 的 `openLoginWindow` / `extractAndApplyCookies`（God Function 拆分）→ 推迟到 `login-window-refactor` 变更，因当前 login-window **无单元测试**，需先补测试再重构。
- **N2**：不建立 sandbox:true 回归机制（login-window sandbox:false 是已知妥协）→ 推迟到独立工程实践提案。
- **N3**：不改 IPC 通道契约、不改 Python `apply_auth` 签名（cookie 转义仅在 Electron 端单边修复）。
- **N4**：不触碰 `csp-relaxed-registry.ts` / `log-init.ts`（审查中无问题）。
- **N5**：不重命名 `VALID_DOWNLOAD_STATUSES`（保留 main.ts 内的本地别名，仅改为从 shared 派生）。

## 方案概览

```
   ┌─────────────────────────────────────────────────────────────┐
   │                    shared/types.ts                          │
   │   + DOWNLOAD_STATUSES  (常量数组，单一来源)                  │
   │   + ACTIVE_DOWNLOAD_STATUSES (子集常量)                     │
   │   + IMAGE_QUALITIES  (常量数组)                              │
   │   + IMAGE_QUALITY_OPTIONS (派生 readonly tuple)             │
   └───────────────┬─────────────────────────────────────────────┘
                   │ 派生 / 复用
        ┌──────────┴───────────┐
        ▼                      ▼
   ┌─────────────┐        ┌─────────────────┐
   │ electron/   │        │ src/            │
   │  main.ts    │        │  ComicReaderModal.tsx
   │  preload.ts │        │  pages/*.tsx    │
   │  notif-mgr  │        │  hooks/useIpc.ts│
   │  validators │        │  ...            │
   └──────┬──────┘        └────────┬────────┘
          │                        │
          ▼                        ▼
   ┌──────────────────────────────────────────┐
   │  electron/validators.ts                  │
   │   + withOptionalSource helper            │
   │   + validateCredentialPair (共享 helper) │
   └──────────────────────────────────────────┘
```

## 关键设计决策

### D1: cookie 转义用单边修复（方案乙'），不改 Python 接口

**背景**：`login-window.ts:99` 拼接 `curl 'https://${domain}' -b '${cookieStr}' -H 'User-Agent: ${ua}'`，Python 端 `auth_parser.py:38` 用 `shlex.split(text, posix=True)` 解析。

**决策**：**拒绝**（c）结构化传递方案（需改 `apply_auth` 签名 + IPC 契约 + Python 解析路径，扩散成本高，违反 N3）；**采用**（b）转义方案的强化版：
- 拼接前对 cookie value 中的 `'` 用 shlex posix 转义规则处理：把单引号字符串切分，每个 `'` 替换为 `'\''`。
- 由于 cookie value 在 RFC 6265 实际很少含 `'`（DQUOTE 和控制字符更常见），同时校验拒绝含控制字符的 cookie value（防御纵深）。
- 保持 Python `apply_auth(curl_text, source)` 签名不变，shlex 解析路径不变。

**权衡**：单边修复意味着 Python 端 `auth_parser` 若被其他入口（手动粘贴 curl）调用仍可能遇到未转义输入，但那属于用户输入范畴，shlex 本身会抛错而非静默错误，可接受。

### D2: DownloadStatus 派生而不重命名

**决策**：在 `shared/types.ts` 新增：
```ts
export const DOWNLOAD_STATUSES = ['queued','downloading','pausing','paused','completed','failed','cancelled'] as const
export type DownloadStatus = typeof DOWNLOAD_STATUSES[number]
export const ACTIVE_DOWNLOAD_STATUSES = new Set(['queued','downloading','pausing','paused'] as const)
```
- main.ts:144 的 `VALID_DOWNLOAD_STATUSES` 改为 `new Set(DOWNLOAD_STATUSES)`（派生，不重命名以减少 diff）。
- main.ts:397 / preload.ts / src 下 8+ 处 `status === 'downloading' || ...` 改用 `ACTIVE_DOWNLOAD_STATUSES.has(status)`。
- NotificationManager:31 的字面量 Set 改为 `ACTIVE_DOWNLOAD_STATUSES`。

**权衡**：`ACTIVE_DOWNLOAD_STATUSES` 用 Set 实例（不是 readonly tuple），不可直接作为类型守卫的判别联合，但项目内用途都是运行时 `.has()` 查询，无类型层需求。

### D3: 抽 helper 而非改 IPC handler 签名

**决策**：`withOptionalSource(params, source, label)` 仅做"校验+注入"，handler 签名不变：
```ts
function withOptionalSource(
  params: Record<string, unknown>,
  source: unknown,
  label: string,
): void {
  if (source !== undefined && source !== null) {
    assert(and(string(), oneOf(Array.from(SOURCE_VALUES))), source, `${label} source`)
    params.source = source
  }
}
```
handler 改为：
```ts
const params: Record<string, unknown> = { query, mode, page }
withOptionalSource(params, source, 'search')
```
13+ 处一次性收敛。

### D4: preload 校验 helper 与 main 共享

**决策**：preload 的 username/password/comicId+source 校验抽取为本地函数（preload 因 sandbox 限制不能 import electron/validators，只能在 preload.ts 内自包含）。`validateCredentialPair`、`validateComicIdSource` 作为 preload.ts 内部私有函数；main 端的等价 helper 放 `electron/validators.ts` 导出，两端不强行共享代码（避免 preload/main 耦合），但语义对齐。

## 影响面

| 文件 | 改动类型 | 风险 |
|---|---|---|
| `shared/types.ts` | +常量、DownloadStatus 改派生 | 低（纯增量） |
| `electron/main.ts` | kill、WRITE_CLIPBOARD、常量引用、helper 调用、cookie 转义改在 login-window | 中（13+ 处替换） |
| `electron/preload.ts` | 内部 helper、IMAGE_QUALITIES 引用 | 中（6+ 处替换） |
| `electron/python-bridge.ts` | `kill()` 加 pending 清理、`handleProcessFailure` 复用 `_clearPendingRequests`、魔法数字命名 | 低 |
| `electron/notification-manager.ts` | activeStatuses 提为静态常量 | 低 |
| `electron/validators.ts` | +`withOptionalSource` 导出 | 低 |
| `electron/login-window.ts` | cookie 拼接前转义+控制字符校验 | 中（仅 #7，不动业务逻辑） |
| `src/components/ComicReaderModal.tsx` | `IMAGE_QUALITIES` 引用 | 低 |
| `src/hooks/useIpc.ts` | `ACTIVE_DOWNLOAD_STATUSES.has` | 低 |
| `src/pages/{Download,Favourites,History,Search}Page.tsx` | `ACTIVE_DOWNLOAD_STATUSES.has` | 低 |
| `tests/unit/main/*.test.ts` | +新 helper 测试、+kill 清 pending 测试、+cookie 转义测试 | 必需 |

## 验证策略

1. **现有测试全绿**：`pytest` / `npm test` / `npx tsc --noEmit` / `npm run lint` / `npm run lint:py` / `black --check .`。
2. **新增测试覆盖**：
   - `python-bridge.test.ts`：`kill()` 后 pending 请求被 reject。
   - `main.test.ts`：`WRITE_CLIPBOARD` 拒绝超长/非字符串。
   - `login-window`（在第二个变更补完整测试前，本次至少加 cookie 转义的纯函数单测）。
   - `validators.test.ts`：`withOptionalSource` 注入与拒绝路径。
3. **IPC 契约对称测试**：现有 `ipc-arity-parity.test.ts` / `ipc-channel-consistency.test.ts` 必须仍通过。
4. **手动验证**：cookie 含特殊字符（`'`、空格、`;`）的 jmcomic 登录流程仍能 apply_auth 成功（如有条件）。

## 风险与回滚

- **R1**：`shared/types.ts` 改动可能影响前端类型推断。缓解：DownloadStatus 改为 `typeof DOWNLOAD_STATUSES[number]` 是等价类型，编译期可验证。
- **R2**：13+ 处 helper 替换可能漏改。缓解：grep `source !== undefined && source !== null` 全量收敛，提交前搜索确认零残留。
- **R3**：cookie 转义若实现错误会破坏现有登录流程。缓解：转义逻辑抽为纯函数 `escapeCookieValueForShlex(v)` 并加单测覆盖 `'`/`\`/`;`/空格。
- **回滚**：所有改动按簇分提交（A/B/C 三个 commit），任一簇出问题可单独 revert。
