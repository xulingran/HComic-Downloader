## 为什么

当前应用专注于「下载」，但对下载完成后的资产健康缺少系统性的维护手段。随着时间推移，用户会遇到三类问题：

1. **文件损坏不自知**：网络波动可能导致某张图片下载成 0 字节或截断，用户只有在打开阅读时才发现。
2. **临时目录残留**：崩溃或异常退出会让 `temp_*` 目录留在下载目录里，长期占用空间。
3. **存储去向不明**：下载目录越来越大，但用户不知道哪些来源/作者占了多少空间，也难以决定清理哪些内容。

本次变更引入「维护中心」，以**只读检查 + 安全清理 + 空间分析**三件套解决上述问题。第一期不包含「自动修复下载」，只聚焦于发现问题和清理残留，保持低风险。

## 变更内容

- **新增「维护中心」页面**：独立的 `MaintenancePage`，通过侧边栏导航进入，与工具箱并列。
- **健康检查**：扫描 `download_history.db` 中的成功记录，验证目标文件是否存在、CBZ/ZIP 是否完整、图片是否能被 PIL 打开、实际页数是否与期望一致。
- **孤儿临时目录清理**：扫描下载目录中残留的 `temp_*` 目录，排除活跃任务和近期目录，提供一键安全删除。
- **存储分析**：按来源、格式、作者维度统计下载目录的空间占用，并展示 Top 大文件与孤儿文件。

## 功能 (Capabilities)

### 新增功能

- `maintenance-center`: 维护中心页面，聚合健康检查、孤儿清理、存储分析三个工具。
- `health-check`: 对已下载漫画做完整性检查，返回缺失/损坏/不完整等问题列表。
- `orphan-cleanup`: 检测并清理下载目录中残留的孤儿临时目录。
- `storage-analytics`: 统计并可视化下载目录的空间占用分布。

### 修改功能

<!-- 无。本变更不修改现有下载、搜索、收藏等功能的行为。 -->

## 影响

- **前端（新增）**：
  - `src/pages/MaintenancePage.tsx`（新）—— 维护中心主页面。
  - `src/components/maintenance/HealthCheckPanel.tsx`（新）—— 健康检查面板。
  - `src/components/maintenance/OrphanCleanupPanel.tsx`（新）—— 孤儿清理面板。
  - `src/components/maintenance/StorageStatsPanel.tsx`（新）—— 存储分析面板。
  - `src/components/Sidebar.tsx`（改）—— 新增维护中心入口。
- **后端（新增）**：
  - `python/ipc/maintenance_mixin.py`（新）—— IPC 处理入口。
  - `python/maintenance/scanner.py`（新）—— 目录扫描与漫画识别。
  - `python/maintenance/health_checker.py`（新）—— 健康检查核心。
  - `python/maintenance/orphan_cleaner.py`（新）—— 孤儿目录检测与清理。
  - `python/maintenance/storage_analyzer.py`（新）—— 空间统计。
  - `python/ipc_server.py`（改）—— 混入 `MaintenanceMixin`。
- **共享类型**：
  - `shared/types.ts`（改）—— 新增 IPC 方法类型与返回类型。
- **配置**：本期不引入新的持久化配置项，孤儿最小年龄硬编码为 24 小时，后续可视反馈开放配置。
- **测试**：新增后端单元测试（scanner/health_checker/orphan_cleaner/storage_analyzer）与前端组件测试。

## 范围与非范围

**范围内：**
- 只读性质的健康检查与存储分析。
- 仅删除明确为孤儿且非活跃的临时目录。
- 支持 `folder` / `cbz` / `zip` 三种输出格式。
- 支持单本漫画与多章节专辑（folder 格式下的章节子目录）。

**范围外（后续候选）：**
- 自动重新下载缺失/损坏页面（repair mode）。
- 图片压缩/格式转换等优化操作。
- 本地漫画库 browsing（本变更为本地库打基础，但不实现浏览）。
- 跨设备同步或云存储分析。
