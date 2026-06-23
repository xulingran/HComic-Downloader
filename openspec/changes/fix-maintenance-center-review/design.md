## 上下文

维护中心三件套（`health-check` / `orphan-cleanup` / `storage-analytics`）已随 `2026-06-22-maintenance-center` 变更落地，但代码审查发现实现与规范之间存在偏差，最严重的是规范要求"页数对账"，实现却读取了数据库中根本不存在的 `pages` 列（测试用 mock 字典掩盖了这一点）。本设计针对四项 Critical 与若干 Important 项给出最小侵入、向前兼容的实现路径。

关键约束：
- 数据库 schema 必须向前兼容旧 `download_history.db`（已分发到用户机器）。
- IPC 通道名与协议不可破坏性变更（前端与历史发行版 Python 二进制须共存一段时间）。
- Python stdout 在非 TTY 下默认块缓冲，进度通知须显式 flush。

## 目标 / 非目标

**目标：**
- 让健康检查的页数对账在生产环境真实生效（`incomplete_pages` / `unexpected_pages` 真正可能被触发）。
- 消除孤儿清理的扫描-删除 TOCTOU 窗口与 stale active-set。
- 让存储分析的"孤儿"语义与"孤儿临时目录清理"面板一致，避免误导用户删除实际需要的资产。
- 修正 `main.ts` 中误导性的入参校验。
- 健康检查在大库（数百本 CBZ）下不阻塞 UI 数分钟。

**非目标：**
- 不重写维护中心整体架构，不改 IPC 通道名/方法名。
- 不引入新的 Python 依赖。
- 不改变 `temp_*` 命名约定或下载流程本身。
- 不实现"撤销清理"或回收站机制（超出本次范围）。
- 不为健康检查增加配置项 UI（`Image.verify` vs 全解码切换通过常量/环境变量控制，不暴露给用户）。

## 决策

### 决策 1：持久化 `pages` 列（而非从 ComicInfo.xml 实时推断）

**选择：** 在 `download_history` 新增 `pages INTEGER NOT NULL DEFAULT 0` 列，`record_download` 写入实际下载页数。

**理由：** 规范明确允许"`download_history.db` 或 `ComicInfo.xml`"两个来源。但 ComicInfo.xml 的 `PageCount` 是可选元数据，folder 格式根本没有 ComicInfo.xml。数据库列是唯一对所有格式都可靠的来源，且与"健康检查针对历史记录"的语义一致——检查的是"下载时记录的页数"。

**替代方案：** 实时扫描资产文件计数作为期望页数。否决：那会把"期望"和"实际"变成同一来源，对账无意义。

**迁移：** 复用既有 `ALTER TABLE ... ADD COLUMN ... DEFAULT 0` 迁移模式（`download_history.py:42-47` 已为 `album_id`/`album_total_chapters` 建立先例）。旧记录 `pages=0`，健康检查对 `expected_pages=0` 跳过页数对账（既有行为），不会对老记录误报。

### 决策 2：清理时即时重算 active-set 与 mtime（非复用扫描快照）

**选择：** `cleanup_orphan_temp_dirs` 内部在删除循环**之前**重新调用一次 active-set 与 output-paths 收集，并在循环内对每个 path 实时 `os.path.getmtime`。

**理由：** 扫描与删除之间存在窗口；用户在 UI 上勾选后点"清理"可能间隔数秒至数分钟，期间新的下载任务可能复用同名 `temp_*` 目录。复用扫描时刻的 `active_temp_dirs` 快照无法捕获新任务。

**替代方案 A：** 加文件锁/进程锁。否决：跨平台文件锁复杂，且下载任务创建 `temp_*` 目录的代码路径不在同一把锁下。
**替代方案 B：** 强制要求清理前必须重新扫描，UI 只传 orphan id。否决：增加往返且不消除"重扫后到删除前"的窗口。
**选择（即时重算）** 是唯一能在删除瞬间获得最新视图的方式，且实现成本最低。

**注意：** mixin 层 `_get_active_temp_dirs()` 须在 `handle_cleanup_orphan_temps` 内重新调用一次（当前实现只调用一次并下传，见 `maintenance_mixin.py:107`）。

### 决策 3：`orphanFiles` 语义收紧 + 新增 `untrackedFiles`

**选择：** `storage_analyzer.analyze_storage` 中：
- `orphanFiles` 仅统计 `temp_*` 目录（与"孤儿临时目录清理"面板定义一致）。
- 新增 `untrackedFiles: { count, sizeBytes }` 统计"非 `temp_*`、但不在 history `output_path` 中的资产"。
- UI `StorageStatsPanel` 的"孤儿文件"卡片改为展示 `untrackedFiles` 计数 + 文案"未在历史记录中"，并加注"非临时目录，删除请谨慎"。

