## 为什么

当前测试套件规模可观（Python 653 + 前端 782 = 1435 用例，覆盖率 83%），但提供的信心远低于数字暗示的程度：

1. **存在虚假安全感**：Python 套件跑出来就有一个失败用例 `test_same_drive_target_exists_reports_clear_error`，而它实际上暴露了一个被掩盖的真实 bug——macOS/Linux 上 `os.rename` 会静默覆盖已存在的目标文件，导致迁移时用户数据可能丢失，而测试却声称"会报告清晰错误"。
2. **大量同义反复测试**：前端 `useDownload.test.ts` 等用 mock 后断言"mock 被调用"，验证不了真实行为；`test_download_manager.py` 测试"枚举值等于字符串"；`downloadStore.test.ts` 测试 Zustand 的基本 CRUD 保证。这些测试不坏，但贡献不了信号。
3. **危险地带缺乏行为验证**：最近 100 次提交中 fix（23 次）是 test 提交（12 次）的近两倍，bug 反复集中在阅读器自适应预加载、下载并发状态机、IPC 契约一致性——正是当前测试最薄弱的地方。
4. **完全缺失端到端冒烟**：项目最脆弱的边界（JSON-RPC over stdin/stdout 连接 Electron 与 Python）没有任何进程级测试。

为什么现在做：这个项目测试已经多到"看似完备"，再盲目堆测试只会加深噪音而非信心。现在正是从"数量思维"转向"信号思维"的时机。

## 变更内容

### Phase 1 — 修假测试 + 建回归网

- **修复 migration 跨平台覆盖 bug**：`migration.py` 的 `_move_item` 在调用 `os.rename` 前显式检查目标是否存在并主动抛 `FileExistsError`，使 macOS/Linux/Windows 行为一致。
- **修正 `test_same_drive_target_exists_reports_clear_error`**：让其在所有平台通过，锁定"目标已存在时报错且不破坏源文件"的正确行为。
- **新增 migration 回归用例**：验证"目标已存在时，源文件保持不变"。

### Phase 2 — 审计并精简同义反复测试

- **删除/重写以下类别的低价值测试**（逐个标注理由）：
  - 验证"mock 被调用"的同义反令断言（如 `useDownload.test.ts` 的部分用例）
  - 验证语言/框架基本保证的断言（如枚举值、Zustand 基本 CRUD）
  - `test_download_manager.py` 中验证数据类字段赋值的用例
- **保留所有真正的行为验证**（CBZ 打包、JM 解混淆、bika 签名、fixtures 解析）

### Phase 3 — 补危险地带的行为测试

- **阅读器自适应预加载边界回归**：针对最近 params 抖动 bug，验证"快速滚动时已预加载页面不丢失"等不变量。
- **下载状态机真实文件系统集成测试**：用 `tmp_path` 真实下载+打包，验证 `queued → downloading → completed` 完整流转和 `.cbz` 真实生成。
- **IPC 契约运行时烟雾测试**：进程内实例化 `IPCServer`，调用关键方法（`get_config`、`search`），验证返回结构符合前端 TypeScript 类型契约。

### Phase 4 —（可选）一条端到端冒烟

- 真实 spawn `ipc_server.py` 子进程，发 JSON-RPC `get_config`，验证合法响应和优雅退出。守住进程间通信这条最脆弱的边界。

## 功能 (Capabilities)

### 新增功能

- `test-discipline`: 测试纪律——定义"什么是有价值的测试"的判断标准、同义反复测试的识别与精简规则，以及测试套件的信号质量准则。
- `regression-guards`: 回归守护——针对已发现的真实 bug（migration 跨平台覆盖、阅读器预加载 params 抖动）建立锁定正确行为的回归测试集。
- `behavior-integration-tests`: 行为集成测试——用真实文件系统、真实 fixtures、进程内调用验证关键链路（下载→打包、IPC 契约、预加载不变量）的端到端行为。

### 修改功能

- `migration-engine`: 修复 `_move_item` 在非 Windows 平台上 `os.rename` 静默覆盖目标文件的 bug，要求所有平台上目标已存在时主动抛 `FileExistsError`。

## 影响

- **代码修复**：`migration.py`（`_move_item` 方法，约 3-5 行）
- **测试变更**：
  - 修正：`tests/test_migration.py`（1 个用例）
  - 新增：`tests/test_migration.py`（回归用例）、`tests/test_download_integration.py`（新文件）、`tests/test_ipc_contract.py`（新文件）、前端预加载边界测试
  - 精简：`tests/test_download_manager.py`、`tests/unit/hooks/useDownload.test.ts`、`tests/unit/stores/downloadStore.test.ts` 等部分用例
- **构建时间**：Phase 4 若实施，Python 测试从 ~6s 增至 ~10-15s（一条进程级测试的开销）
- **无 API 变更**，无依赖变更，无破坏性变更（migration 的 bug 修复让错误处理在所有平台一致，属于 bug fix 范畴）
