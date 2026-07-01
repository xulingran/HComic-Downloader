## 上下文

JM 来源已具备一套成熟的 Cloudflare 反爬挑战恢复机制，但当前**仅收藏夹请求（`get_favourites`）能触发**。完整链路为：

```
Python: AntiBotChallengeError(challenge_url)
   → ipc_server.py 顶层捕获 → JSON-RPC -32002 {source:'jm', challengeUrl, message}
   → Electron main.ts GET_FAVOURITES handler 识别 isJmChallengeError
   → recoverJmChallenge() 编排
       → openJmChallengeWindow() 用户验证
       → apply_auth 注入 cookie 到全局唯一 parser.session
       → bridge.call('get_favourites') 重试一次
       → (可选) parse_jm_favourites_snapshot 快照兜底
```

**关键事实**（探索阶段已确认）：
- JM 全进程只有一个 `JmParser` 实例（`MultiSourceParser` 单例 + double-checked locking），只有一个 `self.session`。
- `search()`（parser.py:395）和 `favourites()`（parser.py:578）都用同一个 `self.session.get`。
- 验证后 cookie 经 `configure_auth` → `_sync_cookies_to_jar` 注入该 session 的 jar，**搜索天然复用收藏验证数据，反之亦然**。
- 因此"在一个界面验证后另一界面无需重新验证"在 Python session 层**已经成立**，缺口纯粹在于：搜索请求无法触发恢复链路。

**搜索路径的现状缺口**（三层）：
1. **Python**：`search()` → `_request_text()`（parser.py:824）只做 `resp.raise_for_status()`，CF 挑战页返回 HTTP 200 时通过检测，HTML 被原样解析为空结果。`search()` 的 `except Exception`（parser.py:418）静默吞掉所有异常返回 `[], None`。
2. **Electron**：`SEARCH` handler（main.ts:698）直接 `bridge.call('search', params)`，无挑战恢复分支。
3. **前端**：`search()` 无 `allowInteractiveChallenge` 参数；`SearchPage` 无法区分"被挑战"与"真无结果"。

## 目标 / 非目标

**目标：**
- JM 搜索请求遇到 CF 挑战时，能复用收藏页同款恢复链路（验证窗口 → cookie 同步 → 重试）。
- 用户在搜索页或收藏页任一界面完成验证后，另一界面立即复用已有 cookie，无需重新验证。
- 最大化复用现有代码：`extractJmChallengeData` / `isJmChallengeError` / `openJmChallengeWindow` / `apply_auth` / `-32002` 错误序列化 / session 共享机制全部不动。
- 搜索的"真无结果"与"被挑战"在前端清晰区分，不再以空列表掩盖挑战。
- 后台预加载/缓存刷新被挑战时静默失败保缓存，绝不弹窗（与收藏页范式一致）。

**非目标：**
- 不改动 bika / copymanga / moeimg / hcomic 来源的验证机制（它们无需 CF 挑战恢复）。
- 不为搜索引入"快照兜底"（搜索结果页结构与收藏页不同，且无对应的 `parse_jm_search_snapshot` Python 入口；快照兜底是收藏页专属能力，本次保持搜索恢复流程更简单）。
- 不改动 `login-window.ts` / `login-preload.ts`（挑战窗口 UI 已通用，mode='challenge' 已支持显式初始 URL）。
- 不改动 JM parser 的 session 创建、cookie jar 同步、域名锁定逻辑（这些已正确工作）。
- 不改动 `jm-challenge-recovery` / `jm-interactive-challenge-recovery` 规范中关于挑战检测、载荷安全、窗口互斥的既有需求（搜索复用同一套契约）。

## 决策

### 决策 1：Python 搜索端挑战检测——复用 `_request_text` 还是新增方法？

**选择：在 `search()` 方法内于 `_request_text()` 返回后立即检测，而非修改 `_request_text`。**

**理由**：
- `_request_text` 被 `get_comic_detail`、`random` 等多处复用。若在 `_request_text` 内抛 `AntiBotChallengeError`，会改变这些路径的错误语义，需逐一审计，扩大改动面与回归风险。
- 搜索路径的挑战检测逻辑与收藏页 `favourites()` 方法内的"正文层检测"（parser.py:604-608）同构——都是拿到 HTML 后调 `_is_challenge_page(html)`。把检测放在 `search()` 内，与现有 `favourites()` 的二层检测模式一致，最小化对其他路径的影响。
- 同时保留对响应头的检测：`search()` 改为通过 `_request_text` 之外的方式获取 `resp`（或新增一个轻量的 `_request_for_search` 返回 `resp` 对象，调用 `_is_challenge_response(resp)`）。**优选方案**：抽一个 `_request_text_with_challenge_check(url)` 私有方法，内部调 `self.session.get` + `_is_challenge_response(resp)` + `raise_for_status` + `_fix_encoding`，仅供 `search` 使用；这样不污染公共 `_request_text`，又能同时检测响应头和正文。

