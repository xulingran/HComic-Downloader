# 多章节漫画专辑文件夹布局 - 设计文档

**日期**: 2026-06-12
**作者**: Brainstorming 协作输出
**状态**: Draft（待用户审阅）

## 1. 背景与目标

### 1.1 当前实现

项目已支持多章节来源（jmcomic / bika / copymanga），每章作为独立 `DownloadTask` 加入下载队列：

- `python/ipc/download_mixin.py::_download_chapters` 为每个选中章节创建一条 `ComicInfo`，标题为 `"{album_title} - {chap_name}"`，并各自 `add_task`。
- `ComicInfo` 已包含 `album_id`、`album_total_chapters` 字段（见 `models.py`）。
- 输出路径由 `CBZBuilder._generate_folder_name` 决定，模板 `{author}-{title}.cbz`。
- 多章漫画的所有章节在 `download_dir` 下**完全平铺**，例如：
  ```
  download_dir/
    Author-AlbumTitle - 第1話.cbz
    Author-AlbumTitle - 第2話.cbz
    Author-AlbumTitle - 第3話.cbz
  ```

### 1.2 目标

将同一专辑的所有章节集中到一个"专辑文件夹"下，每章以子文件夹区分。在 `output_format = cbz` 时，齐套后整体打包为单个专辑 cbz；在 `output_format = folder` 时保持文件夹布局。

### 1.3 决策摘要

| 决策点 | 选定方案 |
| --- | --- |
| 触发条件 | `comic.album_total_chapters > 1` |
| folder 模式 | 专辑文件夹 / 章节文件夹（两层都是文件夹） |
| cbz 模式 | 下载期间以文件夹/文件夹组织，齐套后整体打包为单个专辑 cbz |
| 打包时机 | 所有章齐了再整体打包 |
| 齐套判定 | 本次任务集完成 **且** 磁盘上章节子文件夹数 ≥ `album_total_chapters` |
| 失败处理 | 保留部分专辑文件夹；UI 提供「强制打包」按钮 |
| 重复下载冲突 | 逐章检查，已有章跳过 |
| 历史记录 | 逐章入库；打包后将这些章记录的 `output_path` 批量更新为专辑 cbz 路径 |
| 临时目录 | 放在专辑文件夹内 |
| ComicInfo.xml | 写入专辑级别的合并 ComicInfo.xml；章节子文件夹不再各自带 |
| 打包后工作目录 | 删除整个专辑工作目录 |
| 专辑名字段 | `ComicInfo` 新增 `album_title` 字段（不剥离 `title` 字符串） |
| 前端聚合 | 仅视图层按 `(sourceSite, albumId)` 分组，IPC 不返回 albumGroups |
| 强制打包冲突 | 后端返回 `status=conflict + existingPath`，前端弹确认后带 `overwrite=true` 重发 |
| 不变范围 | 单本漫画 / 现有 cbz 文件 / `downloader.py` 完全不动 |

## 2. 文件系统布局

### 2.1 output_format = folder（多章专辑）

```
download_dir/
  {author}-{album_title}/                ← 专辑文件夹（用户可见的最终产物）
    第1話/                                ← 章节子文件夹（最终产物）
      00001.jpg ... 00020.jpg
    第2話/
    temp_jmcomic_<chap_id>/              ← 进行中：单章临时目录
```

### 2.2 output_format = cbz（多章专辑）

**下载中：**
```
download_dir/
  {author}-{album_title}/                ← 工作目录（中间态）
    第1話/
    第2話/
    temp_jmcomic_<chap_id>/
```

**齐套打包后：**
```
download_dir/
  {author}-{album_title}.cbz             ← 最终产物
```

cbz 内部结构：
```
ComicInfo.xml                            ← 专辑级合并元数据
第1話/00001.jpg ... 第1話/00020.jpg
第2話/00001.jpg ...
```

### 2.3 单本漫画

`comic.album_total_chapters <= 1` 时**完全保持现有行为**，平铺在 `download_dir`。

## 3. 数据模型变更

### 3.1 `models.ComicInfo`

新增字段 + 派生属性：

```python
@dataclass
class ComicInfo:
    # ... 已有字段 ...
    album_title: str = ""           # 专辑标题（不含 " - 第N話" 后缀）

    @property
    def is_album_chapter(self) -> bool:
        return self.album_total_chapters > 1
```

`album_title` 由 `_download_chapters` 在构造每章 `ComicInfo` 时填入，值来源于 `comic_data.get("title")`（即用户当前看到的专辑详情页标题）。`title` 字段保留现有 `"{album_title} - {chap_name}"` 格式以兼容历史代码与显示逻辑。

### 3.2 `download_history`

无需 schema 变更。打包成功后通过现有写入 API 批量更新这些章节记录的 `output_path` 字段为专辑 cbz 路径。

## 4. 模块/组件划分

### 4.1 `cbz_builder.CBZBuilder`（新增 3 个方法，不动旧的）

