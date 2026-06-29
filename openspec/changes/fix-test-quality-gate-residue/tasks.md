# 实施任务

> 纯清理变更：死代码删除 + 注释残骸删除 + 主规范目的补全 + delta spec 校正。
> 先改代码（验证行为不变），再补主规范目的，最后归档同步 delta。

## 1. 代码清理

- [ ] 1.1 删除 `eslint-rules/test-quality.js` 中的 `isRealBehaviorAssertion` 函数及其 docblock（行 20-66）。确认删除后文件内无 `isRealBehaviorAssertion` 残留引用（`grep` 验证零命中）。
- [ ] 1.2 删除 `tests/unit/stores/fatalErrorStore.test.ts` 第 20-24 行的"已删除..."占位注释。确认删除后文件无孤立空行或对已删除用例的引用。

## 2. 主规范目的补全（非 delta，直接编辑）

- [ ] 2.1 编辑 `openspec/specs/test-quality-gate/spec.md` 第 4 行，把占位文本"待定 - 由归档变更 test-discipline-gate 创建。归档后请更新目的。"替换为简明的目的陈述：说明本规范定义测试质量闸门（前端 ESLint `test-quality` 规则 + Python `scripts/lint-test-quality.py`）的判定准则与执行要求，把 `test-discipline` 的"mock 替换测试"等准则转为自动化主动门控。措辞不与 `test-discipline` 重复。

## 3. 验证（行为不变）

- [ ] 3.1 运行自我验证测试：`npx vitest run tests/unit/lint/test-quality-rule.test.ts`（18 passed）+ `pytest tests/test_test_quality_gate.py`（16 passed），确认死代码删除未误伤规则判定逻辑。
- [ ] 3.2 运行完整 7 步验证流程：`pytest`（971）+ `npx tsc --noEmit` + `npm test`（1217）+ `npm run lint:py` + `black --check .` + `npm run lint` + `npm run lint:test-quality`，全部通过。
- [ ] 3.3 运行 `openspec-cn validate test-quality-gate`，确认主规范结构合规（目的/需求/场景标题）。

## 4. 提交与归档

- [ ] 4.1 提交代码清理 + 主规范目的补全（独立 commit），commit message 说明清理项与对应来源（死代码源于 Phase A 精炼、注释残骸源于 Phase B、规范目的占位源于归档工具未填）。
- [ ] 4.2 运行 `openspec-cn archive fix-test-quality-gate-residue`，将 delta spec（MODIFIED 需求：`assert_called_with` 全部放行）同步到主规范。
- [ ] 4.3 归档后再次 `openspec-cn validate test-quality-gate` + `openspec-cn list`（活动变更清空），确认归档干净。
