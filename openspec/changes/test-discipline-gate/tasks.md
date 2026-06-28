# 实施任务

> 严格按 Phase 顺序执行：Phase 1（清理）必须先合并，Phase 2 闸门才能从 warning 转 error，否则现存同义反复测试会让 CI 立即红。

## 1. Phase 1 — 清理纯框架 CRUD 测试（前端 store）

- [x] 1.1 删除 `tests/unit/stores/comicStore.test.ts` 整文件。理由记录：6/6 用例均为 `setX(v) → getState().x === v` 往返，store 实现为单行 `(x) => set({ x })`（`src/stores/useComicStore.ts`），验证 Zustand 框架基本保证，无项目代码信号。
- [x] 1.2 删除 `tests/unit/stores/useReaderStore.test.ts` 整文件。理由记录：3/3 用例验证 `openReader`/`closeReader` 的状态赋值，store 实现为 `set({...})` 透传，无派生逻辑。
- [x] 1.3 精简 `tests/unit/stores/settingsStore.test.ts`：删除"应能设置 themeMode"、"应能设置 cardStyle"、"应能设置 sfwMode"、"应能通过 dismissSfwToast 设置 sfwToastDismissed"、"defaultFavouriteSource 默认为空字符串且可设置"5 个 setter 往返用例；**保留**"应能切换所有主题模式"参数化用例（验证枚举值集合的契约，含弱派生信号）。理由记录在文件顶部注释。
- [x] 1.4 **保留** `tests/unit/stores/searchCacheStore.test.ts`、`historyStore.test.ts`、`drawerStore.test.ts`、`fatalErrorStore.test.ts`、`toastStore.test.ts`——它们含派生逻辑（上下文隔离、预加载不覆盖、字段映射、可选字段传播），不在删除清单。保留理由已记入本任务条目备查。

## 2. Phase 1 — 降级裸 mock 调用断言（Python）

- [x] 2.1 降级 `tests/test_migration_mixin.py` 中 6 处 `assert_called_once()`：`test_confirm_migration_pauses_dm`、`test_migration_complete_resumes_dm`、`test_migration_error_resumes_dm`、`test_cancel_migration_resumes_dm`（`toggle_global_pause` 断言）、`test_pause_migration_holds_lock`、`test_resume_migration_holds_lock`（`pause`/`resume` 断言）。删除冗余的 mock 计数断言，**保留** `mixin._migration_paused_dm` 状态断言（真实信号源）。每个降级在行内注释记录理由。
- [x] 2.2 强化 `test_pause_and_confirm_are_serialized`（L146）：当前 `assert "pause" in pause_order` 仅验证 `tracked_pause` 被执行（重述调用）。改为验证真实串行不变量（如 pause 在 lock 持有期间执行），或标注为低价值并删除。
- [x] 2.3 降级 `tests/test_migration.py::test_log_handler_initialized_in_constructor`（T9, L519）：`mock_makedirs.assert_called_once()` 重述构造函数实现。删除 mock 断言，**保留** `assert engine._log_handler is not None` 真实状态断言。
- [x] 2.4 降级 `tests/test_migration.py::test_*` 中 `mock_db.update_output_path.assert_called_once()`（L513）：确认该用例是否有伴随的状态断言（`state.plan[0].status == "done"`），若无则补充对迁移结果的真实验证。

## 3. Phase 1 — 修正名不副实的测试

- [x] 3.1 修正 `tests/unit/main/ipc-channel-consistency.test.ts` 末尾用例（`it('no IPC channel string should appear as a raw string in preload or main...')`）：当前只断言常量集合非空，未扫描源文件。二选一：(a) 让用例名副其实——读取 `electron/preload.ts` 与 `electron/main.ts`，断言 IPC_CHANNELS 的值不作为裸字符串字面量出现；(b) 重命名为"常量非空健全性检查"以如实反映行为。优先 (a)。
- [x] 3.2 复核 `tests/test_ipc_startup_progress.py::test_flush_is_true`：`mock_print.assert_called_once()` + `kwargs.flush is True` 与同文件其他 5 个 stderr 内容断言重叠。合并到内容断言用例，或标注为防御性保留。

## 4. Phase 1 验证

