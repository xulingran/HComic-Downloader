## 上下文

阅读器翻页动画由 `src/lib/anim.ts` 的 `getDirectionalPageVariants()` 定义，并在 `src/components/PageFlipView.tsx` 中通过 `AnimatePresence` + `motion.div` 消费。现有 `ui-animation` 规范已经要求 single / double 模式翻页使用 smooth 曲线并禁止 spring overshoot，但当前普通动画路径没有在 variants 中显式声明 `transition`，导致 framer-motion 使用默认 spring。

这属于实现与既有规范不一致的回归：reduced-motion 路径已有显式 transition，Tab 页面切换也正确使用 `smoothTransition`；只有阅读器普通横向翻页路径遗漏了 transition。

## 目标 / 非目标

**目标：**

- 让阅读器 single / double 翻页的普通路径显式使用 `smoothTransition`，避免默认 spring 的 overshoot 与回弹。
- 为进入/退出状态增加轻微 opacity 变化，使翻页时新旧页切换更柔和。
- 通过单元测试锁定 `getDirectionalPageVariants()` 的 transition 与 opacity 行为，防止后续重构再次遗漏。
- 保持 PageFlipView 的现有数据流与方向推断机制不变。

**非目标：**

- 不重构 `PageFlipView` 的布局、翻页触发路径、双页页码计算或空白页逻辑。
- 不改变 scroll 模式行为。
- 不改变 reduced-motion 的无位移 crossfade 退化路径。
- 不引入新的动画依赖或全局 MotionConfig。

## 决策

1. **复用现有 `smoothTransition`，不恢复独立 `pageFlipTransition` 常量。**
   - 现有动画体系已经将平移类动画集中到 `smoothTransition`（300ms，cubic-bezier(0.4, 0, 0.2, 1)）。
   - Tab 页面切换也使用该 transition；阅读器翻页复用它可保持项目节奏一致。
   - 备选方案是恢复早期 commit 中的 250ms `pageFlipTransition`，但这会重新引入一个仅服务单处的过渡常量，增加维护成本。

2. **在 directional page variants 的 center 与 exit 上显式声明 transition。**
   - enter 只描述初始状态；实际进入动画由 enter → center 完成，因此 center 需要 `transition: smoothTransition`。
   - exit 负责旧页滑出，必须同样显式使用 `smoothTransition`，避免退出段回退到默认 spring。

3. **轻微 opacity 只用于普通路径的进入/退出端点。**
   - enter / exit 使用接近 1 的 opacity（例如 0.92），center 保持 1。
   - 这比从 0 完全淡入更克制，不会让图片在翻页过程中明显闪烁，同时能降低新旧页满不透明叠加时的生硬感。
   - reduced-motion 路径保留现有纯 opacity crossfade，不与普通路径共用该轻微 opacity 参数。

4. **测试直接覆盖 `getDirectionalPageVariants()`，而非依赖 DOM 动画。**
   - DOM 动画在 jsdom 中难以可靠观察；直接断言 variants 的返回值更稳定。
   - 测试重点是防止 transition 再次缺失，以及确认方向位移、opacity 端点和 reduced-motion 无位移行为。

## 风险 / 权衡

- **风险：翻页节奏从原规范的“约 250ms”变为 300ms。** → 将规范更新为使用项目共享 `smoothTransition` / `DURATION.slow`，与 Tab 切换和当前动画令牌一致。
- **风险：opacity 变化可能在深色背景上产生轻微闪烁感。** → 使用接近 1 的端点值，只做轻微柔化；如验证中闪烁明显，可调整为 0.96 或回退到纯位移。
- **风险：测试过度绑定实现细节。** → 该 bug 本质就是 variants 漏写 transition，直接测试共享动画 API 是合理的回归保护；不测试 framer-motion 内部行为。
