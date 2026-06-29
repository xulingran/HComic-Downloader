## 上下文

`cleanup-test-quality-backlog` 与 `test-discipline-gate` 归档后，留下三类与"已交付行为"不一致的残留：

1. `eslint-rules/test-quality.js` 的 `isRealBehaviorAssertion`（行 20-66，~47 行含 docblock）是 Phase A 精炼前的旧判定函数，被 `classifyExpectAssertion`（行 117-163）取代后未删除。全仓零调用者（`grep -rn isRealBehaviorAssertion` 仅返回定义行）。`@typescript-eslint/no-unused-vars` 不检测未导出的局部函数声明，ESLint 漏过。
2. `tests/unit/stores/fatalErrorStore.test.ts` 行 20-24 留有"已删除 'setError 应设置致命错误'..."的占位注释。Phase B 删除两个 CRUD 往返用例时，移除理由记在了 git commit message（符合 test-discipline"移除理由可追溯"），但文件里又重复留了一段解释性注释残骸。
3. `openspec/specs/test-quality-gate/spec.md` 的"裸调用断言"判定（行 11 + 场景"Python 裸 assert_called 被拦截"行 33）声称 `mock.assert_called_with(<仅字面量期望>)` 必须拦截，但实现（`scripts/lint-test-quality.py` 的 `BARE_MOCK_ASSERTIONS = {assert_called, assert_any_call, assert_has_calls}`）把 `assert_called_with`/`assert_called_once_with` 全部放行。这是 commit `fb08f55` 的决策优化（论证：本仓库 tests/ 实际仅用 `assert_called_once_with`/`assert_not_called`/`assert_called_once`，无 `assert_called`/`any_call`/`has_calls`，且 `*_called_with` 都在验证被测代码构建的 URL/JSON 契约），但规范文本未同步。

附带：主规范 `test-quality-gate/spec.md` 行 4 的"目的"是占位文本"待定 - 由归档变更 test-discipline-gate 创建。归档后请更新目的。"——归档工具未填，需补全。

## 目标 / 非目标

**目标：**
- 删除死代码 `isRealBehaviorAssertion`，使 `eslint-rules/test-quality.js` 不含未使用的旧实现。
- 删除 `fatalErrorStore.test.ts` 的注释残骸，使测试文件不含对已删除代码的解释。
- 修正 `test-quality-gate` 主规范，使其 `assert_called_with` 判定与实现一致（全部放行）。
- 补全主规范"目的"占位文本。

**非目标：**
- **不**改变闸门的实际判定行为（死代码删除零调用、注释删除不影响测试、规范校正只是对齐既有实现）。
- **不**重构 `classifyExpectAssertion` 或 `BARE_MOCK_ASSERTIONS` 的逻辑（它们已验证正确）。
- **不**重新审视 `assert_called_with` 放行决策本身——该决策已由 `fb08f55` 充分论证并经全量测试验证，本次只对齐文档。
- **不**处理 `tasks.md` 中"`assert_called_with` 按字面量判定"的历史描述（已归档，属历史记录，不应回改）。

## 决策

### 决策 1：`assert_called_with` 全部放行（与实现对齐，不再按字面量区分）

**选择**：delta spec 的 MODIFIED 需求明确写"`assert_called_with`/`assert_called_once_with` 全部放行，**禁止**按参数是否全字面量区分拦截"，并新增场景"Python assert_called_with 全部放行不按字面量区分"固化此判定。

**理由**：
- 与 `scripts/lint-test-quality.py` 的 `BARE_MOCK_ASSERTIONS` 实际拦截集（仅 `assert_called`/`assert_any_call`/`assert_has_calls`）完全对齐。
- `fb08f55` 已论证：即便参数全字面量，`assert_called_with(literal)` 的语义是"被测代码以这些字面量调用了协作方"，参数来自被测代码的组装逻辑（如 `shutdown(cancel_futures=True, wait=False)`、`add_to_favourites` 的 json body），mock 替换测试不成立——属契约验证。
- 与前端 `toHaveBeenCalledWith` 一律放行对齐（前后端判定一致）。

**替代方案与拒绝理由**：
- *改实现去拦截全字面量 `assert_called_with`（让实现服从规范）*：会与 `fb08f55` 的论证冲突，且本仓库无此类用例，纯属制造拦截面而无收益，还要重写已通过的自我验证测试。规范是错的那个，应改规范。
- *保留规范的"按字面量区分"措辞，加注说明实现简化*：留两套语义会让贡献者困惑（按规范写代码会被实现放行，或反之），spec 漂移未真正消除。

### 决策 2：死代码直接删除，不留 deprecation 标记

**选择**：直接删 `isRealBehaviorAssertion` 函数及其 docblock，不留 `@deprecated` 注释或占位。

**理由**：该函数零调用、零导出、非公开 API，无外部消费者。留 deprecation 标记反而增加阅读负担。

**替代方案**：*留 `@deprecated` 一段过渡期*：无意义——没有调用者需要迁移。

### 决策 3：注释残骸直接删除

**选择**：删 `fatalErrorStore.test.ts` 行 20-24 的占位注释，不保留任何痕迹。

**理由**：移除理由已在 git commit `419b9cb`（Phase B）的 message 中完整记录（test-discipline"移除理由必须可追溯"经 commit message 满足），文件内重复留注释是冗余且违反"测试文件不应含对不存在代码的解释"。

**替代方案**：*改写为简短的一行注释指向 commit*：仍属冗余，commit 历史本身就是可追溯来源。

## 风险 / 权衡

- **[死代码删除误伤规则] → 缓解**：`isRealBehaviorAssertion` 零调用，删除后 `npm run lint:test-quality` 与自我验证测试（`test-quality-rule.test.ts` 18 用例 + `test_test_quality_gate.py` 16 用例）必须全绿，确认规则判定逻辑（实际由 `classifyExpectAssertion` 承载）未受影响。这是删除后的必跑验证。
- **[规范校正引入措辞偏差] → 缓解**：delta spec 用 MODIFIED 完整重写需求块，归档时 `openspec-cn archive` 会替换主规范对应需求；归档后 `openspec-cn validate test-quality-gate` 必须通过，确保结构与场景标题合规。
- **[主规范"目的"补全措辞] → 权衡**：目的段不在 delta spec 覆盖范围（delta 只改需求），需在实现阶段直接编辑主规范文件。措辞应简明陈述该 capability 的作用域（测试质量闸门的判定准则与执行要求），避免与 test-discipline 重复（后者管"准则是什么"，本规范管"准则如何被自动化执行"）。

## 迁移计划

1. **编辑代码**：删除 `eslint-rules/test-quality.js` 的 `isRealBehaviorAssertion`（行 20-66）；删除 `tests/unit/stores/fatalErrorStore.test.ts` 行 20-24 注释。
2. **编辑主规范目的**（非 delta）：补全 `openspec/specs/test-quality-gate/spec.md` 行 4 的占位"目的"。
3. **验证**：7 步验证流程全绿（重点 lint:test-quality + 自我验证测试），`openspec-cn validate test-quality-gate` 通过。
4. **归档**：`openspec-cn archive fix-test-quality-gate-residue` 同步 delta（MODIFIED 需求）到主规范。
5. **回滚**：纯文档/死代码清理，`git revert` 单 commit 即可，无数据/迁移风险。
