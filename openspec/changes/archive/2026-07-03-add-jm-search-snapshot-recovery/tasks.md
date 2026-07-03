## 1. TLS 指纹对齐

- [x] 1.1 在 `sources/jm/constants.py` 将 `IMPERSONATE_BROWSER` 从 `"chrome136"` 改为 `"chrome142"`，同步更新 `HEADERS["User-Agent"]` 为 `Chrome/142.0.0.0`、`HEADERS["Sec-Ch-Ua"]` 为 `v="142"`（三处版本号）
- [x] 1.2 在 `python/ipc/cover_mixin.py` 将硬编码 `impersonate="chrome136"` 改为引用 `from sources.jm.constants import IMPERSONATE_BROWSER`
- [x] 1.3 在 `sources/jm/title_resolver.py` 将硬编码 `impersonate="chrome136"` 改为引用 `IMPERSONATE_BROWSER`
- [x] 1.4 新增 `tests/test_jm_fingerprint_sync.py`：断言 `IMPERSONATE_BROWSER == "chrome142"`、`HEADERS["User-Agent"]` 含 `Chrome/142`、`Sec-Ch-Ua` 含 `v="142"`、cover_mixin 和 title_resolver 无硬编码 `chrome136`

## 2. Python 搜索/首页快照解析

- [x] 2.1 在 `sources/jm/parser.py` 新增 `_SEARCH_PATH_RE`、`_HOME_PATH_RE` 常量
- [x] 2.2 在 `sources/jm/parser.py` 新增 `parse_search_snapshot(html, source_url, *, query, page)` 方法：校验 → 挑战检测 → 调 `_parse_search_results`，返回 2-tuple
- [x] 2.3 在 `sources/jm/parser.py` 新增 `parse_home_snapshot(html, source_url)` 方法：校验 → 挑战检测 → 调 `_parse_home_sections`，返回 sections 列表
- [x] 2.4 在 `sources/jm/parser.py` 新增 `_validate_search_snapshot`（含 search_query 绑定校验）和 `_validate_home_snapshot` 验证器
- [x] 2.5 在 `sources/__init__.py` 新增 `parse_jm_search_snapshot` 和 `parse_jm_home_snapshot` 委托方法
- [x] 2.6 在 `python/ipc/search_mixin.py` 新增 `handle_parse_jm_search_snapshot` handler + `_validate_jm_search_snapshot_input` 校验器
- [x] 2.7 在 `python/ipc/search_mixin.py` 新增 `handle_parse_jm_home_snapshot` handler + `_validate_jm_home_snapshot_input` 校验器（含 sections 组装逻辑）
- [x] 2.8 在 `python/ipc_server.py` 的 `_HANDLER_NAMES` 注册 `parse_jm_search_snapshot` 和 `parse_jm_home_snapshot`

## 3. Python 测试

- [x] 3.1 在 `tests/test_jm_parser.py` 新增搜索快照测试：正常解析、拒绝挑战页、拒绝不受信任 URL、拒绝 search_query 不匹配、拒绝 page 不匹配、拒绝超大 HTML
- [x] 3.2 在 `tests/test_jm_parser.py` 新增首页快照测试：正常解析 sections、拒绝挑战页、拒绝不受信任 URL、拒绝超大 HTML
- [x] 3.3 在 `tests/test_search_mixin.py` 新增 `handle_parse_jm_search_snapshot` 和 `handle_parse_jm_home_snapshot` 测试（mock parser，验证调用 + 去重 + 返回结构）
- [x] 3.4 在 `tests/test_multi_source_parser.py` 新增 `parse_jm_search_snapshot` / `parse_jm_home_snapshot` 委托测试（monkeypatch 模式）
- [x] 3.5 在 `tests/test_ipc_contract.py` 新增 `test_jm_snapshot_handlers_are_registered`，断言两个新 handler 在 `_HANDLER_NAMES` 中

## 4. Electron 快照校验器与捕获

