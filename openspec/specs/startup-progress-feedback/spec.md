### 需求:启动期进度信号产生

Python 后端在 `IPCServer.__init__` 各初始化阶段必须经 stderr 输出结构化进度行，格式必须为 `PROGRESS:<percent>:<label>`，其中 `percent` 为 0-100 的整数，`label` 为不含冒号的中文文案。进度行必须立即 flush，不得被缓冲延迟。进度行的 percent 必须按各阶段真实耗时分配的权重单调递增，禁止回退。进度行禁止写入 stdout（stdout 仅用于 JSON-RPC 响应）。

#### 场景:Config 加载完成时输出进度
- **当** `IPCServer.__init__` 执行完 `Config.load()` 后
- **那么** stderr 输出 `PROGRESS:25:配置已加载`，且该行立即送达（flush=True）

#### 场景:各初始化阶段按权重输出进度
- **当** `IPCServer.__init__` 依次执行 MultiSourceParser 构造、下载管理器初始化、线程池创建、DB 初始化、handler 参数注册
- **那么** 各阶段完成后 stderr 分别输出对应权重的进度行（如 `PROGRESS:35:解析器已就绪`、`PROGRESS:50:下载引擎已就绪`、`PROGRESS:65:线程池已就绪`、`PROGRESS:85:数据库已就绪`、`PROGRESS:95:准备就绪`），且 percent 严格递增

#### 场景:进度行不污染 stdout JSON-RPC 通道
- **当** Python 后端输出任意进度行
- **那么** 该行必须出现在 stderr，stdout 必须保持仅含 JSON-RPC 响应，ready gate 契约（首个 stdout 即首个 RPC 响应）不得受影响

### 需求:Electron 主进程转发进度信号

PythonBridge 必须解析 Python 子进程 stderr 中的 `PROGRESS:` 前缀行，提取 percent 和 label，通过 `STARTUP_PROGRESS` IPC 通道转发到渲染进程。非 `PROGRESS:` 前缀的 stderr 行必须保持原有行为（逐行 `console.log('[Python]', line)` 转发到日志）。格式错误的 `PROGRESS:` 行（如 percent 非整数、缺少 label）必须降级为普通日志转发，禁止抛错中断启动。窗口创建就绪时 Electron 主进程必须本地触发初始进度（约 10%）以反映"窗口已就绪"。

#### 场景:PythonBridge 解析有效进度行并转发
- **当** PythonBridge 从 Python stderr 收到 `PROGRESS:50:下载引擎已就绪`
- **那么** PythonBridge 通过 `webContents.send('STARTUP_PROGRESS', { percent: 50, label: '下载引擎已就绪' })` 转发到渲染进程，且该行不写入 `main.log`

#### 场景:非进度行保持原日志转发行为
- **当** PythonBridge 从 Python stderr 收到非 `PROGRESS:` 前缀的行（如 `INFO - IPC Server started`）
- **那么** 该行按原逻辑 `console.log('[Python]', line)` 转发到日志，不触发 `STARTUP_PROGRESS` 通道

#### 场景:格式错误的进度行降级处理
- **当** PythonBridge 收到 `PROGRESS:abc:xxx`（percent 非整数）或 `PROGRESS:50`（缺少 label）
- **那么** 该行降级为普通日志转发（`console.log('[Python]', line)`），不抛错，不中断启动，不发送 `STARTUP_PROGRESS`

#### 场景:窗口就绪时报告初始进度
- **当** Electron 主进程创建窗口并加载完 index.html 后
- **那么** 主进程通过 `webContents.send('STARTUP_PROGRESS', { percent: 10, label: '正在启动应用…' })` 发送初始进度

### 需求:渲染进程订阅并消费进度信号

渲染进程必须提供 `useStartupProgress` hook 订阅 `STARTUP_PROGRESS` IPC 通道，维护 `{ percent, label, done }` 状态。percent 必须单调递增（新值小于当前值时必须忽略，防止乱序）。当 percent 达到 100 或 `useFatalErrorStore.error` 变为非 null 时，必须将 `done` 置为 true。hook 必须在模块加载时立即订阅（不依赖 React 生命周期），并用模块级缓存存储最新进度值，确保 React 挂载滞后于首个 IPC 事件时不丢失进度。首屏就绪（首个 IPC getConfig 成功）必须通过 `markStartupReady` 标志驱动 `done` 置为 true，因为 Python 进度最高只到 95%，最后的就绪信号由渲染进程补上。

#### 场景:hook 接收并更新进度
- **当** `useStartupProgress` 收到 `STARTUP_PROGRESS` 事件 `{ percent: 50, label: '下载引擎已就绪' }`，当前状态为 `{ percent: 25, done: false }`
- **那么** 状态更新为 `{ percent: 50, label: '下载引擎已就绪', done: false }`

