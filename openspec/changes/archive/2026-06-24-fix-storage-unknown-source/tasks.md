## 1. 测试先行（TDD）

- [x] 1.1 在 `tests/test_maintenance_scanner.py` 新增用例：专辑根目录（folder）在 `path_to_meta` 精确匹配 miss 时，应通过父目录回填命中子章节记录，`source_site` 正确继承（hcomic / bika 各一例）
- [x] 1.2 在 `tests/test_maintenance_scanner.py` 新增用例：资产路径能精确匹配 `output_path` 时，父目录回填逻辑不得覆盖精确匹配的元数据
- [x] 1.3 在 `tests/test_maintenance_storage_analyzer.py` 新增契约用例：含多章节专辑的下载目录，`bySource` 中该专辑根目录的来源应归入正确来源，不计入 `unknown`
- [x] 1.4 在 `tests/test_maintenance_storage_analyzer.py` 补充用例：DB 完全无记录的真孤儿资产仍归入 `unknown`（确保本次改动不误伤孤儿判定）
- [x] 1.5 运行 `pytest tests/test_maintenance_scanner.py tests/test_maintenance_storage_analyzer.py` 确认新增用例全部失败（红）

## 2. 核心实现

- [x] 2.1 修改 `python/maintenance/scanner.py` 的 `scan_download_dir`：构建 `path_to_meta` 时，除以 `output_path` 为 key 外，额外以 `os.path.dirname(output_path)` 为 key 写入（父目录 key 已存在则跳过，保持「首个非空记录覆盖」语义）
- [x] 2.2 确认 `scan_download_dir` 的扫描循环内读取 `path_to_meta` 的逻辑无需调整（精确匹配 key 与父目录 key 互不重叠）
- [x] 2.3 运行 1.5 的测试，确认全部通过（绿）

## 3. 回归与契约验证

- [x] 3.1 运行 `pytest` 全量，确认无回归
- [x] 3.2 运行 `npm run lint:py` 与 `black --check .`，确认扫描器改动符合 lint/格式规范
- [x] 3.3 手动验证：在真实下载目录 `E:\新建文件夹\hcomic` 上运行 `analyze_storage`，确认原 4 个多章节专辑 unknown 资产已正确归入 hcomic/bika，剩余 3 个真孤儿仍为 unknown（符合预期）

## 4. 规范归档准备

- [x] 4.1 确认 `openspec/changes/fix-storage-unknown-source/specs/storage-analytics/spec.md` 的「多章节专辑根目录继承子章节来源」「来源回退优先级」「父目录回填避免覆盖精确匹配」三个场景均有对应测试覆盖
- [x] 4.2 自检：本次改动未触碰 DB schema、CBZ 打包、下载流程、健康检查、孤儿清理的来源解析路径
