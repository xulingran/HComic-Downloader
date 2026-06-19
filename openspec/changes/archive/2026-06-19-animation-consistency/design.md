# 设计：动画一致性与质感（animation-consistency）

本设计解释为什么把 4 个弹窗统一到 framer-motion，以及迁移的具体策略。实现细节见 `tasks.md`，行为契约见 `specs/ui-animation/spec.md` 的 `## 修改需求` 增量。

## 上下文与约束

探查代码库得到的关键事实：

- **4 个容器级弹窗**，3 套进出场实现并存：
  - `Modal.tsx` + `ComicInfoDrawer.tsx` + `ComicReaderModal.tsx` 共用 `useModalAnimation`（变更 1 已委托给 `usePresenceAnimation`）
  - `Toast.tsx` 自管 mounted/visible + rAF（与 hook 不统一）
- **时长与曲线不一致**：
  - Modal 内层：`duration-200 ease-out`（变更 1 改为 `duration-slow ease-spring`）
  - ComicInfoDrawer：`duration-300 ease-out`
  - ComicReaderModal：`duration-300 ease-out`，垂直滑入
  - Toast：`duration-300 ease-out`（变更 1 改为 `duration-slow ease-spring`）
- **ComicInfoDrawer 内有嵌套 Modal**（confirmTag 弹窗），zIndex=60 覆盖在 Drawer 之上
- **Modal 的安全遮罩点击**（方案 A）依赖 mousedown/click 落点判定，迁移时必须保留
- **变更 1 已引入** framer-motion 12.40、`anim.ts`（variants/transition 工厂）、`usePresenceAnimation`

## 关键设计决策

### 决策 1：用 framer-motion 的 `AnimatePresence` 替代手动 mounted/visible

**选择**：4 个弹窗全部迁移到 `<AnimatePresence>` 包裹，子元素用 `motion.div` + `initial/animate/exit` variants。

**理由**：
- `AnimatePresence` 自动处理「卸载时等 exit 动画结束再 unmount」，比手写 `handleTransitionEnd` + `mounted` state 简洁可靠
- variants 集中在 `anim.ts`，4 个弹窗共享同一份定义
- 与 usePresenceAnimation 的旧模式相比，代码量减半（不再需要 mounted + visible + handleTransitionEnd 三件套）

**反例**：继续用 usePresenceAnimation + transition className——虽然能工作，但 4 个组件各自维护 transition class 仍然分散，且无法用 spring 物理曲线（CSS cubic-bezier 只是近似）。

### 决策 2：删除 `usePresenceAnimation` 与 `useModalAnimation`

**选择**：迁移完成后删除两个 hook 文件。

**理由**：
- 迁移后没有任何代码 import 它们（4 个调用方全部切到 AnimatePresence）
- 保留死代码会混淆后续维护者
- 变更 1 标注的 `@deprecated` 就是为了这一刻

**反例**：保留 hook 作为「fallback」——没人会再用，纯负担。

**风险与缓解**：`Modal.test.tsx:106` 依赖 rAF 时序假设。迁移到 AnimatePresence 后，测试需要改成「等待 motion 动画完成」的断言模式（用 `findByTestId` 轮询）。这是必须同步更新的测试。

### 决策 3：统一 variants，但保留各自的运动方向

**选择**：`anim.ts` 提供 3 套 variants：

```ts
// 弹窗内层：scale + opacity（Modal、Drawer 内嵌 Modal）
modalPresenceVariants: { initial: {opacity:0, scale:0.95}, animate: {opacity:1, scale:1}, exit: {opacity:0, scale:0.95} }

// 抽屉：水平滑入（ComicInfoDrawer 从右滑入）
drawerPresenceVariants: { initial: {x:'100%'}, animate: {x:0}, exit: {x:'100%'} }

// 阅读器：垂直滑入（ComicReaderModal 从下滑入，保留现有方向）
readerPresenceVariants: { initial: {y:'100%'}, animate: {y:0}, exit: {y:'100%'} }

// Toast：上方滑入（保留现有方向）
toastPresenceVariants: { initial: {y:'-1rem', opacity:0}, animate: {y:0, opacity:1}, exit: {y:'-1rem', opacity:0} }
```

