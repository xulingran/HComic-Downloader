## 上下文

项目磁盘占用 ~1050 MB，分解如下：

| 位置 | 大小 | 性质 |
|------|------|------|
| `.git/` | 200 MB | 含历史中遗留的 `dist/` 构建产物 (~180 MB) |
| `python/dist/` | 72 MB | PyInstaller 输出，gitignored |
| `python/build/` | 24 MB | PyInstaller 临时文件，gitignored |
| `__pycache__/` ×150 | 1.4 MB | Python 字节码缓存，gitignored |
| `node_modules/` | 596 MB | 开发依赖，保留 |

`.gitignore` 已正确配置 `dist/`、`python/build/`、`python/dist/`、`__pycache__/` 规则，当前 HEAD 不含这些文件。问题出在 git 历史中曾提交过 `dist/`（提交 `cd2fa2e`）。

## 目标 / 非目标

**目标：**
- 释放约 98 MB 本地磁盘空间（构建产物 + 缓存）
- 将 `.git/` 从 200 MB 缩减至约 20 MB
- 确保清理后不影响正常开发工作流

**非目标：**
- 不修改 `node_modules/` 管理方式（不切换 pnpm）
- 不修改 `venv/` 结构
- 不修改源代码
- 不引入新的 `.gitignore` 规则（现有规则已足够）

## 决策

### 决策 1：git 历史清理工具选择

**选择：`git filter-repo`**

| 工具 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| `git filter-branch` | 内置，无需安装 | 慢、已官方不建议使用 | ❌ |
| `BFG Repo-Cleaner` | 快，Java 实现 | 需 JRE，不处理所有边缘情况 | 🟡 备选 |
| `git filter-repo` | 快、Python 实现、官方推荐、精确 | 需 `pip install` | ✅ |

`git filter-repo` 是 git 官方推荐的替代 `filter-branch` 的工具，Python 实现，项目已有 Python 环境。

### 决策 2：过滤策略

**选择：按路径排除 `dist/`**

```bash
git filter-repo --path dist/ --invert-paths --force
```

`--invert-paths` 表示排除（而非保留）指定路径。只清除 `dist/`，保留所有其他历史。

### 决策 3：执行顺序

**先本地清理，后 git 历史重写：**

1. 先在当前分支执行本地文件清理，确认无影响
2. 再执行 git 历史重写
3. git 历史重写是高风险步骤，放在最后，确保前两步无误

### 决策 4：备份策略

在执行 `git filter-repo` 前，通过以下方式保障安全：
- 确保远程仓库已推送最新状态
- 本地保留未过滤的 clone 或 bare clone 作为备份
- `git filter-repo` 默认拒绝在非 fresh clone 中运行，因此操作路径为：bare clone → filter → push

## 风险 / 权衡

| 风险 | 缓解 |
|------|------|
| git 历史重写后 commit hash 全部变更，协作者分支断裂 | force push 前通知所有协作者；提供 fresh clone 指引 |
| `git filter-repo` 误删非目标文件 | 仅使用 `--path dist/ --invert-paths`，精确限定过滤范围 |
| 过滤后仓库功能异常 | 过滤后运行 `git fsck` 验证完整性；执行构建脚本确认无 regression |
