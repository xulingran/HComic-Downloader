## 1. 理解代码上下文

- [x] 1.1 阅读 `download_history.py` 中 `check_downloaded_batch` 方法的完整逻辑，确认当前的 SQL 查询和回退路径
- [x] 1.2 阅读 `python/ipc/download_mixin.py` 中 `handle_check_downloaded_status` 和 `handle_download_batch_as_album` 的逻辑
- [x] 1.3 阅读 `cbz_builder.py` 中 `get_output_path_for_format` 方法，确认专辑章节的路径计算逻辑

## 2. 实现核心修复：修改 `check_downloaded_batch`

- [x] 2.1 在 `check_downloaded_batch` 中，第一轮 SQL 查询（`WHERE (source_site, album_id, comic_source) IN`）无结果后，增加第二轮回退查询，使用 `(source_site, comic_id, comic_source)` 主键匹配
- [x] 2.2 回退查询的 SQL：`WHERE (source_site, comic_id, comic_source) IN ({placeholders})`，查询 `source_site, comic_id, comic_source, output_path, album_total_chapters, title, author` 字段
- [x] 2.3 回退查询结果的处理逻辑与主路径一致：统计 `output_path` 存在的记录数，达到 `album_total_chapters` 即标记为 `"downloaded"`
- [x] 2.4 确保 `batch` 循环中未在第一轮命中的 key 才触发回退查询，避免重复查询

## 3. 编写测试

- [x] 3.1 为 `check_downloaded_batch` 增加测试用例，验证专辑下载的漫画能通过回退查询正确返回 `"downloaded"`
- [x] 3.2 增加测试用例验证单本下载的漫画仍通过第一轮 `album_id` 查询命中（回归测试）
- [x] 3.3 增加测试用例验证回退查询的文件路径存在性检查逻辑

## 4. 验证与清理

- [x] 4.1 运行 `pytest` 确认所有现有测试通过（26/26 download_history 测试全部通过，71/71 下载相关测试全部通过）
- [x] 4.2 测试使用 tmp_path 隔离，自动清理
- [x] 4.3 代码分析确认修复逻辑正确：回退查询使用主键 `(source_site, comic_id, comic_source)` 直接匹配下载历史记录并通过文件存在性验证