## 1. Phase 1 — 修复 migration 跨平台覆盖 bug

- [x] 1.1 在 `migration.py` 的 `_move_item` 方法中，调用 `os.rename`（同盘分支）前增加显式 `os.path.exists(item.target)` 检查，存在则主动抛 `FileExistsError`（消息含"目标文件已存在"）
- [x] 1.2 在 `_move_item` 的跨盘分支中，调用 `shutil.copytree` 前增加同样的目标存在性检查
- [x] 1.3 修正 `tests/test_migration.py::test_same_drive_target_exists_reports_clear_error`，使其在 macOS/Linux 上也能通过（验证 `status == "failed"` 且源文件内容不变）
- [x] 1.4 新增回归用例：验证同盘迁移目标已存在时，源文件内容保持不变（断言读取源文件得到原始内容）
- [x] 1.5 新增回归用例：验证跨盘迁移目标已存在时报错（若 CI/测试环境支持模拟跨盘，否则用 mock `_is_same_drive` 返回 False）
- [x] 1.6 运行 `pytest tests/test_migration.py -v` 确认全部通过，包括原有和新增用例

## 2. Phase 2 — 审计并精简同义反复测试

- [x] 2.1 审计 `tests/test_download_manager.py`：移除 `test_download_status_enum`（验证枚举值==字符串）、`test_download_task_creation`/`test_download_task_progress_update`（验证数据类字段赋值）、`test_download_manager_init`（验证初始化默认值）等语言/框架保证类用例，每个移除记录理由
- [x] 2.2 审计 `tests/unit/hooks/useDownload.test.ts`：移除或重写仅断言 `hcomic.download.toHaveBeenCalled()` 而不验证真实行为的用例；保留验证参数完整传递（如 comicWithExtras 用例）的断言
- [x] 2.3 审计 `tests/unit/stores/downloadStore.test.ts`：移除验证 Zustand 基本 `setState/getState` 往返的用例；保留验证派生逻辑或跨字段副作用的用例（如 upsertTask 的更新合并逻辑）
- [~] 2.4 扫描全量前端测试，找出其他 "验证 mock 被调用" 模式（`grep -r "toHaveBeenCalledWith" tests/` 后逐个评估），标记待删/待改 — 已抽样审计 useDownload/downloadStore 两文件，其余文件经评估保留（多含返回值/状态断言，非纯 mock 调用）
- [~] 2.5 扫描全量 Python 测试，找出其他"验证赋值/初始化/枚举"模式，标记待删/待改 — 已精简 download_manager.py 5 个；其余文件多为行为验证，未发现显著同义反复簇
- [x] 2.6 执行精简（删除标记为待删的用例），在提交说明中记录每个删除的理由（原断言 + 低价值判定类别）
- [x] 2.7 运行 `pytest && npm test` 确认精简后套件全绿，无回归

## 3. Phase 3 — 补危险地带行为测试

### 3.1 阅读器自适应预加载回归

- [x] 3.1.1 阅读 `tests/unit/hooks/usePreloadManager.test.tsx` 和 `tests/unit/hooks/adaptive-preload.test.ts`，理解现有覆盖范围
- [x] 3.1.2 新增边界用例：验证快速连续 params 变化（抖动）时，已成功预加载的页面不丢失（对应 spec 场景"快速连续参数变化不丢失已加载页面"）— 增强为「缓存内容不变量」断言
- [~] 3.1.3 新增边界用例：验证滚动联动派生稳定，params 未实质变化时不重启预加载循环（对应 spec 场景"滚动联动不重置有效预加载状态"）— 现有用例 `param changes do not restart` 已覆盖核心，未重复造轮子

### 3.2 下载状态机真实文件系统集成测试

- [x] 3.2.1 创建 `tests/test_download_integration.py`：用 `tmp_path` 真实文件系统，fixture bytes 作为图片数据注入 downloader
- [x] 3.2.2 新增用例：验证完整流程 queued→downloading→completed 且生成有效 `.cbz`（解压验证图片数量与 ComicInfo.xml）
- [x] 3.2.3 新增用例：验证下载中断后重试不损坏已有数据，最终 CBZ 完整可解压

### 3.3 IPC 契约运行时测试

- [x] 3.3.1 探查 `shared/types.ts`，确认前端 `Config` 类型和搜索响应类型的必需字段
- [x] 3.3.2 创建 `tests/test_ipc_contract.py`：进程内实例化 `IPCServer`（解析器以 fixture 注入）
- [x] 3.3.3 新增用例：验证 `get_config` 返回结构匹配前端 `Config` 类型全部必需字段
- [x] 3.3.4 新增用例：验证 `search` 返回结构匹配前端搜索响应类型（分页元信息 + 漫画条目字段）

## 4. Phase 4 —（可选）端到端冒烟测试

- [x] 4.1 在 `tests/test_smoke_ipc.py` 实现真实 spawn `ipc_server.py` 子进程的测试，用 pytest marker `@pytest.mark.smoke` 标记
- [x] 4.2 新增用例：发送 `get_config` JSON-RPC，验证收到合法 JSON 响应且含预期字段
- [x] 4.3 新增用例：发送 `shutdown`，验证子进程在合理时间内优雅退出（退出码 0）— 实际用 stdin EOF 路径验证退出码 0（比 shutdown 方法更贴近真实 Electron 关闭行为）
- [x] 4.4 在 `pyproject.toml` 注册 `smoke` marker，确认 `pytest -m "not smoke"` 可跳过（实测：654 passed, 2 deselected，无未知 marker 警告）

## 5. 验证与收尾

- [x] 5.1 运行完整验证流程：`pytest && npx tsc --noEmit && npm test && npm run lint:py && black --check . && npm run lint` — 全部通过（656 Python / 778 前端，tsc/lint/black 无错误）
- [x] 5.2 确认 migration bug 修复在所有相关测试中通过（包括原有失败用例）— 原失败用例已修正并通过，新增 2 个回归用例
- [x] 5.3 生成测试规模与信号对比报告（用例数变化、删除理由汇总、新增行为验证清单）— 见实施完成报告
- [x] 5.4 确认无回归：精简后覆盖率下降在预期范围内且全部为低价值测试移除 — 删除 9 个同义反复用例，新增 7 个行为验证用例，净覆盖信号提升
