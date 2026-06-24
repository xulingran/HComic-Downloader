## 上下文

维护中心存储分析通过 `scanner.scan_download_dir()` 扫描下载目录识别漫画资产，再用 `storage_analyzer.analyze_storage()` 按 `source_site` 聚合。扫描器构建 `path_to_meta` 映射来补全元数据：遍历 `history_db.get_all_records_with_album()`，以每条记录的 `output_path` 为 key。

**问题**：多章节专辑打包为 folder 格式时，DB 记录的 `output_path` 指向**章节子目录**（如 `<dl>/<album>/第3話`），而扫描器只扫描下载目录的**一级条目**（专辑根目录 `<dl>/<album>`）。因此专辑根目录在 `path_to_meta` 中查不到，`source_site` 回退为空，最终被 `storage_analyzer.py:57` 的 `asset.source_site or "unknown"` 归为 `unknown`。

实测 7 个 unknown 资产中，4 个是 DB 有完整子章节记录的多章节专辑（来源本应是 hcomic / bika），3 个是 DB 完全无记录的真孤儿（不在本次修复范围）。

约束：
- 扫描器是只读分析，禁止修改 DB 或磁盘。
- 来源识别已有三级回退：精确匹配 → 启发式 → unknown，本次只在「精确匹配」和「启发式」之间插入「父目录匹配」这一级。
- `_collect_history_output_paths`（orphan_cleaner / storage_analyzer 共用）的「资产是否在历史中」判定语义不能受影响——专辑根目录虽不在 `output_path` 集合中，但其子章节在，故专辑根目录仍应被正确识别为 tracked（这点现有逻辑已满足，因为 `_collect_history_output_paths` 收集的是所有 output_path，扫描器对 untracked 的判定基于资产 path 是否在该集合内，与 source_site 回填无关）。

## 目标 / 非目标

**目标：**
- 多章节专辑根目录能正确继承其子章节记录的 `source_site`，不再被误归 `unknown`。
- 来源回退逻辑保持单一真相源（集中在 `scan_download_dir` 的 `path_to_meta` 构建），不在 `storage_analyzer` 侧重复实现。
- 修复对存量数据立即生效（无需重新下载或迁移 DB）。

**非目标：**
- 不修复 DB 完全无记录的真孤儿资产（如手动放入、旧版本下载丢失记录的漫画）——它们的 `unknown` 来源是诚实表现，应由「未在历史记录中」面板承接。
- 不变更 CBZ 打包逻辑、不新增 ComicInfo.xml 的 Source 字段、不新增落盘标记文件（这些属于独立的「元数据持久化」改进，不在本次范围）。
- 不修改 `untrackedFiles` 的判定语义。

## 决策

### 决策 1：父目录回填而非递归扫描

**选择**：在 `path_to_meta` 构建阶段，除了以 `output_path` 为 key，额外以 `os.path.dirname(output_path)`（即章节子目录的父目录）为 key，值为该记录。扫描专辑根目录时即可命中。

**考虑过的替代方案**：
- *递归扫描子目录*：让扫描器对每个 folder 资产递归检查子目录是否在 `path_to_meta`。复杂度高，且会与现有的「只扫一级」语义冲突，可能引入重复计数。
- *专辑打包时为根目录写 DB 记录*：在 `album_coordinator` 完成后插入一条专辑级虚拟记录。改动面大（主键/去重/迁移都要考虑），且救不了存量。

**理由**：父目录回填改动最小（`path_to_meta` 构建循环内加 ~5 行），语义清晰（专辑根目录 = 某条章节记录的父目录），立即对存量生效。

### 决策 2：父目录映射的冲突处理

**选择**：父目录 key 可能被多条章节记录竞争（同一专辑下多个章节共享同一父目录）。采用「首个非空记录覆盖」语义——遍历记录时，若父目录 key 尚未填充，则写入；已填充则跳过。由于同一专辑的所有章节记录 `source_site` / `comic_source` / `album_id` 必然相同（来自同一专辑的打包上下文），取哪一条都不影响来源正确性。

**考虑过的替代方案**：
- *校验所有同父目录记录的来源一致性，不一致时报错*：过度防御，实际数据中同专辑章节来源必然一致（打包时由 `ComicInfo.source_site` 决定），增加无谓复杂度。

### 决策 3：精确匹配优先级保持不变

`scan_download_dir` 现有逻辑是「`meta = path_to_meta.get(entry_path, {})`」再用 `source_site = meta.get(...) or _infer_source_site(...)`。本次改动后，精确匹配的 key（章节子目录自身）和父目录 key（专辑根目录）互不重叠，各自命中不同资产，无覆盖风险。无需调整扫描循环内的读取逻辑。

## 风险 / 权衡

- **[风险] 父目录恰好是另一个无关资产的路径** → 极低概率。下载目录结构里，章节子目录的父目录就是专辑根目录，不会与另一个独立资产重合。且扫描器对每个资产先做精确匹配（优先级最高），父目录回填仅在精确匹配 miss 时生效。
- **[风险] `get_all_records_with_album()` 返回量大时 `dirname` 调用开销** → 可忽略。`dirname` 是纯字符串操作，相对 DB 查询和网络 IO 可忽略不计；且仅在维护中心手动触发时执行。
- **[权衡] 真孤儿仍显示 unknown** → 本次不修复 DB 无记录的孤儿。它们应通过「未在历史记录中」面板被用户感知，来源显示 unknown 是符合预期的诚实行为。若未来需要更友好的展示，可单独做前端文案改进。
