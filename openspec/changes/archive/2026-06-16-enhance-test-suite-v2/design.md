## 上下文

上一轮 `strengthen-test-suite` 变更确立了"信号优先于数量"的测试哲学，系统化清理了 Python 端的同义反复（mock 调用断言降到 2.4%），并建立了 IPC 契约、端到端冒烟、下载集成三块真实行为验证。本轮承接，攻坚三类**新的虚假安全感**盲点。

实施前代码审计确认了以下现实（非推测）：

1. **`url_validator.py` 是 SSRF 唯一防线，且存在 classmethod 与实例属性脱节的隐患**：`validate_url` 是 `@classmethod`，读取的是 `cls._TRUSTED_CDN_DOMAINS`（类属性）；但 `__init__` 在传入 `trusted_cdn_domains` 时写到 `self._trusted_cdn_domains`（实例属性）。两者脱节意味着实例化时自定义白名单不会生效于 `validate_url`。这条安全防线从未被真实测试，此类问题不会被现有测试捕获。
2. **下载核心链路被 mock 切断**：`ComicDownloader` 编排逻辑有测试，但 `test_downloader_source.py` 中 `image_downloader.download_task = lambda: True` 把 URL 校验、代理注入、断点分片、错误路径全部跳过。`ImageDownloader.download` 内部的 `resolve_redirects`（动态剥离/恢复 auth 头防盗泄漏）、100MB 上限防护、格式检测 fallback——全靠信仰。
3. **状态机并发与时序是高危区**：`download_manager.py` 用 `threading.Lock` + `Condition` + `Event` 实现 `QUEUED→DOWNLOADING→PAUSING→PAUSED→CANCELLED` 状态机，worker 线程消费队列。并发 add/cancel/pause 的竞态、PAUSING→PAUSED 异步过渡——这是 design.md（上一轮）标注的"最近 bug 反复出现的地方"。
4. **前端 mock 调用断言 249 处需甄别，不可一刀切**：抽样 `main.test.ts`（46 处）发现多数是真实的桥接参数转换验证（camelCase→snake_case），应保留；但 `downloadStore.test.ts` 已在上轮清理过（注释引用 strengthen-test-suite）。结论：前端甄别必须逐文件套用既有准则，不能按文件类型批量删。

当前架构关键约束：所有网络请求必须走 `apply_system_proxy_to_session`（AGENTS.md 硬约束）；下载链路为 URL 校验→代理注入→流式下载→格式检测→落盘；状态机为单 worker 线程消费队列。

## 目标 / 非目标

**目标：**

- 把 SSRF 防线从"靠信仰"变成"有护栏"——`url_validator` 各攻击向量（IP 黑名单、DNS 解析、TOCTOU、白名单）逐一被真实测试覆盖
- 把下载核心链路从"mock 切断"变成"路径打通"——`ImageDownloader` 真实路径（含 URL 校验、代理、断点、错误）被验证
- 把状态机从"单线程顺序验证"扩展到"并发不变量验证"——锁定竞态安全与异步过渡正确性
- 把前端 249 处 mock 断言从"未经甄别的噪音"变成"逐条标注理由的信号"——延续上轮 test-discipline
- 若实施中发现真实 bug（如上述 classmethod 脱节），就地修复并标注，作为回归守护的一部分

**非目标：**

- 不追求覆盖率数字（覆盖率衡量"执行过"而非"验证过"）
- 不为四个解析器补全所有错误路径（网站改版时全挂，维护负担重——继承上一轮决策）
- 不引入 Playwright 全链路 UI E2E（桌面应用 ROI 极低——继承上一轮决策）
- 不重写网络 mock 策略（网络层用 fixture bytes 注入是正确的，继承上一轮）
- 不测时序细节（状态机测试只测不变量，禁止时序断言——继承上一轮 design.md 警告）
- 不为 `main.test.ts` 的真实桥接行为验证做减法（甄别准则决定它们应保留）

## 决策

### 决策 1：`url_validator` 测试策略 —— 注入而非 mock 网络层，DNS 用 monkeypatch

**选择**：
- IP 黑名单、scheme 校验、hostname 校验、域名白名单：直接调用 `validate_url`，断言抛 `DownloadError` 或正常返回，**不涉及网络**。
- DNS 解析路径：用 `monkeypatch.setattr(socket, "getaddrinfo", fake_resolver)` 注入可控的解析结果，验证"域名解析到内网 IP 被拦截""可信 CDN 跳过解析"。
- `resolve_redirects`：用 `requests_mock` 或本地 HTTP test server（`http.server`）注入可控的重定向链，验证 auth 头剥离/恢复、跳数上限、无 Location 报错。
- **不**真实发起网络请求（继承上一轮"进程内而非进程间"原则）。