- [x] 4.1 在 `electron/login-window.ts` 新增 `validateJmSearchSnapshotUrl`（复用 `resolveJmOrigin` + `JM_SEARCH_PATH` + `validateJmSearchParams`）
- [x] 4.2 在 `electron/login-window.ts` 新增 `validateJmHomeSnapshotUrl`（复用 `resolveJmOrigin`，路径必须为 `/`，禁止 query）
- [x] 4.3 修改 `captureJmChallengeSnapshot`：新增可选 `urlValidator` 参数，默认 `validateJmFavouritesSnapshotUrl`，第 404 行改为调用传入校验器
- [x] 4.4 给 `LoginWindowContext` 加 `challengeTargetUrl?: string` 字段，`openSourceWindow` 在 challenge 模式设置它，`triggerExtraction` 据此选择校验器传给 `captureJmChallengeSnapshot`
- [x] 4.5 新增 `captureJmSearchSnapshotWindow` 和 `captureJmHomeSnapshotWindow`（镜像 `captureJmFavouritesSnapshotWindow`，用对应校验器 + 隐藏窗口）

## 5. Electron 恢复编排

- [x] 5.1 在 `electron/jm-challenge-recovery.ts` 新增 `parseSearchSnapshotFallback`（根据 searchParams 判断首页/关键词，调对应 IPC，返回 `JmSearchRecoveryOutcome`）
- [x] 5.2 在 `electron/jm-challenge-recovery.ts` 新增模块级状态 `preferSilentSearchSnapshotRecovery` / `lastSearchSnapshotParams`
- [x] 5.3 修改 `recoverJmSearchChallenge`：加静默快照优先块 + `stillChallenged` 快照兜底块（镜像 `recoverJmChallenge`）
- [x] 5.4 新增 `captureSilentSearchSnapshot`（根据 searchParams 构造目标 URL，调对应隐藏快照窗口）
- [x] 5.5 新增导出 `shouldPreferSilentJmSearchSnapshotRecovery()` 和 `recoverJmSearchSilently()`，供 main.ts 预检
- [x] 5.6 更新 `resetJmChallengeRecoveryStateForTests` 重置搜索快照状态
- [x] 5.7 在 `electron/main.ts` 搜索 handler 增加 `shouldPreferSilentJmSearchSnapshotRecovery()` 静默快照预检

## 6. Electron 测试

- [x] 6.1 在 `tests/unit/main/login-window.test.ts` 新增 `validateJmSearchSnapshotUrl` 测试：接受合法搜索 URL，拒绝首页/收藏夹/非可信域
- [x] 6.2 在 `tests/unit/main/login-window.test.ts` 新增 `validateJmHomeSnapshotUrl` 测试：接受根路径，拒绝搜索/收藏夹/带 query 的根路径
- [x] 6.3 在 `tests/unit/main/login-window.test.ts` 新增 `captureJmChallengeSnapshot` 参数化校验器测试：搜索校验器接受搜索 URL
- [x] 6.4 在 `tests/unit/main/jm-challenge-recovery.test.ts` 修改 "retry still challenged" 测试为断言搜索快照被调用（`parse_jm_search_snapshot`）
- [x] 6.5 新增关键词搜索快照兜底成功测试
- [x] 6.6 新增首页快照兜底成功测试（空 query + keyword mode + page 1）
- [x] 6.7 新增静默搜索快照恢复测试
- [x] 6.8 修改跨模块契约测试：`validateJmSearchSnapshotUrl` 接受搜索 URL，`validateJmHomeSnapshotUrl` 接受根 URL

## 7. 验证与收尾

- [x] 7.1 运行 `pytest`（Python 全量测试）
- [x] 7.2 运行 `npx tsc --noEmit`（TypeScript 类型检查）
- [x] 7.3 运行 `npm test`（前端测试）
- [x] 7.4 运行 `npm run lint:py`（Python lint）
- [x] 7.5 运行 `black --check .`（Python 格式化检查）
- [x] 7.6 运行 `npm run lint`（JS/TS lint）
- [x] 7.7 运行 `npm run lint:test-quality`（测试质量闸门）
