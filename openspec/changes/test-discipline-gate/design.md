## 上下文

`test-discipline` 规范定义了"什么是好测试"的准则，但当前只靠人工审计执行——上一轮 `strengthen-test-suite` 清理了一批同义反复测试，之后新写的 `comicStore.test.ts`（整文件）、`settingsStore.test.ts`（5/6）、`useReaderStore.test.ts`（整文件）再次进入仓库且存活至今。审计还发现 `test_migration_mixin.py` 6 处 `assert_called_once()`、`ipc-channel-consistency.test.ts` 末尾名不副实的用例。

现状的技术约束：
- 前端 lint 用 ESLint flat config（`eslint.config.js`），作用域 `src + electron + shared + tests`。
- Python lint 用 ruff（`pyproject.toml` 的 `[tool.ruff.lint]`），但 ruff 自定义规则需 Rust 编写的插件，成本远超价值。
- 跨平台 Python 工具调用已有先例：`scripts/lint-py.mjs`、`scripts/format-py.mjs`（Node 脚本封装 venv 内的可执行文件）。
- `AGENTS.md` "完整验证流程"是贡献者的提交前事实清单（6 步）。
- CI 假设执行 `npm test` + `npm run lint` + `pytest`（标准 Electron 项目链路）。

## 目标 / 非目标

**目标：**
- 清理现存同义反复测试（Phase 1，方向 1）：删除/降级约 12-15 个低价值用例，每个删除记录理由（遵循 `test-discipline` "移除理由必须可追溯"需求）。
- 建立预防闸门（Phase 2，方向 2）：自动化拦截两类新引入的低价值测试——裸 mock 调用断言、纯框架 CRUD 往返。
- 闸门接入 `AGENTS.md` 验证流程与 CI，使准则从被动文档转为主动门控。
- 闸门规则自身有自我验证测试（反例被拦截、正例被放行），防止规则演进时静默失效。

**非目标：**
- 不重写既有真实行为测试（`searchCacheStore`、`useComicReader`、`test_models`、`ipc-arity-parity` 等保持原样）。
- 不追求 100% 覆盖率指标——本次目标是信号质量而非覆盖率数字。
- 不实现跨语言统一的闸门 DSL（前端用 ESLint、Python 用脚本，各用最合适的工具）。
- 不在此变更中引入端到端冒烟测试（属于 `behavior-integration-tests` 范畴）。
- 不修改应用代码（纯测试基础设施）。

## 决策

### 决策 1：前端闸门用自定义 ESLint 规则，而非现成插件

**选择**：在 `eslint.config.js` 中注册一条本地自定义规则（文件级，仅作用于 `tests/unit/**/*.test.ts(x)`），扫描每个 `it(...)`/`test(...)` 回调体内的断言集合。

**理由**：
- 现成插件（如 `eslint-plugin-no-only-tests`、`eslint-plugin-vitest`）没有"裸 mock 调用断言需伴随行为断言"这类语义规则——这是本项目 `test-discipline` 特有的判断标准。
- ESLint 的 AST 遍历天然适配"在 `it` 块内收集 `expect()` 调用并分类"的需求，比正则更稳健（能区分 `expect(mock).toHaveBeenCalled()` 与 `expect(result).toEqual(...)`，能识别 `await expect(...).rejects.toThrow`）。
- flat config 允许内联本地规则（`plugins: { local: {...} }`），无需发包。

**替代方案与拒绝理由**：
- *Vitest 自定义 reporter / test runner 钩子*：能在运行时拿到断言结果，但判断"是否有伴随行为断言"需要在源码层而非运行结果层做，reporter 路径不合适。
- *纯正则脚本*：无法可靠区分 `expect(x).toHaveBeenCalled()` 与 `expect(x).toHaveBeenCalledWith(transformedArg)`（后者参数承载信号），AST 必需。

### 决策 2：Python 闸门用独立 AST 脚本（`scripts/lint-test-quality.py`），而非 ruff 插件

**选择**：写一个标准库 `ast` 模块的 Python 脚本，扫描 `tests/**/*.py`，对每个 `test_*` 函数收集 `assert mock.assert_called*()` 调用与是否存在"真实断言"（返回值比较、`pytest.raises`、属性/字典/文件内容断言），通过 `scripts/lint-py.mjs` 同款 Node 包装暴露为 `npm run lint:test-quality`。

**理由**：
- ruff 自定义规则需 Rust 编译的插件 + 发布流程，为单一启发式规则不值得。
- Python 标准库 `ast` 足以做"函数内是否同时存在 mock 调用断言与真实断言"的判断，无需第三方依赖。
- 复用 `scripts/lint-py.mjs` 的跨平台封装模式（自动定位 venv），贡献者体验与现有 `lint:py` 一致。

**替代方案与拒绝理由**：
- *pytest collection-time hook（conftest.py）*：能在 `pytest --collect-only` 时跑，但会污染测试运行本身，且 `--collect-only` 不在 `AGENTS.md` 标准流程中。独立脚本更干净、可单独执行。
- *flake8 插件*：项目未用 flake8（用 ruff），引入新工具链不一致。