**理由：** 当前 `orphanFiles` 把"未在历史"等同于"可清理孤儿"，会把用户手动放入下载目录的资产、迁移残留、旧版下载文件全部计为"孤儿"。UI 的"孤儿文件 N 个"会诱导用户误删。拆分两个字段后语义清晰：`orphanFiles` = 可安全清理的临时目录，`untrackedFiles` = 仅信息性提示。

**替代方案：** 把 `orphanFiles` 直接改为统计 `temp_*`，不新增字段。否决：会丢失"未在历史"这个有用的诊断信息（这正是存储分析的价值之一）。

### 决策 4：`main.ts` 入参校验改用显式 Array 检查

**选择：** 移除 `assert(and(object()), comicKeys, ...)`，改为：
```ts
if (!Array.isArray(comicKeys)) throw new ValidationError('comicKeys must be an array')
for (const key of comicKeys) {
  if (!Array.isArray(key) || key.length < 3 || key.length > 8)
    throw new ValidationError('Each comicKey must be an array of 3-8 strings')
  for (const k of key) {
    assert(and(string(), length(1, 256), noControlChars()), k, 'runHealthCheck comicKey element')
  }
}
```

**理由：** `object()` 断言对 `{foo:1}` 这种非数组对象会通过，紧接着又 `as unknown as unknown[]` + `Array.isArray` 检查，逻辑割裂且给审阅者虚假的安全感。显式 `Array.isArray` 与 `preload.ts` 一致，且对每个字符串元素补充长度与控制字符校验（这些字符串会原样传到 Python，是 SSRF/注入的潜在向量）。

### 决策 5：健康检查用 `Image.verify()` 头部校验 + 可选全解码

**选择：** `_check_archive` / `_check_folder` 默认用 `Image.open(...).verify()`（仅读头部，不解码像素），通过环境变量 `HCOMIC_HEALTH_FULL_DECODE=1` 切换为完整 `.load()`。

**理由：** `verify()` 能检测出截断、错误格式、损坏头部——覆盖 95% 的"图片不可读"场景，而成本是 `.load()` 的 ~1/50。逐页全解码对数百 MB 的库不可接受。`scope="selected"` 下用户主动体检单本时可开全解码。

**替代方案：** 只校验文件大小 > 0。否决：无法发现"伪图片"（如 HTML 错误页被存为 .jpg）。

### 决策 6：进度通知流式下发

**选择：** `_emit_maintenance_progress` 在 `_write_response(notification)` 后追加 `sys.stdout.flush()`；健康检查改为在后台线程执行，主线程立即返回，通过通知推送进度与最终结果。

**理由：** Python stdout 非 TTY 默认全缓冲，通知会滞留缓冲区直到结束才一次性刷出，UI 进度条全程不动。`sys.stdout.flush()` 是 JSON-RPC over stdin/stdout 的标准做法。后台执行避免阻塞 IPC 分发循环（与 `download_manager` 长任务模式一致）。

### 决策 7：页数统计去重

**选择：** `health_checker._check_folder` 删除自身页数计数逻辑，改为调用 `scanner._count_folder_pages` 获取期望对账值；自身只负责"逐页可读性校验"。

**理由：** scanner 与 health_checker 当前各维护一份"chapter 子目录 vs 根目录图片"启发式，是同步漂移的定时炸弹。单一真相源在 scanner。

## 风险 / 权衡

- **[迁移风险] 新增 `pages` 列** → 复用既有 `ALTER TABLE ADD COLUMN DEFAULT 0` 模式，与 `album_id` 迁移同质；旧库自动补 0，健康检查对 0 跳过对账，无破坏。
- **[TOCTOU 残余窗口] 即时重算仍非原子** → 接受残余窗口（毫秒级），并在清理结果 `failed` 列表中明确回报"目录正被活跃任务使用"，让用户可重试。完全消除须改下载流程，超出范围。
- **[性能] `Image.verify()` 漏报深层损坏** → 文档化：默认快速校验，用户怀疑特定本子时可设 `HCOMIC_HEALTH_FULL_DECODE=1` 或用 `scope="selected"`。
- **[行为变更] `orphanFiles` 计数下降** → 用户可见的数值变化，须在 changelog 显著说明；新值与"临时目录清理"面板的孤儿数对齐，反而消除困惑。
- **[测试] mock 字典掩盖 schema 问题** → 强制 maintenance 测试用真实 `DownloadHistoryDB`（`tmp_path` + 真实建表），新增契约测试断言 `get_all_records_with_album` 返回的 dict 包含 `pages` 键。
- **[后台执行] 健康检查结果须异步回传** → 复用既有 `maintenance_progress` 通知通道，在 `phase` 中区分 `health_check_progress` 与 `health_check_result`；前端监听 result 通知收尾。若改动过大，降级方案：保持同步但加 `sys.stdout.flush()` + 缩短进度回调间隔（每条而非每 5 条）。
