## 上下文

项目已具备完善的下载、打包、历史记录能力：

- `download_history.py` 用 SQLite 记录每次成功下载的 `(source_site, comic_id, comic_source, output_path, output_format, album_id, album_total_chapters)`。
- `cbz_builder.py` 负责把临时图片目录打包成 CBZ/ZIP，或移动为 folder；内部有 `_collect_image_files()` 可复用。
- `downloader.py` 在下载时使用 `temp_{source}_{id}` 作为临时目录名。
- `image_downloader.py` 已使用 `PIL.Image.open()` 做图片格式检测。
- `download_manager.py` 持有当前活跃任务，可通过 `tasks[task_id].temp_dir` 定位它们正在使用的临时目录。

本变更在此基础上新增一个「维护中心」，解决下载完成后的资产健康、残留清理、空间分析三类问题。

## 目标 / 非目标

**目标：**
- 提供独立的维护中心页面，聚合健康检查、孤儿清理、存储分析。
- 健康检查能发现：文件丢失、图片损坏、CBZ/ZIP 不完整、页数不匹配。
- 孤儿清理能安全删除残留临时目录，不会误删活跃任务目录。
- 存储分析能按来源、格式、作者给出空间分布，并识别孤儿文件。
- 所有操作以只读或安全删除为主，不修改用户已下载的健康文件。

**非目标：**
- 不实现自动修复 / 重新下载损坏页面（repair mode）。
- 不实现图片压缩、格式转换等优化。
- 不实现本地漫画库的浏览/管理（只为其做数据准备）。
- 本期不引入新的持久化配置项。

## 架构

```
┌────────────────────────────────────────────────────────────────┐
│                       维护中心 (Maintenance Center)              │
├────────────────────────────────────────────────────────────────┤
│  前端                                                           │
│  ├── src/pages/MaintenancePage.tsx                              │
│  ├── src/components/maintenance/HealthCheckPanel.tsx            │
│  ├── src/components/maintenance/OrphanCleanupPanel.tsx          │
│  └── src/components/maintenance/StorageStatsPanel.tsx           │
│                          ↓ IPC                                 │
│  后端                                                           │
│  ├── python/ipc/maintenance_mixin.py      # JSON-RPC 入口      │
│  └── python/maintenance/                  # 核心逻辑           │
│       ├── scanner.py                      # 目录遍历识别       │
│       ├── health_checker.py               # 健康检查           │
│       ├── orphan_cleaner.py               # 孤儿清理           │
│       └── storage_analyzer.py             # 空间统计           │
└────────────────────────────────────────────────────────────────┘
```

## 决策

### 决策 1：独立页面而非塞进工具箱

**选择**：新增 `MaintenancePage`，通过侧边栏导航进入，不与工具箱混在一起。

**理由**：
- 工具箱当前聚焦「搜索/标签/重复检测/查缺补漏」，面向发现内容；维护中心面向下载后的资产管理，工作流不同。
- 维护中心需要展示大量列表、统计卡片、操作按钮，独立页面空间更充裕。
- 后续若扩展本地库、修复模式，也能自然容纳。

### 决策 2：后端核心拆分为 scanner + 三个 analyzer

**选择**：新增 `python/maintenance/` 包，底层 `scanner.py` 负责遍历下载目录并识别漫画资产（folder/cbz/zip），上层三个模块分别负责健康检查、孤儿清理、存储分析。

**理由**：
- `scanner.py` 统一处理路径安全校验（复用 `cbz_builder._validate_path_in_dir`）、格式识别、专辑 folder 识别，避免三处重复写文件系统遍历。
- 三个功能可独立测试，也便于后续 repair mode 复用 scanner 的结果。

### 决策 3：健康检查数据源以 `download_history.db` 为主

**选择**：健康检查从 `download_history.db` 拉取已下载记录，反向验证磁盘文件。对磁盘上存在但 DB 中没有记录的文件，只在存储分析里作为「孤儿文件」展示，不在健康检查中处理。

**理由**：
- DB 中的 `output_path` 和 `album_total_chapters` 能给出明确的期望值（页数、专辑总章数），便于检查完整性。
- 反过来遍历磁盘难以判断「是否完整」，因为不知道期望页数。
- 孤儿文件的对账更适合放在「存储分析」或未来的「本地库导入」功能里。

### 决策 4：孤儿目录判定规则

**选择**：候选目录必须同时满足以下条件才视为孤儿：
1. 路径在配置的 `download_dir` 下，且以 `temp_` 开头。
2. 不是当前 `DownloadManager` 中任何活跃任务的 `temp_dir`。
3. 目录最后修改时间距离现在超过 24 小时。
4. 不在 `download_history.db` 任何成功记录的 `output_path` 中（防止误删 folder 格式保存的目录）。

**理由**：
- 活跃任务保护是核心安全措施，避免清理掉正在下载的目录。
- 24 小时缓冲避免刚取消/失败的目录被立即删除，给用户留足排查时间。
- folder 格式保存的目录名可能与 `temp_` 无关，但为保险仍做 output_path 交叉检查。

