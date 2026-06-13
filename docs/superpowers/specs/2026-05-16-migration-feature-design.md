# 漫画库迁移功能设计

> 日期：2026-05-16
> 状态：已确认，待实现

## 概述

提供漫画库迁移功能，允许用户将已下载的漫画文件移动到新目录，同时保持数据库记录正确、历史数据完整保留。支持两种模式：完整迁移（自动搬文件+更新DB）和修复模式（用户手动搬文件后修复DB）。

## 方案选择

采用 **Python 主导 + 智能移动策略**（方案 C）：
- 迁移逻辑集中在 Python 端，便于维护和测试
- 同盘移动用 `os.rename()` 瞬间完成
- 跨盘移动用 `shutil.copy2()` + `os.remove()`
- 前端只负责触发、展示进度、交互

## 整体架构

三层结构：

### 1. 迁移引擎（`migration.py`）
- 核心逻辑：扫描、规划、执行、状态持久化
- 不依赖 IPC 层，可独立测试
- 提供 `MigrationEngine` 类，通过回调报告进度

### 2. IPC 桥接（`python/ipc/migration_mixin.py`）
- 将引擎暴露为 IPC 命令
- 管理迁移生命周期：启动、暂停、恢复、取消
- 将进度事件推送到前端

### 3. 前端交互（React 迁移对话框）
- 设置页下载目录旁的"迁移漫画库"按钮
- 迁移对话框：选择模式 → 预览计划 → 执行 → 完成
- 后台模式横幅

### 数据流

```
前端触发 → IPC 命令 → MigrationEngine 生成计划 →
  逐文件移动 + 更新 DB + 写状态文件 →
  进度回调 → IPC 事件 → 前端更新进度条
```

### 文件变更清单

- 新增：`migration.py`、`python/ipc/migration_mixin.py`
- 修改：`python/ipc_server.py`（混入 MigrationMixin）、`python/ipc/types.py`
- 新增前端：迁移对话框组件、相关 hooks
- 修改前端：设置页（加按钮）、`shared/types.ts`
- 修改 Electron：`main.ts`（注册新 IPC handlers）

## 迁移引擎详细设计

### 迁移状态文件

路径：`~/.hcomic_downloader/migration_state.json`

```json
{
  "id": "uuid-string",
  "mode": "full | repair",
  "status": "planning | ready | running | paused | completed | failed",
  "source_dir": "D:\\Downloads\\hcomic",
  "target_dir": "E:\\Comics",
  "started_at": 1715836800,
  "updated_at": 1715836900,
  "total_items": 150,
  "completed_items": 87,
  "failed_items": [
    {"path": "D:\\Downloads\\hcomic\\xxx.cbz", "error": "Permission denied"}
  ],
  "plan": [
    {
      "source": "D:\\Downloads\\hcomic\\author-title.cbz",
      "target": "E:\\Comics\\author-title.cbz",
      "db_key": ["hcomic", "12345", "MMCG_SHORT"],
      "status": "pending | done | failed | skipped"
    }
  ]
}
```

每完成一个文件就更新状态文件，断点续传从 plan 中第一个 `pending` 项继续。

### 完整迁移模式（full）

1. 读取当前 `download_dir` 作为源目录
2. 扫描数据库中所有 `output_path` 以源目录开头的记录
3. 检查每个文件是否存在，过滤掉已不存在的
4. 生成迁移计划（源路径 → 目标路径 + 数据库 key）
5. 检测同盘/跨盘 → 选择移动策略
6. 逐文件执行：移动文件 → 更新数据库 `output_path` → 更新状态文件
7. 全部完成后更新 `config.json` 的 `download_dir`

### 修复模式（repair）

1. 用户指定新的下载目录
2. 扫描数据库中所有记录，收集 `(source_site, comic_id, comic_source, title, author, output_path)`
3. 扫描新目录下的所有 cbz/zip/folder
4. 综合匹配：
   - 第一轮：从文件名中提取 comic_id（如果文件名模板包含 `{id}`），与数据库精确匹配
   - 第二轮：用 title + author 与文件名模糊匹配
   - 第三轮：将无法匹配的文件和数据库记录标记为"待确认"，返回前端让用户手动关联
5. 匹配成功 → 更新数据库 `output_path`
6. 更新 `config.json` 的 `download_dir`

### 同盘 vs 跨盘检测

