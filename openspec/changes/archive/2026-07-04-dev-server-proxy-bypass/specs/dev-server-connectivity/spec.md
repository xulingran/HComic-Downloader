## 新增需求

### 需求:dev server 必须绑定 loopback 且端口固定
dev 模式下 Vite renderer dev server 必须监听 `127.0.0.1`（禁止 wildcard `0.0.0.0`），且必须使用固定端口（`strictPort=true`），HMR 连接必须显式指向 `127.0.0.1`。固定 loopback 端口确保代理 bypass 规则可稳定匹配，避免端口漂移导致 bypass 失效。

#### 场景:dev server 监听地址为 loopback
- **当** `npm run dev` 启动 electron-vite
- **那么** Vite renderer dev server 监听 `http://127.0.0.1:5173`，且 `ELECTRON_RENDERER_URL` 环境变量指向该地址

#### 场景:端口被占用时直接失败而非漂移
- **当** 5173 端口已被其他进程占用
- **那么** electron-vite 立即报错退出（`strictPort=true`），而不是静默切换到其他端口

#### 场景:HMR websocket 走 loopback
- **当** renderer 建立 HMR websocket 连接
- **那么** websocket 目标 host 必须是 `127.0.0.1`，禁止通过主机名或外网 IP 走代理

### 需求:dev 模式必须强制 Electron session 对 loopback 直连
dev 模式下，BrowserWindow 创建后、`loadURL` 之前，系统必须调用 `session.setProxy` 强制 direct 连接并对 loopback 设置 bypass，使 localhost 流量不再被系统/TUN 代理劫持。该行为仅在 `ELECTRON_RENDERER_URL` 存在时生效；生产构建路径（`loadFile`）禁止受影响。

#### 场景:dev 模式设置 session 直连
- **当** Electron 以 dev 模式启动（`process.env.ELECTRON_RENDERER_URL` 存在）
- **那么** 默认 session 的代理必须被设置为 `proxyRules='direct://'` 且 `proxyBypassRules` 至少包含 `<local>,localhost,127.0.0.1,::1`，且该设置必须在首次 `loadURL` 之前完成

#### 场景:生产模式不触发代理覆写
- **当** Electron 以生产构建启动（`process.env.ELECTRON_RENDERER_URL` 不存在）
- **那么** 系统 禁止 调用 `session.setProxy`，保留系统原有代理设置

#### 场景:直连后 dev server 首次加载可达
- **当** TUN 模式代理处于激活状态且系统代理已开启
- **那么** Electron 对 `http://127.0.0.1:5173` 的请求必须绕过代理直接命中本地 Vite dev server，首次加载成功（不依赖手动切换 TUN 开关）

### 需求:loadURL 前必须主动探测 dev server 就绪
dev 模式下，调用 `loadURL` 之前系统必须对 dev server URL 执行主动就绪探测（HTTP GET），反复重试直到返回 2xx/3xx 响应或达到总超时（默认 30s）。探测失败时必须记录诊断日志，但仍交由后续 `loadWithRetry` 继续尝试。探测必须使用 Node 内置网络栈直连 loopback，禁止经过系统代理。

#### 场景:dev server 已就绪时探测立即成功
- **当** Vite dev server 已完成启动并对探测请求返回 200
- **那么** 探测必须在首次请求（<100ms）内成功并立即触发 `loadURL`，不引入可感知延迟

#### 场景:dev server 暂未就绪时反复重试
- **当** Vite dev server 尚未绑定端口或代理未稳定，探测请求失败/超时
- **那么** 系统必须在总超时（30s）窗口内反复重试，直到成功或超时；超时后必须记录日志并继续走 `loadWithRetry` 兜底

#### 场景:探测请求绕过代理
- **当** 系统代理或 TUN 模式处于激活状态
- **那么** 就绪探测请求 禁止 经由代理转发，必须直连 `127.0.0.1`

### 需求:loadWithRetry 必须使用指数退避且窗口足够长
dev 模式下首次 `loadURL` 失败时，`loadWithRetry` 必须以指数退避方式重试（初始 500ms，每次翻倍，封顶 3000ms），最大重试次数必须 ≥ 10，总重试窗口必须 ≥ 25s，以覆盖 TUN 模式代理冷启动抖动。重试进度必须输出到日志。

#### 场景:首次加载失败后按指数退避重试
- **当** 首次 `loadURL` 触发 `did-fail-load`
- **那么** 系统按 500ms → 1000ms → 2000ms → 3000ms → 3000ms ... 的间隔重试，最多 10 次

#### 场景:重试窗口覆盖代理启动抖动
- **当** TUN 代理冷启动后 10-20s 内才稳定 bypass loopback
- **那么** 指数退避重试在代理稳定后下一次尝试必须成功，无需用户手动干预

#### 场景:重试耗尽时显式记录并展示窗口
- **当** 重试达上限仍失败
- **那么** 系统必须输出错误日志说明已重试次数与总耗时，并显示主窗口（沿用现有 `win.show()` 行为）
