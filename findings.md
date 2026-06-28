# 发现与决策

## 需求
- 持续 JM 挑战必须成为结构化信号，不能误判为登录失效。
- 只有收藏夹用户前台操作允许弹出验证窗，后台刷新和预加载不得弹窗。
- 验证完成后同步全部目标域 Cookie 与实际 UA；失败恢复必须有界。
- Cookie、UA 原文和 HTML 正文不得进入 React renderer 或日志。

## 研究发现
- 当前工作树已包含 `AntiBotChallengeError`、JM 挑战检测和最多两次后台重试的未提交基础修改。
- 现有 `electron/login-window.ts` 已具备 JM 多域 Cookie 提取、UA 提取、用户名提取、apply_auth、CSP/导航隔离和 5 分钟超时。
- 现有登录叠层使用全局 IPC handler，因此普通登录和挑战窗口必须全局互斥。
- PythonBridge 当前只保留 JSON-RPC error code，不保留 data。
- `getFavourites` 的缓存后台刷新和相邻页预加载与用户请求共用同一 hook，需要显式传递交互开关。
- `SearchMixin._auth_error_guard` 当前主动把 `AntiBotChallengeError` 降为 `RuntimeError`；应改为保留异常给 `IPCServer` 专门序列化。
- `IPCServer._dispatch_request` 已有 `AuthRequiredError` 专门分支，新增挑战分支可保持 JSON-RPC 错误结构一致。
- `JmParser.favourites()` 的 HTML 检查、登录提示、条目解析、分页和标题补全可抽成共享方法；快照路径应关闭详情页标题网络补全，优先使用渲染后 DOM。
- `MultiSourceParser` 目前只暴露网络版 `favourites`，需要新增严格限定 JM 的快照解析转发方法。
- Python IPC 并发测试已有轻量 server 构造和 stdout 捕获工具，可直接覆盖 `-32002` 数据载荷。
- 共享 HTML 解析可以对网络路径保留标题补全，对浏览器快照路径完全禁用标题网络请求；渲染后 DOM 已能提供标题时不损失信息。
- JSON-RPC `error.data` 已能由 PythonBridge 保留，但必须在 `main.ts` 使用前校验来源、URL 长度和 URL 白名单。
- 登录窗口完成结果当前只保存布尔成功状态；挑战模式需在 context 内保存 `successResult`，让倒计时完成、手动关窗和兜底 timer 都返回同一内部快照而不广播给 renderer。
- 挑战模式不应沿用“关窗即提取”：用户关闭窗口必须视为取消；只有叠层显式提交才验证 DOM 并捕获快照。
- `login-preload.ts` 可通过 BrowserWindow `additionalArguments` 读取受控模式，避免依据第三方 URL 或 DOM 推断。
- 现有测试 MockBrowserWindow 已包含 focus、restore 和 executeJavaScript，适合新增单飞与快照用例；只需补 `getURL` 或定制 executeJavaScript 返回值。

## 技术决策
| 决策 | 理由 |
|------|------|
| 挑战错误使用 -32002 | 与既有认证错误 -32001 分离 |
| challenge URL 在 Electron 和 Python 双端校验 | 防止异常载荷触发任意导航或 SSRF |
| 浏览器快照固定上限 5 MiB | 控制本地 JSON-RPC 内存开销 |
| 公共 openLoginWindow 剥离内部快照 | 防止敏感页面进入 React renderer |

## 遇到的问题
| 问题 | 解决方案 |
|------|---------|
| PowerShell 的 rg glob 路径写法不兼容 | 改为对 tests 目录使用 `-g` 文件过滤 |

## 资源
- `openspec/changes/add-jm-interactive-challenge-recovery/`
- `sources/jm/parser.py`
- `python/ipc/search_mixin.py`
- `electron/login-window.ts`
- `electron/login-preload.ts`
- `src/pages/FavouritesPage.tsx`

## 视觉/浏览器发现
- 当前阶段无需浏览器或图片检查。
