## 1. 修复屏蔽占位符封面变体的内容区结构

- [x] 1.1 在 `src/pages/SearchPage.tsx` 的 `BlockedPlaceholder` 组件封面变体分支（`cardStyle !== 'detailed'` 的 return），将内容区容器的 padding 由 `p-3` 改为 `p-2`，与正常 `CoverCard`（`ComicCard.tsx` line 224）对齐。
- [x] 1.2 为该分支的标题容器补上 `min-h-[2.5rem]` 最小高度类，与正常 `CoverCard` 标题（`ComicCard.tsx` line 230）的 `min-h-[2.5rem]` 一致。
- [x] 1.3 在该分支标题下方补一个空作者占位行：`<p className="text-xs text-[var(--text-secondary)] mt-0.5 h-4 truncate select-none">{'\u00A0'}</p>`，与正常 `CoverCard` 作者栏（`ComicCard.tsx` line 235-237）的 `h-4 mt-0.5` 高度对齐；**不**渲染任何作者文字。
- [x] 1.4 保留屏蔽占位符的现有简化语义：标题 `line-through`、封面区 🚫 图标与「已屏蔽」标签、外层 `opacity-50`、点击标题打开详情抽屉逻辑——本组任务不改动这些。

## 2. 补充渲染测试断言高度结构对齐

- [x] 2.1 在 `tests/unit/pages/SearchPage.test.tsx` 新增测试用例：封面模式下，当某漫画命中 tag 黑名单被渲染为屏蔽占位符时，断言占位符的内容区容器含 `p-2`（非 `p-3`）、标题容器含 `min-h-[2.5rem]`、且标题下方存在一个 `h-4` 占位行。复用现有的 `tagBlacklist` + `filterEnabled: true` mock 模式（参考 line 903-923 的「被黑名单屏蔽的漫画不高亮」用例）。
- [x] 2.2 在同一测试文件补充断言：屏蔽占位符**不**渲染作者文字（占位行仅含 `\u00A0`），并保留 `line-through` 标题样式——锁定「简化视觉语义」需求，防止回归成正常卡片信息密度。

## 3. 验证

- [x] 3.1 运行 `npm test`（前端测试），确认新增的屏蔽占位符测试通过且无回归。
- [x] 3.2 运行 `npx tsc --noEmit`（TypeScript 类型检查）通过。
- [x] 3.3 运行 `npm run lint`（ESLint）通过。
- [x] 3.4 运行 `npm run lint:test-quality`（测试质量闸门）通过——确保新增测试不是「仅断言 mock 被调用」的裸断言，而是真实校验渲染 DOM 结构。
