# 实施任务

> 按依赖顺序执行：Phase A（精炼规则，消除误报）→ Phase B（清理真同义反复）→ Phase C（转 error 闭环 Phase 2b）。
> Phase A 必须与自我验证测试同步更新（否则现有反例用例会红）。Phase C 前置条件是 `lint:test-quality` 零报告。

## 1. Phase A — 精炼前端 no-bare-mock-assertion 规则

- [x] 1.1 修改 `eslint-rules/test-quality.js` 的 `no-bare-mock-assertion.create`：对 `toHaveBeenCalledTimes` matcher 检查其调用参数——参数为 `Literal`（数字字面量）则计入 `hasReal`（断言性次数，放行）；参数为变量/`expect.any(...)`/成员访问则仍按裸调用（拦截）。
- [x] 1.2 同规则增加否定断言判定：检测 `expect(x)` 是否被 `not.` 修饰（`expect(x).not.toHaveBeenCalled()` / `not.toHaveBeenCalledTimes(0)`），视为否定断言，计入 `hasReal`（放行）。
- [x] 1.3 同步更新 `tests/unit/lint/test-quality-rule.test.ts`：把现有"裸 `toHaveBeenCalledTimes(2)` 反例"改为正例（断言性次数放行）；新增反例"`expect.any(Number)` 次数仍拦截"；新增正例"`not.toHaveBeenCalled()` 放行"。确保自我验证测试覆盖精炼后的判定边界。

## 2. Phase A — 精炼 Python 闸门规则

- [x] 2.1 修改 `scripts/lint-test-quality.py` 的 `MOCK_CALL_ASSERTIONS` 集合：移除 `assert_called_once` 与 `assert_called_once_with`（"恰好一次"承载信号，放行）。保留 `assert_called`、`assert_any_call`、`assert_has_calls` 在拦截集。
- [x] 2.2 增强 `_is_mock_call_assertion`：对 `assert_called_with` / `assert_called_once_with`，若参数全为字面量（`Constant`）则仍拦截（无转换信号），含变量/调用则放行（参数承载转换信号）。
- [x] 2.3 同步更新 `tests/test_test_quality_gate.py`：`test_bare_assert_called_once_reported` 反例改为正例（放行）；新增 `assert_called_with` 全字面量拦截反例与含变量放行正例。

## 3. Phase A 验证

- [x] 3.1 运行自我验证测试：`npx vitest run tests/unit/lint/test-quality-rule.test.ts`（18 passed）+ `pytest tests/test_test_quality_gate.py`（16 passed），确认全绿。
- [x] 3.2 运行 `npm run lint:test-quality`，记录精炼后剩余违规数：前端 84→**12**（消除 72 处误报），Python 8→**2**（消除 6 处误报）。
- [x] 3.3 运行 `npm test`（1221 passed）+ `pytest`（971 passed），确认精炼规则未破坏既有测试。
- [x] 3.4 提交 Phase A（独立 commit），commit message 说明精炼逻辑与误报消除数量。

## 4. Phase B — 清理前端真同义反复（重灾区文件）

- [x] 4.1 `tests/unit/main/python-bridge.test.ts`：缓冲区溢出 kill 用例从 `toHaveBeenCalled` 补强为 `toHaveBeenCalledTimes(1)`（断言恰好 kill 一次，不重复/不漏）。
- [x] 4.2 `tests/unit/main/main.test.ts`：will-navigate 安全断言 + 退出确认 app.quit 均补强为 `toHaveBeenCalledTimes(1)`（安全/生命周期行为的精确触发）。
- [x] 4.3 `tests/unit/lib/scheduler.test.ts`：精炼后（Phase A）所有违规已消除（`toHaveBeenCalledTimes(1)` / `not.toHaveBeenCalled` 现放行），无需改动。
- [x] 4.4 `tests/unit/main/notification-manager.test.ts`：精炼后所有违规已消除（`toHaveBeenCalledTimes(1)` 断言性次数现放行），无需改动。

## 5. Phase B — 清理前端真同义反复（其余文件，按目录分组）

- [x] 5.1 `tests/unit/components/**`：ChapterDownloadDialog cancel、ComicReaderModal close 补强为 `toHaveBeenCalledTimes(1)`。
- [x] 5.2 `tests/unit/hooks/usePaginatedPreloader.test.tsx`：精炼后违规已消除（混合用例含 `toHaveBeenCalledTimes` 字面量），无需改动。
- [x] 5.3 `tests/unit/pages/**`：DownloadPage、FavouritesPage 的 "calls getX on mount" 删除（裸调用，mount 意图已由渲染数据用例覆盖）。
- [x] 5.4 `tests/unit/preload/preload.test.ts`：credential/favourites 合法输入用例补强为 `toHaveBeenCalledTimes(1)`；App.test/Toast/PreviewRetryToast 精炼后已消除，无需改动。
- [x] 5.5 `tests/unit/stores/**`：fatalErrorStore 删除两个 setError CRUD 往返用例（保留 clear/最小错误）；settingsStore 主题切换用例加 `[derived]` 标记（枚举值集合契约）。

## 6. Phase B — 清理 Python 真同义反复

- [x] 6.1 `tests/test_jm_favourites.py`：精炼后违规已消除（assert_called_once 现放行），无需改动。
- [x] 6.2 `tests/test_parser_favourites.py` + `tests/test_ipc_async_main_loop.py`：精炼后违规已消除（assert_called_once_with 现放行，参数承载契约信号），无需改动。

## 7. Phase B 验证

- [x] 7.1 运行 `npm run lint:test-quality`（前端+Python），确认**零报告**（前端 0、Python 0；backlog 清零）。
- [x] 7.2 运行 `npm test`（1217 passed）+ `pytest`（971 passed）+ `npx tsc --noEmit` + `npm run lint` + `npm run lint:py` + `black --check .`，全部通过。
- [x] 7.3 提交 Phase B（commit），列出处理清单与理由。

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
