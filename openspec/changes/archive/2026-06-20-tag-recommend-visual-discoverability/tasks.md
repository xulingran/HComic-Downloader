## 1. CoverCard 推荐态升级为整圈高亮

- [x] 1.1 修改 `src/components/common/ComicCard.tsx` CoverCard(L198 附近):将推荐态从 `border-l-2 border-l-amber-400/70` 改为整圈琥珀高亮。最初用 `ring` 实现但发现外环会溢出视口(卡片紧贴窗口边缘时),最终改为 `bg-amber-500/10 shadow-[inset_0_0_0_2px_rgba(245,158,11,0.8)]`(内描边,不溢出)。渲染条件中加入 `!selected` 守卫
- [x] 1.2 核对 CoverCard 推荐态 className 不再包含 `border-l-amber-400`,确认 selected 态的 `ring-2 ring-[var(--accent)]` 逻辑保持不变

## 2. DetailedCard 推荐态加粗左边框并补背景色

- [x] 2.1 修改 `src/components/common/ComicCard.tsx` DetailedCard(L259 附近):将推荐态从 `border-l-2 border-l-amber-400/70` 改为 `border-l-4 border-l-amber-400 bg-amber-500/10`(实色 4px 边框 + 加深背景),保留现有 `isRecommended && !selected` 守卫
- [x] 2.2 核对 DetailedCard 命中 tag 的琥珀色样式逻辑(`bg-amber-500/15 text-amber-600`)保持完全不变(规范明确禁止改动)

## 3. 测试更新

- [x] 3.1 更新 `tests/unit/components/common/ComicCard.test.tsx` 中"CoverCard: isRecommended"用例:断言改为 `bg-amber-500/10` + `shadow-[inset_0_0_0_2px_rgba(245,158,11,0.8)]`
- [x] 3.2 更新"CoverCard: 未推荐时不显示"用例:断言不含 `bg-amber-500/10` 与 `shadow-[inset_0_0_0_2px`
- [x] 3.3 新增"CoverCard: selected+recommended 叠加时只显示选中环"用例:断言只含 `ring-[var(--accent)]`,不含 `bg-amber-500/10` 或 `shadow-[inset_0_0_0_2px`(覆盖决策 4 的守卫)
- [x] 3.4 更新"DetailedCard: isRecommended"用例:断言改为 `border-l-4 border-l-amber-400` + `bg-amber-500/10`
- [x] 3.5 核对"DetailedCard: selected 状态下不叠加推荐边框"用例与命中 tag 样式用例不受影响,仍通过

## 4. 验证

- [x] 4.1 运行 `npm test` 确认 ComicCard 测试全部通过
- [x] 4.2 运行 `npm run lint` 确认无 ESLint 错误
- [x] 4.3 运行 `npx tsc --noEmit` 确认无类型错误
- [x] 4.4 手动验证:`npm run dev` 后在搜索页开启标签推荐高亮,观察网格视图(CoverCard)推荐卡片呈现整圈琥珀内描边 + 微背景,选中后切换为 accent 色;切换 detailed 视图观察加粗左边框效果
