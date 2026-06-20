## 为什么

当前应用启动时只显示一个静态骨架屏（spinner + logo + 固定文案"HComic Downloader 启动中…"），从窗口可见到首屏真实内容之间，用户看不到任何进度反馈。虽然 commit `75b2aa8` 的冷启动优化已把首屏感知延迟压到 ~1.5s，但 Python 后端 spawn、`IPCServer.__init__`（Config 加载、下载管理器、3 个线程池、多个 DB 初始化）这段"看不见的黑盒"仍然存在，用户无法判断应用是在工作还是卡死。

引入启动进度条和具体启动项文案，可以让用户在等待期间获得持续的视觉反馈，明确"应用正在做什么、走到哪一步了"。

## 变更内容

- **新增启动进度反馈通道**：Python 后端在 `IPCServer.__init__` 各阶段经 stderr 输出结构化进度行（`PROGRESS:<percent>:<label>`），Electron 主进程的 PythonBridge 解析后通过新的 `STARTUP_PROGRESS` IPC 通道转发到渲染进程
- **骨架屏增加进度条 UI**：`index.html` 内联骨架屏新增进度条 DOM（百分比 + 当前阶段文案），由原生 JS 在 React 挂载前更新；React 挂载后由同款 `<StartupScreen>` 组件接管渲染，保证视觉连续
- **进度信号走 stderr，零侵入 ready gate 契约**：不动 `ipc-startup-async` spec，ready gate 仍在 Python 首个 RPC 响应时 resolve
- **预分配权重百分比 + CSS transition 平滑**：进度按各阶段真实耗时分配权重，CSS `transition: width` 让进度条在信号间隔期平滑爬行；快启动就快速跑完，慢启动就停在当前步骤（不强制最小时长）
- **启动失败衔接 FatalBanner**：Python 启动失败/重启超限时，进度条自然被已有的 `FatalBanner` 覆盖，无需特殊处理

## 功能 (Capabilities)

### 新增功能
- `startup-progress-feedback`: 启动期进度反馈能力，覆盖进度信号的产生（Python stderr）、转发（Electron bridge + IPC 通道）、消费与渲染（骨架屏 + React 组件）全链路，以及启动失败时的衔接行为

### 修改功能
（无 —— 本变更不改变现有 `startup-skeleton-screen`、`ipc-startup-async`、`backend-restart-exceeded` 的规范级行为，仅在其上叠加新功能）

## 影响

**受影响代码**：
- `python/ipc_server.py` — `IPCServer.__init__` 各阶段插桩 `_emit_progress()`，新增辅助方法（约 +15 行）
- `electron/python-bridge.ts` — stderr 处理逻辑（`start()` 内，约第 172-184 行）识别 `PROGRESS:` 前缀行，解析后 `webContents.send('STARTUP_PROGRESS', ...)`，不转发到日志（约 +20 行）
- `electron/main.ts` — 窗口就绪时报初始进度（约 +5 行）
- `electron/preload.ts` — 暴露 `onStartupProgress` 订阅 API（约 +3 行）
- `index.html` — 骨架屏加进度条 DOM + CSS + 原生 JS 监听逻辑（约 +30 行）
- `src/components/StartupScreen.tsx` — 新增 React 版同款骨架屏 + 进度条（约 80 行）
- `src/hooks/useStartupProgress.ts` — 新增 hook，订阅 `STARTUP_PROGRESS` IPC + 状态机（约 50 行）
- `src/App.tsx` — 启动未完成时渲染 `<StartupScreen>`（约 +10 行）
- `shared/types.ts` — 新增 `STARTUP_PROGRESS` 通道常量与类型（约 +5 行）

**受影响规范**：
- 无规范级行为变更（不修改 `ipc-startup-async`、`startup-skeleton-screen`、`backend-restart-exceeded`）

**受影响测试**：
- 新增 bridge stderr 解析单测、`useStartupProgress` hook 状态机测试、`StartupScreen` 渲染测试、`ipc_server._emit_progress` 单测

**依赖**：无新增外部依赖，全部基于现有 `framer-motion`、Tailwind、Electron IPC、Python stdio

**约束**：
- 进度信号走 stderr，不污染 stdout JSON-RPC 通道
- 不破坏 `ipc-startup-async` 的 ready gate 契约
- 进度文案必须真实反映当前步骤，禁止虚构阶段
