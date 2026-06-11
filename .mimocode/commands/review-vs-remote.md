---
name: review-vs-remote
description: 审查本地分支相对于远端的所有更改（已提交但未推送的commit）
---

审查本地分支相对于远端（origin/master）的所有未推送更改，输出结构化的审查报告。

## 执行步骤

### 1. 收集变更信息

```bash
git fetch origin
git log origin/master..HEAD --oneline
git diff origin/master..HEAD --stat
git diff origin/master..HEAD
```

### 2. 逐文件审查

审查标准与 `review-uncommitted` 命令相同：

1. **读取完整文件**以理解上下文
2. 检查：类型安全、错误处理、IPC 集成完整性、测试覆盖、代码规范、安全、死代码、React 性能
3. 特别关注：跨 commit 的累积效果、commit 消息是否准确描述了变更

### 3. 输出报告

格式与 `review-uncommitted` 相同，但额外包含：

```
### 未推送的 commits
- `abc1234` 简短描述
- `def5678` 简短描述

### Commit 质量检查
- 是否有 typo 或遗漏的 commit
- squash 建议（如果多个 commit 解决同一个问题）
```

### 4. 如果用户确认，执行修复

等用户确认后再修改代码，不要自行修改。