**替代方案（已否决）**：
- 直接改 `_request_text` 抛挑战错误 → 影响详情页/随机等路径，回归面大。
- 在 `_parse_search_results` 内检测 → 检测时机太晚（已进入解析逻辑），且 `_parse_search_results` 无法访问原始 URL 用于构造 `challenge_url`。

### 决策 2：`search()` 的异常处理——让 `AntiBotChallengeError` 透传

**选择：在 `search()` 的 `except` 链中显式放行 `AntiBotChallengeError` 和 `ParserResponseError`（后者已放行），仅对其他异常保持静默兜底。**

```python
url = self._build_search_url(keyword, page=page)
try:
    html = self._request_text_with_challenge_check(url)
    return self._parse_search_results(html, domain=domain)
except (ParserResponseError, AntiBotChallengeError):
    raise  # 向上传播，让 IPC 层序列化为 -32002
except Exception as e:
    logger.error("jm search failed: %s", e, exc_info=True)
    return [], None
```

**理由**：
- 现有 `except Exception` 兜底是为了让搜索在网络抖动等情况下"尽力而为"返回空结果而非崩溃。但 CF 挑战不是普通网络错误，是**可交互恢复**的结构化信号，必须向上传播。
- 显式列出 `(ParserResponseError, AntiBotChallengeError)` 而非用 `except Exception: if is_challenge: raise`，语义更清晰，且符合 `jm-challenge-recovery` 规范"挑战与认证失效分开报告"的契约。

### 决策 3：`handle_search` 接入 `_auth_error_guard`

**选择：把 `handle_search` 中调用 `self.parser.search(...)` 的 try/except 块替换为 `with self._auth_error_guard(effective_source):`，与 `handle_get_favourites` 完全对齐。**

**理由**：
- `_auth_error_guard` 是项目既有的统一异常处理上下文管理器，会正确区分 `AntiBotChallengeError`（让其冒泡到 `ipc_server.py:410` 顶层捕获 → `-32002`）和普通认证错误（转 `AuthRequiredError`）。
- 当前 `handle_search` 用裸 `try/except + _is_source_auth_error`，是历史遗留，没有处理 `AntiBotChallengeError`。改用 guard 后，搜索与收藏在 IPC 层的异常处理完全一致。
- 注意：bika 的 ranking/tag/category 分支已经用了 `_auth_error_guard`（search_mixin.py:262/272/283），本次改动让主搜索分支（line 290-297）也对齐。

### 决策 4：`recoverJmChallenge` 泛化——重构 vs 新增

**选择：重构 `recoverJmChallenge`，将其核心编排（步骤 1-3：开窗 → cookie 同步 → 重试）抽取为接受"重试回调"的通用函数，收藏与搜索各传自己的重试逻辑；快照兜底（步骤 4）和静默快照恢复保留为收藏专用。**

**重构形态**：
```ts
// 通用核心：开窗 → cookie 已同步 → retryOp() 重试一次
async function recoverJmChallengeCore(
  ctx: JmChallengeRecoveryContext,
  recoveryError: unknown,
  retryOp: (bridge) => Promise<unknown>,  // 收藏传 get_favourites，搜索传 search
): Promise<{ resolved: true; result: unknown } | { resolved: false; message?: string; cancelled?: boolean }>

// 收藏专用入口（保持现有签名，内部调 core + 快照兜底）
export async function recoverJmChallenge(ctx, recoveryError, page): Promise<JmChallengeRecoveryOutcome>

// 搜索专用入口（无快照兜底）
export async function recoverJmSearchChallenge(
  ctx: JmChallengeRecoveryContext,
  recoveryError: unknown,
  searchParams: { query, mode, page, source, tag },  // 用于构造重试请求
): Promise<JmSearchRecoveryOutcome>
```

**理由**：
- 步骤 1（开窗）、步骤 2（cookie 同步，由窗口内部完成）、步骤 3（重试）对收藏和搜索完全相同，只是重试调用的 method 和参数不同。抽取 `retryOp` 回调消除重复。
- 快照兜底（步骤 4）依赖 `parse_jm_favourites_snapshot` 和 `windowResult.snapshot`，是收藏专属，搜索无对应入口。将其留在 `recoverJmChallenge`（收藏版）内。
- 静默快照恢复（`preferSilentSnapshotRecovery` / `recoverJmFavouritesSilently`）同样收藏专属，不动。
- 搜索恢复失败语义更简单：重试仍被挑战 → 直接返回可重试错误（无快照兜底）。

