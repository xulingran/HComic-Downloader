## 上下文

`test-discipline-gate` 变更建立了测试质量闸门（`eslint-rules/test-quality.js` + `scripts/lint-test-quality.py`），注册为 `warn` 级别。该闸门在真实测试套件中发现存量违规 backlog：前端 84 处（23 文件）+ Python 8 处（3 文件）。

对前端 84 处按 matcher 类型分类后发现：**约 33 处 `toHaveBeenCalledTimes` 与 15 处混合违规中，多数承载"触发次数/未触发"的真实不变量信号**（如"批量通知恰好触发一次"、"cancel 后任务未执行"、"缓冲区溢出后重启恰好两次"），并非真正的同义反复。闸门规则把 `toHaveBeenCalledTimes(n)` 与 `toHaveBeenCalled()` 一律视为裸调用，是误报根源。

现状约束：
- 闸门规则位于 `eslint-rules/test-quality.js`（前端）与 `scripts/lint-test-quality.py`（Python），自我验证测试位于 `tests/unit/lint/test-quality-rule.test.ts`（14 用例）与 `tests/test_test_quality_gate.py`（13 用例）。
- 闸门当前 `warn` 级别，未接入 `AGENTS.md`，CI 不阻断。
- `test-discipline-gate` 的 Phase 2b（转 error）被显式推迟到 backlog 清零。

## 目标 / 非目标

**目标：**
- 精炼 `no-bare-mock-assertion` 规则（Phase A）：区分"断言性次数/否定断言"（放行）与"裸调用"（拦截），消除约 33+ 处前端误报与对应 Python 误报。
- 清理真正的同义反复（Phase B）：逐条处理精炼后剩余的违规（前端裸 `toHaveBeenCalled` + 混合 + store CRUD + Python `assert_called`/`assert_called_with`），删除或补强。
- 闭环 Phase 2b（Phase C）：backlog 清零后转 `error` + 接入 `AGENTS.md`。

**非目标：**
- 不修改 `no-pure-store-crud-roundtrip` 规则的判定逻辑（其 3 处违规在 Phase B 逐条处理，规则本身已足够精确）。
- 不重构既有真实行为测试（`main.test.ts` 的验证器断言、`useComicReader` 的状态机断言等保持原样）。
- 不改 Python 侧 `_node_contains_real_assertion` 的真实断言判定（仅调整 `_is_mock_call_assertion` 对 `assert_called_once` 的归类）。
- 不在此变更处理 `test-discipline-gate` 已清理的文件（避免重复劳动）。

## 决策

### 决策 1：用 AST 判定 `toHaveBeenCalledTimes` 的参数是否为字面量

**选择**：在 `no-bare-mock-assertion` 的 exit 处理器中，对 `toHaveBeenCalledTimes` matcher 检查其调用参数（`expect(x).toHaveBeenCalledTimes(arg)` 的 `arg`）：
- `arg` 为 `Literal`（数字字面量，如 `1`/`2`）→ 视为**断言性次数**，计入 `hasReal`（放行整个 `it` 块）。
- `arg` 为其他（变量、`expect.any(Number)`、成员访问）→ 视为**裸调用**（拦截）。
- `not.toHaveBeenCalled()` 与 `not.toHaveBeenCalledTimes(0)` → 检测 `expect` 调用参数是否被 `UnaryExpression(!)` 或 matcher 链上的 `not` 修饰，视为否定断言，放行。

**理由**：
- `toHaveBeenCalledTimes(1)` 与 `toHaveBeenCalledTimes(n)` 的信号强度截然不同：前者断言确定的次数（被测代码必须恰好触发 N 次），后者接受任意次数（等价于"被调用过"）。
- AST 参数判定比正则更可靠：能区分 `1`（字面量）与 `expect.any(Number)`（调用表达式）、`n`（标识符）。
- 否定断言（`not.toHaveBeenCalled`）承载"未触发"信号——cancel/守卫/短路逻辑的核心验证，必须放行。

**替代方案与拒绝理由**：
- *一律放行所有 `toHaveBeenCalledTimes`*：过度放行——`toHaveBeenCalledTimes(expect.any(Number))` 与 `toHaveBeenCalledTimes(n)` 仍无信号，会漏拦。
- *用阈值（如次数 > 0 才放行）*：`(0)` 即"未触发"，是有信号的否定断言，阈值法会误拦。

### 决策 2：Python 侧把 `assert_called_once` 从拦截集移到放行

**选择**：修改 `scripts/lint-test-quality.py` 的 `MOCK_CALL_ASSERTIONS` 集合，移除 `assert_called_once` 与 `assert_called_once_with`（这两个断言"恰好一次"，承载信号）；保留 `assert_called`、`assert_any_call`、`assert_has_calls`、`assert_not_called` 中仍需甄别的项。`assert_called_with`/`assert_called_once_with` 因参数可能承载转换信号，归入"需结合参数判定"——若参数全为字面量则拦截，含变量/调用则放行（与前端 `toHaveBeenCalledWith` 对齐）。

