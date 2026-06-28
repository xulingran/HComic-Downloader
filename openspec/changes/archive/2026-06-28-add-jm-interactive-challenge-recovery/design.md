## 上下文

JM 收藏夹当前由 Python `curl_cffi.Session` 请求。解析器能通过 `cf-mitigated: challenge` 和页面特征识别 Cloudflare 挑战，并在同一 Session、系统代理和认证上下文中执行有界重试；重试耗尽后，`AntiBotChallengeError` 在 IPC 层被转换成普通 `RuntimeError`，Electron 只能得到文本错误。

项目同时已有一个基于 Electron `BrowserWindow` 的来源登录窗口。它使用默认持久 Session，支持 JM 域名白名单、弹窗/权限隔离、Cookie 与 User-Agent 提取、JM 用户名提取以及 `apply_auth` 回写。现有窗口只接受来源和已解析主域名，默认打开站点首页，叠层也只表达“登录”语义。

现场挑战发生在 `/user/{username}/favorite/albums?page=N`。首页未必触发相同规则；而 Cloudflare clearance 可能与浏览器设备、网络出口和挑战级别绑定，因此只把浏览器 Cookie 复制给 TLS/JS 指纹不同的 Python 客户端并不能保证恢复。所有新增网络路径仍必须遵守系统代理约束，敏感 Cookie 禁止进入 React 或日志。

## 目标 / 非目标

**目标：**

- 把持续 JM 挑战作为带稳定错误码和受挑战 URL 的结构化信号传到 Electron 主进程。
- 仅在用户主动加载 JM 收藏夹时打开真实浏览器窗口，并直接加载受挑战路径。
- 在用户验证完成后同步该域名的登录 Cookie、clearance Cookie 与 User-Agent，自动重试原请求一次。
- Python 重试仍失败时，复用已验证 BrowserWindow 中的渲染后页面快照，由 Python 现有解析逻辑生成收藏夹结果。
- 防止后台预加载误弹窗、多请求并发弹窗、取消后循环弹窗、任意 URL 加载及 Cookie 泄露。

**非目标：**

- 不自动破解、模拟点击或绕过 Cloudflare 挑战。
- 不把所有 JM 网络请求迁移到 Electron，不为其他来源建立通用浏览器抓取框架。
- 不修改 Cloudflare 规则、JM 站点行为或系统代理配置。
- 不在本变更中升级 Electron、调整 `curl_cffi` impersonate 版本或重新启用登录窗口 sandbox。

## 决策

### 1. 使用专用 JSON-RPC 错误码和受限数据载荷

`AntiBotChallengeError` 增加只读的 `challenge_url` 上下文。JM 收藏夹重试耗尽时使用内部构造的实际请求 URL 抛出该异常；`SearchMixin` 不再把它降级为 `RuntimeError`。`IPCServer` 在通用异常之前捕获并输出专用应用错误码（计划为 `-32002`），`data` 仅包含 `source: "jm"`、`challengeUrl` 和可展示消息。

`PythonBridge` 将错误的 `code` 与经过类型约束的 `data` 保留在主进程 Error 对象上。由于 Electron `ipcMain.handle` 抛出的自定义 Error 属性不保证完整跨到渲染进程，挑战编排由主进程消费该结构化错误，不依赖渲染进程读取 Error 自定义字段。

替代方案是继续匹配错误文本。该方案无法可靠携带 URL，也容易把认证失败和挑战混淆，因此不采用。

### 2. 收藏夹调用显式声明是否允许交互

在前端到主进程的 `getFavourites` 参数中增加可选布尔值 `allowInteractiveChallenge`，默认 `false`，该参数不传给 Python。收藏夹页面只有无缓存的用户加载、显式刷新和用户翻页可设为 `true`；缓存后台刷新、相邻页预加载和工具内部批量读取保持 `false`。

主进程仅在来源为 `jm`、错误码为挑战专用码且该标志为 `true` 时启动交互恢复。非交互调用继续快速失败，由原调用方静默忽略或展示普通可恢复错误。

替代方案是任何挑战都自动弹窗。它会让后台预加载和工具扫描突然抢占焦点，不可接受。

### 3. 将现有登录窗口泛化为受约束的来源浏览器窗口

保留 `openLoginWindow` 公共行为，并在其下抽取可复用编排，使内部挑战模式可传入：`mode: "challenge"`、`source: "jm"` 和显式 `initialUrl`。挑战模式标题及叠层文案改为“JM 人机验证 / 我已完成验证”，但继续复用默认持久 Session、CSP 注册、导航白名单、弹窗拒绝、权限策略、超时与 Cookie 提取链。

主进程必须在创建窗口前验证初始 URL：仅允许 HTTPS、无用户名密码、默认端口、当前 JM 域名或受信镜像域名，且路径匹配 `/user/<非空安全段>/favorite/albums`；查询参数只允许受限页码。导航过程继续使用现有域名白名单，但最终验证与页面快照只接受原 JM 可信域。

