## 1. 分档工具与常量

- [x] 1.1 在 `src/components/NhEntryGrid.tsx` 顶部定义档位常量 `TIER_HEAD = 5`、`TIER_MID = 5`，并定义 `type TagTier = 'head' | 'mid' | 'tail'`
- [x] 1.2 实现纯函数 `classifyTier(index: number, total: number, allCountsZero: boolean): TagTier | null`：当 `allCountsZero` 为 true 时返回单一中性档（视作 'tail' 样式或新增 'flat' 档，统一中性渲染）；否则按 `index < TIER_HEAD` → head、`< TIER_HEAD+TIER_MID` → mid、其余 → tail；当 `total <= TIER_HEAD` 时全部归入 head
- [x] 1.3 为 `classifyTier` 编写单元测试（覆盖：充足数量三档、总数=5 恰好填满头部、总数<5 全归头部、总数=10 无长尾、count 全零退化），放入 `tests/unit/components/NhEntryGrid.test.tsx`（若不存在则创建）

## 2. 视觉权重映射

- [x] 2.1 定义档位样式映射（可为对象 `TIER_STYLE: Record<TagTier, { wrapper, badge }>`）：head = `bg-[var(--accent)] text-white text-sm font-medium` + 计数徽章 `bg-white/20 rounded-full px-1.5 text-xs font-semibold`；mid = `bg-[var(--accent)]/10 text-[var(--accent)] text-sm` + 计数 `ml-1.5 text-xs font-medium text-[var(--accent)]/70`；tail = `bg-[var(--bg-secondary)] text-[var(--text-primary)] text-xs` + 计数 `ml-1 text-[10px] text-[var(--text-secondary)]`
- [x] 2.2 hover 态映射：head `hover:bg-[var(--accent-hover)]`、mid `hover:bg-[var(--accent)]/20`、tail `hover:bg-[var(--accent)]/15`，统一 `transition-colors`
- [x] 2.3 编写测试断言三档标签的 class 包含对应底色 token（如 head 含 `bg-[var(--accent)] text-white`、mid 含 `bg-[var(--accent)]/10`、tail 含 `bg-[var(--bg-secondary)]`），使用 `toHaveAttribute('class', expect.stringContaining(...))` 或 `querySelector` + class 断言

## 3. 渲染分层结构

- [x] 3.1 将原 `tags.map(...)` 单层 `flex flex-wrap` 改为按档位分组：计算 `head = tags.slice(0, TIER_HEAD)`、`mid = tags.slice(TIER_HEAD, TIER_HEAD+TIER_MID)`、`tail = tags.slice(TIER_HEAD+TIER_MID)`，当 `allCountsZero` 或 `tags.length <= TIER_HEAD` 时合并为单一组
- [x] 3.2 每档渲染为独立 `<div className="flex flex-wrap gap-2">`，档位之间用 `space-y-3` 或分隔间距区隔；保留每档内按 `count` 降序（IPC 已排序，slice 即可）
- [x] 3.3 计数渲染按档位差异化：head 用徽章 `<span className="ml-1.5 ...badge...">{formatCount(count)}</span>`、mid/tail 用内联 span；`formatCount` 函数保持不变
- [x] 3.4 标题区改为：标题 `🔥 热门标签`（emoji + 文案）、副文案 `按热度排序 · 共 {tags.length} 个`（当 `tags.length > 0` 时）；刷新按钮位置与文案不变

## 4. 动画与 reduced-motion 退化

- [x] 4.1 引入 `motion` from `framer-motion`、`tagListVariants`、`tagItemVariants`、`useReducedMotionPreference` from `../lib/anim`
- [x] 4.2 每档容器：`reduceMotion ? <div> : <motion.div variants={tagListVariants} initial="hidden" animate="show">`；每档内标签：`reduceMotion ? <button> : <motion.button variants={tagItemVariants}>`，标签 onClick/onSelectTag 契约不变
- [x] 4.3 刷新重放动画：新增 `refreshKey` state（初始 0），`handleRefresh` 成功后 `setRefreshKey(k => k+1)`；给三个档位容器或外层包裹 `<AnimatePresence>` / 在容器 `key` 上绑定 `refreshKey`，使刷新后新数据重新触发 stagger（注意：key 变化会触发 exit 动画，需测试是否需要 `mode="wait"`）
- [x] 4.4 编写测试：reduced-motion（mock `useReducedMotionPreference` 返回 true）时渲染的标签为普通 `<button>` 且无 motion 属性；正常时为 motion.button（可通过检查是否传入 `variants` prop 或用 `data-testid` + 渲染数量断言）
- [x] 4.5 编写测试：刷新后 `refreshKey` 递增且标签列表更新（mock getTagList 两次返回不同数据，断言第二次数据渲染）

## 5. 空状态与边界

- [x] 5.1 保留 loading 态（`加载标签中...`）与空数据态（`暂无标签数据，请先点击刷新热门标签` + error 展示）逻辑不变
- [x] 5.2 处理 `tags.length === 0` 时不渲染档位容器（已有分支覆盖，确认不回归）
- [x] 5.3 处理 `count` 全零场景：计算 `allCountsZero = tags.every(t => !t.count || t.count === 0)`，为 true 时全部按 tail 样式单组渲染，不分档
- [x] 5.4 编写测试：count 全零时所有标签渲染为中性 tail 样式（无 accent 实心底）

## 6. 集成验证与回归

- [x] 6.1 运行 `npx tsc --noEmit` 确认无类型错误（framer-motion 导入、TagTier 类型、props 契约）
- [x] 6.2 运行 `npm test` 确认前端测试全绿，重点检查 `tests/unit/pages/SearchPage.test.tsx` 中 NH 入口页相关用例（"clicks NH entry hot tag as tag search" 等）不回归
- [x] 6.3 运行 `npm run lint` 确认 ESLint（含 test-quality 自定义规则）通过——注意新增测试不得是「仅断言 mock 被调用」的裸断言，必须验证真实渲染行为（class、DOM 结构、计数显示）
- [x] 6.4 运行 `npm run lint:test-quality` 确认测试质量闸门通过
- [x] 6.5 手动目检（`npm run dev`）：light/dark 双主题下三档视觉层级清晰，头部实心强调底可读，dark 模式下不过亮（若过亮按 design 风险项改用 `accent-hover`）— 用户视觉验证通过
- [x] 6.6 手动目检：刷新按钮点击后标签重新 stagger 进场；reduced-motion（系统设置「减少动态效果」）下退化为纯淡入 — 用户视觉验证通过
