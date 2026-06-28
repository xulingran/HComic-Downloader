## 1. 结构化挑战信号

- [x] 1.1 扩展 `sources.base.AntiBotChallengeError`，保存只读 `challenge_url`，并让 JM 收藏夹在后台重试耗尽时附带实际请求 URL 抛出该异常
- [x] 1.2 调整 `SearchMixin` 和 `IPCServer` 捕获顺序，为挑战返回专用 JSON-RPC 错误码 `-32002` 及仅含 `source`、`challengeUrl`、安全消息的 `data`，保持认证错误 `-32001` 语义不变
- [x] 1.3 更新 `shared/types.ts` 的错误码和主进程错误数据类型，并让 `electron/python-bridge.ts` 在拒绝 Promise 时保留经过类型约束的 `code` 与 `data`
- [x] 1.4 增加 Python IPC 与 PythonBridge 单元测试，覆盖合法载荷、非法/超长载荷、普通 403、真实认证失效和敏感字段不外泄

## 2. JM 浏览器快照解析入口

- [x] 2.1 从 `JmParser.favourites()` 抽取复用的收藏夹 HTML 纯解析流程，使 HTTP 正常响应与浏览器快照共享条目、分页、去重和已知收藏 ID 更新逻辑
- [x] 2.2 增加仅供 Electron 主进程调用的 JM 收藏夹快照解析 handler，双重校验来源、HTTPS、JM 可信域、收藏夹路径、页码和固定 HTML 大小上限
- [x] 2.3 确保快照解析禁止再次请求同一收藏夹 URL，缺失标题补全为有界非关键步骤，失败时不得把正常快照伪装成空收藏夹
- [x] 2.4 增加 Python 测试，覆盖正常渲染后 DOM、挑战页拒绝、跨域/错误路径拒绝、HTML 超限、分页解析及标题补全失败降级

## 3. 登录窗口挑战模式

- [x] 3.1 将 `electron/login-window.ts` 的内部窗口编排泛化为 `login`/`challenge` 模式，保留公开 `openLoginWindow` 兼容返回值，并支持内部显式 `initialUrl`
- [x] 3.2 实现挑战 URL 验证器：仅允许 HTTPS、无用户信息、默认端口、当前 JM 域或受信镜像、`/user/<安全段>/favorite/albums` 路径及受限 `page` 参数
- [x] 3.3 为普通登录和挑战窗口建立共享单实例/单飞协调器；已有窗口时聚焦并复用 Promise，所有成功、取消、超时、崩溃和退出路径确定性清理 handler 与敏感引用
- [x] 3.4 在挑战完成提取链中校验当前 URL 和挑战 DOM 状态，提取目标域全部 Cookie 与实际 User-Agent，沿现有安全转义路径调用 `apply_auth`
- [x] 3.5 从可信收藏夹主框架捕获渲染后 `outerHTML`，执行固定 5 MiB 上限和敏感日志禁写；公共登录窗口结果必须剥离快照
- [x] 3.6 扩充 `tests/unit/main/login-window.test.ts`，覆盖两种模式、非法 URL、单飞互斥、仍在挑战页、登录跳转、Cookie/UA 同步、快照成功/超限及各类生命周期清理

## 4. 验证叠层交互

- [x] 4.1 通过受控 preload 参数向 `electron/login-preload.ts` 提供窗口模式，不依赖第三方页面可篡改的 DOM 或 URL 文本推断模式
- [x] 4.2 为挑战模式实现“验证助手 / 我已完成验证 / 验证尚未完成 / 验证成功”状态文案和提交流程，同时保持普通登录叠层现有行为
- [x] 4.3 增加叠层测试，覆盖模式文案、挑战未完成不关闭、成功倒计时、重复提交防抖和页面导航后的监听器清理

## 5. Electron 主进程恢复协调

- [x] 5.1 为 preload、共享 `HcomicAPI` 和主进程收藏夹 handler 增加默认关闭的 `allowInteractiveChallenge?: boolean`，逐层验证类型且禁止转发给 Python
- [x] 5.2 在 JM 前台请求捕获 `-32002` 后运行挑战窗口；验证成功后直接调用原 Python 收藏夹请求一次，禁止递归触发交互恢复
- [x] 5.3 Python 自动重试仍被挑战时，将合格浏览器快照交给内部 Python 解析 handler；快照缺失/失败时停止并返回可操作错误，禁止再次自动弹窗
- [x] 5.4 处理用户取消、窗口失败和并发请求：不清除认证、不映射为登录失效，并确保一次用户动作最多一个窗口、一次 Python 重试和一次快照解析
- [x] 5.5 增加主进程与 preload 测试，覆盖交互开关默认值、后台挑战不弹窗、成功重试、快照兜底、取消、二次挑战停止和非法错误载荷

## 6. 收藏夹页面接入

- [x] 6.1 在 `FavouritesPage` 区分前台用户请求与缓存后台刷新/相邻页预加载，仅对无缓存主动加载、显式刷新和用户翻页启用交互恢复
- [x] 6.2 验证取消或最终失败时保留已有漫画、分页与下载状态缓存；无缓存时显示人机验证提示和手动重试入口，禁止显示“登录凭证已失效”
- [x] 6.3 更新其他 `getFavourites` 调用方保持非交互默认，并增加页面测试覆盖缓存刷新不弹窗、用户刷新弹窗、取消保留缓存和恢复成功更新页面

## 7. 安全与完整验证

- [x] 7.1 审计所有新增网络调用继续使用 Electron 默认系统代理 Session 或已调用 `apply_system_proxy_to_session()` 的 Python JM Session，禁止新增直连客户端
- [x] 7.2 审计挑战错误、窗口诊断和 IPC 返回值，确认 Cookie、User-Agent 原文、HTML 正文及令牌均不进入 React renderer 或日志
- [x] 7.3 运行 JM/Python 定向测试、`pytest`、`npx tsc --noEmit`、`npm test`、`npm run lint:py`、`black --check .` 与 `npm run lint`，修复全部回归
