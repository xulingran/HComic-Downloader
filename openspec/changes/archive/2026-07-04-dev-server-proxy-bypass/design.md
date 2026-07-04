## 上下文

冷启动后首次 `npm run dev`（electron-vite dev）经常卡在“无法连接到 dev remote”，需手动开关 TUN 模式代理才能恢复。当前 `electron/main.ts` 的 `loadWithRetry`（536-574 行附近）仅依赖 Chromium 的 `did-fail-load` 被动重试 5 次 × 1000ms（共 ~5s），既不做主动就绪探测，也不在 session 层剥离系统/TUN 代理对 localhost 的劫持。`electron.vite.config.ts` 的 `renderer` 块未声明 `server` 配置，Vite 默认行为是监听 `localhost` 并自动选择端口，HMR websocket 复用同一 origin，这些都可能被系统代理拦截。

约束：
- Electron 42 / Node 24，`session.setProxy` 与全局 `fetch` 均为内置，无新依赖。
- 现有 `setupCSP` 在 dev 模式放行 `connect-src 'self' https: ws:`，已兼容 ws HMR，本次不动 CSP。
- `ELECTRON_RENDERER_URL` 由 electron-vite 注入；main.ts 已校验其 hostname 必须是 localhost/127.0.0.1。
- 生产构建走 `loadFile`，与本次改动路径完全隔离。
- 仅 dev 模式生效，禁止影响生产行为（spec 强约束）。

## 目标 / 非目标

**目标：**
- 消除冷启动时 TUN/系统代理对 Vite dev server 首次加载的劫持，无需用户手动切换代理开关。
- 在 session 层、网络栈层、重试层三处分别建立防线，单点失效仍可由下一层兜底。
- 保持零新增依赖，改动局限于 `electron.vite.config.ts` 与 `electron/main.ts`。
- 生产路径完全不受影响。

**非目标：**
- 不修改 Python 后端 `apply_system_proxy_to_session()` 或各来源解析器的运行期代理逻辑（这些是下载请求的代理，与 dev server 启动无关）。
- 不修改前端 HMR 客户端逻辑或 renderer 源码。
- 不为 TUN/Clash/Mihomo 写适配层或检测其是否存在。
- 不调整生产打包流程。

## 决策

### D1：固定 dev server 至 `127.0.0.1:5173` + `strictPort`
**选择**：在 `electron.vite.config.ts` 的 `renderer.server` 设置 `host='127.0.0.1'`、`port=5173`、`strictPort=true`，`hmr={host:'127.0.0.1',port:5173,protocol:'ws'}`。

**理由**：
- 显式 loopback 比 Vite 默认的 `localhost` 解析更确定（避免 `localhost` 被解析成 `::1` 或外部 IP 后命中代理）。
- 固定端口让 `session.setProxy` 的 bypass 规则可预测，也便于诊断。
- `strictPort=true` 让端口冲突直接报错而非静默漂移——静默漂移会让 bypass 规则失效却无可见信号。

**替代方案**：
- 不固定端口、仅设 `host='127.0.0.1'`：被否，因为端口漂移后 HMR 客户端可能与主 server 端口不一致，且诊断困难。
- 监听 `0.0.0.0`：被否，扩大攻击面且更易被代理/TUN 拦截。

### D2：dev 模式调用 `session.setProxy` 强制 direct + loopback bypass
**选择**：在 `createWindow()` 创建 BrowserWindow 后、`loadURL` 前，仅当 `ELECTRON_RENDERER_URL` 存在时执行：
```ts
await mainWindow.webContents.session.setProxy({
  proxyRules: 'direct://',
  proxyBypassRules: '<local>,localhost,127.0.0.1,::1'
})
```

**理由**：
- 这是从根因层剥离代理劫持：Chromium 继承 WinINET 系统代理，session 级覆写优先级最高，确保 dev server 流量不经代理。
- `direct://` 对 dev 模式安全（dev server 在本地，渲染器对外网的请求在 dev 模式无关紧要）；同时显式声明 bypass-list 作为兜底，即便将来 `direct://` 被误改也保留 loopback 直连。
- 仅 dev 生效，生产路径不受影响（spec 约束）。

**替代方案**：
- 仅设 `proxyBypassRules` 不改 `proxyRules`：被否，TUN 模式是 IP 层劫持，单纯 bypass-list 在系统代理规则未稳定时可能仍被覆盖；`direct://` 更彻底。
- 用 `app.commandLine.appendSwitch('proxy-bypass-list', ...)`：被否，命令行开关作用于全部 session 且粒度粗；session API 更精准可控。

