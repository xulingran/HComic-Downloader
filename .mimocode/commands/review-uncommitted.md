---
name: review-uncommitted
description: 审查当前工作区未提交的修改，检查代码质量、潜在问题和一致性
---

审查当前工作区中所有未提交的修改（unstaged + staged + untracked），输出结构化的审查报告。

## 执行步骤

### 1. 收集变更信息

```bash
git status
git diff HEAD --stat
git diff HEAD
git diff --staged --stat
```

如果 diff 很大，先看 `--stat` 再按文件分段读取。

### 2. 逐文件审查

对每个修改的文件：

1. **读取完整文件**（用 Read 工具）以理解上下文，不要仅看 diff
2. 检查以下方面：
   - **类型安全**：TypeScript 类型标注是否完整，Python 类型注解是否齐全
   - **错误处理**：网络请求是否调用了 `apply_system_proxy_to_session()`，异常是否正确传播（`ParserResponseError` 应 re-raise）
   - **IPC 集成**：新增 IPC 通道是否在 7 层全部更新（Python parser → IPC mixin → `_HANDLER_NAMES` → `shared/types.ts` IPCMethods + PYTHON_IPC_CHANNEL_MAP + IPC_CHANNELS + HcomicAPI → `electron/main.ts` ipcMain.handle + validators → `electron/preload.ts` → React hooks/components）
   - **测试覆盖**：新增功能是否有对应测试
   - **代码规范**：命名（PascalCase 类名、snake_case 函数/变量）、导入顺序（标准库 → 第三方 → 本地）、行长 120
   - **安全问题**：IPC 参数校验（类型/长度/范围/路径遍历/控制字符）、CSP、context isolation
   - **死代码**：未使用的导入、变量、注释掉的代码
   - **React 性能**：useCallback/useMemo 使用是否正确（特别是 `hasPage` 这类传递给 hook 的回调必须用 `useCallback`）

### 3. 输出报告

按严重程度分类输出：

```
## 审查报告

### 🔴 必须修复（N 项）
- [文件:行号] 问题描述 → 建议修复方式

### 🟡 建议改进（N 项）
- [文件:行号] 问题描述 → 建议修复方式

### 🟢 良好实践（N 项，可选）
- 正面评价

### 总结
- 修改统计：X 文件，+Y/-Z 行
- 总体评价：一句话
```

### 4. 如果用户确认，执行修复

等用户确认后再修改代码，不要自行修改。
