## 新增需求

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
