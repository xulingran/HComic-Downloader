# 实施任务

> 按依赖顺序执行：Phase A（精炼规则，消除误报）→ Phase B（清理真同义反复）→ Phase C（转 error 闭环 Phase 2b）。
> Phase A 必须与自我验证测试同步更新（否则现有反例用例会红）。Phase C 前置条件是 `lint:test-quality` 零报告。

## 1. Phase A — 精炼前端 no-bare-mock-assertion 规则

- [ ] 1.1 修改 `eslint-rules/test-quality.js` 的 `no-bare-mock-assertion.create`：对 `toHaveBeenCalledTimes` matcher 检查其调用参数——参数为 `Literal`（数字字面量）则计入 `hasReal`（断言性次数，放行）；参数为变量/`expect.any(...)`/成员访问则仍按裸调用（拦截）。
- [ ] 1.2 同规则增加否定断言判定：检测 `expect(x)` 是否被 `not.` 修饰（`expect(x).not.toHaveBeenCalled()` / `not.toHaveBeenCalledTimes(0)`），视为否定断言，计入 `hasReal`（放行）。
- [ ] 1.3 同步更新 `tests/unit/lint/test-quality-rule.test.ts`：把现有"裸 `toHaveBeenCalledTimes(2)` 反例"改为正例（断言性次数放行）；新增反例"`expect.any(Number)` 次数仍拦截"；新增正例"`not.toHaveBeenCalled()` 放行"。确保自我验证测试覆盖精炼后的判定边界。

## 2. Phase A — 精炼 Python 闸门规则

- [ ] 2.1 修改 `scripts/lint-test-quality.py` 的 `MOCK_CALL_ASSERTIONS` 集合：移除 `assert_called_once` 与 `assert_called_once_with`（"恰好一次"承载信号，放行）。保留 `assert_called`、`assert_any_call`、`assert_has_calls`、`assert_not_called` 在拦截集。
- [ ] 2.2 增强 `_is_mock_call_assertion`：对 `assert_called_with` / `assert_called_once_with`，若参数全为字面量（`Constant`）则仍拦截（无转换信号），含变量/调用则放行（参数承载转换信号）。
- [ ] 2.3 同步更新 `tests/test_test_quality_gate.py`：`test_bare_assert_called_once_reported` 反例改为正例（放行）；新增 `assert_called_with` 全字面量拦截反例与含变量放行正例。

## 3. Phase A 验证

- [ ] 3.1 运行自我验证测试：`npx vitest run tests/unit/lint/test-quality-rule.test.ts` + `pytest tests/test_test_quality_gate.py`，确认全绿。
- [ ] 3.2 运行 `npm run lint:test-quality`，记录精炼后剩余违规数（前端应从 84 降至约 48，Python 从 8 降至约 3）。剩余项即 Phase B 清理目标。
- [ ] 3.3 运行 `npm test` + `pytest`，确认精炼规则未引入误报导致既有测试逻辑被破坏（规则只读不跑测试，但确认自我验证测试通过）。
- [ ] 3.4 提交 Phase A（独立 commit），commit message 说明精炼逻辑与误报消除数量。

## 4. Phase B — 清理前端真同义反复（重灾区文件）

- [ ] 4.1 `tests/unit/main/python-bridge.test.ts`（精炼后剩余违规）：逐条评估缓冲区溢出/重启相关用例——`toHaveBeenCalled` 类补强为状态/次数断言或删除；保留 `toHaveBeenCalledTimes(2)` 等已放行的。记录每条理由。
- [ ] 4.2 `tests/unit/main/notification-manager.test.ts`（剩余）：批量通知触发逻辑用例——`toHaveBeenCalled` 补强为通知内容/次数断言。
- [ ] 4.3 `tests/unit/lib/scheduler.test.ts`（剩余）：调度/cancel 逻辑——确认 `not.toHaveBeenCalled` 已被 Phase A 放行；剩余 `toHaveBeenCalled` 类评估删除或补强。
- [ ] 4.4 `tests/unit/main/main.test.ts`（剩余）：生命周期监听器注册类——多为 `toHaveBeenCalled` 副作用断言，评估删除（若已有配对状态断言）或补强。