### D3：`loadURL` 前主动探测 dev server（`waitForDevServer`）
**选择**：新增 `waitForDevServer(url: string, totalTimeoutMs = 30_000): Promise<boolean>`，循环用 Node 全局 `fetch` GET dev server URL，每次请求超时 1.5s、间隔 300ms，直到响应状态 2xx/3xx 或总超时；成功后 resolve(true)，超时 resolve(false) 并打日志，不抛错（兜底由 `loadWithRetry` 继续）。

**理由**：
- 主动探测在 Chromium 内部加载流程之外先确认端口可达，把“代理/TUN 未就绪”的窗口前置消化掉，避免 Chromium `did-fail-load` 的长超时与白屏体验。
- Node 内置 `fetch`（Electron 42 / Node 24）已可用，且在 `session.setProxy` 之后并不会继承 Chromium 系统代理——但为确保万无一失，探测使用裸 Node fetch（不经 Electron session），天然走系统路由表，在 `127.0.0.1` 上必为 loopback。
- 探测失败不阻断（resolve false），保留 `loadWithRetry` 兜底；分层防御。

**替代方案**：
- 用 `http.get`/`https.get`：被否，需要新增 `http`/`https` 模块 import 且代码更冗长；`fetch` 内置且简洁。
- 用 `net.fetch`（已 import）：被否，`net.fetch` 走 Chromium 网络栈会受 session 代理影响；裸 `fetch` 走 Node 网络栈更独立。**注意**：需在实现时验证 Node fetch 在当前 Electron 版本确实绕过 session 代理；若验证发现仍受影响，回退到显式 `http.get` 直连 `127.0.0.1`。

### D4：`loadWithRetry` 改指数退避，窗口扩到 ~25s
**选择**：`DEV_SERVER_MAX_RETRIES` 5 → 10；间隔改为 `Math.min(500 * 2 ** attempt, 3000)`，总窗口约 25s（500+1000+2000+3000×7）。

**理由**：TUN 冷启动抖动常持续 10-20s；现有 5×1s=5s 明显不足。指数退避前期快速试探、后期稳定 3s 间隔，兼顾响应性与覆盖窗口。

**替代方案**：
- 固定 3s 间隔：被否，前期太慢、用户感知卡顿。
- 线性递增：被否，比指数退避无明显优势且总窗口更长。

### D5：执行顺序固化
**选择**：`createWindow()` 中 dev 分支顺序固定为：(1) BrowserWindow 创建 → (2) `session.setProxy` (await) → (3) `waitForDevServer` (await) → (4) `loadWithRetry`。

**理由**：先剥离代理再探测再加载，确保每一步都在前一层的保护下进行；任一层失效由下层兜底（分层防御，见 defense-in-depth 技术原则）。

## 风险 / 权衡

- **`strictPort=5173` 端口被占导致启动失败** → 缓解：多数场景 5173 空闲；冲突时报错信息清晰可见，比静默漂移更易诊断。若实测频繁冲突，可回退为 `strictPort=false` + 保留 `host='127.0.0.1'`，但 `ELECTRON_RENDERER_URL` 仍由 electron-vite 注入实际地址，main.ts 已动态读取，不依赖硬编码端口。
- **Node `fetch` 实际仍受 Electron session 代理影响** → 缓解：实现时验证；若受影响，回退到 `http.get` 显式直连 `127.0.0.1`（见 D3 替代方案）。tasks 中已列入验证步骤。
- **`direct://` 影响开发期对外网请求** → 缓解：dev 模式下 renderer 实际对外网请求极少（数据来自 Python 后端 IPC，不直接走 renderer 网络）；且 dev 体验优先于 dev 期的代理转发需求。
- **重试窗口 ~25s 仍不够** → 缓解：spec 已要求 ≥25s；实测若发现极端机器 TUN 启动 >25s，再调参或加配置开关。当前不在范围。
- **session.setProxy 是异步且需 await** → 缓解：`createWindow` 中 dev 分支改为局部 await；现有 `createWindow` 本身是同步函数但内部无返回值依赖，加 await 安全（`app.whenReady` 链路已 try/catch）。

## 迁移计划

- 无数据迁移、无配置迁移；纯代码改动。
- 部署：合入 master 后由用户运行 `npm run dev` 验证。
- 回滚：纯 revert 该变更即可，无副作用残留（`session.setProxy` 仅 dev 运行期生效，不持久化）。

## 未决问题

- 5173 端口是否需要可配置（环境变量覆盖）？默认不配置；若实测冲突频繁再加。
- 是否需要在 `loadWithRetry` 重试时在 UI 上展示进度？当前仅日志；UX 进度已有 `startup-progress-feedback` spec 覆盖其它路径，本次不重叠。
