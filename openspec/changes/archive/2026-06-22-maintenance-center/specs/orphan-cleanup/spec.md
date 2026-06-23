# Orphan Temp Directory Cleanup Specification

## 新增需求

### 需求:孤儿临时目录清理

系统必须能够识别下载目录中残留的 `temp_*` 目录，同时排除活跃任务目录、近期目录以及已被历史记录引用的目录，并允许用户安全删除这些孤儿目录。

#### 场景:扫描发现孤儿目录
- **当** 用户点击「扫描孤儿目录」
- **那么** 系统返回所有满足判定规则的临时目录列表，包含路径、大小和最后修改时间

#### 场景:保护活跃任务目录
- **当** 某个 `temp_*` 目录正被当前 `DownloadManager` 中的任务使用
- **那么** 扫描结果不将其列为孤儿

#### 场景:保护近期临时目录
- **当** 某个 `temp_*` 目录的最后修改时间距离现在不足 24 小时
- **那么** 扫描结果不将其列为孤儿

#### 场景:清理选中的孤儿目录
- **当** 用户选中若干孤儿目录并点击「清理选中」
- **那么** 系统删除这些目录，返回成功删除数量与释放字节数

#### 场景:清理时目录被占用
- **当** 某个孤儿目录因文件被占用而无法删除
- **那么** 系统将该目录加入 `failed` 列表并继续清理其他目录

#### 场景:重新校验后再删除
- **当** 用户调用清理接口
- **那么** 系统在删除前重新校验每个路径是否仍满足孤儿判定规则，防止误删

## 目标

扫描并清理下载目录中因崩溃、取消或异常退出而残留的 `temp_*` 临时目录，释放磁盘空间，同时避免误删正在使用的临时目录。

## 孤儿判定规则

一个目录被视为候选孤儿，当且仅当同时满足：

1. **路径规则**：位于配置的 `download_dir` 下，且目录名以 `temp_` 开头。
2. **活跃任务保护**：不是当前 `DownloadManager` 中任何任务的 `temp_dir`。
3. **年龄规则**：目录最后修改时间距离现在超过 24 小时。
4. **历史记录保护**：目录路径未出现在 `download_history.db` 任何成功记录的 `output_path` 中（防止 folder 格式输出被误识别）。

## IPC 契约

### `python:scan-orphan-temps`

**参数**：无

**返回**：

```typescript
{
  orphans: Array<{
    path: string
    sizeBytes: number
    modifiedAt: number  // Unix 秒时间戳
  }>
  totalSizeBytes: number
}
```

### `python:cleanup-orphan-temps`

**参数**：

```typescript
{
  paths?: string[]  // 要清理的目录路径列表；不传则清理 scan 到的所有孤儿
}
```

**返回**：

```typescript
{
  removed: number
  freedBytes: number
  failed: Array<{
    path: string
    reason: string
  }>
}
```

## 目录大小计算

- 递归计算目录下所有文件大小之和。
- 不跟随符号链接，避免循环或逃逸。
- 使用 `os.path.getsize()` 或 `os.stat().st_size`。

## 清理实现细节

1. 在 `cleanup` 调用时重新校验每个待删除路径是否仍满足孤儿判定规则（活跃任务保护、年龄、output_path）。
2. 使用 `shutil.rmtree(path, ignore_errors=False)` 删除，失败时捕获异常并记录到 `failed`。
3. 删除成功后累加 `removed` 与 `freedBytes`。
4. 对 Windows 上文件被占用导致的删除失败，返回友好错误：`文件被占用，请关闭相关程序后重试`。

## 安全约束

- 所有路径必须位于 `download_dir` 内，使用 `cbz_builder._validate_path_in_dir` 校验。
- 不允许删除 `download_dir` 本身。
- 不允许删除不以 `temp_` 开头的目录。
- 清理前必须重新获取活跃任务快照，避免与正在运行的下载冲突。
- 年龄阈值本期硬编码为 24 小时，避免误删刚取消的任务目录。

## 前端行为

- 提供「扫描孤儿目录」按钮，调用 `python:scan-orphan-temps`。
- 列表展示每个孤儿目录的路径、大小、最后修改时间。
- 提供全选/取消全选，以及按大小排序。
- 点击「清理选中」后弹出确认对话框，显示预计释放空间。
- 清理完成后刷新列表，并显示实际释放空间。
- 若清理失败，展示失败项及原因。

## 测试要点

1. 正常 `temp_` 目录超过 24 小时且无活跃任务保护，会被识别为孤儿。
2. 活跃任务正在使用的 `temp_dir` 不会被识别为孤儿。
3. 修改时间小于 24 小时的 `temp_` 目录不会被识别为孤儿。
4. folder 格式保存的目录若出现在 `download_history.output_path` 中，即使以 `temp_` 开头也不会被清理。
5. 删除失败时返回 `failed` 列表，不抛出整体异常。
6. 跨平台路径校验正确（Windows / macOS / Linux）。
