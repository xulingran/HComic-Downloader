## 1. 固定 Python 回归行为

- [x] 1.1 在 `tests/test_migration.py` 增加修复模式测试：旧 `output_path` 缺失、目标文件存在时，执行后数据库路径更新成功且目标文件字节与位置不变
- [x] 1.2 增加 `source == target` 的幂等修复测试，验证不产生“目标文件已存在”失败并正确累计完成数
- [x] 1.3 增加目标文件在 plan 后消失及数据库更新异常的测试，验证条目标记失败、错误可观测且不发生文件写操作
- [x] 1.4 保留并补强 full migration 回归测试，验证同盘/跨盘移动和目标冲突保护不受模式分派影响

## 2. 实现数据库专用修复路径

- [x] 2.1 在 `MigrationEngine` 中增加 repair 条目处理方法：执行时复核目标存在并仅调用 `update_output_path`
- [x] 2.2 调整 `execute()` 按 `state.mode` 分派 full 文件移动与 repair 数据库更新，同时复用现有进度、失败收集和状态持久化逻辑
- [x] 2.3 运行 `pytest tests/test_migration.py tests/test_migration_engine_cancel.py`，确认修复场景和既有迁移引擎场景全部通过

## 3. 闭合 ready 计划生命周期

- [x] 3.1 在 `tests/test_migration_mixin.py` 增加 `ready -> cancel -> 新计划` 的行为测试，确认取消后不再误报迁移占用且 running/paused 仍拒绝覆盖
- [x] 3.2 完善迁移状态响应及 `shared/types.ts` 类型，使 `ready` 状态携带恢复预览所需的 migration ID、模式、目录、数量和同盘信息
- [x] 3.3 调整 `useMigration.syncFromBackend()`，同步并返回 `ready`、`running`、`paused`、`completed` 与终态，不把遗留计划静默当成空闲
- [x] 3.4 调整 `MigrationDialog`：打开时恢复 `ready` 预览；预览“返回”或关闭时先取消后端计划，取消失败则保留预览并显示错误；执行中“后台运行”行为保持不变
- [x] 3.5 增加 hook 与对话框前端测试，覆盖 ready 恢复、返回/关闭释放计划、取消失败保留界面以及执行中后台运行
- [x] 3.6 增加终态引擎替换测试并调整 `_init_migration()`：替换前关闭旧引擎日志 handler，且只在首次初始化时创建迁移锁和协调字段

## 4. 综合验证

- [x] 4.1 运行迁移相关 Python 与 Vitest 定向测试，并执行 `npm run lint:test-quality`，确保测试验证真实状态和文件/数据库行为
- [x] 4.2 按仓库提交前流程运行 `pytest`、`npx tsc --noEmit`、`npm test`、`npm run lint:py`、`npm run format:py`、`npm run lint`、`npm run lint:test-quality`
- [x] 4.3 使用临时数据库和临时漫画目录做一次手工冒烟：修复已存在文件成功、放弃预览后可立即重试、完整迁移仍按原规则移动文件