- [x] 4.1 运行 `pytest`，确认删除/降级后全部通过（删除测试不应使其他测试失败）。
- [x] 4.2 运行 `npm test`，确认前端测试通过。
- [x] 4.3 运行 `npx tsc --noEmit` + `npm run lint` + `npm run lint:py` + `black --check .`，确认无新增 lint/类型错误（删除文件可能触发 unused import 等）。
- [ ] 4.4 提交 Phase 1（独立 commit / PR），PR 描述列出删除清单 + 每条理由，便于审查。

## 5. Phase 2a — 前端闸门实现（warning 阶段）

- [ ] 5.1 在 `eslint.config.js` 注册本地自定义插件 `local`，含规则 `no-bare-mock-assertion`：扫描 `tests/unit/**/*.test.ts(x)` 的每个 `it`/`test` 回调，若块内含 `expect(x).toHaveBeenCalled()` / `toHaveBeenCalledTimes(n)` 但**不**含返回值/抛错/状态断言，则报告。`toHaveBeenCalledWith(transformedArg)` 直接放行。
- [ ] 5.2 在同一插件添加规则 `no-pure-store-crud-roundtrip`：作用于 `tests/unit/stores/**/*.test.ts`，检测"调用 `setX(v)` + 仅断言 `getState().x === v`"模式。豁免：`it` 标题或行内注释含 `[derived]` 标记。
- [ ] 5.3 实现自我验证测试 `tests/unit/lint/test-quality-rule.test.ts`：喂入合成反例（裸 toHaveBeenCalled、纯 store CRUD）断言规则报告；喂入合成正例（伴随返回值断言、含 `[derived]` 标记）断言规则放行。覆盖决策 1/3 的判定逻辑。
- [ ] 5.4 在 `package.json` 新增 `lint:test-quality` 脚本（或并入现有 `lint`，但先独立以便分阶段）。先以 ESLint `warn` 级别注册，不阻断。

## 6. Phase 2a — Python 闸门实现（warning 阶段）

- [ ] 6.1 编写 `scripts/lint-test-quality.py`：用标准库 `ast` 扫描 `tests/**/*.py`，对每个 `test_*` 函数收集 `assert mock.assert_called*()` 调用，判定同函数内是否存在真实断言（返回值比较、`pytest.raises`、属性/字典/文件内容断言）。无真实断言则报告。
- [ ] 6.2 编写 Node 包装 `scripts/lint-test-quality.mjs`（仿 `scripts/lint-py.mjs` 跨平台定位 venv Python），暴露为 `npm run lint:test-quality`（或 `lint:test-quality:py`）。
- [ ] 6.3 实现自我验证测试 `tests/test_test_quality_gate.py`：构造合成 `test_*` 函数源码字符串，喂入 `lint-test-quality.py` 的扫描函数，断言反例被报告、正例被放行。覆盖决策 2。
- [ ] 6.4 `npm run lint:test-quality` 在本地跑通，确认现存清理后的测试无报告（Phase 1 已清除已知违规）。

## 7. Phase 2b — 闸门转 error 并接入流程

- [ ] 7.1 确认 Phase 1 已合并、CI 绿。将前端 ESLint 规则从 `warn` 升为 `error`；Python 脚本以非零退出码阻断。
- [ ] 7.2 更新 `AGENTS.md` "完整验证流程"：在第 6 步 `npm run lint` 后新增第 7 步 `npm run lint:test-quality`（测试质量闸门）。同步更新"代码检查与格式化"小节说明该命令的作用。
- [ ] 7.3 更新 `eslint.config.js` 的规则级别为 `error`；确认 `npm run lint` 现在会因测试质量问题失败。
- [ ] 7.4 在 PR 描述中说明：自此 PR 起，新引入的裸 mock 调用断言 / 纯 store CRUD 往返会被闸门拦截，引用 `test-discipline` 与 `test-quality-gate` 规范。

## 8. 全量验证与归档准备

- [ ] 8.1 完整执行 `AGENTS.md` 7 步验证流程（含新增的 lint:test-quality），全部通过。
- [ ] 8.2 确认 `openspec-cn status --change "test-discipline-gate"` 显示所有 applyRequires 产出物完成。
- [ ] 8.3 验证 `test-quality-gate` 规范的每个场景有对应的闸门行为覆盖（自我验证测试 + 规则判定逻辑）；验证 `test-discipline` 新增需求的场景被满足。
- [ ] 8.4 归档变更前，运行一次"故意引入违规用例"的手动验证：临时在某个测试加 `expect(vi.fn()).toHaveBeenCalled()` 单独断言，确认闸门失败；移除后确认通过。
