## 为什么

用户在设置页直接改「下载目录」时，系统只调用 `set_output_dir` 更新运行时输出目录，**完全不联动数据库**——旧下载记录的 `output_path` 仍指向旧目录。若用户随后把文件手动移到新目录（或在配置中把目录改为父子关系），健康检查会全部误报 `missing_file`，存储分析会把这些资产误判为孤儿/未跟踪。实际案例中，仅因一次目录从 `E:\新建文件夹` 改为 `E:\新建文件夹\hcomic`，就产生了 68 条脏数据。

应用虽已有专门的「迁移」功能（设置页 → 迁移，走 `migration_engine.plan_full_migration`），但「改下载目录」这条更常用的路径没有与之联动，是设计缺口。本次让配置变更复用既有迁移能力，使改目录成为一次原子操作：文件移动 + 数据库更新 + 配置落库三步合一。

## 变更内容

- **配置变更联动迁移**：`config_mixin` 检测到 `downloadDir` 变更且新旧目录不同时，自动触发 `migration_engine` 的 full migration（移动旧目录下被记录的文件到新目录，逐条 `update_output_path`），完成后再落库新 `download_dir`。
- **前端确认对话框**：改目录前若检测到旧目录有可迁移记录，弹窗告知"将自动迁移 N 个文件并更新历史记录"，用户确认后执行；取消则不改动目录。
- **迁移进度复用**：复用现有 `migration_progress` 通知通道与前端进度 UI，不新增通道。
- **幂等与安全**：迁移失败时回滚配置（保持旧 `download_dir`），已移动的文件不回退（与现有迁移语义一致，失败项记入 `failed_items`）；新目录与旧目录相同或旧目录无记录时跳过迁移。
- **不影响纯增量场景**：首次设置下载目录（旧值为空或默认）时不触发迁移。

## 功能 (Capabilities)

### 新增功能
- `download-dir-change-migration`: 在设置页变更「下载目录」时，自动将旧目录下的已记录文件迁移到新目录并同步更新 `download_history.output_path`，使下载目录变更成为包含数据迁移的原子操作。

### 修改功能
<!-- 无：本次不修改既有 capability 的规范级行为，迁移引擎本身（migration-engine）的冲突处理需求不变。 -->

## 影响

- **Python 后端**：
  - `python/ipc/config_mixin.py`：`downloadDir` applier 改为在落库前检测并触发迁移；新增迁移编排方法。
  - `python/ipc/migration_mixin.py`：可能暴露同步执行迁移的内部方法（复用 `_run_migration` 逻辑，避免重复线程编排）。
  - `migration.py`：`MigrationEngine` 无需改动（`plan_full_migration` + `_move_item` 已满足需求）。
- **Electron 主进程**：`electron/main.ts` 的 `setConfig` handler 可能需返回迁移是否触发/迁移 ID，供前端展示进度。
- **前端**：
  - `shared/types.ts`：`setConfig` 返回类型扩展（可选 `migrationTriggered` / `migrationId`）。
  - 设置页下载目录变更交互：新增确认对话框 + 迁移进度展示（复用既有迁移 UI 组件）。
- **测试**：
  - `tests/test_config_mixin*.py`：新增"改目录触发迁移""空旧目录跳过迁移""迁移失败回滚配置"等用例。
  - 前端设置页测试：确认对话框与进度展示交互。
- **破坏性**：`setConfig` 返回结构扩展（新增可选字段），前端向后兼容；旧前端不读新字段不受影响。
- **依赖**：复用 `migration-engine` 既有能力，无新依赖。