**理由**：
- Python `assert_called_once()` 与前端 `toHaveBeenCalledTimes(1)` 语义等价，应一致放行。
- `assert_called_with(1, 2)`（纯字面量）= 仅"被以这些参数调用过"，参数不来自被测代码转换，无信号；`assert_called_with(transformed)`（变量）承载转换信号。

**替代方案**：*Python 侧保持现状全拦*：会与前端规则不一致，且 `assert_called_once` 在 `test_jm_favourites.py` 等处承载"恰好请求一次"的真实信号，全拦会逼出大量误报。

### 决策 3：Phase B 逐条处理时，三选一判定标准

**选择**：对精炼后剩余的违规，按以下优先级逐条处理（每条记录理由）：
1. **删除**：若该用例的验证意图已被同文件其他用例覆盖（如"mount 时调用 mock"已被"mount 后渲染数据"覆盖），删除。
2. **补强**：若该用例验证的是真实逻辑但缺断言（如通知触发逻辑），补充可观察状态/返回值断言，使裸 mock 断言降级为副信号。
3. **`[derived]` 标记**：仅当用例确属派生逻辑但形式触发（极少数），加标记豁免——但优先用前两种，避免滥用标记。

**理由**：批量删除会损失真实验证意图；批量加标记会让规则形同虚设。逐条甄别符合 `test-discipline` "前端 mock 调用断言必须逐条甄别价值"需求。

**替代方案**：*全删*：损失 `python-bridge` 缓冲区溢出重启、`notification-manager` 批量通知等真实逻辑的验证。*全补强*：工作量大且部分用例本就该删（mount 类）。

### 决策 4：Phase C 转 error 前必须 warn 报告清零

**选择**：Phase C（转 error）的前置条件是 `npm run lint:test-quality` 与 `lint:test-quality:py` **零报告**（零 warn）。禁止在仍有 warn 时转 error（否则 CI 红）。

**理由**：与 `test-discipline-gate` 决策 4 的"清理前置"原则一致——转 error 必须在 backlog 清零后。

## 风险 / 权衡

- **[字面量判定边界] → 缓解**：`expect.any(Number)` 是 `CallExpression`（非 `Literal`），会被正确识别为"非字面量"→拦截。`toHaveBeenCalledTimes(0)` 是 `Literal(0)`→放行（"恰好零次"=未触发，有信号）。自我验证测试覆盖这些边界。

- **[Phase B 工作量] → 权衡**：约 50 处需逐条处理，每条需读上下文判定。分文件提交（按文件/目录分组），降低单 PR 审查负担。重灾区文件（`python-bridge` 16、`notification-manager` 13）单独审查。

- **[补强时引入新断言可能脆弱] → 缓解**：补强的断言优先用可观察状态（`getState()`、DOM 文本、返回值），避免引入新的时序依赖。遵循 `test-discipline` "并发与时序测试必须验证不变量而非时序细节"。

- **[规则精炼后自我验证测试需同步更新] → 缓解**：现有 14+13 用例中，部分"反例"（用 `toHaveBeenCalledTimes` 的）在精炼后变为正例，必须同步改为正例，否则自我验证测试会红。Phase A 与自我验证测试更新在同一 commit。

- **[Python `assert_called_once` 放行后漏拦风险] → 权衡**：理论上 `assert_called_once` 可能被滥用（断言无关 mock 恰好一次），但实际中它几乎总是承载"恰好一次"的真实信号（请求一次、回调一次）。漏拦风险低于误报成本，可接受。

## 迁移计划

1. **Phase A（精炼规则）**：修改 `eslint-rules/test-quality.js` 与 `scripts/lint-test-quality.py` 的判定逻辑；**同步**更新 `test-quality-rule.test.ts`（把 `toHaveBeenCalledTimes(2)` 反例改为正例）与 `test_test_quality_gate.py`（`assert_called_once` 反例改正例）。验证：自我验证测试全绿；`npm run lint:test-quality` 报告数从 84+8 下降到精炼后剩余数（预计前端 ~48、Python ~3）。
2. **Phase B（清理）**：按文件分组逐条处理剩余违规，每组独立 commit，commit message 列出该组删除/补强清单与理由。验证：每组提交后 `npm test` / `pytest` 全绿。
3. **Phase C（转 error）**：确认 `npm run lint:test-quality` 零报告 → `eslint.config.js` 规则升 `error`、`lint-test-quality.mjs` 加 `--strict` → 更新 `AGENTS.md` 验证流程第 7 步。
4. **回滚**：规则精炼位于 `eslint-rules/` + `scripts/`，无应用代码改动；若精炼引入误判，回退规则 commit 即可。Phase C 的转 error 是配置一行变更，可即时回滚。
