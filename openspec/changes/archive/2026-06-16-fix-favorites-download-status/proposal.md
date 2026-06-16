## 为什么

用户从收藏夹中批量选择多本漫画作为专辑下载后，这些漫画在收藏夹页面无法正确显示"已下载"状态（绿色勾选标记）。重新加载收藏夹页面或切换标签后再回来，已下载的漫画仍然显示"未下载"状态，导致用户无法区分哪些漫画已下载。

## 变更内容

修复"批量选择漫画作为专辑下载"后，收藏夹页面无法正确显示已下载状态的 bug。核心问题是：专辑下载时使用 md5 hash 作为 `album_id` 记录到下载历史中，但收藏夹页的下载状态查询使用原始的漫画 `id` 作为 `album_id` 进行匹配，导致查询结果不匹配。

变更将修改 `check_downloaded_batch` 查询逻辑，使其在按 album_id 匹配不到时，回退到按 (source_site, comic_id, comic_source) 直接匹配下载历史记录。

## 功能 (Capabilities)

### 新增功能
- `favorites-download-status-fallback`: 当按 `album_id` 查询下载状态无结果时，使用 `(source_site, comic_id, comic_source)` 三元组进行回退匹配

### 修改功能
- 无（不改变现有规范级行为，仅扩展实现逻辑）

## 影响

### 修改的文件
- `python/download_history.py` — 修改 `check_downloaded_batch` 方法，增加回退查询逻辑
- `python/ipc/download_mixin.py` — 可能需要在 `handle_download_batch_as_album` 中额外记录每条漫画的 `(source_site, comic_id, comic_source)` 到下载历史，确保回退时可匹配

### 不修改
- 不改变 IPC 接口 / 信道定义 / 前后端契约
- 不改变 UI 组件逻辑
- 不改变 AlbumStagingCoordinator / CBZ 打包流程