### 决策 3：Store CRUD 守卫作为前端 ESLint 规则的子规则，而非独立工具

**选择**：决策 1 的 ESLint 规则增加第二模式——对 `tests/unit/stores/**/*.test.ts` 检测"调用 `setX(v)` 后仅断言 `getState().x === v`"模式。豁免判定**不**靠静态推导 store 实现复杂度（脆弱），而是靠**显式标记**：store 测试若验证派生逻辑，须在 `it` 标题或行内注释含约定关键词（如 `[derived]`），否则守卫按"单行透传 store"对待。

**理由**：
- 静态推导 store 实现"是否有派生逻辑"需要跨文件分析（测试文件 vs store 文件），且实现复杂度判定本身就模糊（一行也能有 `error: () => set({type:'error'})` 的映射）。
- 显式标记把"这条用例验证派生逻辑"的意图从隐式变为显式，可审计、可自动化判定，与"豁免边界必须可判定"需求对齐。
- 关键词约定借鉴既有代码注释风格（项目多处用中文注释标注测试意图，如"已移除同义反复"）。

**替代方案与拒绝理由**：
- *跨文件静态分析 store 实现行数*：行数 ≠ 复杂度（一行 `error()` 有映射），误报/漏报率高。
- *完全人工评审*：正是当前模式，已被证明会回潮。

### 决策 4：Phase 1 必须先于 Phase 2 闸门转 error

**选择**：实施顺序锁定 Phase 1（清理）→ Phase 2（闸门先以 warning 跑通 + 自我验证测试）→ 闸门转 error 接入 CI。禁止在现存同义反复测试未清理前就把闸门设为 error。

**理由**：若闸门先转 error，现存 `comicStore.test.ts` 等会立即失败，CI 红灯，阻塞所有 PR。两 Phase 的耦合点在此。

**替代方案**：*一次性大 PR 同时清理 + 加闸门*——风险是 PR 过大、审查困难，且若闸门规则有 bug，清理决策会被裹挟。分步更稳。

### 决策 5：自我验证测试复用 `test_config_isolation_guard.py` 的守卫模式

**选择**：闸门规则的反例/正例集合作为独立测试文件（前端 `tests/unit/lint/test-quality-rule.test.ts`、Python `tests/test_test_quality_gate.py`），喂入合成用例片段断言闸门判定。模式对齐既有的 `tests/test_config_isolation_guard.py`（守卫隔离机制不被破坏）。

**理由**：闸门规则是"测试的测试"，其自身必须有测试，否则规则演进（如调整 AST 匹配）会静默失效。这与 `test-discipline` "隔离失效被守卫测试捕获"场景同构。

## 风险 / 权衡

- **[AST 规则误报] → 缓解**：规则只判定"同 `it`/`test_*` 块内是否存在真实断言"，且 `toHaveBeenCalledWith(transformedArg)` 直接放行（参数即信号）。自我验证测试覆盖正例。误报可在 Phase 2 的 warning 阶段（未转 error 前）暴露并修正。

- **[Store 派生豁免关键词被滥用] → 缓解**：关键词 `[derived]` 必须配合真实派生断言；守卫检测到关键词但用例体仍是纯 setter 往返时仍失败（关键词不是免死金牌，只是声明意图，规则仍检查断言形态）。

- **[清理 Phase 1 误删有价值测试] → 缓解**：每个删除记录理由（原断言 + 为何低价值），删除清单在 `tasks.md` 逐条列出，审查可逐条核验。`searchCacheStore`/`historyStore` 等明确不在删除清单。

- **[Python AST 脚本对 mock 模式覆盖不全] → 缓解**：脚本只针对 `assert_called*` 家族（明确列出的同义反复模式），不试图覆盖所有可能的 mock 断言形态；覆盖不全等于少拦截，不会误伤。脚本失败模式偏向"漏报"而非"误报"。

- **[CI 构建时间增加] → 权衡**：ESLint 本地规则零额外进程开销；Python AST 脚本扫描 `tests/`（~17k 行）毫秒级。可忽略。

- **[AGENTS.md 流程步骤从 6 增到 7，贡献者负担] → 权衡**：新增步骤是 `npm run lint:test-quality` 一条命令，且与现有 `npm run lint` 可串联。收益（防回潮）远超一行命令的成本。

## 迁移计划

1. **Phase 1（清理）**：按 `tasks.md` 逐文件删除/降级，每条删除在 commit message 或行内注释记录理由。验证：`pytest` + `npm test` 全绿（删除测试不应让其他测试失败）。
2. **Phase 2a（闸门 warning）**：实现 ESLint 规则 + Python 脚本 + 自我验证测试，先以 warning / 独立命令运行（不阻断），跑通正反例。
3. **Phase 2b（闸门转 error）**：Phase 1 合并后，闸门转 error，接入 `eslint.config.js` 默认规则集与 `npm run lint:test-quality`，更新 `AGENTS.md` 验证流程第 7 步。
4. **回滚策略**：闸门规则全部位于 `eslint.config.js` + `scripts/` + `tests/conftest.py`（如用 collection hook 备选），无应用代码改动；若闸门引发大面积误报，注释掉规则注册即可回滚，不影响应用功能。
