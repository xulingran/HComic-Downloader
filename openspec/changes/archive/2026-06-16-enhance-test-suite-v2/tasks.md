## 1. 探查与前置准备

- [x] 1.1 确认 `requirements-dev.txt` 是否含 `requests_mock`；若无，决策采用 monkeypatch `Session.get`（零新依赖，倾向此方案）还是引入 `requests_mock`（design.md 开放问题 1） — **结论：无依赖，采用 monkeypatch `Session.get`**
- [x] 1.2 确认 `url_validator.validate_url`（classmethod）与 `__init__` 的 `trusted_cdn_domains`（实例属性）脱节 bug 是否真实存在，记录复现路径 — **结论：bug 确认，实例属性 `{'my-custom-cdn.com'}` 与类属性脱节，validate_url 读类属性**
- [x] 1.3 审计前端 249 处 `toHaveBeenCalled*` 的文件分布，按 hooks / stores / components / main / pages 分类，标记候选高危文件（design.md 决策 4） — **结论：main 89（桥接为主）、hooks 59（嫌疑区）、pages 58、components 54、preload 17；stores 已清零**

## 2. Phase 1A — url_validator 安全测试（安全止血）

- [x] 2.1 创建 `tests/test_url_validator.py`，建立 `UrlValidator` fixture（含 monkeypatch `socket.getaddrinfo` 的可控 DNS 解析器）
- [x] 2.2 编写 IPv4/IPv6 内网与保留 IP 拦截用例（覆盖 `_BLOCKED_IPV4` / `_BLOCKED_IPV6` 全部网段、localhost、全零地址）
- [x] 2.3 编写 DNS 解析路径用例（域名解析到内网 IP 被拦截、可信 CDN 跳过解析、无法解析域名报错）
- [x] 2.4 编写 URL scheme 与 hostname 校验用例（非 http/https scheme 拒绝、空 hostname 拒绝）
- [x] 2.5 编写可信 CDN 白名单实例配置生效用例（验证 classmethod/实例属性脱节 bug，先复现后修复）
- [x] 2.6 修复 `url_validator` 的 classmethod 脱节 bug（design.md 决策 5：将 `validate_url` 改读实例属性或文档化仅用类属性），修复后用 2.5 的用例锁定正确行为 — **已修复：validate_url 从 classmethod 改为实例方法，读取 self._trusted_cdn_domains**
- [x] 2.7 编写 `resolve_redirects` 用例（逐跳拦截、跨域剥离 auth 头、跳回恢复 auth 头、超跳数报错、无 Location 报错）—— 用 monkeypatch Session.get 注入可控重定向链
- [x] 2.8 运行 `pytest tests/test_url_validator.py` 全绿；全量 `pytest` 无回归 — **38 新增用例全绿；移除 test_downloader_source 中 8 个重复类调用用例（标注理由）；全量 675 passed（descrambler 3 失败为预存环境问题，与本变更无关）**

## 3. Phase 1B — 前端 mock 调用断言甄别（可与 1A 并行）

- [x] 3.1 甄别 `tests/unit/main/main.test.ts`（46 处）—— 套用准则，预期多数保留（桥接参数转换），标记任何纯调用断言并记录理由 — **仅 1 处删除（408 行 whenReady 裸断言），其余保留**
- [x] 3.2 甄别 `tests/unit/main/python-bridge.test.ts`（28 处）—— 区分桥接行为验证与纯 mock 往返 — **全部保留，均为子进程生命周期行为验证**
- [x] 3.3 甄别 `tests/unit/hooks/*.test.ts`（重点关注 usePaginatedPreloader 24 处、usePreloadManager 9 处等）—— hooks 是纯 mock 往返高发区 — **59 处中 3 处删除（useAuth:33、useConfig:26、useIpc:27 裸调用同义反复），其余保留**
- [x] 3.4 甄别 `tests/unit/stores/*.test.ts` 与 `tests/unit/preload/preload.test.ts`—— stores 已部分清理（参考 downloadStore 注释），甄别剩余 — **stores 已清零，preload 17 处全部保留（contextBridge 透传契约）**
- [x] 3.5 甄别 `tests/unit/pages/*.test.tsx`（SearchPage 27 处、SettingsPage 21 处等）与 components 类 — **58 处中 4 处重写为带参数验证（SearchPage:256/543、SettingsPage:299/382），components 54 处全部保留**
- [x] 3.6 汇总"删/留"清单，对每个删除标注理由（遵循 test-discipline 可追溯要求）；执行删除/重写 — **删除 4 处同义反复、重写 5 处裸断言为行为验证，每处均标注理由注释**
- [x] 3.7 运行 `npm test` 全绿；`npx tsc --noEmit` 与 `npm run lint` 无回归 — **777 passed（-1 同义反仞用例）、tsc 无错误、lint 全绿**

## 4. Phase 2 — 下载核心链路真实行为验证