**理由**：
- `validate_url` 的安全逻辑是纯函数性质（输入 URL + DNS 解析结果 → 拦截/放行决策），最适合用注入而非真实网络验证。
- DNS rebinding / TOCTOU 是 `url_validator` 的核心防御点，必须显式测试——而真实 DNS 无法稳定复现攻击向量，必须注入。
- `resolve_redirects` 的 auth 头动态管理是复杂状态逻辑（跨跳转剥离/恢复），test server 或 requests_mock 能精确控制重定向序列，比真实网络可靠。

**替代方案**：
- 用真实 DNS + 公网域名：不可复现、CI 不稳定、无法测攻击向量。
- 全程 mock `requests.Session`：丢失 `url_validator` 与 `requests` 真实交互的信号，退回同义反复。

### 决策 2：`ImageDownloader` 链路测试深度 —— fixture bytes 注入，验证落盘与格式

**选择**：
- 用 `requests_mock` 或 monkeypatch `Session.get` 注入预构造的 `Response`（含真实 JPEG/PNG 字节、Content-Type、状态码），调用真实 `ImageDownloader.download`。
- 验证可观察结果：落盘文件存在、扩展名正确（按 Content-Type / PIL 检测）、内容字节匹配 fixture、临时文件清理。
- 错误路径：注入超时（`requests.Timeout`）、非图片字节（验证格式检测 fallback）、超大响应（验证 100MB 上限抛错）、HTTP 4xx/5xx（验证 `raise_for_status`）。
- 断点续传：用真实分片写入验证中断后重下不损坏已下载部分（继承上一轮 `test_download_integration` 的真实文件系统策略）。
- 代理注入契约：实例化后断言 `session.proxies` 或 `trust_env` 符合 `apply_system_proxy_to_session` 契约（验证 AGENTS.md 硬约束被落实）。

**理由**：
- 这条链路是用户真实遭遇故障的高发区，而当前测试把整条链路 mock 掉了。
- fixture bytes 注入能在不依赖真实网络的前提下，验证从 URL 校验到落盘的完整真实路径——这正是上一轮 design.md"进程内而非进程间（除冒烟外）"原则的延续。
- 代理注入是 AGENTS.md 明确的硬约束，必须有测试守护，否则新增网络请求时容易遗漏。

**替代方案**：
- 真实 HTTP（本地 test server）：最真实但复杂度高，且下载逻辑对 test server 的依赖会引入新的不稳定因素。
- 继续 mock `download_task`：现状，已被证明无法捕获 URL 校验/代理/断点问题。

### 决策 3：状态机测试纪律 —— 不变量优先，禁止时序断言，用 threading 显式构造竞态

**选择**：
- 并发竞态：用 `threading.Barrier` 或 `threading.Event` 显式同步多个线程同时调用 `add_task`/`cancel_task`/`pause_task`，断言**最终一致的不变量**（任务总数守恒、无重复 ID、已完成任务状态不被回滚）。
- PAUSING→PAUSED 异步过渡：验证"pause_task 在下载中时标记 PAUSING，下载分片完成后转为 PAUSED"这一**状态契约**，用回调或轮询验证最终状态，不测具体耗时。
- 回调通知：验证回调被触发的**集合**（如下载完成时 on_task_update 被调用），不验证调用顺序或次数的精确值。
- **明确禁止**：`time.sleep` + 断言时序、断言 mock 调用顺序、断言线程调度的具体行为。

**理由**：
- 上一轮 design.md 已警告"测不变量而非具体时序"——时序敏感的测试天然脆弱，且容易退化为"验证 mock 调用顺序"的同义反复。
- 状态机的价值在于"最终一致"而非"中间状态精确"，不变量测试能抓住真实回归（如任务丢失、状态回滚）而不会因调度抖动误报。
- 显式构造竞态（Barrier/Event）比 sleep 更可靠地复现并发场景，避免 flaky 测试。

**替代方案**：
- 属性测试（hypothesis）：能探索更多并发交错，但引入新依赖且复杂度高，本轮不引入。
- 模型检查（如用线程数参数化暴力枚举）：过度工程化。

### 决策 4：前端甄别策略 —— 逐文件套准则，产出"删/留"清单而非批量删

