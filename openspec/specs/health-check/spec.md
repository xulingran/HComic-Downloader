# health-check 规范

## 目的
待定 - 由归档变更 maintenance-center 创建。归档后请更新目的。
## 需求
### 需求:健康检查

系统必须能够扫描 `download_history.db` 中的成功下载记录，验证对应磁盘文件是否完整、可读，并返回结构化问题列表。

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
- **当** 某本漫画的实际图片页数与 `download_history.db` 或 `ComicInfo.xml` 中记录的期望页数不一致
- **那么** 健康检查标记 `incomplete_pages` 或 `unexpected_pages` 问题

#### 场景:检测到图片不可读
- **当** 某张图片文件存在但无法被 `PIL.Image.open()` 成功打开
- **那么** 健康检查标记 `file_not_readable` 问题并指出具体页码

#### 场景:扫描过程中显示进度
- **当** 健康检查扫描记录数超过 10 条
- **那么** 后端发送 `maintenance_progress` 进度通知，前端展示进度条