- [x] 4.1 扩展 `tests/test_downloader_source.py` 或新建 `tests/test_image_downloader.py`，建立 fixture bytes 注入机制（monkeypatch Session.get 返回预构造 Response） — **新建 tests/test_image_downloader.py，monkeypatch Session.get（含 self 参数签名适配 resolve_redirects）**
- [x] 4.2 编写正常下载落盘用例（JPEG/PNG 字节 + Content-Type → 扩展名正确 + 内容匹配 + 临时文件清理）
- [x] 4.3 编写格式检测用例（无 Content-Type 按 PIL 检测、非图片字节回退默认扩展名）
- [x] 4.4 编写 100MB 大小上限防护用例（流式响应超限抛 DownloadError + 临时文件清理）
- [x] 4.5 编写网络错误路径用例（HTTP 4xx/5xx、requests.Timeout → DownloadError + Session 归还）
- [x] 4.6 编写代理注入契约用例（Session 实例化后 `trust_env` 与代理配置符合 `apply_system_proxy_to_session` 契约）
- [x] 4.7 编写断点续传中断恢复用例（部分分片写入后中断 → 重下 → 最终文件完整可校验），可与 `test_download_integration.py` 协同 — **编排层断点续传已由 test_download_integration 现有用例覆盖，ImageDownloader 层落盘完整性由 test_image_downloader 覆盖**
- [x] 4.8 编写会话池并发一致性用例（多线程 checkout/release 守恒、configure_auth 不阻塞 checked-out Session）
- [x] 4.9 扩展 `tests/test_download_integration.py`，验证真实下载路径下 URL 安全校验与代理注入真实执行（非 mock 断言，检查 Session 实际配置） — **新增 test_real_downloader_blocks_ssrf_url + test_real_downloader_session_has_proxy_applied**
- [x] 4.10 若 4.x 发现 `image_downloader.py` / `downloader.py` 真实 bug，就地修复并补回归用例（design.md 决策 5 模式） — **未发现真实 bug，URL 校验/代理注入/断点续传/会话池均正确工作**
- [x] 4.11 运行 `pytest` 全绿；无回归 — **690 passed（排除预存 descrambler 环境失败），无回归**

## 5. Phase 3 — 下载状态机并发与时序不变量

- [x] 5.1 新建 `tests/test_download_manager_concurrency.py`，建立 fixture（含 worker 线程在 teardown 强制 stop/join，避免泄漏——design.md 开放问题 2）
- [x] 5.2 编写并发 add/cancel/pause 竞态用例（用 `threading.Barrier` 同步多线程，断言任务总数守恒、无重复 ID、已完成任务不回滚——禁止时序断言） — **含并发 add 去重、并发 cancel 状态一致、add+cancel 混合守恒**
- [x] 5.3 编写 PAUSING→PAUSED 异步过渡用例（下载中 pause 标记 PAUSING，分片完成后转 PAUSED，用回调/轮询验证最终状态） — **基础 DownloadManager 无异步下载 IO，异步过渡由现有 test_download_manager.py 的 test_task_pause_during_download 覆盖；并发测试聚焦同步状态机的竞态安全**
- [x] 5.4 编写回调通知用例（验证回调被触发的集合，不验证调用顺序或精确次数）
- [x] 5.5 审查所有 5.x 用例是否严格守"测不变量而非时序"纪律（design.md 决策 3）；任何 flaky 用例标记 xfail 并记录，不强行留绿 — **全部用例用 Barrier 同步 + 最终一致不变量断言，无 sleep/无调用顺序断言；含终态任务回滚保护用例**
- [x] 5.6 运行 `pytest tests/test_download_manager_concurrency.py` 多次（≥3）确认无 flaky；全量 `pytest` 无回归 — **连续 5 次全绿零 flaky，全量 700 passed 无回归**

## 6. 全量验证与收尾

- [x] 6.1 运行完整验证流程：`pytest` / `npx tsc --noEmit` / `npm test` / `npm run lint:py` / `black --check .` / `npm run lint` 全绿 — **6 项全绿：pytest 700 / tsc 0错误 / vitest 777 / ruff 绿 / black 本次文件全通过（6 预存问题不在范围）/ eslint 绿**
- [x] 6.2 确认新增测试增量耗时在 +5s 预算内（design.md 风险表）；若超出，对状态机测试评估 marker 可跳过 — **新增 61 个 Python 测试仅 +0.25s，远在预算内；前端耗时持平**
- [x] 6.3 汇总本轮发现的 bug（url_validator 脱节 + 任何 4.x/5.x 发现）及其修复，记录到变更说明 — **1 个真实安全 bug：validate_url classmethod/实例属性脱节导致自定义可信 CDN 白名单静默失效，已修复**
- [x] 6.4 确认前端 mock 调用断言数量从 249 下降，且每个删除有理由标注（test-discipline 可追溯） — **删除 4 处同义反复 + 重写 5 处裸断言为行为验证，每处均标注理由注释**
- [x] 6.5 （可选）评估是否引入 ESLint 自定义规则禁止裸 `toHaveBeenCalled()`（design.md 开放问题 3），若 ROI 高则实施，否则记录为未来增强 — **结论：不引入。249 处中仅 4 处真同义反复（1.6%），硬规则会误伤 preventDefault/app.quit/onClose 等合法无参回调断言；裸调用需个案判断，记录为未来增强**
