## 1. 纯函数复用验证

- [x] 1.1 确认 `src/utils/titleSimilarity.ts` 的 `findDuplicateGroups` / `extractAlbumTitle` / `normalizeTitle` / `lcsRatio` 无需修改，可直接导入复用
- [x] 1.2 运行既有 `titleSimilarity` 测试确认无回归（聚类与系列名提取行为不变）
- [x] 1.3 验证 `extractAlbumTitle` 对真实 LEVEL 系列的提取行为，确认需要清洗步骤剥离版本标记

## 2. UI：单组渲染组件

- [x] 2.1 创建 `src/components/tools/MissingGroup.tsx`，fork `DuplicateGroup.tsx` 的可折叠卡片骨架，内容区展示组内成员（封面 + 标题）
- [x] 2.2 实现 `cleanSeriesNameForSearch`：剥离方括号标记（[中国翻訳] [DL版] 等）+ 行尾序号标记（LEVEL:N / 第N话 / #N / 其のN）
- [x] 2.3 实现组头部「搜索此系列」按钮：用 `extractAlbumTitle` 提取系列名 → 清洗 → 调 `setPendingSearch(name, 'keyword')`
- [x] 2.4 搜索词清洗后长度 < 2 或提取失败时禁用按钮
- [x] 2.5 保留点击漫画打开详情抽屉/阅读器的能力（与 DuplicateGroup 一致）
- [x] 2.6 不展示相似度百分比（语义无关）

## 3. UI：主组件

- [x] 3.1 创建 `src/components/tools/MissingChapterDetector.tsx`，fork `DuplicateDetector.tsx` 骨架（来源切换、状态机、分页拉取、进度文案、错误/空态文案）
- [x] 3.2 实现分页拉取：逐页串行调用 `getFavourites`，累计 `allComics`，按钮文案显示"正在获取第 N/M 页..."
- [x] 3.3 实现单页失败跳过与失败页计数，结果区显示"警告：N 页数据获取失败，结果可能不完整"
- [x] 3.4 实现聚类调用：拉取完成后调用 `findDuplicateGroups(allComics)` 得到同系列组
- [x] 3.5 展示所有组（v2：不再过滤"有缺失的组"，全部展示供用户判断）
- [x] 3.6 实现未登录处理：`needsLogin` 为 true 时显示"请先登录当前来源"
- [x] 3.7 实现空态：无相似度达标组时显示"未发现疑似同系列的收藏"；初始态显示"选择来源并点击开始检测"
- [x] 3.8 在结果区块顶部展示免责声明"同系列判定基于标题相似度推测，是否漏收请自行核对"
- [x] 3.9 确保本组件状态与 `DuplicateDetector` 完全隔离（独立 state）

## 4. UI：工具箱入口

- [x] 4.1 在 `src/pages/ToolboxPage.tsx` 的 `SECTIONS` 数组追加第 4 项 `{ id: 'missing', label: '查缺补漏', icon: '🔍' }`
- [x] 4.2 在区块容器追加 `<div id="section-missing"><MissingChapterDetector /></div>`
- [x] 4.3 验证点击导航平滑滚动到查缺补漏区块且短暂高亮（复用既有 `handleSectionClick` 逻辑）

## 5. 清理 v1 残留代码

- [x] 5.1 删除 `src/utils/chapterIndex.ts`（v1 序号提取，v2 不再使用）
- [x] 5.2 删除 `src/utils/missingChapters.ts`（v1 缺失推断，v2 不再使用）
- [x] 5.3 删除对应测试文件 `tests/unit/utils/chapterIndex.test.ts` 与 `tests/unit/utils/missingChapters.test.ts`

## 6. 组件测试

- [x] 6.1 编写 `tests/unit/components/MissingChapterDetector.test.tsx`，覆盖：初始引导态、来源切换、检测进度文案、未登录提示、空态文案、免责声明渲染、组渲染、搜索按钮存在性
- [x] 6.2 覆盖「搜索此系列」点击行为：调用 `setPendingSearch` 传入清洗后的系列名
- [x] 6.3 覆盖真实 LEVEL 系列回归：搜索词剥离 [中国翻訳] [DL版] 与 LEVEL:N，保留作品名主体
- [x] 6.4 编写 `tests/unit/pages/ToolboxPage.test.tsx` 的补充用例：第 4 个导航项存在、section-missing 锚点存在

## 7. 完整验证流程

- [x] 7.1 `npx tsc --noEmit`（TypeScript 类型检查）
- [x] 7.2 `npm test`（前端测试，含新增组件测试）
- [x] 7.3 `npm run lint`（JS/TS lint）
- [x] 7.4 手动抽样验证：在真实收藏夹上运行，确认聚类分组合理、搜索词清洗正确、搜索跳转正常
