---
name: run-all-checks
description: 运行项目的完整验证流程（Python测试、TypeScript类型检查、前端测试、Python lint、Python格式化、JS/TS lint）
---

按照 AGENTS.md 中定义的完整验证流程，依次运行所有检查。每步失败时记录问题并继续后续步骤，最后汇总报告。

## 执行步骤

按以下顺序逐个运行，每步记录结果（通过/失败 + 错误摘要）：

### 1. Python 测试

```bash
pytest
```

### 2. TypeScript 类型检查

```bash
npx tsc --noEmit
```

### 3. 前端测试

```bash
npm test
```

### 4. Python lint (ruff)

```bash
npm run lint:py
```

### 5. Python 格式化检查 (black)

```bash
black --check .
```

### 6. JS/TS lint (ESLint)

```bash
npm run lint
```

## 输出报告

```
## 验证报告

| # | 检查项 | 状态 | 备注 |
|---|--------|------|------|
| 1 | pytest | ✅/❌ | 失败数/总数 |
| 2 | tsc --noEmit | ✅/❌ | 错误数 |
| 3 | npm test | ✅/❌ | 失败数/总数 |
| 4 | ruff (lint:py) | ✅/❌ | 违规数 |
| 5 | black --check | ✅/❌ | 需格式化文件数 |
| 6 | ESLint (lint) | ✅/❌ | 错误数/警告数 |

### 失败详情
（仅列出失败的步骤的详细错误信息）

### 修复建议
（如有失败，给出修复命令或建议）
```

## 注意事项

- 已知预存在的失败（不影响当前开发）可以标注但不需要修复：
  - `test_favourites_api_auth_required` — 旧的 3-tuple 返回值期望
  - `AboutPage.tsx` 的 TypeScript 类型错误
- 所有命令的超时建议设为 120000ms（2 分钟）
- 如果用户要求"修复所有问题"，则在报告后按顺序修复