登录与挑战窗口共享一个模块级单飞协调器。已有窗口时复用同一个 Promise 并聚焦窗口，禁止覆盖全局叠层 IPC handler；登录窗口和挑战窗口也不得并存。

### 4. 验证完成时同步凭据并捕获受限页面快照

挑战叠层提交前先检查当前文档不再包含稳定挑战标记，且当前 URL 位于可信 JM 域。仍在挑战页时保持窗口并提示用户继续验证。通过后，提取目标域全部 Cookie（包括现有登录 Cookie、`cf_clearance` 等）和窗口实际 User-Agent，沿现有 shell 转义与 `apply_auth` 路径直接写回 Python；原始值不得发送到主 React renderer 或写入诊断日志。

挑战模式同时从当前主框架读取 `document.documentElement.outerHTML` 作为渲染后页面快照。快照必须来自可信 JM 收藏夹 URL，使用 UTF-8 字符串并受固定上限约束（建议 5 MiB）；超限时丢弃快照但不影响 Cookie 同步。公共 `openLoginWindow` 返回值必须剥离快照，只有主进程内部挑战协调器可访问。

替代方案是在窗口关闭后调用 `session.fetch`。它仍可作为未来替代，但原始响应可能缺少页面 JavaScript 已补齐的 DOM；直接捕获已验证窗口的 DOM 更贴合用户实际看到的收藏夹内容。

### 5. 一次 Python 重试，仍失败则解析浏览器快照

验证成功后，主进程使用原页码和来源直接调用 Python `get_favourites` 一次，不递归进入交互 handler。成功则返回标准收藏夹结果；再次收到挑战错误且存在合格快照时，调用新的内部 Python 解析入口，将 `html`、`sourceUrl` 和 `page` 交给 JM parser。

JM parser 把当前响应后的收藏夹解析步骤抽成纯解析函数，普通 HTTP 路径与浏览器快照路径共用。快照路径禁止再次请求同一收藏夹 URL；缺失标题的网络补全只能是有界、非关键的，失败不得使整页不可用。Python 必须再次校验 HTML 大小、URL scheme/host/path 和来源，不能信任 Electron 传入值。

若无合格快照、快照解析失败或解析后仍明确是挑战页，则停止恢复并返回可操作错误，不再次自动打开窗口。

### 6. 取消和页面状态保持非破坏性

用户取消或关闭挑战窗口时，不清除 Python 认证数据、不把状态标记为登录失效，也不自动重试。收藏夹页面保留已有缓存内容；无缓存时展示带“重新验证/重试”操作的错误状态。一次用户动作最多触发一个窗口、一次 Python 自动重试和一次快照解析。

## 风险 / 权衡

- [Cloudflare 在 Electron 环境仍无法通过] → 使用现代 Electron Chromium、保留 5 分钟超时并返回准确错误；不尝试自动绕过。
- [clearance 复制后 Python 仍因客户端指纹不同被拦截] → 使用同一已验证 BrowserWindow 的渲染后 DOM 快照作为第二级恢复。
- [页面快照包含敏感账户内容] → 只在主进程内短暂持有，限制大小，只传给本地 Python 子进程，禁止日志和 renderer 暴露，处理完成即释放引用。
- [恶意或错误 challenge URL 导致任意导航/SSRF] → Electron 和 Python 两端分别执行 HTTPS、域名、端口、路径和长度校验；不因异常载荷放宽白名单。
- [多个前台/后台请求同时失败导致窗口竞态] → 显式交互标志、模块级单飞 Promise、全局窗口互斥及一次性 handler 清理。
- [渲染后 DOM 与服务器 HTML 结构略有不同] → 复用基于 XPath/DOM 语义的解析函数并增加真实渲染快照夹具；解析失败仍保留明确错误而非返回伪空收藏夹。
- [新增 HTML 经过 JSON-RPC 增加内存开销] → 5 MiB 双端上限、只在第二级恢复发生、处理后释放，不写磁盘。

## 迁移计划

1. 先增加结构化挑战错误及 PythonBridge 数据保留，保持现有 UI 行为不变。
2. 泛化登录窗口并完成挑战模式、URL 校验、单飞和快照捕获测试。
3. 接入前台显式交互标志、Cookie/UA 同步和一次重试。
4. 抽取 JM 收藏夹纯解析入口并接入浏览器快照兜底。
5. 增加端到端状态测试后启用收藏夹页面入口。

所有新增参数均为可选且默认关闭，不需要配置或数据迁移。回滚时可先关闭前端 `allowInteractiveChallenge`，结构化错误和解析入口不会改变非交互请求的既有有界失败行为。

## 开放问题

- 现场验证后再决定是否把交互恢复扩展到“收藏标签同步、重复检测、查缺补漏”等显式用户工具；本变更默认只覆盖收藏夹页面。
- 5 MiB 页面快照上限可在实现时用现场正常收藏夹页面尺寸校准，但必须保持固定上限且不得配置为无限。