**理由**：不强求所有弹窗用同一种运动——Drawer 从右滑、Reader 从下滑、Modal 用 scale，这些方向有语义意义（Drawer 在右侧、Reader 占满全屏、Modal 居中）。统一的是**曲线（spring）+ 时长（slow=300ms）+ reduced-motion 退化（纯 opacity）**，不是运动方向。

**反例**：强行让所有弹窗都用 scale——会破坏 Drawer 的「从右滑出」物理直觉。

### 决策 4：ComicInfoDrawer 的 tag 列表加 staggerChildren

**选择**：Drawer 内的 tag 列表容器用 `motion.div` + `variants={{ show: { transition: { staggerChildren: 0.03 } } }}`，每个 tag 用 `motion.button` + `variants={{ hidden: {opacity:0, y:4}, show: {opacity:1, y:0} }}`。

**理由**：
- Drawer 打开时 tag 错峰出现，质感提升明显
- 30ms 间隔足够细腻，不会让用户感觉「等」
- 仅限 Drawer 首次进入动画期间触发，重复 render 不重新 stagger

**约束**：tag 数量可能很多（一本漫画几十个 tag），stagger 总时长需封顶。用 `staggerChildren: 0.03` + `delayChildren: 0.1`，最多前 20 个 tag 错峰（0.1 + 20×0.03 = 0.7s），之后立即出现。

**反例**：不加 stagger——也能用，但失去变更 2 「质感提升」的核心价值之一。

### 决策 5：Modal 安全遮罩点击逻辑迁移时保留

**选择**：Modal 迁移到 AnimatePresence 时，**保留** `mouseDownOnOverlay` ref 与 mousedown/click 落点判定（方案 A）。motion.div 只接管动画，不接管交互。

**理由**：
- 方案 A 修复的「拖选文字逸出导致误关闭」是真实 bug（见 git log `fix(对话框)`）
- motion.div 的 onClick 行为与普通 div 一致，但安全判定逻辑不能丢
- Modal.test.tsx 有专门的回归测试覆盖此场景

**实现**：外层 `<motion.div>`（遮罩，opacity 动画）+ 内层 `<motion.div>`（内容，scale 动画），交互逻辑挂在遮罩层。

### 决策 6：reduced-motion 退化统一为纯 opacity

**选择**：所有 variants 在 `useReducedMotionPreference()` 为真时，运动分量（x/y/scale）全部归零，只保留 opacity。

**理由**：
- 变更 1 的全局 CSS 兜底会把 duration 压到 0.01ms，但 framer-motion 用 JS 驱动动画可能绕过 CSS
- 必须在 variants 层显式判断
- 纯 opacity 淡入淡出对 reduced-motion 用户是可接受的（不产生画面位移）

**实现**：在 `anim.ts` 提供 `reduceSafe(variant)` 工厂——读取 `useReducedMotionPreference()`，true 时把 variant 的 x/y/scale 字段置零。

## 与变更 1 的衔接

- 复用 `anim.ts` 的 `springTransition`、`createPresenceVariants`
- 删除 `usePresenceAnimation.ts` 与 `useModalAnimation.ts`（变更 1 引入，本变更清除）
- 复用 `useReducedMotionPreference`
- 保留变更 1 的 reduced-motion 全局 CSS 兜底（仍生效，作为 JS 之外的第二道防线）

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Modal.test.tsx rAF 时序假设失效 | 同步更新测试，改用 `findByTestId` 轮询模式 |
| ComicInfoDrawer 嵌套 Modal 的 AnimatePresence 冲突 | 每个 Modal 用独立 AnimatePresence，避免 exit 冒泡 |
| framer-motion exit 动画期间组件仍需可访问（如 onClose） | AnimatePresence 自动保留 exit 中的子树，无需特殊处理 |
| stagger 在长 tag 列表卡顿 | 封顶前 20 个，之后立即出现 |
| Toast 的 Toaster 容器与单个 Toast 的 AnimatePresence 嵌套 | Toaster 用 AnimatePresence 管理多 Toast，单个 Toast 内不再嵌套 AnimatePresence |

## 不在本变更范围

- 阅读器翻页动画（变更 3）
- 列表进出场（变更 4）
- 骨架屏（变更 5）
- 性能审计（变更 6）
- 修改 ComicReaderModal 的运动方向（从下→改为从右）——保留现有方向，仅统一曲线