### 决策 5：存储分析的作者来源

**选择**：优先从 CBZ 内部的 `ComicInfo.xml` 读取 `Writer`；若读取失败或格式为 folder/zip，则回退到文件名模板中的作者部分（通过分隔符解析）。

**理由**：
- `ComicInfo.xml` 是最权威的元数据来源。
- 文件名模板 `{author}-{title}` 在大多数情况下能解析出作者，作为 fallback 够用。
- 完美解析所有历史文件不是本期目标，不准确的作者归入「未知」即可。

### 决策 6：IPC 方法采用同步 + 进度通知模式

**选择**：健康检查和存储分析可能耗时较长，后端在 `request_executor` 中运行，通过 `download_progress` 风格的 JSON-RPC notification 发送进度事件。

**理由**：
- 与现有 `album_progress`、`download_progress` 机制一致，前端易于复用进度条组件。
- 避免阻塞 asyncio 主循环，已有时 `_dispatch_request` 对 sync handler 使用 `loop.run_in_executor`。

## IPC 契约

### `python:run-health-check`

```typescript
params: {
  scope: 'all' | 'selected'
  comicKeys?: Array<[string, string, string]> // [sourceSite, comicId, comicSource]
}
result: {
  scanned: number
  issues: HealthCheckIssue[]
}
```

其中 `HealthCheckIssue`：

```typescript
{
  key: [string, string, string]
  title: string
  outputPath: string
  outputFormat: 'folder' | 'cbz' | 'zip'
  expectedPages: number
  actualPages: number
  checks: Array<{
    kind: 'missing_file' | 'file_not_readable' | 'incomplete_pages'
          | 'unexpected_pages' | 'invalid_archive' | 'missing_comic_info'
    detail: string
    page?: number
  }>
}
```

进度通知：`maintenance_progress`（method），params 含 `phase: 'health_check'`、`current`、`total`。

### `python:scan-orphan-temps`

```typescript
params: Record<string, never>
result: {
  orphans: Array<{
    path: string
    sizeBytes: number
    modifiedAt: number
  }>
  totalSizeBytes: number
}
```

### `python:cleanup-orphan-temps`

```typescript
params: {
  paths?: string[]  // 不传则清理所有检测到的孤儿
}
result: {
  removed: number
  freedBytes: number
  failed: Array<{ path: string; reason: string }>
}
```

### `python:get-storage-stats`

```typescript
params: Record<string, never>
result: {
  totalSizeBytes: number
  totalFiles: number
  bySource: Record<string, number>
  byFormat: Record<'folder' | 'cbz' | 'zip', number>
  byAuthor: Array<{ name: string; sizeBytes: number; itemCount: number }>
  topItems: Array<{
    path: string
    title?: string
    author?: string
    sourceSite?: string
    sizeBytes: number
    pageCount?: number
  }>
  orphanFiles: { count: number; sizeBytes: number }
}
```

## 风险 / 权衡

- **[误删临时目录]** → 通过活跃任务保护 + 24 小时缓冲 + output_path 交叉检查三层防护。**残余风险**：如果 `DownloadManager` 状态因崩溃丢失，极少数非活跃 temp 目录可能被误删；但 24 小时缓冲已覆盖大部分场景。
- **[健康检查耗时过长]** → 扫描大量 CBZ 需要解压和读图。缓解：使用线程池运行；提供进度通知；允许用户中断。
- **[CBZ 内无 ComicInfo.xml]** → folder 格式和早期 zip 格式没有此文件，导致作者/页数统计不准。缓解：在 UI 中标记为「元数据未知」，不阻塞功能。
- **[路径遍历]** → 所有路径操作复用 `cbz_builder._validate_path_in_dir` 或等价校验，确保不会逃逸出 `download_dir`。
- **[并发安全]** → 清理孤儿目录时，如果用户同时开始新的下载，新 temp 目录会被 `DownloadManager.tasks` 保护。活跃任务集合在清理前快照，清理过程中不再次扫描，避免竞态。

## 迁移计划

- **部署**：纯增量变更，新增页面、组件、后端模块与 IPC 方法；不修改现有下载/搜索/收藏行为。
- **数据迁移**：无。健康检查读取现有 `download_history.db`，无需改动表结构。
- **回滚**：移除 `Sidebar` 入口、新增页面/组件、新增 Mixin 与模块即可；若已使用则不影响已有下载文件。

## 开放问题

1. 是否把健康检查扩展到「扫描磁盘上存在但 DB 中没有的漫画」并提供导入？—— 属于本地库范畴，后续考虑。
2. 是否开放「孤儿最小年龄小时数」配置？—— 本期硬编码 24h，后续视用户反馈决定。
3. 健康检查是否需要在启动时自动跑一遍？—— 本期手动触发，后续可考虑可选后台检查。