## 5. Phase B — 清理前端真同义反复（其余文件，按目录分组）

- [ ] 5.1 `tests/unit/components/**`（ChapterDownloadDialog、DuplicateBlacklistManager、MissingBlacklistManager、common/Modal、AlbumNameDialog、SourcePickerModal、ComicReaderModal）：逐条处理回调触发类 `toHaveBeenCalled`。
- [ ] 5.2 `tests/unit/hooks/usePaginatedPreloader.test.tsx`（混合违规 6 处）：预加载边界逻辑——评估哪些是真派生（加 `[derived]`）、哪些补强为预加载状态断言。
- [ ] 5.3 `tests/unit/pages/**`（SearchPage、DownloadPage、FavouritesPage、FavouritesPage.sourcePicker）：mount/交互触发类——多数删除（mount 类无信号），少数补强。
- [ ] 5.4 `tests/unit/main/login-window.test.ts` + `tests/unit/preload/preload.test.ts` + `tests/unit/App.test.tsx` + `Toast.test.tsx` + `PreviewRetryToast.test.tsx`：逐条处理。
- [ ] 5.5 `tests/unit/stores/**`（fatalErrorStore、settingsStore 剩余 3 处 store CRUD）：settingsStore 的"切换主题模式"参数化用例若仍触发，评估加 `[derived]` 或补强；fatalErrorStore 的 setError/clear 评估补强或删除。

## 6. Phase B — 清理 Python 真同义反复

- [ ] 6.1 `tests/test_jm_favourites.py`（精炼后剩余）：`assert_called` / `assert_called_with(字面量)` 类——逐条评估删除（若已有 DOM/状态断言覆盖）或补强。
- [ ] 6.2 `tests/test_parser_favourites.py` + `tests/test_ipc_async_main_loop.py`（剩余各 1 处）：同上逐条处理。

## 7. Phase B 验证

- [ ] 7.1 运行 `npm run lint:test-quality`（前端+Python），确认零报告（backlog 清零）。
- [ ] 7.2 运行 `npm test` + `pytest` + `npx tsc --noEmit` + `npm run lint` + `npm run lint:py` + `black --check .`，全部通过。
- [ ] 7.3 提交 Phase B（可按文件组多个 commit），每个 commit 列出处理清单与理由。

## 8. Phase C — 闸门转 error 并接入流程

- [ ] 8.1 确认 Phase A + Phase B 已合并、`lint:test-quality` 零报告、CI 绿。
- [ ] 8.2 更新 `eslint.config.js`：`test-quality/no-bare-mock-assertion` 与 `test-quality/no-pure-store-crud-roundtrip` 规则级别 `warn` → `error`。
- [ ] 8.3 更新 `scripts/lint-test-quality.mjs`：Python 调用加 `--strict`（检测到违规非零退出）。
- [ ] 8.4 更新 `AGENTS.md` "完整验证流程"：在第 6 步 `npm run lint` 后新增第 7 步 `npm run lint:test-quality`（测试质量闸门）。同步"代码检查与格式化"小节说明命令作用。

## 9. 全量验证与归档准备

- [ ] 9.1 完整执行 `AGENTS.md` 7 步验证流程（含新增 lint:test-quality），全部通过。
- [ ] 9.2 确认 `openspec-cn status --change "cleanup-test-quality-backlog"` 所有 applyRequires 产出物完成。
- [ ] 9.3 手动验证闸门拦截：临时在测试加 `expect(vi.fn()).toHaveBeenCalled()` 单独断言，确认 `npm run lint` 失败（error 级别）；加 `expect(vi.fn()).toHaveBeenCalledTimes(1)` 确认放行；移除后确认通过。
- [ ] 9.4 确认 `test-discipline-gate` 变更的 Phase 2b 已由本变更闭环；两变更可按序归档。
