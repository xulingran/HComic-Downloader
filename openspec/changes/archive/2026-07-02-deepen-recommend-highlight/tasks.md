# 实现任务

## 1. CoverCard（封面网格视图）色值加深

- [x] 1.1 在 `src/components/common/ComicCard.tsx` 第 198 行，将 CoverCard 推荐态背景 `bg-amber-500/10` 改为 `bg-amber-500/15`
- [x] 1.2 同行将内描边 shadow 色值从 `shadow-[inset_0_0_0_2px_rgba(245,158,11,0.8)]` 改为 `shadow-[inset_0_0_0_2px_rgba(217,119,6,0.9)]`（amber-500 RGB → amber-600 RGB，不透明度 0.8 → 0.9）

## 2. DetailedCard（列表视图）色值加深

- [x] 2.1 在 `src/components/common/ComicCard.tsx` 第 259 行，将左边框色阶从 `border-l-amber-400` 改为 `border-l-amber-500`（保持 `border-l-4`）
- [x] 2.2 同行将推荐态背景 `bg-amber-500/10` 改为 `bg-amber-500/15`

## 3. 标签 chip 色值加深（卡片 + 抽屉两处）

- [x] 3.1 在 `src/components/common/ComicCard.tsx` 第 308 行（DetailedCard 内 tag chip），将 `bg-amber-500/15 text-amber-600` 改为 `bg-amber-500/20 text-amber-700`，并将 hover `hover:bg-amber-500/25` 改为 `hover:bg-amber-500/30`
- [x] 3.2 在 `src/components/ComicInfoDrawer.tsx` 第 544 行，将命中推荐 tag 的 chip 样式从 `bg-amber-500/15 text-amber-600 hover:bg-amber-500/25` 改为 `bg-amber-500/20 text-amber-700 hover:bg-amber-500/30`，与卡片 chip 保持一致

## 4. 验证

- [x] 4.1 运行 `npx tsc --noEmit` 确认无类型错误
- [x] 4.2 运行 `npm run lint` 确认 ESLint 通过
- [x] 4.3 运行 `npm test`，若存在断言推荐高亮 class 名的测试用例则同步更新色值断言
- [x] 4.4 手动在深色模式下验证：搜索页 CoverCard 推荐态内描边与背景、DetailedCard 左边框与背景、tag chip 三处色值均加深且与抽屉 chip 一致，且推荐+选中叠加时仍只显示选中态
