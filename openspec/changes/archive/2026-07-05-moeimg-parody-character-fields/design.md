## 上下文

`MoeImgParser._extract_manga_tags`（`sources/moeimg/parser.py:717-735`）当前用单一 `_extract_names` 通道收集 `detail_data.tags` / `detail.tags` / `detail_data.parody` / `detail.parody` / `detail_data.characters` / `detail.characters` / `chapter_detail.tags`，全部去重合并进 `ComicInfo.tags`。这导致：

- `ComicInfo.parodies` / `characters`（`models.py:63-65` 已存在）恒为空 `[]`。
- `ComicInfoDrawer.tsx:430-464` 已就位的"原著"（紫色 chip）/"角色"（青色 chip）分区因数据空而永远不渲染。
- 用户在抽屉"标签"区看到的是 parody ∪ characters ∪ plain tags 的大杂烩。

数据通路两侧已就绪：
- 后端：`models.ComicInfo` 已有 `parodies`/`characters`/`groups` 字段；`_comic_to_dict`（`python/ipc/search_mixin.py:94-96`）已转发这些字段到前端。
- 前端：`ComicInfo` 接口（`shared/types.ts`）已声明 `parodies?`/`characters?`/`groups?`；`ComicInfoDrawer.tsx` 已渲染这三类 chip 分区。

仅缺 parser 端把数据填进去并从 tags 剔除。

**关键约束**：moeimg 搜索结果 `ComicInfo.tags=[]`（`parser.py:214,692`），搜索屏蔽/推荐匹配（`SearchPage.tsx:353-363`）本就不依赖详情页 tags；抽屉 enrich 数据为 `ComicInfoDrawer` 的 local state，不回写搜索列表。因此 tags 内容变更对搜索过滤零影响。

## 目标 / 非目标

**目标：**
- 让 moeimg 详情的 Parody / Characters 实体填充 `ComicInfo.parodies` / `characters`，使前端抽屉既有"原著"/"角色"chip 分区自动显示。
- 让 `ComicInfo.tags` 对 moeimg 详情只含纯 tags（不再混入 parody / characters），消除抽屉里的重复显示。
- 复用现有的 `_extract_names` / `_dedupe_keep_order` 工具与 SPA + HTML 双路径采集模式，保持代码风格一致。

**非目标：**
- 不改动前端组件代码、IPC 序列化、其他来源 parser。
- 不改动搜索屏蔽/推荐匹配链路。
- 不重新设计 tag 体系（不引入 parody/character 的独立屏蔽语义）。
- 不改动 CBZ 元数据写入（`cbz_builder` 现状对 parodies/characters 的处理保持不变）。
- 不渲染封面图（用户已明确排除）。

## 决策

### 决策 1：拆分抽取而非新增标记位

**选择**：新增 `_extract_parodies(detail_data, detail)` 与 `_extract_characters(detail_data, detail)` 两个 classmethod，分别从 `detail_data`/`detail` 两层字典的 `parody` / `characters` 键抽取；`_extract_manga_tags` 同步瘦身，移除对 parody / characters 的合并。

**理由**：与既有 `_extract_names` + `_dedupe_keep_order` 模式同构，零新概念。每个实体类型一个抽取方法，职责单一，便于测试。

**替代方案**：让 `_extract_manga_tags` 返回一个 `(tags, parodies, characters)` 元组 → 引入多返回值耦合，调用方解构混乱，且 `_extract_manga_tags` 名字暗示单一职责，破坏可读性。否决。

### 决策 2：纯 tags 是否保留 `chapter_detail.tags`

**选择**：保留。`_extract_manga_tags` 瘦身后仍合并 `detail_data.tags` / `detail.tags` / `chapter_detail.tags` 三处纯 tags，去重。parody / characters 仅从 `detail_data` / `detail` 两层采集，**不**从 `chapter_detail` 采集。

**理由**：章节级数据（`chapter_detail`）一般不重新定义整部作品的原著/角色，但章节可能携带额外 tag。保持 tags 通道行为不变，parodies/characters 通道只读主详情数据，语义清晰。

### 决策 3：HTML 兜底路径同步扩展

**选择**：`_get_comic_detail_from_html` 在 `.manga-detail li` 节点遍历中，除现有 Category / Author / Language / Tags 四类识别外，新增识别 `Parody` / `Characters` 两类 `.md-title`，分别填入 `parodies` / `characters`（单节点可能含多个 `<a>`，全部抽取）。HTML 路径的 Tags 分支保持不变（只收集 `.md-title == "Tags"` 节点下的 `<a>`，本就不含 parody/characters）。

**理由**：HTML 是 SPA 不可用时的回退路径，与 SPA 路径采集范围应一致，否则会出现"SPA 模式有原著分区、HTML 模式没有"的不一致体验。

### 决策 4：去重策略

**选择**：parodies / characters 各自独立调用 `_dedupe_keep_order`，与 tags 通道的去重行为一致；parodies / characters / tags 三者之间**不做**交叉去重（即一个名字理论上可同时出现在 parody 和 tags，但实际上 parser 已从源头分离，不会发生）。

**理由**：交叉去重会增加耦合且无实际收益；从源头（_extract_manga_tags 不再读 parody/characters）已保证三者数据互斥。

## 风险 / 权衡

- **[风险] 历史下载记录的 CBZ ComicInfo.xml 中 parodies/characters 为空** → 本次只改详情页采集，不影响已落盘 CBZ；用户重新下载才获得新字段。可接受（无迁移价值）。
- **[风险] HTML 页面 `.md-title` 文案在未来变更** → 现有 Category/Author/Language/Tags 识别已硬编码同样文案，新增 Parody/Characters 沿用相同模式；若 moeimg 改版需同步调整，属既有维护成本，不新增风险面。
- **[权衡] tags 不再含 parody/characters，可能让习惯了"在标签区点 parody 搜索"的用户短暂困惑** → 抽屉顶部新增的"原著"/"角色"紫色/青色 chip 同样可点击触发 tag 搜索（`handleSearch(parody, 'tag')`，见 `ComicInfoDrawer.tsx:437/455`），功能等价且视觉更清晰。可接受。
- **[权衡] `_extract_manga_tags` 的 `chapter_detail` 参数继续保留** → 仅用于合并 `chapter_detail.tags`，不破坏现有调用签名。