**选择**：
- 对每个含 `toHaveBeenCalled*` 的前端测试文件，逐断言应用既有准则："如果把这个 mock 换成真实实现，断言还成立吗？"
- **保留**：`main.test.ts` 中验证 camelCase→snake_case 转换、IPC 通道注册完整性、参数映射的真实桥接行为（已抽样确认）。
- **删除/重写**：hooks/stores 中仅验证"mock 被调用"而无状态或输出验证的纯往返断言。
- 每个删除逐条标注理由（遵循 `test-discipline` 的可追溯要求），先标记后确认，不批量操作。
- 候选工具：可考虑引入 ESLint 自定义规则禁止裸 `toHaveBeenCalled()`（无参数、无伴随输出断言），但作为可选增强，不强制。

**理由**：
- 抽样证明前端 mock 断言价值分布不均——`main.test.ts` 多为真实行为，hooks/stores 是嫌疑区。一刀切会误删有价值测试或漏删噪音。
- 逐文件甄别的工作量大但机械，适合在 tasks.md 中按文件分块推进。
- 上轮 Python 端的精简已证明"逐条标注理由"的流程可执行且有审计价值。

**替代方案**：
- 按"删掉覆盖率不掉"的逆向逻辑：方向相反，会误判（覆盖但不提供信号的测试应删）。
- 全部保留只新增：加剧噪音，违背初衷。

### 决策 5：`url_validator` classmethod 脱节 bug 的处置 —— 修复优先于测试

**选择**：实施 Phase 1 时若确认 `validate_url`（classmethod）与 `__init__` 的 `trusted_cdn_domains`（实例属性）脱节，**先修复代码再写测试**。修复方向：将 `validate_url` 改为实例方法（读取 `self._trusted_cdn_domains`），或在 classmethod 中明确文档化"仅用类属性"并移除 `__init__` 的误导性参数。修复后用测试锁定正确行为作为回归守护。

**理由**：
- 这是安全防线上的真实缺陷——自定义白名单静默失效属于"安全功能看似配置了实际没生效"，必须修复而非绕过测试。
- 修复优先确保测试锁的是正确行为而非当前缺陷行为（继承上一轮 migration bug 的处理模式）。

**替代方案**：
- 仅测试当前（缺陷）行为：会锁定 bug，违背"测试守护正确性"的初衷。

## 风险 / 权衡

| 风险 | 缓解 |
|------|------|
| DNS/重定向注入测试可能脆弱（依赖 monkeypatch 时机） | 用 pytest fixture 保证 monkeypatch 自动还原；测决策结果（抛错/放行）而非内部调用 |
| `requests_mock` 等是否已在依赖中 | 实施时探查；若无则优先 monkeypatch `Session.get` 而非新增依赖（遵循上轮"避免新增依赖"倾向） |
| 状态机并发测试 flaky | 严格守决策 3——只测不变量，用 Barrier/Event 显式同步而非 sleep；若仍 flaky 则标记 xfail 并记录，不强行留绿 |
| 前端甄别误删有价值测试 | 逐条标注理由，先标记后确认；保留 `main.test.ts` 的桥接行为验证；遵循 test-discipline 可追溯要求 |
| 修复 `url_validator` bug 可能影响现有行为 | 修复前用 git 确认调用点；修复后跑全量测试确认无回归；bug 本身是"自定义白名单失效"，修复合让配置生效，属正向 |
| 新增测试拖慢反馈（+5s 预算） | 进程内测试为主；状态机测试若慢则用 marker 标记可跳过；不引入进程级开销 |

## 开放问题

1. **`requests_mock` 依赖**：项目 `requirements-dev.txt` 是否已含？若无，Phase 2 倾向 monkeypatch `Session.get`（零新依赖）还是引入 `requests_mock`（更声明式）？实施时探查决定。
2. **状态机并发测试的隔离**：`download_manager` 的 worker 线程是否需要在测试中强制 join 或用 `stop()` 兜底，避免线程泄漏影响后续测试？实施时用 fixture 的 teardown 保证清理。
3. **前端 ESLint 自定义规则**：是否值得引入"禁止裸 `toHaveBeenCalled()`"规则作为长期护栏？本轮作为可选，视甄别工作量决定。
4. **`url_validator` bug 修复的范围**：除 classmethod 脱节外，`resolve_redirects` 的 auth 头管理是否也有边界缺陷？实施时以测试驱动发现，发现的 bug 就地修复。
