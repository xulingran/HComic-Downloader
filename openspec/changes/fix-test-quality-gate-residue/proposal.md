## 为什么

`cleanup-test-quality-backlog` 与 `test-discipline-gate` 归档后，审查发现三处残留：

1. **死代码**：`eslint-rules/test-quality.js` 的 `isRealBehaviorAssertion` 函数（行 20-66，含 docblock 约 47 行）在 Phase A 精炼中被 `classifyExpectAssertion` 取代后未删除，全仓零调用者。`no-unused-vars` 对未导出的函数声明不报警，故 ESLint 漏过。
2. **测试注释残骸**：`tests/unit/stores/fatalErrorStore.test.ts` 在 Phase B 删除两个 CRUD 往返用例后，留下一段"已删除..."的占位注释（行 20-24）。删除的代码不应保留解释性注释残骸——移除理由应记在变更记录/git 历史中，而非留在测试文件里（与 test-discipline "移除理由可追溯"经 commit message 满足）。
3. **规范漂移**：`test-quality-gate` 主规范的"裸调用断言"判定（第 11 行 + 场景"Python 裸 assert_called 被拦截"第 33 行）声称 `mock.assert_called_with(<仅字面量期望>)` 必须拦截，但实际实现（`scripts/lint-test-quality.py` 的 `BARE_MOCK_ASSERTIONS`）把 `assert_called_with`/`assert_called_once_with` **全部放行**（commit `fb08f55` 的决策优化，论证见其 commit message：本仓库实际用例均在验证被测代码构建的 URL/JSON 契约）。规范与实现直接矛盾，会让后续贡献者按规范写出被实现放行、或被实现拦截但规范允许的混淆。

为什么现在做：刚归档完，残留新鲜、上下文完整，趁热清理成本最低；规范漂移若不修正会被后续变更当作"既定准则"继承。

## 变更内容

- **删除死代码**：移除 `eslint-rules/test-quality.js` 中未被调用的 `isRealBehaviorAssertion` 函数及其 docblock。
- **删除注释残骸**：移除 `tests/unit/stores/fatalErrorStore.test.ts` 第 20-24 行的"已删除..."占位注释。
- **校正规范漂移**：通过 delta spec 修正 `test-quality-gate` 主规范——把"`assert_called_with(<仅字面量期望>)` 必须拦截"改为与实现一致的"`assert_called_with`/`assert_called_once_with` 全部放行（参数承载契约信号）"，同步更新相关场景描述。

## 功能 (Capabilities)

### 新增功能

无。

### 修改功能

- `test-quality-gate`: 修正"CI 闸门必须拦截新增的裸 mock 调用断言"需求中关于 `assert_called_with` 的判定描述，使其与实际实现（全部放行）一致。

## 影响

- **代码清理**（实现层）：`eslint-rules/test-quality.js`（-47 行死代码）、`tests/unit/stores/fatalErrorStore.test.ts`（-5 行注释）。
- **规范校正**（文档层）：`openspec/specs/test-quality-gate/spec.md` 经 delta 同步。
- **无行为变更**：死代码删除不影响运行（零调用）；注释删除不影响测试；规范校正只是把文档对齐到既有实现。无 API/依赖变更。
- **验证**：7 步验证流程全绿（含 lint:test-quality，确认死代码删除未误伤规则判定逻辑）。
