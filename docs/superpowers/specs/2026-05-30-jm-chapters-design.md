# jm 章节适配设计

- 日期：2026-05-30
- 状态：已批准，待实现
- 范围：为 jm 来源增加章节（episode）概念，覆盖预览、下载、收藏已下载标记、阅读历史四条链路。

## 1. 背景与目标

部分 jm 专辑包含多个章节（参考项目 ComicGUISpider 的 episode 概念）。当前本项目把每个专辑当作单本处理，多章节专辑无法正确浏览或下载各章。

目标：

- 多章节专辑点击封面进入阅读器时，先显示选章首屏，选定章节后进入该章预览。
- 阅读器内支持「上一章 / 下一章」切换。
- 点击下载时支持多选章节，每章一个独立下载任务。
- 收藏页「已下载」标记按「全部章节下完」判定。
- 阅读历史按专辑一条记录，指向最后阅读的章节与页码。

非目标：

- hcomic / moeimg 的章节化（这两个来源无章节概念，行为完全不变）。
- 「合并为一本」式下载。
- 章节级断点续传策略改动（沿用现有逐任务续传）。

## 2. 关键事实（来自代码调研）

- JM 专辑页 `/album/{id}` 用 `div.episode ul a` 列出章节，节点带 `data-album`（章节/photo id）、`data-index`（0-based）、`<h3>`（章节名）。
- 每章图片在独立的 `/photo/{章节id}` 页面。
- 单章节专辑满足 `album_id == 章节id`，故现有单本流程对单章节恰好正确。
- 反混淆所需的 `eps_id` 是「章节(photo) id」，它嵌在图片 URL 路径 `/media/photos/{id}/00001.webp` 中。当前实现取 `int(comic.id)`（专辑 id），单章节恰好相等而蒙混过关，多章节会出错——本设计修正之。

## 3. 章节数据模型

`models.py` 新增轻量 dataclass，并给 `ComicInfo` 增加 `chapters` 字段：

```python
@dataclass
class ChapterInfo:
    id: str          # 章节(photo) id
    name: str        # 章节名，如 "第 1 話"
    index: int       # 1-based 顺序
    pages: int = 0   # 可选，懒填充
```

`ComicInfo` 新增 `chapters: list[ChapterInfo] = field(default_factory=list)`。约定：

- `len(chapters) > 1` → 多章节，走章节流程。
- `len(chapters) <= 1` → 单本，走现有流程（向后兼容）。

`chapters` 不参与 `__hash__` / `__eq__`（哈希仍基于 `source_site, id, comic_source`）。

`shared/types.ts` 的 `ComicInfo` 新增可选字段：

```ts
export interface ChapterInfo { id: string; name: string; index: number; pages?: number }
// ComicInfo 增加：chapters?: ChapterInfo[]
```

## 4. 解析层（`sources/jm/parser.py`）

- `_parse_detail` 扩展：解析 `//div[@class="episode"]//ul/a`（参考项目用 `(//div[@class="episode"])[last()]/ul/a`），每节点取 `data-album`=章节 id、`data-index`（0-based，+1 得 index）、`.//h3` 文本=章节名，填充 `chapters`。
- 无 episode 块 → 单章节：保持现状，`image_urls` 直接从专辑页提取，`chapters` 留空。
- 多章节 → `chapters` 填充；`image_urls` 留空（按章懒加载，不在详情阶段预取全部章节图片）。
- 新增 `get_chapter_images(chapter_id) -> tuple[list[str], str]`：请求 `/photo/{chapter_id}`，复用现有图片 URL 提取与「按模式补全」逻辑，返回该章 `image_urls` 与 `scramble_id`。

## 5. 反混淆修正（横切，重要 bug）

当前 `descrambler` 与调用方把 `eps_id` 取成专辑 id（`int(comic.id)`），单章节恰好相等而蒙混过关，多章节会错。正确的 `eps_id` 是图片 URL 路径 `/media/photos/{id}/00001.webp` 里的那个 id。

