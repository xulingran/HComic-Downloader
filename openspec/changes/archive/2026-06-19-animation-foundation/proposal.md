## 为什么

当前项目的动画系统缺乏统一的设计语言：`tailwind.config.js` 只扩展了颜色令牌，没有任何动画相关 token（duration / easing / keyframes），导致 `duration-200`、`duration-300`、`ease-out` 等魔法数字散落在 35+ 个文件中，调整一处就要全局搜索替换。同时，代码库中**零处**提及 `prefers-reduced-motion`，对前庭功能障碍、注意力敏感、低性能机器的用户完全不友好——这是可访问性债，也是 Windows「显示动画」系统开关无法生效的原因。

此外，进出场动画逻辑重复实现：`useModalAnimation` 已经抽好 hook，但 `Toast.tsx` 又自己实现了一遍同样的 mounted/visible 双态 + rAF（且行 64 的 className `translate-y-*` 被内联 style 完全覆盖，是死代码）。后续变更需要进入「列表进出场」「阅读器翻页过渡」等高级动画场景，必须先有一个**单一来源的动画基础设施**作为地基。

本变更是整个动画优化工程（共 6 个变更）的**关键路径起点**——后续 5 个变更全部依赖此处的令牌、reduced-motion 兜底与 framer-motion 引入。

## 变更内容

- **令牌化**：在 `tailwind.config.js` 的 `theme.extend` 中新增动画令牌：
  - `transitionDuration`: `{ fast: '150ms', base: '200ms', slow: '300ms', slower: '450ms' }`
  - `transitionTimingFunction`: `{ spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)', smooth: 'cubic-bezier(0.4, 0, 0.2, 1)', standard: 'ease-out' }`
  - `keyframes`: `fade-in`、`slide-up`、`slide-down`、`scale-in`、`shimmer`（供后续变更复用）
- **reduced-motion 兜底**：在 `src/styles/index.css` 末尾新增 `@media (prefers-reduced-motion: reduce)` 全局规则，把所有 `animation-duration` 与 `transition-duration` 压到 `0.01ms`，作为**最后一道防线**（后续即使有组件忘记处理，系统级兜底仍然生效）。
- **引入 framer-motion**：`npm install framer-motion`。新增 `src/lib/anim.ts`，集中导出共享 variants（`springTransition`、`standardTransition`、`reducedSafeTransition`）、共享 duration 常量、以及 `useReducedMotion` 的薄封装。
- **统一 presence hook**：新增 `src/hooks/usePresenceAnimation.ts`，基于 framer-motion 的 `AnimatePresence` + `useReducedMotion` 思路，替代 `useModalAnimation`。保留旧 hook 作为内部实现委托，避免一次性改动过大（迁移留待变更 2）。
- **`transition-all` 清理**：把 `ComicCard`、`Sidebar`、`PaginationControls`、`BatchControls` 等处的 `transition-all` 替换为精确的 `transition-[property]`（参考 `CircularProgress` 已经做对的 `transition-[stroke-dashoffset]`），降低浏览器属性比对开销。
- **Toast 死代码清理**：删除 `Toast.tsx:64` 被 inline style 覆盖的 `translate-y-*` className（不迁移逻辑，逻辑迁移留待变更 2）。

## 功能 (Capabilities)

### 新增功能
- `ui-animation`: 项目动画基础设施——令牌、reduced-motion 兜底、共享 variants、统一 presence hook。定义令牌命名约定、reduced-motion 行为契约、`anim.ts` 公共 API。

### 修改功能
<!-- 无。本变更不触及任何功能规范级需求，仅引入基础设施。 -->

## 影响

- 受影响文件：`tailwind.config.js`、`src/styles/index.css`、`package.json` / `package-lock.json`、新增 `src/lib/anim.ts`、新增 `src/hooks/usePresenceAnimation.ts`；以及 `ComicCard.tsx`、`Sidebar.tsx`、`Toast.tsx`、`PaginationControls.tsx`、`BatchControls.tsx` 等涉及 `transition-all` 或死代码清理的组件。
- 新增依赖：`framer-motion`（~32 KB 未压缩，gzip ~10 KB）。Electron 桌面应用对包体积不敏感。
- **不改变任何用户可见行为**：令牌化与 reduced-motion 兜底对所有现有动画是「等价升级」，唯一新增的行为是当系统开启「减少动画」时全局生效。
- 不影响：IPC 通道、Python 后端、Zustand store 结构、shared types。
- 风险：低。本变更属于纯基础设施引入 + 局部清理，不触及业务逻辑。`useModalAnimation` 与 `Toast` 的内部实现保持不变，迁移留待变更 2。
- 后续依赖：变更 2 / 3 / 4 / 5 全部依赖此处的令牌、framer-motion、`usePresenceAnimation`。
