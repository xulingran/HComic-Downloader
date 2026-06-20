## 上下文

HComic Downloader 启动涉及 Electron 主进程（窗口创建、IPC handler 注册、PythonBridge spawn）和 Python 后端（`IPCServer.__init__` 串行初始化 Config、解析器、下载管理器、3 个线程池、4 个 DB、handler 参数预计算）。

commit `75b2aa8`（冷启动优化）后的现状：
- 窗口 `show: true` 立即显示，用户立刻看到 `index.html` 内联骨架屏（spinner + logo + 固定文案"HComic Downloader 启动中…"）
- PythonBridge spawn Python 子进程，ready gate 在 Python 首次输出 stdout（即首个 RPC 响应）时 resolve
- 渲染进程 React 挂载后，`createRoot().render(<App/>)` **整体替换**骨架屏 DOM
- 启动全程无进度反馈：骨架屏文案固定，用户无法判断应用走到哪一步

约束：
- `ipc-startup-async` spec 定义了 ready gate 契约——ready 必须在 Python 能处理 RPC 时 resolve。本设计**禁止**修改此契约。
- Python 的 `logger.info(...)` 走 stderr（`StreamHandler()`），stdout 仅用于 JSON-RPC 响应。
- 已有 `FatalBanner`（`src/components/FatalBanner.tsx`）由 `useFatalErrorStore` 驱动，在 PythonBridge `onFatal`（重启超限）时显示。

## 目标 / 非目标

**目标：**
- 启动期显示百分比进度条 + 当前阶段中文文案，文案真实反映正在执行的步骤
- 进度信号跨 React 挂载期连续（index.html 骨架屏 → React `<StartupScreen>` 视觉一致）
- 不破坏 `ipc-startup-async` 的 ready gate 契约
- 快启动快速跑完、慢启动停在当前步骤（不强制最小时长）
- Python 启动失败时进度条自然被 FatalBanner 覆盖

**非目标：**
- 不预估"剩余时间"（启动耗时受机器状态影响大，预估不准反而误导）
- 不在 Python 启动失败时让进度条自己显示错误（交给 FatalBanner）
- 不修改 `ipc-startup-async`、`startup-skeleton-screen`、`backend-restart-exceeded` 的现有规范
- 不为非首次启动（单实例锁命中、第二窗口）显示进度条
- 不对 dev/prod 模式做差异化进度行为（两种模式进度信号链路一致）

## 决策

### 决策 1：进度信号走 stderr，不引入 stdout 握手协议

**选择**：Python 在 `IPCServer.__init__` 各阶段往 stderr 写结构化进度行 `PROGRESS:<percent>:<label>`，PythonBridge 解析后转发。

**理由**：
- stderr 已是 Python 日志通道（`StreamHandler` 写 stderr），复用现有管道零基础设施成本
- 不动 stdout，ready gate 契约（首个 stdout = 首个 RPC 响应 = ready）保持不变，`ipc-startup-async` spec 零修改
- stderr 行解析在 PythonBridge 已有逐行转发逻辑（`python-bridge.ts:172-184`），只需在循环内加 `PROGRESS:` 前缀识别

**考虑过的替代方案**：
- *改 ready 判定 + Python `__init__` 各步通过 stdout 推 `startup_progress` 通知*：破坏 ready gate 简洁契约，需修改 `ipc-startup-async` spec，且首个 stdout 不再可靠表示"能处理 RPC"。否决。
- *纯 Electron 侧按时间模拟阶段*：文案不真实，可能和 Python 实际进度不符。否决。

### 决策 2：预分配权重百分比，CSS transition 兜底流畅感

**选择**：按各阶段真实耗时分配权重（见下表），CSS `transition: width 0.4s ease` 让进度条在信号间隔期平滑爬行。

