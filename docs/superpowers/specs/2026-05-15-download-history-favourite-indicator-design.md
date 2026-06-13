# 下载历史数据库与收藏夹已下载标记

## 概述

为 hcomic_downloader 添加持久化下载历史数据库（SQLite），在收藏夹页面为已下载的漫画显示视觉标记（绿色勾号角标），帮助用户快速识别哪些收藏漫画尚未下载。

## 需求

1. 每次下载成功后自动将漫画信息写入 SQLite 数据库
2. 加载收藏夹时，批量查询下载状态（数据库记录 + 文件存在性检查）
3. 仅在收藏夹页面的 ComicCard 上显示"已下载"标记
4. 标记样式：封面右上角绿色圆形底 + 白色勾号角标

## 架构

### 数据库

**存储位置**：`~/.hcomic_downloader/download_history.db`

**表结构 `download_history`**：

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `source_site` | TEXT | PRIMARY KEY | 来源站点（hcomic/moeimg） |
| `comic_id` | TEXT | PRIMARY KEY | 漫画 ID |
| `comic_source` | TEXT | PRIMARY KEY | 图源（MMCG_SHORT/MMCG_LONG/NH） |
| `title` | TEXT | | 标题 |
| `author` | TEXT | | 作者 |
| `output_path` | TEXT | | 下载时的输出路径 |
| `output_format` | TEXT | | 下载时的格式（folder/zip/cbz） |
| `downloaded_at` | INTEGER | | 下载完成时间戳（Unix epoch） |

主键 `(source_site, comic_id, comic_source)` 与 `ComicInfo.__hash__` 逻辑一致。

### 后端模块

**新增文件 `download_history.py`**：

`DownloadHistoryDB` 类，负责所有数据库操作：

- `__init__(db_path: str)` — 连接数据库，创建表（如不存在）
- `record_download(comic: ComicInfo, output_path: str, output_format: str)` — INSERT OR REPLACE 一条下载记录
- `check_downloaded_batch(comic_keys: list[tuple], output_dir: str, output_format: str, filename_template: str, cbz_builder: CBZBuilder) -> dict[tuple, str]` — 批量查询下载状态
  - 输入：一组 `(source_site, comic_id, comic_source)` 元组 + 当前的下载配置
  - 输出：每个 key 的状态字符串
    - `"downloaded"` — 数据库有记录，且 output_path 文件/目录存在
    - `"missing"` — 数据库有记录，但 output_path 文件/目录不存在；回退检查当前配置下的预期输出路径
    - `"unknown"` — 数据库无记录，检查当前配置下的预期输出路径也不存在
  - 对于 `"missing"` 和 `"unknown"` 的漫画，额外根据当前配置（output_dir、output_format、filename_template）计算预期输出路径，检查文件是否实际存在（覆盖用户手动放入文件、更改输出目录后重新下载等场景）
- `close()` — 关闭数据库连接

### 集成到现有后端

**`IPCServer.__init__`**：
- 创建 `DownloadHistoryDB` 实例，传入 `~/.hcomic_downloader/download_history.db`

**`ComicDownloadManager._handle_download_success`**：
- 在文件提交成功后，调用 `DownloadHistoryDB.record_download` 写入记录
- 通过回调或新增回调参数将 record_download 传递给 ComicDownloadManager

**新增 IPC 方法 `check_downloaded_status`**：
- 参数：`{ comics: list[ComicInfo dict] }`
- 返回：`{ status_map: { [task_id: string]: "downloaded" | "unknown" } }`
- task_id 格式与现有 `DownloadTask.task_id` 一致：`{source_site}_{comic_source}_{comic_id}`
- 逻辑：
  1. 对每个 comic 构造 key
  2. 调用 `DownloadHistoryDB.check_downloaded_batch`
  3. 将 `"missing"` 简化为 `"unknown"` 返回（前端只需区分两种状态）

### 前端变更

**`shared/types.ts`**：
- `IPCMethods` 新增 `check_downloaded_status` 方法签名
- `HcomicAPI` 新增 `checkDownloadedStatus(comics: ComicInfo[])` 方法
- `IPC_CHANNELS` 和 `PYTHON_IPC_CHANNEL_MAP` 新增映射

**`src/hooks/useIpc.ts`**：
- `useFavourites` hook 新增 `checkDownloadedStatus` 方法

**`src/components/common/ComicCard.tsx`**：
- 新增可选 prop `downloadStatus?: "downloaded" | "unknown"`
- 当 `downloadStatus === "downloaded"` 时，在封面区域右上角显示标记：
  - CoverCard 模式：22px 绿色圆形底 + 13px 白色勾号 SVG
  - DetailedCard 模式：16px 绿色圆形底 + 9px 白色勾号 SVG，在缩略图右上角
- 标记不影响现有的 hover 下载按钮（z-index 低于下载按钮）

**`src/pages/FavouritesPage.tsx`**：
- 新增 state `downloadedStatus: Record<string, "downloaded" | "unknown">`
- `loadFavourites` 成功后异步调用 `checkDownloadedStatus`
- 加载状态映射期间不阻塞列表渲染（标记延迟出现）
- 传递 `downloadStatus` 给每个 `ComicCard`

### 视觉设计

**CoverCard 已下载标记**：
- 位置：封面区域右上角（top: 6px, right: 6px）
- 样式：22×22px 圆形，`background: rgba(34, 197, 94, 0.9)`，白色勾号 SVG
- z-index: 5，不影响 hover 下载按钮

**DetailedCard 已下载标记**：
- 位置：缩略图右上角（top: 2px, right: 2px）
- 样式：16×16px 圆形，同色，缩小的勾号 SVG

### 不在本次范围内

- `rescan_download_dir` 方法（扫描已有下载目录补充数据库记录）— 后续迭代
- 搜索结果页的已下载标记 — 后续迭代
- 手动标记/取消标记功能 — 后续迭代

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `download_history.py` | 新增 | SQLite 数据库操作类 |
| `python/ipc_server.py` | 修改 | 集成 DownloadHistoryDB，新增 handler，下载成功时写库 |
| `download_manager.py` | 修改 | `_handle_download_success` 中调用写库回调 |
| `shared/types.ts` | 修改 | 新增 IPC 类型和通道映射 |
| `electron/preload.ts` | 修改 | 新增 `checkDownloadedStatus` API 暴露 |
| `electron/main.ts` | 修改 | 新增 IPC channel 转发 |
| `electron/python-bridge.ts` | 修改 | 新增方法路由 |
| `src/hooks/useIpc.ts` | 修改 | 新增 `checkDownloadedStatus` hook |
| `src/components/common/ComicCard.tsx` | 修改 | 新增 `downloadStatus` prop 和已下载标记渲染 |
| `src/pages/FavouritesPage.tsx` | 修改 | 加载下载状态，传递给 ComicCard |
