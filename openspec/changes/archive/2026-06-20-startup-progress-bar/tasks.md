## 1. 共享类型与 IPC 通道常量

- [x] 1.1 在 `shared/types.ts` 的 `NOTIFICATION_CHANNELS` 中新增 `STARTUP_PROGRESS: 'startup-progress'` 常量
- [x] 1.2 在 `shared/types.ts` 中新增 `StartupProgressEvent` 类型（`{ percent: number; label: string }`）并导出

## 2. Python 后端进度信号产生

- [x] 2.1 在 `python/ipc_server.py` 的 `IPCServer` 类新增 `_emit_progress(self, percent: int, label: str) -> None` 方法，直接 `print(f"PROGRESS:{percent}:{label}", file=sys.stderr, flush=True)`
- [x] 2.2 在 `IPCServer.__init__` 的 `Config.load()` 完成后调用 `_emit_progress(25, "配置已加载")`
- [x] 2.3 在 `MultiSourceParser` 构造完成后调用 `_emit_progress(35, "解析器已就绪")`
- [x] 2.4 在下载管理器 + downloader 初始化完成后调用 `_emit_progress(50, "下载引擎已就绪")`
- [x] 2.5 在 3 个 ThreadPoolExecutor 创建完成后调用 `_emit_progress(65, "线程池已就绪")`
- [x] 2.6 在 CoverCacheDB/PreviewCacheDB/migration/reading_history/favourite_tags/tag_list 初始化完成后调用 `_emit_progress(85, "数据库已就绪")`
- [x] 2.7 在 handler 参数预计算完成后调用 `_emit_progress(95, "准备就绪")`
- [x] 2.8 为 `_emit_progress` 编写单元测试，验证 stderr 输出格式 `PROGRESS:<percent>:<label>`、flush 行为、percent 范围

## 3. Electron 主进程进度信号转发

- [x] 3.1 在 `electron/python-bridge.ts` 的 `PythonBridge` 类新增可选 `onStartupProgress?: (event: StartupProgressEvent) => void` 回调属性
- [x] 3.2 修改 `python-bridge.ts` 的 stderr 处理逻辑（`start()` 内约第 172-184 行）：识别 `PROGRESS:` 前缀行，用正则 `^PROGRESS:(\d+):(.+)$` 解析，成功则调 `onStartupProgress`，失败则降级为 `console.log('[Python]', line)` 转发
- [x] 3.3 在 `electron/main.ts` 创建 PythonBridge 时注入 `onStartupProgress` 回调，回调内通过 `mainWindow.webContents.send(NOTIFICATION_CHANNELS.STARTUP_PROGRESS, event)` 转发到渲染进程（需处理 `mainWindow` 可能为 null/被销毁的防御）
- [x] 3.4 在 `electron/main.ts` 窗口加载 index.html 完成后（`did-finish-load` 事件或类似时机）调用 `mainWindow.webContents.send(NOTIFICATION_CHANNELS.STARTUP_PROGRESS, { percent: 10, label: '正在启动应用…' })`
- [x] 3.5 为 stderr 解析逻辑编写单元测试，覆盖：有效进度行解析、非 PROGRESS 行原样转发、格式错误行（非整数 percent、缺 label）降级转发不抛错

## 4. Preload 暴露订阅 API

- [x] 4.1 在 `electron/preload.ts` 的 `contextBridge.exposeInMainWorld('hcomic', {...})` 中新增 `onStartupProgress: (callback: unknown) => onChannel(NOTIFICATION_CHANNELS.STARTUP_PROGRESS, callback)`

## 5. index.html 骨架屏进度条

- [x] 5.1 在 `index.html` 内联骨架屏 DOM 中新增进度条结构：百分比文字（如 `<span id="startup-percent">0%</span>`）、进度条填充（`<div id="startup-progress-bar">`）、阶段文案（`<div id="startup-label">启动中…</div>`）
- [x] 5.2 在 `index.html` 内联 CSS 中新增进度条样式：填充宽度初始 0、`transition: width 0.4s ease`、配色与骨架屏一致、适配深色模式
- [x] 5.3 在 `index.html` 内联 JS 中新增监听逻辑：通过 `window.hcomic.onStartupProgress`（若可用）订阅进度事件，更新 DOM 的 percent/label；若 `window.hcomic` 不可用（React/preload 未就绪）保持初始态

## 6. React StartupScreen 组件与 hook

- [x] 6.1 新增 `src/hooks/useStartupProgress.ts`：订阅 `window.hcomic.onStartupProgress`，维护 `{ percent, label, done }` 状态；percent 单调递增（新值小于当前值时忽略）；percent >= 100 时 done=true；订阅 `useFatalErrorStore.error`，error 非 null 时 done=true；用模块级变量缓存最新进度，确保 React 挂载滞后时不丢失事件
- [x] 6.2 新增 `src/components/StartupScreen.tsx`：视觉与 index.html 骨架屏完全一致（同 logo `assets/icon.svg`、同 spinner、同进度条结构/样式、同文案），接收 `useStartupProgress` 的 `{ percent, label }` 渲染进度
- [x] 6.3 为 `useStartupProgress` 编写单元测试，覆盖：接收并更新进度、percent 达到 100 标记 done、乱序 percent 被忽略、致命错误触发 done、React 挂载滞后不丢失进度
- [x] 6.4 为 `StartupScreen` 编写单元测试，覆盖：渲染 logo/spinner/进度条、percent 变化时进度条宽度更新、label 同步更新

## 7. App.tsx 集成 StartupScreen

- [x] 7.1 在 `src/App.tsx` 顶层调用 `useStartupProgress()`，当 `done` 为 false 时用 `AnimatePresence` 包裹渲染 `<StartupScreen>`（覆盖真实内容），`done` 为 true 时淡出 StartupScreen、显示真实内容
- [x] 7.2 确保 `<StartupScreen>` 与真实内容切换通过 framer-motion 淡入淡出过渡，视觉连续

## 8. 集成验证

- [x] 8.1 手动验证：生产构建启动时进度条从 0% 平滑爬行到 100%，各阶段文案正确显示，StartupScreen 淡出后真实首屏可见
- [x] 8.2 手动验证：故意让 Python 启动失败（如修改 Python 入口路径触发 spawn 失败），确认进度条停留在当前 percent，达到 MAX_RESTARTS 后 FatalBanner 接管，StartupScreen 不显示错误文案
- [x] 8.3 手动验证：快速启动场景（Python 秒级就绪）进度条快速跑完，CSS transition 让快速完成不突兀
- [x] 8.4 运行完整验证流程：`pytest`、`npx tsc --noEmit`、`npm test`、`npm run lint:py`、`black --check .`、`npm run lint`
