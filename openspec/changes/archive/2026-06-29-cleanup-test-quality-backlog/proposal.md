## 为什么

`test-discipline-gate` 变更建立了测试质量闸门（warn 级别），并发现存量违规 backlog：前端 84 处（23 文件）+ Python 8 处（3 文件）。对该 backlog 做分类（按 matcher 类型）后，发现一个关键事实——**大多数前端违规并非真正的同义反复，而是闸门规则过粗导致的误报**：

| 违规类型 | 数量 | 性质 |
|----------|------|------|
| 仅 `toHaveBeenCalledTimes` | 33 | **多为误报**：`toHaveBeenCalledTimes(1)` 断言"恰好触发一次"、`(2)` 断言"重启两次"、`not.toHaveBeenCalled()` 断言"取消生效"——这些承载"触发次数/未触发"的真实不变量信号，并非"被调用过"的同义反复 |
| 仅 `toHaveBeenCalled`（无参） | 33 | **多为真同义反复**：仅断言"被调用过"，mock 替换测试成立——需逐条甄别（删除或补真实断言） |
| 混合（两者并存） | 15 | 需逐条甄别 |
| `notCalled` 类 | 0 | （已被 `not.` 或配对断言覆盖） |

为什么现在做：`test-discipline-gate` 的 Phase 2b（闸门转 error + 接入 `AGENTS.md`）被推迟到 backlog 清零。若不先**精炼闸门规则**就批量清理，会把 33 处承载真实信号的 `toHaveBeenCalledTimes` 测试误删或被迫加 `[derived]` 标记，反而损害信号质量。本变更先精炼规则（消除误报），再清理真正的同义反复，最后转 error，闭环 `test-discipline-gate` 遗留的 Phase 2b。

## 变更内容

### Phase A — 精炼 `no-bare-mock-assertion` 规则（消除误报）

把"断言性次数"与"裸调用"区分开：
- `expect(x).toHaveBeenCalled()`（无参）—— 仍视为裸调用（仅"被调用过"，无信号），**拦截**。
- `expect(x).toHaveBeenCalledTimes(<字面量>)`（如 `(1)`/`(2)`）—— **放行**，断言特定次数承载"触发 N 次"的不变量信号。
- `expect(x).not.toHaveBeenCalled()` / `not.toHaveBeenCalledTimes(0)` —— **放行**，断言"未触发"承载"取消/守卫生效"信号。
- Python 侧 `assert_called_once()` 对应"恰好一次"，**放行**（与前端 `toHaveBeenCalledTimes(1)` 对齐）；但 `assert_called()` / `assert_called_with(字面量)` 仍拦截。

预期效果：84 处前端违规中约 33+ 处 `toHaveBeenCalledTimes` 误报消失；Python 侧 `assert_called_once` 放行。

### Phase B — 清理真正的同义反复（backlog 剩余项）

精炼规则后，逐条处理剩余违规（约前端 33 裸 `toHaveBeenCalled` + 15 混合 + 3 store CRUD + Python 调整后剩余）：
- **删除**：纯"mount 时调用 mock"类（如 `DownloadPage` 的 `calls getDownloads on mount`）——无独立信号，删除。
- **补强**：确有验证意图但缺断言的（如通知/调度/重启逻辑）——补充可观察状态或返回值断言。
- **保留并加 `[derived]`**：极少数确属派生逻辑但形式触发的（如 `usePaginatedPreloader` 的预加载边界）。

### Phase C — 闸门转 error 并接入 `AGENTS.md`（闭环 Phase 2b）

backlog 清零（`npm run lint:test-quality` 零报告）后：
- 前端 ESLint 规则从 `warn` 升 `error`；Python 脚本调用方加 `--strict`。
- `AGENTS.md` "完整验证流程"新增第 7 步 `npm run lint:test-quality`。

## 功能 (Capabilities)

### 新增功能

无。

### 修改功能

- `test-quality-gate`: 修改"CI 闸门必须拦截新增的裸 mock 调用断言"需求——细化判定准则，区分"断言性次数"（`toHaveBeenCalledTimes(字面量)` / `assert_called_once` / `not.toHaveBeenCalled`，承载信号，放行）与"裸调用"（`toHaveBeenCalled()` / `assert_called()`，无信号，拦截）。同步"闸门必须接入提交前验证流程"需求的可执行步骤描述。

## 影响

- **规则精炼**（Phase A）：`eslint-rules/test-quality.js` 的 `no-bare-mock-assertion` 规则判定逻辑；`scripts/lint-test-quality.py` 的 `MOCK_CALL_ASSERTIONS` 集合与 `_is_mock_call_assertion` 判定。
- **自我验证测试更新**：`tests/unit/lint/test-quality-rule.test.ts` + `tests/test_test_quality_gate.py` 新增"断言性次数放行"正例与"裸调用拦截"反例。
- **backlog 清理**（Phase B）：约 23 个前端测试文件 + 3 个 Python 测试文件，净减约 30-45 个真同义反令断言（精炼后剩余），部分补强、部分删除。每个删除/补强记录理由（遵循 `test-discipline` "移除理由必须可追溯"）。
- **流程接入**（Phase C）：`AGENTS.md` "完整验证流程" + "代码检查与格式化"章节；`eslint.config.js` 规则级别 `warn`→`error`；`scripts/lint-test-quality.mjs` 加 `--strict`。
- **无应用代码变更**，无 API/依赖变更。CI 时间增量可忽略（静态扫描）。
- **依赖关系**：本变更闭环 `test-discipline-gate` 的 Phase 2b；两变更应按序合并（test-discipline-gate 先合并，本变更后合并）。
