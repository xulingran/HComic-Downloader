## 为什么

项目磁盘占用约 1050 MB，其中源代码和测试仅占 ~13 MB（1.2%）。其余均为可清理的构建产物、缓存和历史遗留文件。需要立即缩减以降低克隆成本、加速 CI，并减少本地磁盘压力。

## 变更内容

1. **清理本地构建产物** — 删除 `python/dist/` (72 MB) 和 `python/build/` (24 MB)，这些是 PyInstaller 输出，已 gitignored，可随时重建。
2. **清理 Python 缓存** — 删除 150 个 `__pycache__/` 目录 (~1.4 MB) 和 `.pytest_cache/`。
3. **重写 git 历史** — 使用 `git filter-repo` 从历史中清除已提交的 `dist/` 构建产物（HComic Downloader.exe 176 MB + Setup.exe 76 MB + 杂项 ~10 MB），将 `.git/` 从 200 MB 缩小至约 20 MB。

## 功能 (Capabilities)

### 新增功能

无。此为纯维护性清理，不引入新功能。

### 修改功能

无。不涉及规范层面的行为变更。

## 影响

- **磁盘空间**: 合计缩减约 278 MB（本地 98 MB + git 历史 180 MB）
- **git 历史**: 所有 commit hash 将被重写，远程仓库需 force push，协作者需 fresh clone 或 rebase
- **构建流程**: 无影响。`python/dist/` 和 `python/build/` 由 `npm run build:python` 自动重建
- **源码**: 无修改。只清理生成文件和 git 历史
