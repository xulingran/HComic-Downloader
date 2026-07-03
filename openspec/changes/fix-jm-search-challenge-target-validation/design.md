## 上下文

JM 搜索挑战的 Python 到 Electron 数据链路本身工作正常：`AntiBotChallengeError` 被序列化为 `-32002`，`extractJmChallengeData` 也能保留 `challengeUrl`。失败发生在最后一步：`openJmChallengeWindow` 调用 `resolveJmChallengeTarget`，而该函数使用 `JM_FAVOURITES_PATH_RE` 作为唯一合法路径。因此新 JM 首页搜索提供的 `https://18comic.vip/` 被拒绝，既有普通搜索的 `/search/photos` 同样无法通过。

当前同一 `resolveJmChallengeTarget` 还被收藏夹快照捕获路径调用。直接放宽这个函数会让首页或搜索页被当成可信收藏夹 DOM 快照，扩大敏感 HTML 的信任边界。测试也存在断层：搜索恢复测试 mock 了 `openJmChallengeWindow`，登录窗口测试则明确断言根 URL 不可信，二者分别通过却掩盖了组合后的矛盾。

## 目标 / 非目标

**目标：**

- 让可信 JM 首页根 URL 与普通搜索 URL 能进入现有交互挑战窗口。
- 保持 HTTPS、域名、端口、userinfo、fragment、路径和查询参数的严格校验。
- 将通用挑战导航校验与收藏夹快照校验分离，使后者继续仅接受收藏夹路径。
- 增加覆盖真实校验器形状的契约测试，防止 recovery 与 login-window 再次漂移。
- 保持一次验证窗口、一次重试和 Cookie Session 复用语义不变。

**非目标：**

- 不修改 Python 的挑战识别、Cookie 双域写入、系统代理或 `verify_auth` 容错。
- 不为搜索实现 DOM 快照兜底，也不捕获首页或搜索页 HTML。
- 不支持任意 JM 页面、详情页、排行页或登录页作为搜索挑战目标。
- 不改变公开 IPC 参数、错误码或 renderer API。

## 决策

### 1. 拆分公共来源校验、挑战导航校验和收藏夹快照校验

在 `login-window.ts` 内将校验分为三层：

1. 公共 JM 来源约束：URL 长度、可解析、HTTPS、无 userinfo、默认端口、可信域、无 fragment。
2. `resolveJmChallengeTarget`：在公共约束上允许三类交互目标——根路径 `/`、搜索 `/search/photos`、收藏夹 `/user/{safe-user}/favorite/albums`。
3. 收藏夹快照专用校验：只接受原有收藏夹路径和 `page` 规则，供 `captureJmChallengeSnapshot` 使用。

挑战窗口只需要导航到受挑战页面以获得 Cookie，因此可以接受受控的首页和搜索目标；快照会把页面 HTML 送入 Python 解析，风险更高，必须继续使用最窄规则。

替代方案是直接给现有正则增加 `/` 和搜索路径。该方案会同步放宽快照捕获，违反最小权限原则，故不采用。另一个方案是把首页挑战 URL改写成收藏夹 URL，但这不会验证真正受挑战的资源，也违反“加载原受挑战 URL”的既有规范。

### 2. 搜索查询参数使用形状白名单

`/search/photos` 仅允许以下参数且每项最多出现一次：

- `main_tag`：必须为 `0`；
- `search_query`：必须存在，允许空字符串，长度受合理上限约束；
- `page`：可选，必须为十进制整数且范围为 1–1000。

根路径禁止任何 query；收藏夹继续只允许可选 `page`。使用 `URLSearchParams.getAll()` 检测重复参数，禁止仅用 `get()` 静默忽略攻击性重复值。返回 URL保持原始受挑战地址，不重新拼接或丢失编码。

### 3. 可信域规则保持完全不变

允许域集合继续由 `resolvedDomain || JM_DEFAULT_DOMAIN` 与 `JM_MIRROR_DOMAINS` 构成；协议、userinfo、端口和 fragment 限制不变。路径扩展不得演变为“可信域下任意页面均可打开”。错误继续在创建 BrowserWindow 前产生，避免向不可信目标发出请求。

### 4. 搜索恢复测试必须覆盖实际目标校验契约

测试分两层：

- `login-window.test.ts` 对根 URL、合法搜索 URL、重复/未知/非法参数、任意路径以及收藏夹快照专用拒绝进行表驱动验证。
- `jm-challenge-recovery.test.ts` 验证首页和普通搜索的原始 `challengeUrl` 被原样传给窗口并在成功后仅重试一次；同时增加一个跨模块契约用例，使用实际 `resolveJmChallengeTarget` 校验 recovery 所接受的 URL 样本，禁止两处 allowlist 再次分叉。

不在单元测试中创建真实 BrowserWindow；安全目标是覆盖实际纯函数校验，而不是依赖完全 mock 的开窗函数。

### 5. 错误映射保留但增加可诊断性

非法目标仍对 renderer 返回不含 URL 的安全文案“人机验证地址无效，请稍后重试”。主进程可以记录不含 query 和 Cookie 的拒绝原因/路径类别，禁止记录完整搜索词或凭据。合法根 URL和搜索 URL不得进入该错误分支。

## 风险 / 权衡

- **[放宽导航路径引入 SSRF/恶意跳转]** → 保持可信域与协议约束，并对路径、参数名、重复项和值实施白名单。
- **[通用校验被快照路径误用]** → 提供名称明确的收藏夹快照专用校验函数，并用首页/搜索拒绝测试锁定。
- **[站点未来新增搜索参数]** → 默认安全失败并通过测试/站点证据显式扩展，不使用任意参数透传。
- **[搜索词出现在日志]** → 诊断只记录目标类别或 pathname，不记录完整 URL/query。
- **[既有收藏恢复回归]** → 原收藏夹路径、用户名解码和页码规则原样迁移到专用校验，并运行收藏夹挑战全套测试。

## 迁移计划

1. 先抽取公共来源校验与收藏夹专用校验，确保现有收藏夹测试全绿。
2. 为 `resolveJmChallengeTarget` 添加根路径与搜索路径规则及负面测试。
3. 补 recovery 与 validator 的跨模块契约测试，复现并关闭“地址无效”分支。
4. 运行 login-window、JM challenge recovery、main handler 定向测试及项目完整七项验证。

本变更不涉及持久化数据和 IPC 迁移。回滚时恢复单一收藏夹目标校验即可，但会重新引入搜索挑战不可恢复问题。

## 待确认问题

无。允许路径、参数白名单和快照边界均已确定。
