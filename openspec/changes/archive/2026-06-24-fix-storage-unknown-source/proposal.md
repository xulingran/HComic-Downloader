## 为什么

存储分析「按来源分布」面板会把多章节专辑的根目录归入 `unknown` 来源，即使该专辑的每个章节在 `download_history` 表里都有来源正确的记录。根因是 `scanner.scan_download_dir()` 构建 `path_to_meta` 时只按 `output_path` 精确匹配，而专辑打包格式（folder）的 DB 记录指向**章节子目录**，专辑根目录本身没有记录，导致匹配失败，来源回退为空并被 `storage_analyzer` 归为 `unknown`。

实测当前下载目录有 7 个资产被错误标为 `unknown`，其中 4 个是 DB 有完整子章节记录的多章节专辑（来源应为 hcomic / bika），来源被错误丢弃。

## 变更内容

- 修复 `python/maintenance/scanner.py` 中 `path_to_meta` 的构建逻辑：除了 `output_path` 本身，同时把 `output_path` 的**父目录**纳入映射。这样扫描专辑根目录时，能命中其下任一章节记录，从而继承正确的 `source_site` / `comic_source` / `album_id` 等元数据。
- 收敛来源兜底语义：扫描器对父目录回填采用「首个非空子记录」策略，避免多来源混合专辑（理论上不存在，但防御性处理）的歧义。
- 不变更 DB 写入端、不新增 ComicInfo.xml 字段、不新增落盘标记文件——保持本次变更最小化，聚焦修复「有记录但匹配不到」的真 bug。

## 功能 (Capabilities)

### 新增功能
<!-- 无新增 capability -->

### 修改功能
- `storage-analytics`: 「按来源分布」场景的需求从「无法识别即归 unknown」细化为「优先用 `output_path` 精确匹配历史记录，再回退到父目录匹配（覆盖多章节专辑根目录），仍无法识别时才归 unknown」。

## 影响

- **代码**：`python/maintenance/scanner.py`（`scan_download_dir` 内 `path_to_meta` 构建逻辑，约 5-10 行）。
- **测试**：`tests/test_maintenance_scanner.py` 新增专辑根目录来源回填的用例；`tests/test_maintenance_storage_analyzer.py` 新增「专辑根目录应继承子章节来源」的契约用例。
- **运行时行为**：维护中心存储分析面板上，原本显示为 `unknown` 的多章节专辑根目录将正确显示其来源（hcomic / bika 等）；`bySource` 分布更准确。
- **不受影响**：DB schema、CBZ 打包、下载流程、健康检查、孤儿清理（它们各自有独立的来源解析路径）。