| 阶段 | 权重区间 | 信号来源 |
|------|---------|---------|
| 窗口 + Electron 初始化 | 0–10% | Electron `main.ts` 本地触发 |
| Python spawn 返回 | 10–15% | PythonBridge `start()` spawn 后 |
| Config.load | 15–25% | Python `_emit_progress` |
| MultiSourceParser | 25–35% | Python `_emit_progress` |
| 下载管理器 + downloader | 35–50% | Python `_emit_progress` |
| 线程池 ×3 | 50–65% | Python `_emit_progress` |
| DB ×4 + migration | 65–85% | Python `_emit_progress` |
| handler 参数注册 | 85–95% | Python `_emit_progress` |
| 首屏就绪（React 挂载 + 首个 IPC 完成） | 95–100% | 渲染进程 `useStartupProgress` |

**理由**：
- 权重按实测耗时分配，百分比诚实反映进度位置
- CSS transition 让进度条视觉流畅，即使两信号间隔 200ms 也是平滑爬行而非跳变
- 用户已明确选择"方案 Q：快就快、慢就慢"，不强制最小时长——快启动就快速跑完，CSS transition 让快速跑完看起来不突兀

**考虑过的替代方案**：
- *粗粒度阶段列表（✓/◉/○）*：用户明确选择百分比进度条。否决。
- *强制最小时长（方案 P）*：牺牲"快"的诚实反馈。否决。

### 决策 3：React 挂载后由 `<StartupScreen>` 组件接管骨架屏渲染

**选择**：`index.html` 保持静态骨架屏（React 挂载前显示）；React 挂载后，App 顶层判断"启动未完成" → 渲染视觉一致的 `<StartupScreen>`（含进度条），收到 100% 或首屏就绪后淡出。

**理由**：
- 当前 `createRoot().render(<App/>)` 整体替换 `#root`，React 挂载瞬间骨架屏消失。若进度条只在 index.html 里，挂载那一刻进度条会"跳"或消失，不连续。
- 让 React 挂载后继续渲染同款 `<StartupScreen>`，进度条可一直显示到首屏真实可见，视觉连续。
- `<StartupScreen>` 视觉与 index.html 骨架屏完全一致（同 logo、同 spinner、同进度条样式），用户感知不到切换。

**考虑过的替代方案**：
- *纯 index.html 方案（React 不碰骨架屏）*：React 挂载时进度条消失或跳变，不连续。否决。

### 决策 4：`_emit_progress` 封装为 IPCServer 实例方法，stderr 直写

**选择**：在 `IPCServer` 新增 `_emit_progress(self, percent: int, label: str) -> None` 方法，直接 `print(f"PROGRESS:{percent}:{label}", file=sys.stderr, flush=True)`。在 `__init__` 各阶段调用。

**理由**：
- 复用 `sys.stderr`，不走 logger（logger 可能被配置过滤或格式化，直接 print 保证行格式可控）
- `flush=True` 确保立即送达，不被缓冲延迟
- 实例方法便于测试 mock，也便于后续扩展（如加阶段 ID）

**格式约定**：
```
PROGRESS:<percent>:<label>
```
- `percent`：0-100 整数
- `label`：中文文案，不含冒号（避免解析歧义）
- 单行，无前导空格

### 决策 5：PythonBridge stderr 解析——识别 `PROGRESS:` 前缀，不转发到日志

**选择**：在 `python-bridge.ts:172-184` 的 stderr 逐行处理循环中，识别 `PROGRESS:` 前缀的行，解析 percent 和 label，调用注入的 `onStartupProgress` 回调；非 PROGRESS 行保持原行为（`console.log('[Python]', line)` 转发日志）。

**理由**：
- 进度行是协议数据，不是日志，混入 `main.log` 会污染诊断报告
- 解析失败（格式错误）的行降级为普通日志转发，不抛错（防御性）

### 决策 6：渲染进程订阅模型——`useStartupProgress` hook + 状态机

**选择**：新增 `useStartupProgress` hook，订阅 `STARTUP_PROGRESS` IPC 通道，维护 `{ percent, label, done }` 状态。App 顶层根据 `done` 决定渲染 `<StartupScreen>` 还是真实内容。

