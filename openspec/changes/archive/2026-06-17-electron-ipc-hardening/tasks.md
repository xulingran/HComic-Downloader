# Tasks: electron-ipc-hardening

> 工作分支建议：`fix/electron-ipc-hardening`。三簇按依赖顺序提交，每簇独立可 revert。

## 簇 B：跨层常量单一来源（先做，无依赖）

- [x] B1. `shared/types.ts`：新增 `DOWNLOAD_STATUSES` const tuple，`DownloadStatus` 改为 `typeof DOWNLOAD_STATUSES[number]` 派生
- [x] B2. `shared/types.ts`：新增 `ACTIVE_DOWNLOAD_STATUSES: ReadonlySet<string>`（4 个活跃状态）
- [x] B3. `shared/types.ts`：新增 `IMAGE_QUALITIES` const tuple 与 `SOURCE_VALUES = new Set(COMIC_SOURCES)` 派生
- [x] B4. `electron/main.ts:144`：`VALID_DOWNLOAD_STATUSES` 改为 `new Set(DOWNLOAD_STATUSES)`
- [x] B5. `electron/main.ts`：close handler 的 active 判断改用 `ACTIVE_DOWNLOAD_STATUSES.has`
- [x] B6. `electron/main.ts`：`SOURCE_VALUES` 改为从 shared 导入（删除本地定义）
- [x] B7. `electron/main.ts`：`bikaImageQuality` 校验改用 `oneOf(IMAGE_QUALITIES)`
- [x] B8. `electron/main.ts`：FETCH_PREVIEW_IMAGE 的 imageQuality 校验改用 `IMAGE_QUALITIES.includes`
- [x] B9. `electron/preload.ts`：imageQuality 校验改用 `IMAGE_QUALITIES.includes`
- [x] B10. `electron/notification-manager.ts`：activeStatuses 字面量 Set 提为 `private static readonly ACTIVE_STATUSES`
- [x] B11. `electron/main.ts`：`3000` 命名为 `STARTUP_UPDATE_CHECK_DELAY_MS`
- [x] B12. `electron/python-bridge.ts`：`2000` 命名为 `BACKEND_RESTART_DELAY_MS`
- [x] B13. `src/components/ComicReaderModal.tsx`：硬编码数组改用 `IMAGE_QUALITIES`
- [x] B14. `src/hooks/useIpc.ts`：4 状态字面量判断改用 `ACTIVE_DOWNLOAD_STATUSES.has`
- [x] B15. `src/pages/DownloadPage.tsx`：`albumActiveStatuses` 改派生为 `ACTIVE_DOWNLOAD_STATUSES.has`；`matchStatusFilter` 的 `'active'` 过滤器（3 状态语义，不含 paused）保留字面量并加注释
- [x] B16. `src/pages/{Favourites,History,Search}Page.tsx`：5 状态判断改用新增的 `PROGRESS_BADGE_STATUSES.has`（活跃 4 + failed，与 ACTIVE_DOWNLOAD_STATUSES 语义不同）
- [x] B17. `tests/unit/main/notification-manager.test.ts`：补用例，4 个 active 状态各自在集合内不触发通知；全部离开时才触发

## 簇 A：防御深度补齐（依赖 B 合并以避免冲突）

- [x] A1. `electron/python-bridge.ts`：`kill()` 末尾调用 `this._clearPendingRequests('Python bridge killed')`
- [x] A2. `electron/python-bridge.ts`：`handleProcessFailure` 内联清理改调用 `this._clearPendingRequests(message)`
- [x] A3. `electron/main.ts`：`WRITE_CLIPBOARD` 加 `assert(and(string(), length(1, 2_000_000)), text, 'clipboard text')`
- [x] A4. `electron/login-window.ts`：新增导出纯函数 `escapeCookieValueForShlex(value: string): string`（含控制字符拒绝）
- [x] A5. `electron/login-window.ts`：cookie/UA 拼接调用 `escapeCookieValueForShlex`
- [x] A6. `tests/unit/main/python-bridge.test.ts`：补 `kill()` 清 pending 用例（pending Promise 被 reject with 'Python bridge killed'）
- [x] A7. `tests/unit/main/main.test.ts`：补 `WRITE_CLIPBOARD` 拒绝超长（>2M）/非字符串/空字符串 + 合法值写入 用例（mock clipboard.writeText）
- [x] A8. `tests/unit/main/cookie-escape.test.ts`（新建）：覆盖 9 个纯函数场景 + 5 个真实 Python `shlex.split(posix=True)` round-trip 用例