```python
def get_album_folder_name(self, comic: ComicInfo) -> str:
    """返回 {author}-{album_title}（已清理非法字符）。"""

def get_album_output_path(
    self, comic: ComicInfo, output_format: str, download_dir: str | None = None
) -> tuple[str, str]:
    """返回 (专辑工作目录路径, 专辑最终路径)。
    - folder: 两者相同
    - cbz: (download_dir/{folder}, download_dir/{folder}.cbz)
    """

def build_album_cbz(
    self, album_dir: str, comic: ComicInfo, output_path: str, overwrite: bool = False
) -> str:
    """将整个专辑文件夹（含若干章节子文件夹）打包为单个 cbz。
    - 写入根目录 ComicInfo.xml（合并的专辑级元数据）
    - arcname 形如 `第1話/00001.jpg`，按章节子文件夹名 + 文件名排序
    - 临时文件 + os.replace 原子提交
    """
```

合并 `ComicInfo.xml` 字段：
- `Title` / `Series` = `comic.album_title`
- `Count` = `album_total_chapters`
- `Notes` = 章节列表（如 `"Chapters: 第1話, 第2話, 第3話"`）
- 其他字段（Writer / Genre / Tags / 时间）沿用 `generate_comic_info_xml` 已有逻辑

### 4.2 `album_coordinator.py`（新文件）

```python
class AlbumStagingCoordinator:
    """以 (source_site, album_id) 为单位的专辑下载状态机。"""

    def __init__(self, cbz_builder, download_dir_provider, output_format_provider,
                 history_db, on_album_event):
        self._tracked: dict[AlbumKey, set[str]] = {}   # album_key -> task_id 集合
        ...

    def register_album_tasks(self, album_key: AlbumKey, task_ids: list[str],
                              album_total_chapters: int) -> None:
        """_download_chapters 调用：注册本次任务集。"""

    def on_chapter_complete(self, task: DownloadTask) -> None:
        """ComicDownloadManager 在章节成功落盘后调用。
        触发 _check_and_pack。"""

    def force_pack_album(self, album_key: AlbumKey, *, overwrite: bool = False) -> PackResult:
        """UI「强制打包」入口；即使磁盘缺章也打包。
        若 overwrite=False 且专辑 cbz 已存在 → 返回 conflict + existingPath。"""

    def get_progress(self, album_key: AlbumKey) -> AlbumProgress:
        """供 IPC handle_get_album_progress 调用。"""

    def _check_and_pack(self, album_key: AlbumKey) -> None:
        """判定：
        1) self._tracked[album_key] 中所有 task 都 COMPLETED
        2) 扫描 album_dir 下章子文件夹数 >= album_total_chapters
        全部满足 → 走 _pack(album_key, overwrite=False)，失败原因记录但不抛
        """

    def _pack(self, album_key, *, overwrite: bool) -> PackResult:
        """实际打包流程（cbz 模式）：
        1) build_album_cbz → 写到 staging 临时路径
        2) os.replace 到最终 .cbz
        3) 删除整个专辑工作目录
        4) 更新 history：批量 UPDATE output_path
        5) 通过 on_album_event 推送 album_progress 通知
        """
```

`AlbumKey = tuple[str, str]`（`(source_site, album_id)`）。

`PackResult` 包含 `status / output_path / packed_chapters / missing_chapters / error_message`，对应 IPC 返回结构。

### 4.3 `download_manager.ComicDownloadManager`（最小侵入修改）

- 持有 `self._album_coordinator: AlbumStagingCoordinator | None`，通过 setter 注入。
- `_handle_download_success` 新增分支：
  ```python
  if task.comic.is_album_chapter:
      self._handle_album_chapter_success(task, result)
  else:
      # 现有单本逻辑（OutputStagingManager.build/commit）保持不变
      ...
  ```
- `_handle_album_chapter_success(task, result)` 新方法：
  1. 计算专辑工作目录 + 该章最终路径（`{album_dir}/{chap_name}/`）
  2. 创建专辑工作目录（若不存在）
  3. `shutil.move(result.temp_dir, chapter_final_path)`（folder commit，与 `save_as_folder` 同理）
  4. 写入 history（章级，`output_path` 暂为章节子文件夹路径）
  5. `self._album_coordinator.on_chapter_complete(task)`
- 单章临时目录路径从 `download_dir/temp_<site>_<id>` 改为 `download_dir/{album_dir}/temp_<site>_<id>`：
  - 修改点在 `downloader.ComicDownloader._build_temp_dir_name` **不动**；改在调用 `download_comic_resume` 时传入的 `output_dir` 参数。`ComicDownloadManager._execute_download` 在 `is_album_chapter` 时将 `output_dir` 替换为专辑工作目录路径。

### 4.4 `python/ipc/download_mixin.py`

修改与新增：

- `_download_chapters`：
  - 创建每章 `ComicInfo` 时填入 `album_title=album_title`
  - 完成 `add_task` 后调用 `self._album_coordinator.register_album_tasks(album_key, task_ids, total)`
  - 返回结构追加 `albumKey: { sourceSite, albumId }`