```python
def _is_same_drive(path1: str, path2: str) -> bool:
    return os.stat(path1).st_dev == os.stat(path2).st_dev
```

- 同盘：`os.rename()` 瞬间完成
- 跨盘：`shutil.copy2()` + 校验 + `os.remove()` 源文件

### 进度回调

```python
@dataclass
class MigrationProgress:
    completed: int
    total: int
    current_file: str
    speed: float  # bytes/sec
    phase: str    # "moving" | "updating_db" | "verifying"
```

### 日志

- 日志文件：`~/.hcomic_downloader/migration.log`
- 格式：`[2024-05-16 14:30:00] [INFO] Moved: author-title.cbz`
- 失败：`[2024-05-16 14:30:05] [ERROR] Failed: author-title.cbz — Permission denied`
- 迁移完成后日志保留供查看
- 新迁移开始时覆盖旧日志

## IPC 协议

### 命令

| 命令 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `start_migration` | `{target_dir, mode}` | `{migration_id, total_items}` | 启动迁移，生成计划 |
| `confirm_migration` | `{migration_id}` | `{started: true}` | 确认计划，开始执行 |
| `pause_migration` | `{}` | `{paused: true}` | 暂停迁移 |
| `resume_migration` | `{}` | `{resumed: true}` | 恢复迁移 |
| `cancel_migration` | `{}` | `{cancelled: true}` | 取消迁移，保留已完成部分 |
| `get_migration_status` | 无 | 完整的 migration_state | 查询状态 |
| `resolve_unmatched` | `{matches: [{db_key, file_path}]}` | `{resolved: count}` | 修复模式手动关联 |

### 通知事件

| 事件 | 数据 | 说明 |
|------|------|------|
| `migration_progress` | `{completed, total, current_file, speed, phase}` | 实时进度 |
| `migration_complete` | `{total, succeeded, failed, elapsed}` | 迁移结束 |
| `migration_error` | `{message, file_path}` | 单文件失败 |
| `migration_unmatched` | `{db_records, files}` | 需手动匹配项 |

### 执行流程

1. 前端调用 `start_migration` → Python 生成计划，返回预览
2. 前端展示预览
3. 用户确认 → 前端调用 `confirm_migration` → Python 开始执行
4. 执行中 Python 推送 `migration_progress`
5. 单文件失败推送 `migration_error`
6. 全部完成推送 `migration_complete`

## 前端 UI

### 入口

设置页 → 下载设置区域 → 下载目录输入框旁"迁移漫画库"按钮

### 迁移对话框三阶段

**阶段一：选择模式**
- 两个选项卡：「完整迁移」和「修复数据库」
- 完整迁移：显示当前目录（只读）+ 选择目标目录
- 修复模式：指定新下载目录
- "下一步"按钮

**阶段二：预览计划**
- 完整迁移：源→目标路径、文件数、总大小、同盘/跨盘提示、文件列表
- 修复模式：自动匹配成功数、未匹配项、手动关联界面
- "开始迁移"和"返回"按钮

**阶段三：执行中**
- 进度条（已完成/总数）+ 百分比
- 当前文件名
- 实时日志（成功绿色、失败红色）
- 暂停/恢复按钮
- 同盘小规模：模态对话框（阻塞式）
- 跨盘大规模：非模态，可最小化到设置页顶部横幅

### 后台模式横幅

设置页顶部显示："正在迁移漫画库 (87/150)" + 进度条 + 暂停/查看详情按钮

### 完成状态

- 绿色勾 + 统计（成功数、失败数、耗时）
- 失败项可展开查看详情 + "重试"按钮

## 错误处理与恢复

### 单文件失败

- 记录到状态文件 `failed_items`（源路径 + 错误信息）
- 不中断整体迁移
- 推送 `migration_error` 通知前端

### 状态机

```
planning → ready → running ⇄ paused
                  ↓
               completed (含部分失败项)
```

- `failed` 状态仅在引擎级别不可恢复错误时出现（如状态文件损坏），此时用户仍可尝试 `resume_migration` 重新加载

### 断点续传

- 每完成一个文件立即写状态文件
- 应用重启后检测未完成的状态文件 → 横幅提示
- 用户点击"恢复迁移" → 从 plan 中第一个 `pending` 项继续

### 并发安全

- 迁移运行时自动暂停下载队列
- 状态文件使用文件锁保护
- 同一时间只允许一个迁移任务
