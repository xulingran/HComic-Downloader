## 上下文

### 背景
用户可以从收藏夹（Favourites）页面批量选择多本漫画，作为虚拟专辑（album）下载。但下载完成后，收藏夹页面上这些漫画的"已下载"状态（绿色勾选标记）始终显示为"未下载"。

### 根因分析

**问题链路：**

1. **专辑下载时**：`handle_download_batch_as_album` 对所有选中的漫画生成一个 **md5 哈希**作为 `album_id`，并将此 `album_id` 写入下载历史（`download_history` 表）。

2. **收藏夹查询状态时**：`handle_check_downloaded_status` 调用 `check_downloaded_batch`，它以 `(source_site, comic_id, comic_source)` 三元组构建查询，但在 SQL 中**将 `comic_id` 作为 `album_id` 使用**：
   ```sql
   WHERE (source_site, album_id, comic_source) IN (...)
   ```
   传入的 `album_id` = `comic_id`（原始的漫画 ID），但专辑下载的 `album_id` = md5 哈希，**不匹配**。

3. **回退到路径探测**：SQL 无结果后回退到通过 `CBZBuilder.get_output_path_for_format()` 预测路径。但专辑下载的文件位于 `<album_folder>/<chapter_name>/` 下，而回退路径预测的是 `<comic_title>.cbz` 这种单本路径，因此 `os.path.exists()` 返回 `False`，最终返回 `"unknown"`。

4. **前端刷掉临时状态**：`FavouritesPage` 中的 `onDownloadProgress` 监听虽然能在下载完成瞬间标记 `downloaded`，但一到页面刷新或切换标签，`checkDownloadedStatus` 重新调用后端，又回到 `"unknown"`。

### 数据模型现状

`download_history` 表的主键为 `(source_site, comic_id, comic_source)`，此外还有 `album_id` 字段用于专辑关联。目前 `record_download` 写入时 `album_id` = `comic.album_id or comic.id`。

- 单本下载：`album_id = comic.id` → 与收藏夹查询传入的 `album_id` 一致 → **正常命中**
- 批量专辑下载：`album_id = md5_hash` → 与收藏夹传入的 `album_id` 不一致 → **无法命中**

## 目标 / 非目标

**目标：**
- 修复批量专辑下载后收藏夹页面能正确显示已下载状态
- 确保修复兼容已有的下载历史记录（不破坏对现有单本/章节下载的状态显示）

**非目标：**
- 不改变 `download_history` 表结构
- 不改变 IPC 接口 / 信道定义
- 不改变前端 UI 组件（收藏夹页、ComicCard 等）
- 不改变专辑打包流程（AlbumStagingCoordinator / CBZ 打包）
- 不引入新的依赖

## 决策

### 决策 1：在 `check_downloaded_batch` 中增加回退查询而非修改 album_id 生成

**方案选择：**

| 方案 | 描述 | 优缺点 |
|------|------|--------|
| **A (选中)** 双路径查询 | 先用 `(source_site, comic_id, comic_source)` 按 album_id 查询；若无匹配则用同一个三元组按 `(source_site, comic_id, comic_source)` 主键查询 | 最小改动、不破坏已有数据、向后兼容。需要额外的 SQL 查询 |
| B 修改 album_id 生成 | 在 `handle_download_batch_as_album` 中把 `album_id` 设为 `comic.id` 而非 md5 哈希 | 会破坏专辑打包流程（AlbumStagingCoordinator 依赖 album_id 聚合章节），影响范围大 |
| C 双写记录 | 批量专辑下载时，为每条漫画额外写一条 `album_id = comic.id` 的记录 | 冗余存储，历史数据仍需兼容处理 |
| D 存映射表 | 建立 `comic_id → album_id_hash` 的映射关系表或缓存 | 引入新表/新逻辑，过度设计 |

**理由：** 方案 A 改动最小，仅修改 `check_downloaded_batch` 的查询逻辑，无需变更 DB 结构、无需迁就旧数据、不影响打包流程。第一轮按 `(source_site, album_id, comic_source)` 查询仍然是主路径满足单本下载的快速命中，仅在无结果时增加第二轮回退查询。

### 决策 2：回退查询用 `(source_site, comic_id, comic_source)` 主键直接匹配

`download_history` 表的 `PRIMARY KEY (source_site, comic_id, comic_source)` 刚好是收藏夹传入的三元组。用主键查询效率最高，且语义上就是"这本漫画是否已下载过"。

```sql
SELECT source_site, comic_id, comic_source, output_path,
       album_total_chapters, title, author
FROM download_history
WHERE (source_site, comic_id, comic_source) IN ({placeholders})
```

如果回退查询有命中且对应的文件路径存在，则标记为 `"downloaded"`。

### 决策 3：复用相同的路径存在性检查逻辑

回退查询结果的处理方式与主路径一致：统计 `output_path` 存在的记录数，达到 `album_total_chapters` 即为已下载。这确保了即使是专辑中的某一章，只要所有章的文件都在，也算已下载。

## 风险 / 权衡

| 风险 | 缓解措施 |
|------|----------|
| 回退查询增加了一次额外的 DB 查询，影响收藏夹页加载性能（大量漫画时） | 仅在第一轮无结果时才触发回退；单本下载的常见路径不受影响 |
| 同一漫画既作为专辑章节下载又作为独立漫画下载时，主键冲突导致仅保留一条记录 | `INSERT OR REPLACE` 语义确保最后一条记录保留；两种下载方式任一条完成都应算已下载，不影响判定 |
| 专辑章节文件以 `<album_folder>/<chapter_name>/` 存放，回退的路径存在性检查可能不准确 | 回退时计算的是 `CBZBuilder.get_output_path_for_format()` 的结果。对于专辑章节 `ComicInfo`（`is_album_chapter=True`），该函数已经能正确处理专辑目录结构，路径判定是准确的 |
| 批量专辑中不同漫画的 `comic_source` 不同（同一 `source_site` 内混用了不同图源） | 主键 `(source_site, comic_id, comic_source)` 区分了不同图源，不会混淆 |