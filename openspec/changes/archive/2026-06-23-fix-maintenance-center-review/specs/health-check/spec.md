## 修改需求

### 需求:健康检查

系统必须能够扫描 `download_history.db` 中的成功下载记录，验证对应磁盘文件是否完整、可读，并返回结构化问题列表。期望页数必须来自持久化的 `download_history.pages` 列（下载成功时写入），`ComicInfo.xml` 的 `PageCount` 仅在 `pages` 为 0 时作为回退来源；页数统计逻辑禁止在健康检查器与扫描器中重复实现，必须复用 `scanner._count_folder_pages`。健康检查必须真正流式下发进度，进度回调发出的通知禁止滞留 stdout 缓冲区。

#### 场景:扫描全部历史记录
- **当** 用户进入维护中心并点击「开始体检」
- **那么** 系统遍历 `download_history.db` 中所有记录，逐条检查文件存在性、CBZ/ZIP 完整性、图片可读性和页数一致性，最后返回问题列表

#### 场景:检测到文件丢失
- **当** 某条历史记录的 `outputPath` 在磁盘上不存在
- **那么** 健康检查在结果中标记 `missing_file` 问题

#### 场景:检测到压缩包损坏
- **当** 某本 CBZ 或 ZIP 无法通过 `zipfile.testzip()` 校验
- **那么** 健康检查在结果中标记 `invalid_archive` 问题

#### 场景:检测到页数不匹配
- **当** 某本漫画的 `download_history.pages` 列记录的期望页数大于 0，且实际图片页数与之不一致
- **那么** 健康检查标记 `incomplete_pages`（实际 < 期望）或 `unexpected_pages`（实际 > 期望）问题

#### 场景:历史 pages 列为 0 时回退 ComicInfo.xml
- **当** 某条记录的 `pages` 列为 0（旧数据未持久化页数）且资产为含 `ComicInfo.xml` 的 CBZ
- **那么** 健康检查从 `ComicInfo.xml` 的 `PageCount` 读取期望页数；若 `PageCount` 也缺失或为 0，则跳过该条的页数对账（不误报）

#### 场景:检测到图片不可读
- **当** 某张图片文件存在但无法通过 `PIL.Image.verify()` 头部校验
- **那么** 健康检查标记 `file_not_readable` 问题并指出具体页码

#### 场景:扫描过程中显示进度
- **当** 健康检查正在扫描且尚未完成
- **那么** 后端每次进度回调必须立即 `sys.stdout.flush()`，使 `maintenance_progress` 通知实时到达前端，进度条禁止全程静止

#### 场景:逐页全解码为可选行为
- **当** 默认运行健康检查
- **那么** 系统使用 `Image.verify()` 头部校验（不解码像素）；仅当环境变量 `HCOMIC_HEALTH_FULL_DECODE=1` 时启用逐页 `Image.load()` 全解码

#### 场景:期望页数对账必须对真实数据库 schema 生效
- **当** 健康检查针对真实 `DownloadHistoryDB`（而非 mock 字典）执行
- **那么** `get_all_records_with_album` 返回的记录必须包含非空 `pages` 键，且 `record_download` 必须持久化实际下载页数到该列
