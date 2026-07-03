## 上下文

JM 搜索挑战恢复的端到端链路在验证窗口"成功"后仍失败。日志显示：Cookie 已从 Electron 同步到 Python session jar（26 cookies / 52 entries），但 `verify_auth` 返回 `valid=false`（Python 用自己的 TLS 指纹请求首页仍收到 Cloudflare 挑战页），随后的搜索重试自然也仍被挑战。

根因有两层：

1. **TLS 指纹不匹配**：`curl_cffi` 的 `IMPERSONATE_BROWSER = "chrome136"` 与 Electron 42（Chromium 142）的 TLS 指纹不一致。Cloudflare `cf_clearance` Cookie 绑定 TLS 指纹，跨进程复用时被拒。
2. **搜索无快照兜底**：收藏夹恢复在 Python 重试仍被挑战时，把验证窗口已捕获的 DOM HTML 交给 `parse_jm_favourites_snapshot` 解析，完全绕过 Python HTTP 请求。搜索恢复没有对称机制——`recoverJmSearchChallenge` 在 `stillChallenged` 时直接返回失败。

当前 `fix-jm-search-challenge-target-validation` 变更已修复了挑战窗口 URL 校验（允许 `/` 和 `/search/photos` 进入窗口），但设计文档明确把"不为搜索实现 DOM 快照兜底"列为非目标——其前提是"Python 重试在验证后应该能工作"，而 TLS 指纹不匹配使此前提不成立。

## 目标 / 非目标

**目标：**

- 将 `curl_cffi` TLS 指纹对齐到 Electron 42 的 Chromium 142，尽量让 Python 重试直接通过 Cloudflare（第一道防线）。
- 为搜索挑战恢复增加与收藏夹对称的 DOM 快照兜底，覆盖关键词搜索（`/search/photos`）和首页空搜索（`/`），在 Python 重试仍被挑战时完全绕过 Python HTTP 请求（保底）。
- 支持搜索静默快照恢复：首次快照兜底成功后，后续用户翻页优先使用隐藏窗口快照，避免先触发必失败的 Python 请求。
- 保持收藏夹恢复现有行为不变，保持跨类 URL 校验隔离（搜索/首页 URL 不可作为收藏夹快照，反之亦然）。

**非目标：**

- 不修改 Cloudflare 挑战识别逻辑、Cookie 双域写入、系统代理或 `verify_auth` 容错策略。
- 不为排行搜索（`/albums?t=...`）或漫画 ID 直搜（`/album/{id}`）实现快照兜底——这两类路径不走 `/search/photos`。
- 不改变公开 IPC 参数、错误码或 renderer API。
- 不改变收藏夹快照的信任边界（仍仅接受 `/user/{name}/favorite/albums`）。

## 决策

### 1. TLS 指纹对齐到 chrome142

Electron 42 运行 Chromium 142。curl_cffi 0.15.0 支持 `chrome142`（已验证在 `.venv` 中可用）。

将 `IMPERSONATE_BROWSER` 从 `"chrome136"` 改为 `"chrome142"`，同步更新 `HEADERS` 中的 `User-Agent`（`Chrome/142.0.0.0`）和 `Sec-Ch-Ua`（`v="142"`）。同时消除 `cover_mixin.py` 和 `title_resolver.py` 中硬编码的 `chrome136` 字面量，统一引用 `IMPERSONATE_BROWSER`。

**替代方案**：动态检测 Electron 版本并匹配 curl_cffi 支持的最近目标。但 curl_cffi 的 impersonate 目标是离散枚举（chrome99/131/133a/136/142/145/146），与 Chromium 版本不是 1:1 映射，动态匹配引入复杂度且无法保证 TLS 指纹精确对齐。手动对齐到 `chrome142` 更简单可靠，Electron 升级时同步更新即可。

### 2. 搜索快照解析复用现有解析器

搜索快照解析调用 `_parse_search_results(html, domain=domain)`——与 live `search()` 关键词路径完全一致。首页快照解析调用 `_parse_home_sections(html, domain=domain)`——与 live `home()` 完全一致。两者均不发起网络请求。

**返回结构差异**：
- 关键词搜索快照返回 2-tuple `(comics, pagination)`，IPC handler 返回 `{comics, pagination}`（无 `needsLogin`，与 `SearchResult` 一致）。
- 首页快照返回 `list[tuple[str, list[ComicInfo]]]`（sections 列表），IPC handler 复用 `handle_search` 的 sections 组装逻辑，返回 `{comics, pagination, sections}`。

### 3. URL 校验三层分离，按用途分派

延续 `fix-jm-search-challenge-target-validation` 的三层校验架构：