#### 场景:percent 达到 100 时标记完成
- **当** `useStartupProgress` 收到 `{ percent: 100, label: '准备就绪' }`
- **那么** 状态更新为 `{ percent: 100, label: '准备就绪', done: true }`

#### 场景:markStartupReady 触发完成态
- **当** Python 进度最高到 95%，首个 IPC getConfig 成功后调用 `markStartupReady()`
- **那么** `done` 置为 true，驱动 StartupScreen 淡出

#### 场景:乱序进度值被忽略
- **当** `useStartupProgress` 收到 `{ percent: 30 }`，当前 percent 已为 50
- **那么** 状态保持 `{ percent: 50 }` 不变，忽略本次事件

#### 场景:致命错误触发完成态
- **当** `useFatalErrorStore.error` 变为非 null（PythonBridge 重启超限触发 `onFatal`）
- **那么** `useStartupProgress` 的 `done` 置为 true，渲染进程停止显示启动进度界面

#### 场景:React 挂载滞后时不丢失进度
- **当** `STARTUP_PROGRESS` 事件在 React 挂载前到达，hook 在 React 挂载后首次调用
- **那么** hook 必须返回已缓存的最新进度值，而非初始值 `{ percent: 0 }`

### 需求:启动进度界面渲染与视觉连续

`index.html` 内联骨架屏必须包含进度条 DOM（百分比文字 + 进度条填充 + 当前阶段文案），由原生 JavaScript 在 React 挂载前根据 `STARTUP_PROGRESS` 事件更新。React 挂载后，App 顶层必须在 `useStartupProgress.done` 为 false 时渲染 `<StartupScreen>` 组件。`<StartupScreen>` 的视觉（logo、spinner、进度条样式、文案）必须与 index.html 骨架屏完全一致，确保用户感知不到切换。`<StartupScreen>` 必须用 `matchMedia('(prefers-color-scheme: dark)')` 同步判断系统主题配色（与 index.html 骨架屏行为一致），禁止依赖 `data-theme` 属性（该属性由 useTheme 在 useEffect 中设置，晚于 React 首次渲染，会导致首帧颜色闪烁）。进度条填充宽度必须使用 CSS `transition: width` 平滑过渡。当 `done` 为 true 时，`<StartupScreen>` 必须淡出，真实首屏内容显示。

#### 场景:index.html 骨架屏显示进度条并在 React 挂载前更新
- **当** 窗口加载 index.html，React 尚未挂载，收到 `STARTUP_PROGRESS` 事件
- **那么** index.html 骨架屏的进度条填充宽度更新为对应 percent，百分比文字和阶段文案同步更新

#### 场景:React 挂载后 StartupScreen 视觉与 index.html 一致
- **当** React 挂载，`useStartupProgress.done` 为 false
- **那么** App 渲染 `<StartupScreen>`，其 logo、spinner、进度条位置、颜色、尺寸、文案与 index.html 骨架屏像素级一致，用户感知不到从 index.html 到 React 的切换

#### 场景:深色系统下 StartupScreen 首帧颜色正确
- **当** 系统为深色模式，React 挂载首次渲染 `<StartupScreen>`（此时 `data-theme` 属性尚未由 useTheme 设置）
- **那么** `<StartupScreen>` 通过 `matchMedia` 同步判断为深色，首帧即显示深色配色，不出现亮色闪烁

#### 场景:进度条平滑过渡
- **当** 进度从 25% 变为 50%
- **那么** 进度条填充宽度通过 CSS `transition: width 0.4s ease` 平滑爬行，而非瞬间跳变

#### 场景:启动完成时淡出 StartupScreen
- **当** `useStartupProgress.done` 从 false 变为 true
- **那么** `<StartupScreen>` 通过 framer-motion `AnimatePresence` 淡出，真实首屏内容（SearchPage）显示

### 需求:启动失败时进度界面让位致命错误横幅

当 Python 后端启动失败或重启超限时，启动进度界面必须停止显示，由已有的 `FatalBanner` 接管错误反馈。进度界面禁止自行显示错误文案或错误图标。

#### 场景:Python 启动失败时进度条不自行报错
- **当** PythonBridge 触发 `onFatal`（重启超限），`useFatalErrorStore.error` 变为非 null
- **那么** `useStartupProgress.done` 置为 true，App 停止渲染 `<StartupScreen>`，顶层 `FatalBanner` 显示错误横幅，进度界面不显示任何错误文案

#### 场景:进度信号中断不导致界面卡死
- **当** Python 进程在初始化中途崩溃，stderr 进度信号中断在某个 percent（如 50%）
- **那么** 进度界面停留在该 percent 与对应文案，随后 PythonBridge 重启逻辑触发，达到 `MAX_RESTARTS` 后由 FatalBanner 接管
