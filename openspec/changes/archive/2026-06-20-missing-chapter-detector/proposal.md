## 为什么

收藏夹是用户追连载的主要阵地。用户常常只点了部分章节收藏，事后无法快速发现"这个系列我到底收齐没有"。当前工具箱只有重复检测（找多收），缺少反向能力（找漏收）。

本次变更复用重复检测的相似度聚类算法层，把收藏夹中"疑似同系列"的条目聚合展示，让用户自己判断是否漏收，并为每组提供"搜索此系列"入口——一键跳转搜索页用作品名搜索，方便用户在搜索结果里找补漏的。

**v1 方向调整记录**：初版尝试用"序号提取 + 缺失推断"自动报告"缺第 N 话"，但真实收藏夹标题命名习惯过于多样（LEVEL:N / #N / 其のN / (N) 等），序号提取覆盖率无法做到可靠，导致大量组"无任何序号被提取"。v2 转向更务实的方案：复用聚类做"同系列聚合展示"，让用户人工判断 + 一键搜索补全，绕开序号提取的死结。

## 变更内容

- **新增「查缺补漏」工具**：工具箱第 4 个入口，与重复检测并列。
- **纯收藏夹视角**：唯一数据源是 `getFavourites` 分页拉取的收藏项；**不读 `download_history`、不探测硬盘文件**。
- **同系列聚合（复用聚类）**：复用 `findDuplicateGroups`（LCS≥0.6 + 并查集）将收藏项按标题相似度归为同系列组，所有来源统一适用。
- **一键搜索补全**：每组提供「搜索此系列」按钮，点击后用 `extractAlbumTitle` 提取的系列名（经清洗剥离版本/序号标记）调用 `setPendingSearch`，复用项目既有的 pendingSearch 机制自动跳转搜索页执行搜索。
- **人工判断而非自动断言**：不尝试自动报告"缺第 N 话"。系统只负责把同系列聚到一起 + 提供搜索入口，是否漏收由用户核对。
- **复用但不耦合**：100% 复用 `normalizeTitle` / `lcsRatio` / `findDuplicateGroups` / `extractAlbumTitle` 等纯函数；UI 作为独立组件 `MissingChapterDetector`，fork 重复检测的骨架而非修改它。重复检测功能本身**不受任何影响**。

## 功能 (Capabilities)

### 新增功能

- `missing-chapter-detector`: 工具箱「查缺补漏」工具。扫描收藏夹，按相似度聚类找出疑似同系列组并聚合展示，每组提供「搜索此系列」入口（提取系列名 → 清洗 → 跳搜索页）。纯前端、纯收藏夹视角、所有来源统一软路线、人工判断为主。

### 修改功能

<!-- 无。重复检测（duplicate-detector）规范层不变，仅作为算法层的复用来源，不修改其任何需求。 -->

## 影响

- **前端（新增）**：
  - `src/components/tools/MissingChapterDetector.tsx`（新）—— 主组件，fork `DuplicateDetector` 骨架。
  - `src/components/tools/MissingGroup.tsx`（新）—— 单组渲染，含「搜索此系列」按钮 + 系列名清洗逻辑。
  - `src/pages/ToolboxPage.tsx`（改）—— 第 4 个入口。
- **复用（不修改）**：`src/utils/titleSimilarity.ts` 的 `findDuplicateGroups` / `extractAlbumTitle` / `normalizeTitle` / `lcsRatio`；`useFavourites` 分页拉取模式；`useDrawerStore` 的 `setPendingSearch` + `App.tsx` 的 pendingSearch 自动跳页机制（先例：`ComicInfoDrawer`）。
- **后端**：无改动。本功能纯前端，不新增任何 IPC 方法。
- **配置**：不引入新的持久化配置。
- **测试**：新增 `MissingChapterDetector` 组件测试；复用既有 `titleSimilarity` 测试作为聚类与系列名提取的回归保障。
