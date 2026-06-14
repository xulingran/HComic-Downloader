# 客户端日志与错误提示系统设计文档

## 上下文

当前 HComic Downloader 的错误处理存在严重的"黑洞"问题：所有错误信息只能通过 `npm run dev` 的终端输出查看，打包后的客户端对用户完全不可见。

经调查，错误产生于三个源头，全部流向终端 stdout/stderr：

```
① Python 后端     logging.basicConfig → stderr
                   ↓ python-bridge.ts:131 转发到 Electron console
② Electron 主进程  ~17 处 console.error/warn
                   （含 python-bridge.ts:141 进程启动失败、:168 重启超限、
                     main.ts:1137 渲染进程崩溃 等致命场景）
③ React 渲染进程   useIpc.ts 统一 catch → console.error → rethrow
                   各页面再各自 catch（很多静默吞掉）
                         ↓
═══════════════════════════════════════
      终端 stdout/stderr（唯一出口）
═══════════════════════════════════════
打包后：无终端 → 黑洞，完全不可见
```

最刺眼的断点：
- `python-bridge.ts:141` 后端启动失败 → `console.error` 后后端死亡，UI 无感
- `python-bridge.ts:168` 重启超限 → 静默放弃
- `main.ts:1137` 渲染进程崩溃 → 原因永久丢失
- 各页面 `catch {}` 静默吞错 → 用户点击无反应不知何故

## 目标 / 非目标

**目标：**
- 建立客户端日志系统，Electron + Python 双进程日志统一写入 `~/.hcomic_downloader/logs/`
- 现有 `console.*` 调用零改造自动落盘（借助 electron-log 拦截）
- 客户端内对两类错误分级显示：致命错误（顶部常驻横幅）+ 操作失败（全局 Toast）
- 支持一键复制诊断信息到剪贴板，便于用户排障和上报

**非目标：**
- 自动上报日志到远程服务器（隐私风险，本期不做）
- 日志自动脱敏（会损失排障信息，仅复制前提示用户）
- 客户端内日志查看面板（层次 C，本期不做，留待后续）
- 改造全部页面 catch（渐进式，本期只改关键路径）

## 设计决策

### 1. 日志目录：方案甲（`~/.hcomic_downloader/logs/`）

Electron 和 Python 双进程日志统一写入 `~/.hcomic_downloader/logs/`：

```
~/.hcomic_downloader/logs/
├ main.log      ← Electron (electron-log)
└ python.log    ← Python (RotatingFileHandler)
```

**理由：**
- Python 后端已在用 `~/.hcomic_downloader/`（config.json、各 *.db 都在此），目录已存在且熟悉
- 双进程日志同目录，便于对照时间线排查跨进程问题
- 不需要跨进程通信协商路径——Electron 用 `os.homedir()`，Python 用 `os.path.expanduser("~")`，两边天然一致
- 不采用 `app.getPath('logs')`：那是 Electron 官方推荐位置，但会和 Python 数据目录分离

**实现：**
```ts
import { homedir } from 'os'
const LOG_DIR = path.join(homedir(), '.hcomic_downloader', 'logs')
// fs.mkdirSync(LOG_DIR, { recursive: true }) 在初始化时调用
```

### 2. 日志库：electron-log（零改造拦截）

引入 `electron-log` 作为依赖，利用其 console 拦截能力，让现有 17 处 `console.*` 自动落盘，无需逐个修改。

**初始化代码（main.ts 顶部，约 5 行）：**
```ts
import log from 'electron-log'
import { homedir } from 'os'

log.transports.file.resolvePath = () =>
  path.join(homedir(), '.hcomic_downloader', 'logs', 'main.log')
log.transports.file.maxSize = 5 * 1024 * 1024  // 5MB 轮转
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
log.errorHandler.startCatching()  // 未捕获异常/rejection 自动落盘
Object.assign(console, log.functions)  // 接管现有 console.*
```

**关键能力：**
- `Object.assign(console, log.functions)` 让 `console.error(...)` 同时写终端和文件
- `log.errorHandler.startCatching()` 捕获未处理的异常和 Promise rejection，即使代码漏写 try/catch 也不丢日志
- 内置文件轮转（超过 maxSize 自动归档）

### 3. Python 日志双写：方案 A1（stderr + FileHandler）

在 `ipc_server.py:16` 的 `logging.basicConfig` 基础上增加 `RotatingFileHandler`，保留 stderr 输出作为冗余。

**理由（选 A1 而非 A2/A3）：**
- A2（仅 stderr 由 electron-log 统一落盘）更简单，但 Python 崩溃时若 stderr 都来不及输出，日志就丢了
- A3（关 stderr 转发）会让 electron-log 那份失去 Python 内容，丧失对照能力
- A1 冗余但最稳——即使 Python 进程瞬间崩溃，FileHandler 已刷盘的日志仍保留

**实现（ipc_server.py 顶部）：**
```python
from logging.handlers import RotatingFileHandler
import os

CONFIG_DIR = os.path.join(os.path.expanduser("~"), ".hcomic_downloader")
LOG_DIR = os.path.join(CONFIG_DIR, "logs")
os.makedirs(LOG_DIR, exist_ok=True)

_file_handler = RotatingFileHandler(
    os.path.join(LOG_DIR, "python.log"),
    maxBytes=5 * 1024 * 1024,
    backupCount=2,
    encoding="utf-8",
)
_file_handler.setFormatter(logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(), _file_handler],
)
```

