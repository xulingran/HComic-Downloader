## 为什么

电脑冷启动后首次运行 `npm run dev`（electron-vite dev）时，Vite renderer dev server 在 `http://localhost:<port>` 上的初始加载和 HMR websocket 经常连不上，提示“无法连接到 dev remote”，需要手动开关一次 TUN 模式代理才能恢复。根因是 TUN 模式代理（Clash/Mihomo 等创建的虚拟网卡）在系统启动时机早于 Vite，且 Electron/Chromium 继承了 Windows 系统代理，在 TUN 规则与 bypass-list 尚未稳定时把 loopback 流量错误路由进了代理，导致 dev server 首次加载超时。现在修复是因为这是每次冷启动都会复现、且需用户手动干预绕过的体验阻塞点。

## 变更内容

- 在 `electron.vite.config.ts` 的 `renderer` 块显式固定 dev server：`host=127.0.0.1`、`port=5173`、`strictPort=true`，并显式声明 HMR 走 `127.0.0.1`，避免端口漂移和 wildcard 监听被代理劫持。
- 在 `electron/main.ts` 中，dev 模式创建 BrowserWindow 后、`loadURL` 之前调用 `session.setProxy({ proxyRules: 'direct://', proxyBypassRules: '<local>,localhost,127.0.0.1,::1' })`，让 Electron session 在 dev 模式强制对 loopback 直连，剥离系统/TUN 代理对 localhost 的劫持。
- 新增 `waitForDevServer(url, totalTimeoutMs)` 主动就绪探测：在 `loadURL` 之前用 Node 内置 `fetch` 反复探测 dev server URL，直到返回 2xx/3xx 或超时，把代理未就绪的窗口前置消化掉。
- 调整 `loadWithRetry` 重试策略：`DEV_SERVER_MAX_RETRIES` 5 → 10，重试间隔改为指数退避（500ms 起步，封顶 3000ms，总窗口约 25s），覆盖 TUN 启动抖动。
- 所有上述行为仅在 `process.env.ELECTRON_RENDERER_URL` 存在（dev 模式）时生效，生产构建路径完全不受影响。

## 功能 (Capabilities)

### 新增功能
- `dev-server-connectivity`: dev 模式下 Electron 与 Vite renderer dev server 之间的连接可靠性保障——固定 loopback 端口、强制 session 级 localhost 直连 bypass、主动就绪探测与指数退避重试，使 dev server 在系统代理（含 TUN 模式）环境下能稳定首次加载。

### 修改功能
<!-- 无现有 spec 覆盖 dev server 启动连接；本次属新增 capability，不修改既有 spec 级行为。 -->

## 影响

- **代码**：
  - `electron.vite.config.ts`：`renderer.server` 新增配置块。
  - `electron/main.ts`：常量调整、新增 `waitForDevServer`、`loadWithRetry` 退避改造、`createWindow()` 中 dev 分支新增 `session.setProxy` + 探测调用。
- **依赖/环境**：无新增依赖；`session.setProxy` 与 `fetch` 均为 Electron 42 / Node 24 内置能力。
- **测试/校验**：`npx tsc --noEmit`、`npm run lint`（含 electron 目录）需通过；`npm test`/`pytest` 不受影响（改动不触及前端 src 与 Python）。
- **运行时**：仅 dev 模式行为变化（更可靠的首次加载 + 显式 direct proxy）；生产构建路径（`loadFile`）零变化。
- **不在范围内**：Python 后端 `apply_system_proxy_to_session()` 与各来源解析器的代理逻辑（这些是运行期下载请求的代理，与 dev server 启动无关）；前端 HMR 客户端逻辑。