| 层 | 函数 | 适用场景 |
|---|---|---|
| 公共来源约束 | `resolveJmOrigin` | 所有 JM URL（HTTPS/可信域/无userinfo/默认端口/无fragment） |
| 交互挑战窗口目标 | `resolveJmChallengeTarget` | 导航用：接受 `/`、`/search/photos`、收藏夹路径 |
| 收藏夹快照校验 | `validateJmFavouritesSnapshotUrl` | DOM 快照用：仅接受收藏夹路径（现有，不变） |
| 搜索快照校验（新增） | `validateJmSearchSnapshotUrl` | DOM 快照用：仅接受 `/search/photos` + 查询参数白名单 |
| 首页快照校验（新增） | `validateJmHomeSnapshotUrl` | DOM 快照用：仅接受 `/`（无 query） |

`captureJmChallengeSnapshot` 参数化校验器：新增可选 `urlValidator` 参数，默认为 `validateJmFavouritesSnapshotUrl`（保持现有行为），挑战窗口根据当前 URL 路径选择对应校验器传入。

**替代方案**：在 `captureJmChallengeSnapshot` 内部根据 URL 路径自动分派。但显式参数化更清晰、可测试，且避免隐式行为分支。

### 4. 搜索快照兜底与收藏夹对称

`recoverJmSearchChallenge` 镜像 `recoverJmChallenge` 的编排：

1. （可选）静默快照优先：若此前交互恢复已通过搜索快照成功，先用隐藏窗口捕获快照。
2. 核心编排：开窗 → cookie 同步 → 重试 `search` 一次。
3. 重试仍被挑战且有合格快照 → `parseSearchSnapshotFallback`：根据 searchParams 判断是首页（空 query + keyword mode + page 1）还是关键词搜索，分别调 `parse_jm_home_snapshot` / `parse_jm_search_snapshot`。
4. 快照成功 → 记录静默恢复状态。

新增模块级状态 `preferSilentSearchSnapshotRecovery` 和 `lastSearchSnapshotParams`，与收藏夹的 `preferSilentSnapshotRecovery` / `lastSnapshotSourceUrl` 对称。

### 5. search_query 绑定校验

搜索快照验证器额外校验 URL 中的 `search_query` 参数解码后必须等于请求的 `query`——防止快照页面 A 的结果被当作查询 B 的结果返回。收藏夹快照无此需求（只有 `page` 参数）。Python 端 `_build_search_url` 用 `quote(keyword)` 编码，验证器用 `unquote(parsed.search_query) == query` 校验。

## 风险 / 权衡

- **[TLS 指纹对齐后仍可能被挑战]** → Cloudflare 可能校验 JA3 之外的信号。指纹对齐是第一道防线，搜索快照兜底是保底。两者叠加后，即使指纹对齐失败，用户仍能通过快照获得搜索结果。
- **[Electron 升级后指纹漂移]** → 新增 `test_jm_fingerprint_sync.py` 断言 `IMPERSONATE_BROWSER`、`HEADERS["User-Agent"]`、`Sec-Ch-Ua` 三者版本号一致，提醒 Electron 升级时同步更新。
- **[搜索快照扩大 HTML 信任边界]** → 搜索/首页快照校验器各自仅接受对应路径，跨类拒绝。`captureJmChallengeSnapshot` 参数化校验器后，收藏夹快照仍默认用收藏夹校验，不放宽。
- **[首页快照 sections 组装逻辑重复]** → `handle_parse_jm_home_snapshot` 复用 `handle_search` 的 sections 组装代码。若未来 sections 结构变更，两处需同步。可接受，因结构稳定。
- **[静默搜索快照 URL 构造]** → 搜索静默恢复需根据 `query` + `page` 构造 `/search/photos?main_tag=0&search_query=...&page=...`；首页静默恢复构造 `https://{domain}/`。URL 构造在 Electron 侧完成，Python 侧仍校验。

## 迁移计划

1. 先做 TLS 指纹对齐（独立、低风险、立即可验证）。
2. 再做 Python 搜索/首页快照解析入口（纯后端，可独立测试）。
3. 然后 Electron 快照校验器与参数化捕获。
4. 最后 Electron 恢复编排与 main.ts 静默预检。
5. 全量验证七项闸门。

回滚：恢复 `IMPERSONATE_BROWSER = "chrome136"` + 删除新增的 snapshot handler/方法/校验器。搜索挑战恢复回到"窗口能开但重试必失败"状态，不影响收藏夹恢复。

## 待确认问题

无。搜索/首页快照范围、URL 校验分派、search_query 绑定均已确定。