**替代方案（已否决）**：
- 新增完全独立的 `recoverJmSearchChallenge` 复制核心流程 → 代码重复，且核心流程（开窗+同步+重试）未来若变动需双改。
- 把 `recoverJmChallenge` 改成接受 method 字符串（'get_favourites' | 'search'）→ 参数结构差异大（收藏只需 page，搜索需 query/mode/page/source/tag），用回调比用联合参数更灵活。

### 决策 5：搜索 IPC 契约扩展——交互标志位置

**选择：`allowInteractiveChallenge` 作为 `search` 的最后一个可选参数，与 `getFavourites(page?, source?, allowInteractiveChallenge?)` 同构。**

`shared/types.ts` 契约变更：
```ts
// 之前
search(query, mode, page, source?, tag?)
// 之后
search(query, mode, page, source?, tag?, allowInteractiveChallenge?)
```

**逐层处理**（复用 `electron-ipc-contract` 中"收藏夹交互标志逐层验证并默认关闭"的同构契约）：
- **preload.ts**：校验第 7 参数为布尔或 undefined，非布尔拒绝，缺省 false，**不转发给 Python**。
- **main.ts SEARCH handler**：`interactiveFlag = allowInteractive === true`，构造 `params` 时不包含该字段，发给 Python 的 `params` 只含 query/mode/page/source/tag。
- **handler 挑战分支**：`if (interactiveFlag && effectiveSource === 'jm' && isJmChallengeError(err))` → 调用 `recoverJmSearchChallenge`。

**理由**：与收藏页完全对称，前端调用方心智模型统一，preload/main 校验逻辑可直接复用。

### 决策 6：前端搜索页交互标志传递策略

**选择：完全照搬收藏页的范式。**

- `SearchPage.handleSearch()`（用户主动搜索）→ `search(query, mode, page, source, tag, true)`。
- `useSearchPreloader`（相邻页预加载）→ `search(query, mode, page, source, tag, false)`。
- `withLoading` 的 catch：捕获到挑战恢复失败/取消错误时，展示"人机验证未完成，点击重试"的可重试提示，而非空结果或"登录失效"。

**理由**：
- 收藏页已验证此范式（`paginated-preload-interruption` 规范要求预加载静默失败保缓存）。
- 搜索预加载被挑战时若弹窗，会打断用户当前操作且与"预加载不可见"语义冲突。

## 风险 / 权衡

**[风险] `search()` 改为抛 `AntiBotChallengeError` 后，调用 `search` 的其他路径（如 `handle_search` 中 bika 分支以外的来源）行为变化**
→ 缓解：`AntiBotChallengeError` 仅由 JM 来源抛出（`_is_challenge_page` 只在 JM parser 内调用）。其他来源（hcomic/moeimg/bika/nh/copymanga）的 parser 不会抛此异常，它们的 `search` 行为不变。`MultiSourceParser.search` 的分发层不捕获此异常，让其冒泡。需在测试中覆盖"非 JM 来源搜索不受影响"。

**[风险] 搜索恢复无快照兜底，用户体验略逊于收藏页**
→ 接受。搜索结果页 DOM 结构与收藏页不同，实现 `parse_jm_search_snapshot` 需额外解析逻辑且收益有限（搜索重试成功率本身较高，因为 cookie 已注入）。若未来证明需要，可单独变更。

**[风险] `recoverJmChallenge` 重构波及收藏页现有逻辑**
→ 缓解：重构采用"抽取共享核心 + 保留收藏专用外壳"模式，收藏页的 `recoverJmChallenge` 公开签名和行为不变。必须有回归测试覆盖收藏页恢复流程（开窗→重试→快照兜底→静默恢复），确保重构前后行为一致。`resetJmChallengeRecoveryStateForTests` 等测试辅助函数保留。

**[风险] 搜索预加载被挑战时静默返回空，用户主动搜索同一查询时才弹窗——用户可能困惑"为什么预加载没结果但手动搜就有了"**
→ 缓解：这是收藏页已有的既有行为范式，用户已习惯。预加载的语义本就是"尽力而为的后台优化"，失败不阻塞 UI。

**[权衡] `allowInteractiveChallenge` 加在 `search` 第 7 参数位置，参数列表较长**
→ 接受。与 `getFavourites` 一致，且 TypeScript 可选参数 + IDE 提示可缓解。若未来参数继续增长，可考虑改为 options 对象，但本次不做（避免契约大改）。
