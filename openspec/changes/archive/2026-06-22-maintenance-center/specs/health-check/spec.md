# Health Check Specification

## 新增需求

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

## 目标

对 `download_history.db` 中记录的成功下载进行完整性检查，帮助用户发现「文件丢失、图片损坏、CBZ 不完整、页数不匹配」等问题。

## 输入

```typescript
{
  scope: 'all' | 'selected'
  comicKeys?: Array<[string, string, string]> // [sourceSite, comicId, comicSource]
}
```

- `scope='all'`：扫描 `download_history.db` 中所有记录。
- `scope='selected'`：只扫描传入的 comicKeys。

## 输出

```typescript
{
  scanned: number           // 实际扫描的记录数
  issues: HealthCheckIssue[]
}
```

### HealthCheckIssue

```typescript
{
  key: [string, string, string]      // [sourceSite, comicId, comicSource]
  title: string
  outputPath: string
  outputFormat: 'folder' | 'cbz' | 'zip'
  expectedPages: number
  actualPages: number
  checks: Array<{
    kind: 'missing_file'
          | 'file_not_readable'
          | 'incomplete_pages'
          | 'unexpected_pages'
          | 'invalid_archive'
          | 'missing_comic_info'
    detail: string
    page?: number       // file_not_readable 时指出具体页码
  }>
}
```

## 检查规则

### 1. missing_file

**触发条件**：`outputPath` 指向的文件或目录不存在。

**detail 示例**：`输出路径不存在: /Users/xxx/Downloads/hcomic/author-title.cbz`

### 2. invalid_archive

**触发条件**：`outputFormat` 为 `cbz` 或 `zip`，但 `zipfile.testzip()` 返回错误，或无法打开 zip。

**detail 示例**：`CBZ 压缩包损坏: Bad CRC-32 for file '00001.jpg'`

### 3. missing_comic_info

**触发条件**：`outputFormat` 为 `cbz`，但包内不存在 `ComicInfo.xml`。

**detail 示例**：`缺少 ComicInfo.xml 元数据文件`

### 4. incomplete_pages / unexpected_pages

**触发条件**：实际页数 ≠ `expectedPages`。

- `expectedPages` 来源优先级：
  1. `download_history` 记录的 `album_total_chapters` 聚合（对专辑 folder）。
  2. `download_history` 记录的 `pages` 字段（单本）。
  3. CBZ 内 `ComicInfo.xml` 的 `PageCount`。
  4. 若都不可得，则跳过此项检查。

- 实际页数计算：
  - `folder`：递归统计目录下所有符合 `SUPPORTED_IMAGE_EXTENSIONS` 的图片文件。
  - `cbz`/`zip`：统计压缩包内符合图片扩展名的条目。
  - 专辑 folder：统计所有章节子文件夹中的图片总和。

**detail 示例**：`期望 24 页，实际 22 页，缺失页: 23, 24`

### 5. file_not_readable

**触发条件**：某张图片文件存在但无法被 `PIL.Image.open()` 成功打开。

**detail 示例**：`第 5 页图片无法打开: /.../00005.jpg`

## 进度通知

后端在扫描过程中发送 JSON-RPC notification：

```json
{
  "jsonrpc": "2.0",
  "method": "maintenance_progress",
  "params": {
    "phase": "health_check",
    "current": 12,
    "total": 120,
    "label": "正在检查: author-title.cbz"
  }
}
```

## 安全约束

- 所有路径必须位于配置的 `download_dir` 内，使用 `cbz_builder._validate_path_in_dir` 校验。
- 不修改任何文件，只读检查。
- 对 CBZ 使用 `zipfile.ZipFile` 只读模式打开。

## 错误处理

- 单条记录检查失败不应中断整个扫描，应记录为 `checks` 中的一项。
- 若 `download_dir` 无效或不可读，返回清晰的错误消息。
- 进度通知中的 `label` 禁止包含冒号，避免解析歧义（或做转义）。

## 前端行为

- 提供「开始体检」按钮，点击后调用 `python:run-health-check`。
- 展示进度条（基于 `maintenance_progress` 通知）。
- 结果按问题级别分组：error（missing_file / invalid_archive / file_not_readable）> warning（incomplete_pages / missing_comic_info）> info（unexpected_pages）。
- 每条 issue 提供「打开所在文件夹」入口。
- 对 `incomplete_pages` 类型，二期可扩展「修复」按钮（重新下载缺失页）。

## 测试要点

1. 正常 CBZ 返回无 issue。
2. 删除 outputPath 触发 `missing_file`。
3. 截断 CBZ 文件触发 `invalid_archive`。
4. 删除 CBZ 中某张图片触发 `incomplete_pages`。
5. 把某张图片替换为 0 字节文件触发 `file_not_readable`。
6. folder 格式下删除章节子目录中的图片正确计算实际页数。
7. 扫描范围 `selected` 只检查指定 key。
