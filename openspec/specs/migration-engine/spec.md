# migration-engine 规范

## 目的

定义下载目录迁移在同盘、跨盘、目标冲突、占用判定和用户取消场景下的状态与文件安全行为，保证各操作系统上的结果一致且不会静默覆盖数据。

## 需求

### 需求:同盘迁移文件冲突处理

同盘迁移（源与目标在同一设备）时，当目标文件已存在，系统必须主动检测并抛出 `FileExistsError`，不得依赖底层 `os.rename` 的平台相关异常行为。系统必须在调用 `os.rename` 前显式检查目标路径是否存在，使 macOS、Linux、Windows 三个平台的行为完全一致。

#### 场景:macOS/Linux 上目标已存在时报错且不覆盖

- **当** 在 macOS 或 Linux 上执行同盘迁移，目标文件已存在
- **那么** 系统必须抛出 `FileExistsError`（消息包含"目标文件已存在"），且不得调用 `os.rename` 导致目标被静默覆盖

#### 场景:Windows 上行为保持一致

- **当** 在 Windows 上执行同盘迁移，目标文件已存在
- **那么** 系统必须抛出 `FileExistsError`，行为与修复前一致（Windows 原本依赖 `os.rename` 抛出该异常）

#### 场景:目标不存在时正常迁移

- **当** 同盘迁移，目标路径不存在
- **那么** 系统必须通过 `os.rename` 正常完成迁移，源文件移动到目标位置

### 需求:跨盘迁移文件冲突处理

跨盘迁移（源与目标在不同设备）时，当目标文件已存在，系统必须在复制前主动检测并抛出 `FileExistsError`，不得让 `shutil.copytree` 静默失败或部分写入后崩溃。

#### 场景:跨盘迁移目标已存在时报错

- **当** 跨盘迁移，目标文件已存在
- **那么** 系统必须抛出 `FileExistsError`（消息包含"目标文件已存在"），且源文件必须不被复制操作破坏

### 需求:迁移状态机占用判据

迁移引擎的"占用中"判据必须采用补集式定义：除终态（`none` / `cancelled` / `completed` / `failed`）外的所有状态（含 `ready` / `running` / `paused`）都必须视为占用，禁止被新 plan 覆盖。所有接受新迁移计划的入口（`handle_start_migration`、`trigger_download_dir_migration` 及任何未来新增的 plan 入口）必须共用同一占用判据，禁止各入口各自枚举占用态。

#### 场景:ready 态禁止被新 plan 覆盖

- **当** 引擎当前 state.status == "ready"（已 plan 完毕等待前端确认），任一 plan 入口被调用
- **那么** 入口必须拒绝并抛出"迁移进行中"语义的错误，不得调用 `_init_migration()` 重建引擎、不得覆盖既有 plan

#### 场景:终态可接受新 plan

- **当** 引擎 state 为 None 或 state.status ∈ {"cancelled", "completed", "failed"}
- **那么** plan 入口必须正常接受新 plan，允许 `_init_migration()` 重建引擎

#### 场景:running 与 paused 态继续拒绝

- **当** 引擎 state.status ∈ {"running", "paused"}，任一 plan 入口被调用
- **那么** 入口必须拒绝并抛出"迁移进行中"语义的错误（保持既有行为）

### 需求:取消操作的公共入口

`MigrationEngine` 必须提供公共 `mark_cancelled()` 方法封装"暂停 + 标记 cancelled + 持久化"的取消语义。外部调用方（IPC mixin 等）禁止直接访问引擎的 `_save_state_if_needed` 等私有方法实现取消。

#### 场景:mixin 调用公共方法取消迁移

- **当** `handle_cancel_migration` 被调用
- **那么** 必须通过 `MigrationEngine.mark_cancelled()` 完成"暂停 + status=cancelled + 持久化"，禁止直接读写 `state.status` 或调用 `_save_state_if_needed`

#### 场景:mark_cancelled 无 state 时安全返回

- **当** `mark_cancelled()` 在 state 为 None 时被调用
- **那么** 必须安全返回（no-op），不得抛出 AttributeError