修正：

- `descrambler` 增加从图片 URL 提取 `eps_id` 的辅助函数（路径中 `/media/photos/(\d+)/` 捕获组）。
- 预览反混淆（`python/ipc/preview_mixin.py`）改为按图片 URL 自纠 `eps_id`，不再依赖传入的 album id。
- 下载侧 `downloader._maybe_postprocess_images`：每章是独立下载任务、`comic.id == 章节id`，现有 `int(comic.id)` 自然正确；保留但增加注释说明依赖「章节任务的 id 即 photo id」这一前提。

## 6. IPC 变更

- `get_preview_urls`：多章节时返回 `chapters`（结构同 §3 TS 定义），`imageUrls` 为空（不预取全部章节）。单章节/其他来源不变。
- 新增 `get_chapter_preview_urls`：参数 `{ chapter_id, album_id }`，返回 `{ imageUrls, totalPages, scrambleId, comicId }`，其中 `comicId = chapter_id`（供前端反混淆用）。
- `download`：参数增加可选 `chapter_ids?: string[]`（选章下载）。缺省（无该参数或单章节）→ 退化为现有单本下载。每个 chapter_id → 一个独立下载任务。

同步波及面（IPC 新增方法的固定清单）：

- `shared/types.ts`：`IPCMethods`、`HcomicAPI`、`PYTHON_IPC_CHANNEL_MAP`、`IPC_CHANNELS`。
- `electron/main.ts` IPC 处理器、`electron/preload.ts`、`src/hooks/useIpc.ts`。
- 所有 `vi.mock('@/hooks/useIpc')` 的测试文件需补齐新方法的 mock（参考记忆中 `feedback_ipc-method-blast-radius`）。
- `tests/unit/main/ipc-channel-consistency.test.ts` 回归。

## 7. 阅读器 UI（B 首屏 + 边界翻章 + 底栏切章）

打开阅读器时：

- `chapters.length > 1` → 先显示「选章首屏」（章节列表，点击进入该章阅读）。
- 否则直接进入阅读（现状）。

阅读器状态新增：`chapters`、`currentChapterIndex`、按章缓存的图片数据。切章时调 `get_chapter_preview_urls` 拉取该章图片，`currentPage` 重置为 1，预览缓存按章清理/隔离。

切章机制（你选定的组合）：

- **边界翻章提示（B）**：单/双页模式下，处于本章末页继续前翻 → 浮层提示「→ 下一章」，再翻一次切换；处于首页后翻 → 「← 上一章」。滚动模式不做边界翻章（由底栏按钮覆盖）。到首/末章时不提示越界。
- **底栏两端按钮（C）**：底栏进度条两端放「‹ 上一章 / 下一章 ›」，各显示模式都可用；首章禁用「上一章」、末章禁用「下一章」。
- 顶栏标题显示「专辑名 · 章节名」。
- 未采纳顶栏章节下拉（A）。「回到选章首屏」可作为底栏一个次要入口（可选，实现时定）。

## 8. 下载（选章多选）

- 阅读语境：选章首屏单选，进入该章阅读。
- 下载语境（点下载按钮）：弹同样的章节列表但**支持多选**，勾选的每章 → 一个独立下载任务。
- 每个章节任务的 `ComicInfo`：`id = 章节id`、`title` 沿用专辑名、`comic_source = "JMCOMIC"`、`source_site = "jm"`、携带 `album_id` 与 `album_total_chapters`、`image_urls` 来自 `/photo/{章节id}`、`scramble_id` 来自该章。
- 输出路径：每专辑一个文件夹，章节为子项。
  - folder：`{专辑名}/{章节名}/`。
  - zip/cbz：`{专辑名} - {章节名}.{ext}`。
  - 章节名需经 `sanitize_filename`。
- 任务 id：现有 `task_id = {source_site}_{comic_source}_{id}`，因 `id` 用章节 id，各章天然不冲突。
- 单章节专辑 / 其他来源：行为不变（`id == album_id`、`album_total_chapters = 1`）。