- 新增 `handle_force_pack_album(sourceSite, albumId, overwrite=False)`
- 新增 `handle_get_album_progress(sourceSite, albumId)`
- 修改 `handle_check_download_conflict`：检测 `comicData.albumTotalChapters > 1` 时，对照专辑工作目录下的章节子文件夹存在性，而非 download_dir 根。
- 在初始化时构造并注入 `AlbumStagingCoordinator`，并实现 `_on_album_event` 把 `album_progress` 作为 JSON-RPC 通知推送到 stdout。

### 4.5 前端

- **DownloadsPage**：本地按 `(sourceSite, albumId)` 分组（仅多章专辑）。专辑卡显示：
  - 标题 = `album_title`，进度 = 章节进度聚合（已完成章数 / `album_total_chapters`）
  - 子行列出每章 + 状态 + 单章操作按钮
  - 新增「强制打包」按钮：`chaptersOnDisk >= 1 && !isComplete && output_format === "cbz"` 时可见
- **章节选择对话框**：提交后弹聚合 toast（已加入下载：xxx 共 N 章）
- **ConflictDialog**：根据 `albumTotalChapters > 1` 切换文案
- **新增 IPC 客户端**：`forcePackAlbum`、`getAlbumProgress`
- 监听新 `album_progress` 通知，刷新对应专辑卡状态

## 5. IPC 接口契约

### 5.1 新增方法

```ts
// 强制打包
handle_force_pack_album({ sourceSite, albumId, overwrite? }) -> {
  status: "packed" | "no_chapters" | "conflict" | "error",
  outputPath?: string,
  packedChapters?: number,
  missingChapters?: number,
  existingPath?: string,         // status="conflict" 时存在
  errorMessage?: string,
}

// 专辑进度查询
handle_get_album_progress({ sourceSite, albumId }) -> {
  albumId, albumTitle, albumFolderPath,
  packedPath: string | null,
  totalChapters: number,
  chaptersOnDisk: number,
  chaptersInQueue: number,
  isComplete: boolean,
}
```

### 5.2 调整的方法

```ts
_download_chapters → {
  taskIds, failedChapters,
  albumKey?: { sourceSite, albumId },   // 新增
  status,
}

handle_check_download_conflict: 多章场景下按"专辑工作目录/章节名"路径判定
```

### 5.3 新增通知

```ts
{
  jsonrpc: "2.0",
  method: "album_progress",
  params: {
    sourceSite, albumId,
    event: "chapter_done" | "packed" | "force_pack_started" | "force_pack_done",
    outputPath?, chaptersOnDisk?, totalChapters?,
  }
}
```

## 6. 不变范围

- 单本漫画（hcomic / moeimg / 单章 jmcomic 等）行为完全不变
- `downloader.ComicDownloader` 不修改
- `ImageDownloader`、`UrlValidator`、`image_formats` 不动
- `OutputStagingManager` 仅用于单本路径，不修改其方法语义
- 历史 cbz 文件不会被新逻辑迁移/触碰

## 7. 边界与失败行为

| 场景 | 行为 |
| --- | --- |
| 多章下载中某章 FAILED | 保留专辑工作目录与已完成章；不打包；UI 显示「强制打包」按钮 |
| 用户点强制打包，缺章 | 打包磁盘上已有的章；history 仅更新这些章记录 |
| 强制打包时专辑 cbz 已存在 | 返回 `status="conflict" + existingPath`；前端弹确认带 `overwrite=true` 重发 |
| 用户重复下载已有章 | `handle_check_download_conflict` 报告冲突；用户决定跳过/覆盖（章级） |
| 打包失败（IO 异常） | 工作目录保留；推送 `force_pack_done` event + errorMessage |
| 应用重启 | `AlbumStagingCoordinator._tracked` 内存状态丢失；下次再有章完成时不会自动触发齐套打包，需用户手动「强制打包」。属可接受的有意行为。 |

## 8. 测试覆盖

最少 7 组：

1. `CBZBuilder.build_album_cbz`：arcname 含章节前缀、ComicInfo.xml 在根、章节顺序正确
2. `CBZBuilder.get_album_folder_name` / `get_album_output_path`：folder + cbz 双模式
3. `AlbumStagingCoordinator` 状态机：未齐套不打包；齐套触发打包；强制打包；过期清理
4. `_download_chapters`：写入 `album_title`，注册到 coordinator，返回 `albumKey`
5. `ComicDownloadManager._handle_album_chapter_success`：staged 到正确路径，触发 coordinator
6. `handle_force_pack_album`：packed / no_chapters / conflict 三路径
7. `handle_check_download_conflict`：多章场景下按章子文件夹判定
8. 集成测试：下载 3 章 jmcomic 专辑（folder + cbz 两种 output_format）端到端

## 9. 实施顺序建议（供后续 plan 参考）

1. 模型：`ComicInfo.album_title` + `is_album_chapter`
2. `CBZBuilder` 新增 3 个方法
3. `AlbumStagingCoordinator` 独立组件 + 单元测试
4. `ComicDownloadManager._handle_album_chapter_success` 分支
5. IPC 层：新增 handler、调整 `_download_chapters` 与冲突检测
6. 前端：聚合视图 + 强制打包按钮 + 通知监听
7. 集成测试
