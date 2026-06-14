## 1. 依赖与基础设施

- [x] 1.1 在 `package.json` 添加 `electron-log` 依赖并 `npm install`
- [x] 1.2 新建 `electron/log-init.ts`，封装日志目录创建 + electron-log 初始化（resolvePath、maxSize、format、errorHandler.startCatching、console 拦截）
- [x] 1.3 在 `electron/main.ts` 顶部（app ready 前）导入并调用日志初始化

## 2. Python 后端日志双写（方案 A1）

- [x] 2.1 在 `python/ipc_server.py` 顶部新增 `LOG_DIR` 常量（`~/.hcomic_downloader/logs/`）和 `os.makedirs(..., exist_ok=True)`
- [x] 2.2 新增 `RotatingFileHandler`（`python.log`, maxBytes=5MB, backupCount=2, utf-8），设置与 StreamHandler 一致的 formatter
- [x] 2.3 修改 `logging.basicConfig` 的 `handlers=[StreamHandler(), file_handler]`，保留原 format

## 3. 共享类型与 IPC 通道

- [x] 3.1 在 `shared/types.ts` 的 `NOTIFICATION_CHANNELS` 新增 `FATAL_ERROR: 'fatal:error'`
- [x] 3.2 在 `shared/types.ts` 的 `IPC_CHANNELS` 新增 `GET_DIAGNOSTICS: 'log:get-diagnostics'`
- [x] 3.3 在 `shared/types.ts` 新增 `FatalErrorEvent` 类型（{ message: string; detail?: string; kind?: string }）和 `DiagnosticsReport` 类型
- [x] 3.4 在 `HcomicAPI` 接口新增 `onFatalError(callback): () => void` 和 `getDiagnostics(): Promise<string>`

## 4. 致命错误转发（主进程 → 渲染进程）

- [x] 4.1 在 `electron/python-bridge.ts` 的 `handleProcessFailure` / spawn error 中，新增回调或事件通知主进程（进程启动失败、重启超限两类）
- [x] 4.2 在 `electron/main.ts` 接收 python-bridge 的致命事件，安全地 `mainWindow?.webContents.send(NOTIFICATION_CHANNELS.FATAL_ERROR, payload)`（复用 onUpdateAvailable 的安全发送模式，检查 mainWindow 存在）
- [x] 4.3 在 `electron/preload.ts` 新增 `onFatalError(callback)`（订阅 fatal:error 通道）

## 5. 诊断信息收集（主进程）

- [x] 5.1 新建 `electron/diagnostics.ts`，实现 `buildDiagnostics(): string`：拼装环境信息（app.getVersion、process.platform、process.arch、process.versions.electron、时间）+ 读 main.log 尾部 200 行 + 读 python.log 尾部 200 行
- [x] 5.2 日志文件不存在或读取失败时降级显示占位文本，不抛异常
- [x] 5.3 在 `electron/main.ts` 注册 `ipcMain.handle(IPC_CHANNELS.GET_DIAGNOSTICS, ...)` 处理器
- [x] 5.4 在 `electron/preload.ts` 新增 `getDiagnostics()`（invoke GET_DIAGNOSTICS）

## 6. 渲染进程：致命错误横幅（方案 B2）

- [x] 6.1 新建 `src/stores/useFatalErrorStore.ts`（Zustand）：{ error: FatalErrorEvent | null, setError, clear }
- [x] 6.2 在 `src/App.tsx` 订阅 `window.hcomic.onFatalError`，写入 useFatalErrorStore
- [x] 6.3 新建 `src/components/FatalBanner.tsx`：消费 useFatalErrorStore，渲染顶部常驻横幅（不阻塞、单例、带关闭/复制日志按钮）
- [x] 6.4 在 `src/App.tsx` 挂载 `<FatalBanner/>`（位于内容区顶部、Sidebar 之外）

## 7. 渲染进程：全局 Toast store

- [x] 7.1 新建 `src/stores/useToastStore.ts`（Zustand）：{ toast: {message, type, visible}, show, error, info, success, dismiss }
- [x] 7.2 改造 `src/components/common/Toast.tsx` 支持 type 样式（error=红/警告色，info=默认，success=绿），保留原有动画
- [x] 7.3 新建 `src/components/common/Toaster.tsx`：消费 useToastStore 渲染 Toast，4 秒自动 dismiss（用 useEffect + setTimeout）
- [x] 7.4 在 `src/App.tsx` 用 `<Toaster/>` 替换原硬编码 SFW Toast；SFW 提示改用 `useToastStore.show('当前处于 SFW 模式...', 'info')` 配合原有 dismissed 逻辑
  > 实现偏差：保留 SFW 的 `<Toast/>`（交互型常驻、带 action 按钮，不应 4 秒自动消失），新增 `<Toaster/>` 专门负责瞬态操作反馈。两者并存而非替换，语义不同。

## 8. 渲染进程：关键路径接入 Toast（渐进式）

- [x] 8.1 `src/hooks/useDownloadHelper.ts`：各 catch 块从 `console.error` 改为 `useToastStore.error(友好文案)`
- [x] 8.2 `src/pages/DownloadPage.tsx`：loadDownloads / cancelDownload 的 catch 接入 Toast
- [x] 8.3 `src/pages/HistoryPage.tsx`：delete/clear history 的 catch 接入 Toast
- [x] 8.4 `src/pages/SettingsPage.tsx`：loadConfig 等关键 catch 接入 Toast
- [x] 8.5 `src/hooks/useIpc.ts`：invoke 的 catch 在 console.error 之外保留 rethrow（不强制 Toast，由各调用方决定）

## 9. 设置页诊断入口

- [x] 9.1 在 `src/pages/SettingsPage.tsx` 新增"诊断信息"区块，含"复制诊断日志"按钮
- [x] 9.2 按钮点击时弹出敏感信息确认提示（confirm 对话框或自定义 modal），确认后调用 `window.hcomic.getDiagnostics()` + `navigator.clipboard.writeText()`
- [x] 9.3 复制成功/失败显示 Toast 反馈

## 10. 测试与验证

- [x] 10.1 新增前端测试：useToastStore、useFatalErrorStore 的状态流转（vitest）
- [x] 10.2 新增前端测试：Toaster / FatalBanner 渲染与自动消失（@testing-library/react）
- [x] 10.3 新增前端测试：diagnostics 类型与降级逻辑（mock 文件不存在）
- [x] 10.4 验证完整流程：`pytest`、`npx tsc --noEmit`、`npm test`、`npm run lint:py`、`black --check .`、`npm run lint` 全部通过
- [ ] 10.5 手动验证：npm run dev 下触发后端异常，确认横幅显示 + 日志文件生成 + 复制诊断可用
  > 需用户手动执行（见下文验证步骤）。自动化校验（pytest/tsc/vitest/lint/black）已全部通过。
