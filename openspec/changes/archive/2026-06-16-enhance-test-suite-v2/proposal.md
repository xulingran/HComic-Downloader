## 为什么

上一轮 `strengthen-test-suite` 变更确立了"信号优先于数量"的测试哲学，系统化清理了 Python 端的同义反复（mock 调用断言从高位降到 2.4%），并补齐了 IPC 契约、端到端冒烟、下载集成三块真实行为验证。但审计暴露了三类**新的虚假安全感**，恰好是上一轮未触及的盲点：

1. **安全防线裸奔**：`url_validator.py`（167 行）是抵御 SSRF 的唯一防线——IP 黑名单、DNS 解析、TOCTOU 防护、域名白名单全部集中在此。它被 `downloader.py` 和 `image_downloader.py` 引用，但所有下游测试都把 `download_task` 整个 mock 掉了，导致这条安全防线**从未被真实地验证过**。这是"虚假安全感"最危险的形态。
2. **下载核心链路被 mock 切断**：编排逻辑（`ComicDownloader`）有测试，但 URL 安全校验、代理注入、断点分片、错误路径（超时/损坏/中断/磁盘满）全靠信仰。这是用户真实遭遇故障却测不到的高发区。
3. **前端同义反复尚未清理**：前端 Vitest 套件有 249 处 mock 调用断言（占 40.8%），是 Python 端（2.4%）的 17 倍。其中 `main.test.ts` 的桥接参数转换断言多数是真实行为验证（需保留），但 hooks/stores 的纯 mock 往返是同义反复的高发区，尚未甄别。

为什么现在做：上一轮把 Python 端的纪律沉淀成了 `test-discipline` 长期规范，现在正是把同样的纪律与"危险地带攻坚"的方法论推广到剩余盲点的时机——安全止血、链路打通、前端提纯、状态机深水区，一次性收口。

## 变更内容

### Phase 1 — 安全止血 + 前端提纯（可并行）

- **`url_validator.py` 从零建立专属测试**：验证 SSRF 拦截（127.x/10.x/169.254/::1 等）、DNS rebinding / TOCTOU 防护（可信 CDN 白名单跳过解析）、域名白名单边界。将"靠信仰"的安全防线变成"有护栏"。
- **前端 mock 调用断言甄别审计**：逐文件判定 249 处 `toHaveBeenCalled*` 断言，套用既有准则"把这个 mock 换成真实实现，断言还成立吗？"。重点审计 hooks/stores 的纯 mock 往返；保留 `main.test.ts` 等真实桥接行为验证。产出"删/留"清单并逐条标注理由（遵循 `test-discipline` 的可追溯要求）。

### Phase 2 — 下载核心链路真实行为验证

- **`ImageDownloader` 真实路径测试（mock 网络，不 mock 逻辑）**：用 fixture bytes 注入响应，验证 URL → `UrlValidator.validate` → 代理注入 → 下载 → 断点分片写入的完整链路。
- **错误路径行为验证**：网络超时、损坏响应（非图片字节）、断点续传中断恢复、磁盘写入失败——覆盖用户真实遭遇的故障形态。
- **代理注入契约验证**：落实 AGENTS.md 的硬约束——"新增任何网络请求必须走系统代理"，验证 Session 创建后代理确实被注入。

### Phase 3 — 下载状态机深水区

- **`download_manager` 并发与时序不变量**：验证并发 add/cancel/pause 的竞态安全、PAUSING→PAUSED 异步过渡、回调通知顺序。**严格守"测不变量而非具体时序"纪律**（design.md 已警告）——只断言"已完成任务不被回滚、队列最终一致"，禁止为覆盖率写时序断言。

## 功能 (Capabilities)

### 新增功能

- `download-core-integrity`: 下载核心完整性——验证 `ImageDownloader` / `ComicDownloader` 真实下载链路（URL 安全校验、代理注入、断点续传、错误路径）的端到端行为，用 fixture bytes 注入响应而非真实 HTTP。
- `ssrf-protection`: SSRF 防护——验证 `UrlValidator` 的安全防线（IP 黑名单、DNS 解析、TOCTOU 防护、域名白名单）在各类攻击向量下正确拦截或放行。

### 修改功能

- `behavior-integration-tests`: 新增下载核心链路与错误路径的集成测试需求，扩展"下载到打包"的验证深度（从仅验证编排逻辑，深化到验证 URL 安全校验、代理注入、断点分片的真实路径）。
- `regression-guards`: 新增对 SSRF 拦截、断点续传完整性、状态机不变量的回归守护需求。
- `test-discipline`: 将前端同义反复甄别准则与"测不变量而非时序"的并发测试纪律固化为长期规范要求。

## 影响

- **代码修复（可能）**：实施过程中若在 `url_validator.py` / `image_downloader.py` / `downloader.py` 发现真实 bug（如 SSRF 绕过、代理未注入、断点续传损坏），按上一轮 migration bug 的模式就地修复并标注。当前无预定的破坏性变更。
- **测试变更**：
  - 新增：`tests/test_url_validator.py`（SSRF/白名单/DNS）、`tests/test_image_downloader.py` 或扩展 `tests/test_download_integration.py`（下载核心真实路径 + 错误路径）、`tests/test_download_manager_concurrency.py`（状态机不变量）
  - 精简：前端 hooks/stores 测试中的同义反令断言（逐条标注理由）
- **无 API 变更**，无依赖变更，无破坏性变更（所有测试新增/精简均为内部质量提升；可能的代码修复属 bug fix 范畴，让安全/下载行为符合既有契约）
- **构建时间**：Phase 1/2 新增测试为进程内单元/集成测试，增量约 +2-4s；Phase 3 状态机测试若引入并发等待，增量约 +1-2s。总增量控制在 +5s 内，不引入进程级开销（冒烟已由上一轮覆盖）。
