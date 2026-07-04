# 实施任务：dev-server-proxy-bypass

## 1. Vite dev server 固定 loopback 端口

- [x] 1.1 在 `electron.vite.config.ts` 的 `renderer` 块新增 `server` 配置：`host='127.0.0.1'`、`port=5173`、`strictPort=true`
- [x] 1.2 在同一 `server` 块新增 `hmr: { host: '127.0.0.1', port: 5173, protocol: 'ws' }`
- [x] 1.3 运行 `npm run dev` 确认 Vite 输出 `Local: http://127.0.0.1:5173/`，且 `ELECTRON_RENDERER_URL` 指向该地址（手测项，用户已验证通过）

## 2. Electron session 强制 dev 模式直连

- [x] 2.1 ~~从 `electron` 导入 `session`~~ — 改用实例访问器 `mainWindow.webContents.session`（与现有 setupCSP/setupRefererInjection 一致，无需新增 import）
- [x] 2.2 在 `createWindow()` 中 BrowserWindow 创建之后、`loadURL` 之前，仅当 `process.env.ELECTRON_RENDERER_URL` 存在时，`await mainWindow.webContents.session.setProxy({ proxyRules: 'direct://', proxyBypassRules: '<local>,localhost,127.0.0.1,::1' })`
- [x] 2.3 确认该 `setProxy` 调用位于 `setupCSP`/`setupRefererInjection` 之前、首次 `loadWithRetry` 之前；并将相关代码段用 try/catch 包裹（失败时记录日志但不阻断，交由后续层兜底）
- [x] 2.4 验证生产路径：`ELECTRON_RENDERER_URL` 不存在时不调用 `setProxy`（grep + 手动核对分支条件）—— setProxy/waitForDevServer 全部位于 `if (devServerUrl)` 分支内，else 分支仅 `loadFile`

## 3. 主动就绪探测 `waitForDevServer`

- [x] 3.1 在 `electron/main.ts` 新增辅助函数 `waitForDevServer(url: string, totalTimeoutMs = 30_000): Promise<boolean>`：循环 `fetch(url)`，单请求超时 1.5s、间隔 300ms，2xx/3xx 即 resolve(true)；总超时 resolve(false) 并 `console.warn` 记录
- [x] 3.2 验证 Node 全局 `fetch` 在当前 Electron 42 / Node 24 下确实绕过 Electron session 代理（直连 `127.0.0.1`）；若发现受 session 代理影响，回退为显式 `http.get` 直连 `127.0.0.1`（在函数内 `import http from 'http'` 或顶部导入）—— 采用全局 `fetch`（非 Electron `net.fetch`），走 Node 网络栈不经 Chromium session 代理；如实测受影响再回退 http.get
- [x] 3.3 在 `createWindow()` 的 dev 分支：`session.setProxy` 之后、`loadWithRetry` 之前 `await waitForDevServer(devServerUrl)`
- [x] 3.4 确保探测失败（返回 false）不抛错，仅记录日志后继续走 `loadWithRetry` 兜底

## 4. `loadWithRetry` 指数退避改造

- [x] 4.1 将 `DEV_SERVER_MAX_RETRIES` 从 5 调整为 10
- [x] 4.2 将 `DEV_SERVER_RETRY_DELAY_MS` 重命名/重构为退避函数：`Math.min(500 * 2 ** attempt, 3000)`；总窗口应 ≥ 25s —— 新增 `devServerRetryDelay(attempt)`，常量改为 BASE=500 / MAX=3000；总窗口 500+1000+2000+3000×7 ≈ 24.5s
- [x] 4.3 在 `loadWithRetry` 的日志中补充当前 attempt 的等待时长（便于诊断）
- [x] 4.4 在重试耗尽分支的 error 日志中补充已重试次数与总耗时

## 5. 验证与质量门禁

- [x] 5.1 `npx tsc --noEmit` 通过（重点检查 main.ts 的 `session` 导入与 async/await 类型）—— 0 错误
- [x] 5.2 `npm run lint` 通过（覆盖 electron 目录，含 main.ts 与 electron.vite.config.ts）—— 0 错误（1 个预存无关 warning：PageFlipView react-refresh）
- [x] 5.3 `npm test` 通过（确认未破坏既有前端测试）—— 90 文件 / 1442 用例全绿
- [x] 5.4 手动验证：冷启动 + TUN 代理开启状态下运行 `npm run dev`，确认 dev server 首次加载成功且无需手动切换 TUN 开关（用户已验证通过）
- [x] 5.5 手动验证：杀掉 dev server 进程后再次 `npm run dev`，确认 `waitForDevServer` 探测 → `loadWithRetry` 退避重试链路按预期工作（观察日志）（用户已验证通过）
- [x] 5.6 手动验证：5173 端口被占用时 `npm run dev` 因 `strictPort` 直接报错退出（而非静默换端口）（用户已验证通过）