**注意：** stderr 的 Python 日志会被 `python-bridge.ts:131` 转发到 Electron console，再被 electron-log 落入 `main.log`。因此 `main.log` 会包含 Python 日志（冗余副本），`python.log` 是独立副本——这是 A1 的预期行为，不是 bug。

### 4. 错误分级与 UI 形态

```
┌──────────────┬────────────────────────┬────────────────────────────────┐
│ 级别          │ 代表场景                │ UI 形态                         │
├──────────────┼────────────────────────┼────────────────────────────────┤
│ 🔴 致命 Fatal │ 后端进程起不来          │ 顶部常驻横幅 (FatalBanner)      │
│              │ 后端重启超限            │ 不阻塞操作，带复制/重启/关闭按钮 │
├──────────────┼────────────────────────┼────────────────────────────────┤
│ 🟡 操作失败   │ 下载失败                │ 全局 Toast（复用现有 Toast 组件）│
│  Error       │ 收藏/历史操作失败        │ 顶部居中，4 秒自动消失           │
│              │ 登录失败                │                                │
├──────────────┼────────────────────────┼────────────────────────────────┤
│ ⚪ 静默       │ 参数校验 warning        │ 仅日志，不打扰用户              │
│  Log-only    │ 非关键配置同步失败       │                                │
└──────────────┴────────────────────────┴────────────────────────────────┘
```

**为什么致命用横幅而非对话框：** 对话框会阻塞用户去设置页查日志/改代理，而 B2 横幅允许用户在 app 无法正常工作的情况下仍能自救。

### 5. 致命错误：方案 B2（顶部横幅）

**数据流：**
```
PythonBridge 失败（spawn error / 重启超限）
  ↓ main.ts 捕获
  ↓ mainWindow.webContents.send('fatal:error', {message, detail, kind})
  ↓ preload.ts onFatalError(callback) 订阅
  ↓ useFatalErrorStore (Zustand)
  ↓ <FatalBanner/> 渲染常驻横幅
```

**FatalBanner 行为：**
- 常驻：不自动消失，直到用户点 [×] 关闭或后端恢复
- 不阻塞：横幅在内容区顶部，页面仍可滚动、切菜单
- 单例：新错误覆盖旧的
- 按钮：[复制诊断日志]（带敏感信息确认）[重启应用]（可选，后期）[×]

### 6. 操作失败：全局 Toast store

现有 `Toast.tsx` 是单例硬编码在 App.tsx 服务 SFW 提示。改造为 store 驱动的全局 Toaster：

**新建 `src/stores/useToastStore.ts`（Zustand）：**
```ts
interface ToastState {
  message: string
  type: 'info' | 'error' | 'success'
  visible: boolean
}
interface ToastStore {
  toast: ToastState
  show: (message: string, type?: ToastState['type']) => void
  error: (message: string) => void  // show(message, 'error') 的快捷方式
  info: (message: string) => void
  dismiss: () => void
}
```

**新建 `src/components/common/Toaster.tsx`：** 消费 store，渲染改造后的 Toast（支持 error 红色样式）。

**App.tsx 改动：** 移除现有硬编码 SFW Toast，改为 `<Toaster/>`。SFW 提示改用 `useToastStore.show()`。

**各页面渐进式改造：** 关键路径（下载、收藏、历史、登录）的 catch 块从 `console.error` 改为 `useToastStore.error(友好文案)`。本任务仅覆盖关键路径，其余页面留待后续。

### 7. 一键复制诊断信息

**新增 IPC 通道 `log:get-diagnostics`（Electron 自处理，不经 Python）：**

主进程读取日志文件尾部 + 环境信息，返回结构化字符串。渲染进程调用 `navigator.clipboard.writeText()`。

**报告格式：**
```
HComic Downloader 诊断报告
═══════════════════════════════════════
## 环境
- 版本: 1.2.3
- 平台: win32 10.0.26200 x64
- Electron: 28.x.x
- 时间: 2026-06-13 14:30:00

## 主进程日志（最近 200 行）
[2026-06-13 14:29:50.123] [error] Failed to start Python process: ...
...

## Python 后端日志（最近 200 行）
[2026-06-13 14:29:48] [ERROR] ipc_server: ...
═══════════════════════════════════════
```

**降级：** 日志文件不存在时显示"(日志文件不存在)"，读取失败显示"(读取失败)"，不阻断整体报告。

**隐私提示：** 复制前弹出确认，提示日志可能含 cookie/搜索词等敏感信息。

## 风险 / 缓解

| 风险 | 缓解 |
|------|------|
| electron-log 在打包后路径解析异常 | 用 `os.homedir()` 显式拼路径，不依赖 electron-log 默认的 getPath |
| 日志文件无限增长 | electron-log maxSize 轮转（5MB）+ Python RotatingFileHandler（5MB, backupCount=2） |
| 日志含敏感信息（cookie/搜索词） | 不做自动脱敏（会损失排障价值），复制前提示用户 |
| Python stderr 转发到 main.log 造成重复 | 这是 A1 预期行为，python.log 是独立完整副本，main.log 的重复部分可接受 |
| 改造 Toast 影响 SFW 提示逻辑 | 用 useToastStore 接管 SFW 提示，保持原有交互不变 |
| 致命横幅在 mainWindow 未就绪时发送 | main.ts 在 send 前检查 mainWindow 是否存在，复用现有 onUpdateAvailable 的安全发送模式 |
