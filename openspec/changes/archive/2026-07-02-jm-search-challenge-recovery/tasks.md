# 任务

## 1. Python 后端：搜索挑战检测与异常传播

- [x] 1.1 在 `sources/jm/parser.py` 新增私有方法 `_request_text_with_challenge_check(url)`：内部调用 `self.session.get` + `_is_challenge_response(resp)` 检测响应头挑战 + `raise_for_status()` + `_fix_encoding(resp)`，若检测到挑战抛 `AntiBotChallengeError(challenge_url=url)`。禁止修改公共 `_request_text`（详情页/随机等路径仍用原方法）。
- [x] 1.2 修改 `JmParser.search()`（parser.py:395）：将 `_request_text(url)` 替换为 `_request_text_with_challenge_check(url)`；在 `except` 链中显式放行 `(ParserResponseError, AntiBotChallengeError)` 重新抛出，仅对其他异常保持 `return [], None` 兜底。
- [x] 1.3 修改 `python/ipc/search_mixin.py` 的 `handle_search` 主搜索分支（line 290-297）：将裸 `try/except + _is_source_auth_error` 替换为 `with self._auth_error_guard(effective_source):`，与 `handle_get_favourites`（line 326）对齐，使 `AntiBotChallengeError` 冒泡到 `ipc_server.py:410` 顶层捕获序列化为 `-32002`。
- [x] 1.4 编写 Python 单元测试：JM 搜索 CF 挑战页（响应头 `cf-mitigated: challenge` / 正文含稳定标记）→ 抛 `AntiBotChallengeError`；正常搜索页 → 正常解析；真无结果 → 返回空列表不抛挑战；非挑战网络异常 → 兜底返回空列表。覆盖 `handle_search` 经 guard 抛 `-32002`。

## 2. 共享契约：搜索 IPC 扩展交互标志

- [x] 2.1 修改 `shared/types.ts`：`HcomicAPI.search` 签名新增可选末尾参数 `allowInteractiveChallenge?: boolean`；`IPCMethods.search` 契约同步更新。保持与 `getFavourites(page?, source?, allowInteractiveChallenge?)` 同构。
- [x] 2.2 修改 `electron/preload.ts` 的 `search` 桥接（line 73-74）：接收第 7 参数 `allowInteractiveChallenge`，校验为布尔或 undefined（非布尔拒绝），缺省视为 false，**不转发给 Python**（转发给主进程用于挑战恢复判定，但不放入发给 Python 的 params）。

## 3. Electron 主进程：搜索挑战恢复编排

- [x] 3.1 重构 `electron/jm-challenge-recovery.ts`：抽取核心编排（开窗 → cookie 已同步 → retryOp 重试一次）为内部函数 `recoverJmChallengeCore(ctx, recoveryError, retryOp)`。保持 `recoverJmChallenge`（收藏专用，含快照兜底和静默恢复）的公开签名和行为不变，内部改为调用 core + 快照兜底。
- [x] 3.2 在 `jm-challenge-recovery.ts` 新增 `recoverJmSearchChallenge(ctx, recoveryError, searchParams)` 导出函数：调用 `recoverJmChallengeCore`，retryOp 用 `searchParams`（query/mode/page/source/tag）调用 `bridge.call('search', ...)`；无快照兜底；重试仍被挑战 → 返回可重试错误。定义 `JmSearchRecoveryOutcome` 类型（复用 resolved/message/cancelled 语义，result 为搜索结果结构）。
- [x] 3.3 修改 `electron/main.ts` 的 `SEARCH` handler（line 698-709）：增加第 7 参数 `allowInteractive`，`interactiveFlag = allowInteractive === true`；构造 `params` 时不包含该字段；增加 `try/catch` 挑战分支：`if (interactiveFlag && effectiveSource === 'jm' && isJmChallengeError(err))` → 调用 `recoverJmSearchChallenge`，成功返回 result，失败/取消重新抛出可恢复错误。
- [x] 3.4 编写 Electron 单元测试：`recoverJmChallengeCore` 抽取测试（retryOp 被调用、重试成功/失败/取消分支）；`recoverJmSearchChallenge` 用原搜索参数重试、无快照兜底；收藏页 `recoverJmChallenge` 回归测试（确保重构后开窗→重试→快照兜底→静默恢复行为不变）；SEARCH handler 挑战分支测试（仅 JM + interactiveFlag 触发恢复）。

## 4. 前端：搜索页接入交互恢复

- [x] 4.1 修改 `src/hooks/useIpc.ts` 的 `useSearch` hook（line 27-35）：`search()` 新增可选 `allowInteractiveChallenge?: boolean` 参数，透传给 `window.hcomic.search`。
- [x] 4.2 修改 `src/pages/SearchPage.tsx` 的 `handleSearch`（line 351-388）：用户主动搜索调用 `search(query, mode, page, source, tag, true)`。
- [x] 4.3 修改 `SearchPage` 的 `useSearchPreloader`（line 577-587）：预加载调用 `searchFn` 时传 `allowInteractiveChallenge=false`（或省略，依赖缺省 false）。
- [x] 4.4 修改 `SearchPage` 的 `withLoading` catch（line 338-345）：扩展错误处理，捕获挑战恢复失败/取消错误时展示"人机验证未完成，点击重试"的可重试提示（而非空结果或登录失效提示）。复用 `isAuthError` 区分"需登录"与"需验证"。
- [x] 4.5 编写前端单元测试：`useSearch` 透传 `allowInteractiveChallenge`；`handleSearch` 传 true；预加载传 false；catch 处理挑战错误展示重试提示。

## 5. 端到端验证与回归

- [x] 5.1 运行完整验证流程：`pytest`、`npx tsc --noEmit`、`npm test`、`npm run lint:py`、`black --check .`、`npm run lint`、`npm run lint:test-quality` 全部通过。
- [x] 5.2 验证 session 共享语义：在测试或手动验证中确认——搜索页完成验证后，收藏页请求自动携带 cookie 不再触发挑战；反之收藏页验证后搜索页免重验（可通过 mock session.cookie_jar 断言或集成测试覆盖）。
- [x] 5.3 确认非 JM 来源搜索不受影响：hcomic/moeimg/bika/nh/copymanga 搜索行为与重构前一致（不抛 `AntiBotChallengeError`，`handle_search` 对这些来源行为不变）。