## 簇 C：DRY 抽取（依赖 B3 的 SOURCE_VALUES 上移）

- [x] C1. `electron/validators.ts`：新增导出 `withOptionalSource(params, source, label)`
- [x] C2. `electron/main.ts`：13 处可选 source 校验替换为 `withOptionalSource`（search/random/get_favourites/add_to_favourites/check_favourite/remove_from_favourites/get_comic_detail/get_favourite_tags/clear_favourite_tags/remove_favourite_tag/sync_favourite_tags/get_tag_list/refresh_tag_list）。APPLY_AUTH/VERIFY_AUTH 两处有意保留（source 不校验 SOURCE_VALUES，由 Python 端校验）
- [x] C3. `electron/preload.ts`：新增私有 `validateCredentialPair(username, password)`
- [x] C4. `electron/preload.ts`：3 个登录函数（moeimgLogin/bikaLogin/hcomicLogin）改用 `validateCredentialPair`
- [x] C5. `electron/preload.ts`：新增私有 `validateComicIdAndOptionalSource(comicId, source)`
- [x] C6. `electron/preload.ts`：3 个收藏函数（addToFavourites/checkFavourite/removeFromFavourites）改用 `validateComicIdAndOptionalSource`
- [x] C7. `electron/preload.ts`：`fetchPreviewImage` 的 `scrambleId`/`comicId` 透传加 `typeof === 'string'` 守卫（#20）
- [x] C8. `tests/unit/main/validators.test.ts`：补 `withOptionalSource` 用例（undefined 跳过/null 跳过/合法值注入/5 个 COMIC_SOURCES/非法值抛错/label 写入 field）
- [x] C9. `tests/unit/preload/preload.test.ts`：补 3 个登录 × 5 拒绝路径 + 3 个收藏 × 5 拒绝路径 + fetchPreviewImage scrambleId/comicId 守卫

## 收尾与验证

- [x] V1. `grep` 确认 main.ts 内 `withOptionalSource` 替换覆盖完整，仅 APPLY_AUTH/VERIFY_AUTH 两处保留（这两处 source 不校验 SOURCE_VALUES，是预期行为）
- [x] V2. `grep` 确认 `['low', 'medium', 'high', 'original']` 字面量在 electron/src 零残留
- [x] V3. `grep` 确认 4 状态活跃判断零字面量残留。剩余 2 处（TaskActionButtons 的"可暂停"2 状态、DownloadPage matchStatusFilter 的 `'active'` 过滤器 3 状态）语义不同，已加注释保留
- [x] V4. `pytest` 全绿（740 passed）
- [x] V5. `npx tsc --noEmit` 仅剩 master 既有的 `Error(msg, { cause })` 错误（tsconfig lib 配置问题，与本次改动无关，stash 验证已确认）
- [x] V6. `npm test` 全绿（887 passed，64 文件）
- [x] V7. `npm run lint` 全绿
- [x] V8. `npm run lint:py` 全绿（本次零 Python 文件改动，验证无回归）
- [x] V9. `black --check .` 全绿（96 files unchanged）
- [~] V10. 手动验证：含特殊字符 cookie 的 jmcomic 登录流程仍 apply_auth 成功 —— 推迟到合并后用户验证；shlex round-trip 测试（5 用例真实 Python 解析）已覆盖转义正确性

## 非任务（推迟到 login-window-refactor 变更）

- login-window.ts `openLoginWindow` God Function 拆分（原审查 #5）
- login-window.ts `extractAndApplyCookies` 多 source 分支拆分（原审查 #6）
- login-window DOM 提取脚本抽常量（原审查 #16）
- login-window diag 同步写文件优化（原审查 #17）
- sandbox:true 回归机制（原审查 #8，独立工程实践提案）
- 先补 login-window.test.ts 再做上述重构

## 非任务（Minor，本次顺手处理）

- [~] M1. `electron/main.ts:209`：`as unknown as DownloadProgressEvent` 双重断言改为构造 typed 对象（#13）——**评估后决定不做**：构造 typed 对象需手动列字段，可读性未必优于现状的双重断言，且不影响运行时；改动收益不抵风险
- [~] M2. `electron/main.ts` SHUTDOWN IPC 与 before-quit 双轨流程加注释说明（#19）——**评估后决定不做**：现有 shutdownState 状态机注释已充分说明设计意图，额外注释属冗余
