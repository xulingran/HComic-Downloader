# 实现任务

## 1. Python 同步函数拆解与错误事件单点化

- [x] 1.1 在 `python/ipc/favourite_tags_mixin.py` 提取 `_fetch_favourites_pages(self, source, on_progress) -> FetchResult` 私有方法：负责第一页预检（保留 raise_errors=True 行为，但**删除**内层的 error 推送 + 简化为直接 raise）、`needs_login` 检查、`_favourite_tags_db.clear`、逐页扫描 + fetching 进度推送、统计 `total_comics/skipped_pages`。返回命名结构（dataclass 或 TypedDict：`all_empty, total_comics, total_pages, skipped_pages`）。
- [x] 1.2 提取 `_enrich_phase(self, source, empty_comics, on_progress) -> int` 私有方法：负责起始 0/total 推送 + 调用 `_enrich_tags_for_comics(progress_callback=on_progress)`，返回 `enriched_count`。`empty_comics` 为空时直接返回 0 不推送。
- [x] 1.3 重写 `handle_sync_favourite_tags` 为编排函数：调用 `_fetch_favourites_pages` → `_enrich_phase` → 推送 `completed`（含 total_tags）→ logger.info + return。**外层** `try/except Exception` 保留为**唯一** error 推送点（推送一次 `phase:"error"`, `total=0` 表达未知总数, re-raise）。函数体降至 ≤30 行逻辑。
- [x] 1.4 把 `total_pages = 1` 初始哨兵改为 `None`，外层 error 推送用 `total_pages or 0`（None / 未确定时 total=0）。

## 2. config_mixin my_tags 兜底对齐

- [x] 2.1 在 `python/ipc/config_mixin.py` 将 `my_tags` 的 `getattr` 默认值从手写 `{"hcomic": [], "moeimg": [], "jm": [], "bika": [], "copymanga": []}` 字面量改为 `_default_source_list_map()`，与同文件内 `tag_blacklist` 等字段风格一致。确认 `_default_source_list_map` 已在模块顶部导入，缺失则补 import。

## 3. ComicInfoDrawer 标签按钮状态查询表化

- [x] 3.1 在 `src/components/ComicInfoDrawer.tsx` 顶部（紧邻 `SINGLE_CONFIRM_LAYOUT`）定义模块级 `TAG_BUTTON_STATE` 查询表：`Record<TagButtonState, { action: TagConfirmAction; icon: string; color: string; title: string }>`，含 `blocked` / `favourited` / `recommendable` / `plain` 四键，字段值取自当前实现的四个三元表达式输出。补 `type TagButtonState = 'blocked' | 'favourited' | 'recommendable' | 'plain'`。
- [x] 3.2 在 `renderTag` 内删除 `btnAction`/`btnIcon`/`btnColor`/`btnTitle` 四个平行三元表达式，改为：单次推导 `const state: TagButtonState = blocked ? 'blocked' : favourited && canRecommend ? 'favourited' : canRecommend ? 'recommendable' : 'plain'`，然后 `const { action: btnAction, icon: btnIcon, color: btnColor, title: btnTitle } = TAG_BUTTON_STATE[state]`。保持 `setConfirmTag({ tag, action: btnAction })` 调用点不变。

## 4. 测试

- [x] 4.1 在 `tests/test_favourite_tags_sync_progress.py` 新增回归用例 `test_sync_emits_error_once_on_first_page_failure`：mock 第一页 `parser.favourites` 抛 `RuntimeError`，断言 `_notifications` 中 `phase=="error"` 的事件**恰好一次**（`assert len([e for e in events if e["phase"]=="error"]) == 1`），且 `total == 0`（未知总数），且原函数 re-raise。
- [x] 4.2 在同文件新增/确认用例覆盖 `needs_login` 失败路径也恰好一次 error，与第一页网络失败路径行为一致（数量相等）。
- [x] 4.3 在 `tests/unit/components/ComicInfoDrawer.test.tsx` 补一条用例：断言四态（blocked / favourited / recommendable+不支持推荐 / plain）按钮渲染出对应 icon/color/action（验证查询表化后行为不变）。若已有覆盖四态的用例，确认仍通过即可。

## 5. 验证闸门（提交前必须全部通过）

- [x] 5.1 `pytest`（含新增 favourite tags 错误单发用例）
- [x] 5.2 `npx tsc --noEmit`
- [x] 5.3 `npm test`（ComicInfoDrawer 四态查询表用例）
- [x] 5.4 `npm run lint:py`
- [x] 5.5 `black --check .`
- [x] 5.6 `npm run lint`
- [x] 5.7 `npm run lint:test-quality`
- [x] 5.8 `openspec-cn validate fix-tag-sync-review-refactor --strict`（规范增量通过校验）
