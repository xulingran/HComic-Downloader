## 1. URL 校验边界拆分

- [x] 1.1 在 `electron/login-window.ts` 抽取 JM 挑战 URL 的公共来源约束，统一校验长度、URL 解析、HTTPS、可信域、userinfo、端口和 fragment。
- [x] 1.2 将收藏夹路径、用户名解码和可选 `page` 校验迁移到名称明确的收藏夹专用校验函数，保证现有收藏夹目标行为完全等价。
- [x] 1.3 修改 `resolveJmChallengeTarget`，在公共来源约束上允许无 query 的根路径 `/`，返回原始可信首页目标。
- [x] 1.4 为 `/search/photos` 增加严格参数校验：`main_tag=0`、必需且单值的 `search_query`、可选单值 `page=1..1000`，拒绝未知、重复或非法参数。
- [x] 1.5 更新收藏夹快照捕获入口，使其显式调用收藏夹专用校验，禁止首页和搜索页进入 DOM 快照结果。

## 2. 搜索挑战恢复接入

- [x] 2.1 确认 `openJmChallengeWindow` 使用扩展后的交互目标校验，而收藏夹静默/可见快照路径仍使用收藏夹专用校验。
- [x] 2.2 保持 `recoverJmSearchChallenge` 将 Python 的首页或搜索 `challengeUrl` 原样交给窗口，并在验证成功后仅用原参数重试 `search` 一次。
- [x] 2.3 为 URL 校验失败增加不含完整 query、搜索词或 Cookie 的安全诊断，renderer 继续收到既有通用错误文案。
- [x] 2.4 确认 Cookie 双域 jar 写入、`verify_auth=false` 登录容错、窗口单飞与收藏夹快照兜底均不受改动。

## 3. 回归测试

- [x] 3.1 扩展 `tests/unit/main/login-window.test.ts`：接受可信默认域/自定义域根 URL，拒绝根 URL query、fragment、非 HTTPS、非可信域和任意路径。
- [x] 3.2 增加 `/search/photos` 表驱动测试，覆盖合法中文/空搜索词、可选页码，以及未知参数、重复参数、非法 main_tag、缺失 search_query 和越界页码。
- [x] 3.3 增加收藏夹快照专用边界测试，断言首页与搜索 URL 可以导航但不能作为收藏夹快照，既有收藏夹 URL仍可捕获。
- [x] 3.4 扩展 `tests/unit/main/jm-challenge-recovery.test.ts`：首页根 URL和普通搜索 URL原样传给挑战窗口，成功后只重试一次且不调用快照入口。
- [x] 3.5 增加 recovery 与实际 URL 纯函数校验的跨模块契约测试，防止恢复层样本与 login-window allowlist 再次分叉。
- [x] 3.6 保留非法来源/路径测试，确认不创建 BrowserWindow、不发网络请求，并运行收藏夹挑战恢复全套回归。

## 4. 验证与收尾

- [x] 4.1 运行 login-window、jm-challenge-recovery、main handler 和 preload 定向测试。
- [x] 4.2 运行 `npx tsc --noEmit`、`npm test` 与 `npm run lint`。
- [x] 4.3 运行 `pytest`、`npm run lint:py` 和虚拟环境中的 `black --check .`，确认 Electron 改动未影响后端契约。
- [x] 4.4 以 UTF-8 环境运行 `npm run lint:test-quality`，确认新增测试通过测试纪律闸门。
- [x] 4.5 使用 `https://18comic.vip/` 和合法 `/search/photos` 样本做一次主进程目标解析 smoke test，确认不再返回“人机验证地址无效”，并严格验证收藏夹快照仍拒绝两者。