**状态机**：
```
初始: { percent: 0, label: '准备启动…', done: false }
  │
  ├─收到 STARTUP_PROGRESS {percent, label}
  │   ├─percent < 100 → 更新 {percent, label}
  │   └─percent >= 100 → 更新并标记 done
  │
  └─收到 useFatalErrorStore.error 非 null → 标记 done（让 FatalBanner 接管）
```

**理由**：
- 订阅 `useFatalErrorStore` 实现"启动失败时进度条让位 FatalBanner"——error 非 null 即 `done`，App 不再渲染 StartupScreen，顶层 FatalBanner 自然显示
- `done` 由两个信号驱动：进度达 100% 或致命错误，任一触发即结束启动态

## 风险 / 权衡

**[风险] Python `_emit_progress` 输出格式被未来改动破坏 → PythonBridge 解析失败**
→ 缓解：解析失败的行降级为普通日志转发，不抛错；Python 侧 `_emit_progress` 加单元测试锁定格式契约；PythonBridge 解析逻辑加单测覆盖正常/异常行。

**[风险] 进度权重与实际耗时偏差大（如某机器 Config.load 特别慢）**
→ 缓解：权重按 commit `75b2aa8` 设计文档的实测耗时分配，已具有代表性；CSS transition 让进度条在单个阶段内也能缓慢爬行（即使该阶段耗时超过预期，进度条停在该区间不会显得"卡死"，因为有文案说明当前步骤）。

**[风险] React 挂载慢导致 `<StartupScreen>` 显示滞后，index.html 骨架屏与 React 版之间出现闪烁**
→ 缓解：`<StartupScreen>` 视觉与 index.html 骨架屏完全一致（同 DOM 结构、同 CSS、同 logo），切换瞬间用户无感知；React 挂载后立即读取已缓存的进度状态（IPC 事件在 React 挂载前就到达的话，由 `useStartupProgress` 内部缓存最新值保证不丢失）。

**[权衡] 进度信号走 stderr 而非专用 IPC 通道**
→ 接受：stderr 已是 Python 日志通道，复用零成本；解析逻辑局部（仅 PythonBridge 一处）；缺点是 stderr 行格式是隐式契约，但通过单测 + 文档锁定。

**[权衡] 不预估剩余时间**
→ 接受：用户已选择"快就快、慢就慢"，预估不准（受机器状态影响）反而误导；百分比 + 当前步骤文案已足够提供"走到哪了"的反馈。

**[权衡] dev/prod 模式进度行为一致**
→ 接受：dev 模式 Python 启动更慢（热重载），进度条行为一致意味着 dev 模式下进度条会停在 Python 阶段更久，但这正是诚实反馈；不做差异化避免维护两套逻辑。

## 迁移计划

**部署**：纯新增功能，无数据迁移、无配置迁移、无破坏性变更。

**回滚策略**：
- 若需回滚，删除以下新增即可恢复原静态骨架屏行为：
  - `python/ipc_server.py` 中的 `_emit_progress` 方法及各调用点
  - `electron/python-bridge.ts` 中的 `PROGRESS:` 解析逻辑
  - `index.html` 中的进度条 DOM/CSS/JS
  - `src/components/StartupScreen.tsx`、`src/hooks/useStartupProgress.ts`
  - `src/App.tsx` 中的 `<StartupScreen>` 渲染分支
  - `shared/types.ts` 中的 `STARTUP_PROGRESS` 常量
- 回滚不影响 `ipc-startup-async`、`startup-skeleton-screen` 等现有功能（本变更未修改它们）

## 待解决问题

无——所有关键技术抉择已通过探索阶段与用户对齐：
- 进度形态：百分比进度条（非阶段列表）
- 流畅策略：CSS transition，不强制最小时长（方案 Q）
- Python 改动：轻度（仅 `_emit_progress` 插桩）
- 信号通道：stderr（不动 ready gate）
- 失败衔接：FatalBanner
- 边界情况：dev/prod 一致、非首次启动不显示