## 9. 收藏「已下载」标记（全章完成判定）

判定规则：专辑的「已下载章数」≥「总章数」才标记为已下载。

- `download_history` 表新增列：`album_id TEXT`、`album_total_chapters INTEGER DEFAULT 1`。
- 旧记录 / 单章节 / 其他来源：`album_id = comic_id`、`album_total_chapters = 1`，旧的全本下载记录迁移后仍判定为已下载（向后兼容）。
- 下载时写入 `album_id` 与 `album_total_chapters`——下载前已解析专辑详情（为显示选章首屏），此时已知总章数，无需额外请求。
- `check_downloaded_batch`：收藏页传入的 key 是专辑级 `(source_site, album_id, comic_source)`。查询按 `album_id` 聚合，统计「output_path 仍存在」的章节记录数，`>= album_total_chapters` → `"downloaded"`，否则 `"unknown"`。**列表期零额外请求**。
- 注意 `__hash__` / 持久层一致性：参考记忆 `feedback_hash-default-persistence`，新增列不参与主键，主键仍为 `(source_site, comic_id, comic_source)`，多章节专辑会有多行（每章一行），靠 `album_id` 聚合。

## 10. 阅读历史（专辑一条，指向最后一章）

- 历史表新增列：`last_chapter_id TEXT`、`last_chapter_name TEXT`（非章节漫画为空字符串）。
- 每专辑仍一条记录（主键不变），记录最后阅读的章节 id/名 与页码。
- `add_history` IPC 参数增加可选 `last_chapter_id` / `last_chapter_name`。
- `useReaderStore.openReader` 增加可选 `initialChapterId`；从历史打开多章节漫画 → 跳到该章该页（先选章定位，再跳页）。
- 历史卡片展示：多章节时副标题显示「· {章节名}」。

## 11. 测试计划

- 新增多章节专辑 HTML fixture（当前 `tests/fixtures/html/jm_album_detail.html` 是单章节，缺多章节样本）。
- 解析层：`_parse_detail` 正确填充 `chapters`（index/name/id）；单章节专辑 `chapters` 为空且 `image_urls` 保持现状；`get_chapter_images` 返回该章图片与 scramble_id。
- 反混淆：`eps_id` 从图片 URL `/media/photos/(\d+)/` 提取；多章节场景下用章节 id 而非专辑 id。
- 下载：选章生成独立任务、输出路径命名（folder 与 cbz）、单章节回退不变。
- 收藏标记：全章完成判定（已下载章数 < / = / > 总章数三种情况）；旧记录默认 `album_total_chapters=1` 仍判定已下载。
- 历史：章节字段读写；从历史打开跳到指定章节页。
- IPC 一致性回归 `ipc-channel-consistency.test.ts`；所有 `vi.mock('@/hooks/useIpc')` 测试补齐新方法。
- 阅读器组件：选章首屏渲染、切章、边界翻章提示、底栏切章按钮首/末章禁用。

## 12. 假设与非目标

假设：

- 多章节 episode 选择器与参考项目一致（`div.episode ul a` / `data-album` / `data-index` / `h3`）。需用真实多章节专辑页校验后再最终确定 XPath。
- 选章首屏在「下载」与「阅读」两种语境下复用同一章节列表组件，仅多选/单选行为不同。

非目标：

- hcomic / moeimg 章节化。
- 「合并为一本」式下载。
- 章节级断点续传策略改动（沿用现有逐任务续传）。
- 章节列表的服务端分页（假设单页详情即可拿到全部章节，与参考项目一致）。

## 13. 数据库迁移注意事项

- `download_history` 与历史表新增列均用 `ALTER TABLE ... ADD COLUMN ... DEFAULT ...`，对旧库幂等升级；启动时检测列是否存在再决定是否 ALTER。
- 参考记忆 `feedback_sqlite-threading`：所有写操作走现有 `self._lock` + 单连接，不引入新连接。
