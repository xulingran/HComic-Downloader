## 1. 骨架屏 —— 消除黑屏等待

- [x] 1.1 在 `index.html` 的 `<div id="root">` 内添加骨架屏内联 HTML/CSS（logo、加载动画、"启动中…" 文字），深色/浅色模式通过 `prefers-color-scheme` 自动适配
- [x] 1.2 在 `electron/main.ts` 的 `createWindow()` 中将 `show: false` 改为 `show: true`，移除 `ready-to-show` 监听中的 `mainWindow.show()` 调用
- [x] 1.3 在 `index.html` 中添加 `<noscript>` 后备提示："请启用 JavaScript 以使用 HComic Downloader"
- [x] 1.4 验证：npm run dev 后窗口立即显示骨架屏，React 就绪后骨架屏无缝被真实 UI 替换

## 2. 解析器懒加载 —— 延迟非默认来源解析器构造

- [x] 2.1 在 `sources/__init__.py` 中重构 `MultiSourceParser.__init__`：将 `self.parsers` 字典的预创建改为工厂函数映射 `_factory` 和缓存字典 `_parsers`，在 `__init__` 结束时只创建 default_source 的解析器
- [x] 2.2 新增 `_get_parser(name: str) -> Parser` 私有方法：检查 `_parsers` 缓存，未创建时调用 `_factory[name]()` 构造并执行凭据恢复（`set_stored_credentials`、`configure_auth`、`set_image_quality`）
- [x] 2.3 将所有 `self.parsers[src]` 的直接访问替换为 `self._get_parser(src)` 调用
- [x] 2.4 修改 `configure_auth()`：更新 `_auth_params` 待用参数，同时如果解析器已创建则即时应用，未创建时等待懒创建
- [x] 2.5 重写 `get_sessions()`：只返回 `_parsers` 缓存中已创建解析器的 session，跳过未创建的
- [x] 2.6 验证：`pytest` 全部通过（740 passed）；启动后访问 hcomic 以外的来源时首次调用有短暂延迟但后续调用正常

## 3. React 代码分割 —— 首屏只发 SearchPage

- [x] 3.1 在 `src/App.tsx` 中：SearchPage 保持静态 `import`；其余 6 个 page 和 3 个 modal（`ComicInfoDrawer`、`ComicReaderModal`、`UpdateDialog`）改为 `React.lazy(() => import(...).then(m => ({ default: m.Xxx })))`（named export → default 转换）
- [x] 3.2 在每个 lazy 页面的 `<Suspense fallback={<PageSkeleton />}>` 组件中包裹
- [x] 3.3 在 `electron.vite.config.ts` 的 `rollupOptions.output` 中添加 `manualChunks` 配置：`react-vendor`（react/react-dom/react-router-dom）、`framer-motion`，确保各 lazy 页面产出独立 chunk
- [x] 3.4 验证：`npm test` 全部通过（924 passed, 65 test files）

## 4. IPC 注册异步化 —— 不等待 Python 就绪

- [x] 4.1 在 `electron/python-bridge.ts` 的 `PythonBridge` 类中新增 `_readyResolve` / `_readyPromise` 字段；`start()` 开头创建新的 Promise，spawn 成功后 resolve；暴露 `waitForReady(): Promise<void>` 方法
- [x] 4.2 `call()` 内部在进程未就绪时 await `waitForReady()`；`registerIPCHandlers()` 注册 handler 时不阻塞（handler 内部自动 await）
- [x] 4.3 验证：python-bridge.test.ts 32/32 passed
- [x] 4.4 Python 崩溃重启处理：`start()` 每次创建新的 `_readyPromise`，旧 Promise 不影响新连接
- [x] 4.5 验证：全部 65 个前端测试文件、924 个测试通过；全部 740 个 Python 测试通过