## 上下文

Electron 登录窗口能够取得有效的 JM `remember_id` 等 Cookie，Python 后端使用 `curl_cffi.Session`、系统代理和同一认证数据访问站点。当前登录校验访问首页，而收藏夹访问 `/user/{username}/favorite/albums`；Cloudflare 会对后者间歇性返回挑战响应。现场对同一 Cookie 和网络上下文的重复请求观察到收藏夹在 200 与 403 之间切换，403 带有 `cf-mitigated: challenge` 和挑战页正文，证明这不是确定性的凭证失效。

现有实现存在两处放大问题：`JmParser._is_challenge_page()` 把正文长度达到 500 字节视为非挑战，无法识别约 6 KB 的现代挑战页；`favourites()` 又在正文检测前调用 `raise_for_status()`。异常到达 `SearchMixin` 后，字符串关键词表会把任何包含 `403`、`cloudflare` 或 `just a moment` 的错误转换为 `AuthRequiredError`。

## 目标 / 非目标

**目标：**

- 可靠识别带响应头或稳定正文特征的 JM Cloudflare 挑战。
- 在同一会话及代理上下文中对收藏夹挑战进行少量、有界的恢复尝试。
- 通过结构化异常让 IPC 明确区分挑战与认证失效。
- 保持现有成功路径、IPC 方法签名与配置格式不变，并用单元测试覆盖所有分支。

**非目标：**

- 不实现或绕过 Cloudflare CAPTCHA/JavaScript 挑战。
- 不更换 JM 域名发现策略，不修改 Cookie 提取或持久化格式。
- 不在本变更中调整 Electron 148 与 curl_cffi Chrome 136 的指纹版本；现有对照尚不足以证明它是本次间歇性故障的决定因素。
- 不为所有来源建立通用 HTTP 重试框架。

## 决策

### 1. 以响应级检测替代正文长度启发式

新增响应级判断，优先检查大小写不敏感的 `cf-mitigated: challenge`；随后检查正文中的稳定标记，例如 `/cdn-cgi/challenge-platform/`、`cf-chl-`、`challenge-platform` 或页面标题中的 `Just a moment`。正文长度不再作为排除条件。

保留纯正文检测入口用于已有调用和测试，但收窄过于宽泛的 `cloudflare`/`cf-` 匹配，避免正常页面脚本或页脚产生误报。

替代方案是仅依据 HTTP 403。该方案会混淆真实权限错误，无法满足错误语义区分，因此不采用。

### 2. 收藏夹使用同 Session 的有界重试

将单次收藏夹 GET 封装为小型请求流程：首次响应若为挑战，可在同一 Session 中进行一次首页预热并重试收藏夹；收藏夹重试总数设固定上限（实现时以最多两次重试为边界）。每次请求继续使用 `_auth_headers()`，从而保留显式 Cookie 回退、User-Agent、系统代理和域名。

仅对已明确识别的挑战重试；登录重定向、普通 HTTP 错误和解析错误不参与挑战重试。重试耗尽后抛出结构化挑战异常。

替代方案是创建新的 Session 或直接使用标准 `requests` 重试适配器。新 Session 容易丢失 Cookie/代理/TLS 上下文，通用状态码重试又会错误重试认证失败，因此不采用。

### 3. 用结构化异常跨越 parser 与 IPC 边界

在共享 parser 基础模块中增加 `AntiBotChallengeError`（继承 `ParserResponseError`），JM 在恢复失败时抛出该类型。`SearchMixin._auth_error_guard()` 必须在通用 `ParserResponseError` 和字符串关键词判断之前捕获它，并转成普通可恢复运行时错误，文案说明站点人机验证及稍后重试建议。

该类型放在 `sources/base.py`，避免 IPC 反向依赖具体的 JM parser。字符串关键词表暂不做跨来源重构，以控制变更范围；结构化异常优先级保证 JM 挑战不会进入旧的认证误判分支。

替代方案是刻意避免在错误消息中写 `403` 或 `cloudflare`。这种做法依赖文案细节且容易回归，不采用。

### 4. 登录语义保持显式证据驱动

收藏夹只有在最终 URL 指向登录页，或正常 HTML 中出现明确登录提示时，才返回 `needs_login=True`。Cloudflare 挑战即使状态为 403，也不得清空或判废 Cookie。

`verify_login_status()` 遇到挑战时仍可返回 `valid=False`（现有布尔 IPC 无法表达“未知”），但消息必须描述“服务端校验被人机验证阻断”，禁止声称 Cookie 已过期。登录窗口现有的“保存凭证但校验不阻断”行为继续保留。

## 风险 / 权衡

- [Cloudflare 持续挑战无法由 HTTP 客户端解决] → 有界停止并给出准确提示，不循环、不伪报登录失效。
- [额外请求增加延迟和站点负载] → 只在明确挑战时触发，并限制预热及重试次数。
- [正文特征可能误判] → 优先使用响应头，正文只采用稳定且具体的挑战平台标记，并增加正常长页面反例测试。
- [共享异常会影响捕获顺序] → 新类型继承现有 `ParserResponseError`，仅增加更具体的前置分支，其他来源行为保持不变。
- [字符串认证判断仍较宽泛] → 本次以结构化异常隔离已知问题；全面替换关键词分类可作为后续独立重构。

## 迁移计划

1. 先增加挑战异常和检测函数测试。
2. 接入收藏夹有界恢复并验证成功、耗尽、登录跳转路径。
3. 调整 IPC 捕获顺序并验证用户错误文案。
4. 运行 JM 定向测试、Python 全量测试及项目规定的 lint/format 检查。

本变更无数据迁移。若出现回归，可回滚请求重试和异常分支；现有 Cookie 与配置无需恢复。

## 开放问题

- 后续是否将 `AntiBotChallengeError` 推广到其他受 Cloudflare 保护的来源，由实际故障证据另行决定。
- 若有界重试仍频繁失败，是否需要新增 Electron 主进程代请求或浏览器会话回退，暂不纳入本变更。
