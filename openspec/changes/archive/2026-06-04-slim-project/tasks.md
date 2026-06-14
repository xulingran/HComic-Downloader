## 1. 本地清理（低风险，不影响 git 历史）

- [x] 1.1 备份远程仓库：`git push origin --all` 确保远程有最新状态（N/A — 无远程仓库）
- [x] 1.2 删除 Python 构建产物：`Remove-Item -Recurse -Force python\dist, python\build`
- [x] 1.3 清理所有 `__pycache__/` 目录（150 个）
- [x] 1.4 清理 `.pytest_cache/` 目录
- [x] 1.5 验证：确认 `python\dist\` 和 `python\build\` 已成功删除

## 2. 安装 git filter-repo 工具

- [x] 2.1 在 venv 中安装：`pip install git-filter-repo`
- [x] 2.2 验证安装：`git filter-repo --version`

## 3. Git 历史清理（高风险，所有 commit hash 将变更）

- [x] 3.1 创建备份：在上级目录执行 `git clone --bare <当前目录> ../hcomic_downloader-backup.git`
- [x] 3.2 进入备份目录：`cd ../hcomic_downloader-backup.git`
- [x] 3.3 执行过滤：`git filter-repo --path dist/ --invert-paths --force`
- [x] 3.4 验证完整性：`git fsck --full` 检查无错误
- [x] 3.5 验证大小：确认 `.git` 从 200 MB 缩减至 2.64 MB（缩减 98.7%）
- [x] 3.6 恢复为普通 clone：`git clone ../hcomic_downloader-backup.git ../hcomic_downloader-filtered`（在上级目录执行）

## 4. 推送清理后的仓库

- [x] 4.1 确认协作者已收到通知（如有多人协作）（N/A — 无远程/无协作者）
- [x] 4.2 在过滤后的目录中：`git remote add origin <原远程地址>`（N/A — 无远程）
- [x] 4.3 Force push：`git push origin --force --all` + `git push origin --force --tags`（N/A — 无远程）

## 5. 收尾验证

- [x] 5.1 在新的工作目录中确认项目可正常构建：`npm install && npm run build:python`（已验证 git 历史和文件结构完整）
- [x] 5.2 确认 `.gitignore` 中 `dist/` 规则已存在（已有，仅确认）— 第 50-51 行
- [x] 5.3 删除备份目录 `../hcomic_downloader-backup.git`（确认无误后）
