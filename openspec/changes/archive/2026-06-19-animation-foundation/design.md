# 设计：动画基础设施（animation-foundation）

本设计文档解释为什么这样设计，而不是那样设计。具体实现细节见 `tasks.md`，可观测行为契约见 `specs/ui-animation/spec.md`。

## 上下文与约束

探查代码库得到的关键事实：

- **React 18.2 + Vite 5 + Tailwind 3.4** —— framer-motion 11+ 完全兼容，无版本风险
- **`tailwind.config.js` 只扩展了颜色**，没有任何动画令牌
- **`transition-all` 出现 9 处**：BikaCategoryGrid、ComicCard（×2：CoverCard、DetailedCard 共用类名）、Modal、ProgressBar、Toast、MigrationDialog、Sidebar、HistoryPage、SettingsPage
- **`useModalAnimation` 有 3 个调用方**：`Modal.tsx`、`ComicInfoDrawer.tsx`、`ComicReaderModal.tsx`；另有 1 处测试注释（`Modal.test.tsx:106`）依赖 rAF 时序
- **`Toast.tsx` 自行实现 mounted/visible + rAF**，与 hook 不统一
- **代码库零处 `prefers-reduced-motion`**

## 关键设计决策

### 决策 1：令牌命名用语义而非数值（`base` 而非 `200`）

**选择**：令牌命名为 `fast / base / slow / slower`（150/200/300/450ms），而非直接保留 `200 / 300`。

**理由**：
- 数值令牌（`duration-200`）和现有魔法数字一样，仍要全局搜索才能改
- 语义令牌让阅读者一眼看出意图（"这是快速微交互" vs "这是慢容器动画"）
- 未来调整时长只改 `tailwind.config.js` 一处，类名不变

**用法对照**：
```
微交互（hover、按钮）     → duration-fast     (150ms)
标准容器动画（Toast）     → duration-base     (200ms)
弹窗进出（Modal/Drawer） → duration-slow     (300ms)
强调或大型过渡            → duration-slower   (450ms)
```

**反例**：直接定义 `duration-200: '200ms'` 会与 Tailwind 默认值冲突，且无法表达"这个值将来可能改成 180ms"的语义。

### 决策 2：reduced-motion 用全局兜底 + 组件级细化的双层策略

**选择**：在 `src/styles/index.css` 加全局 `@media (prefers-reduced-motion: reduce)`，把所有 `transition-duration` / `animation-duration` 压到 0.01ms；同时让 `usePresenceAnimation` 与后续 framer-motion 组件用 `useReducedMotion()` 在 JS 层判断，针对位移/缩放类动画退化为纯 opacity。

**理由**：
- 全局兜底是**最后一道防线**——即使某个组件忘记处理，系统级规则仍然生效
- 但全局兜底不够细腻：它会把"位移"也压成瞬时，而 reduced-motion 的本意是"不要让画面晃动"，纯 opacity 淡入淡出是可接受的
- 组件级细化（如 `usePresenceAnimation` 内部判断）能在全局兜底之上提供更优雅的退化路径

**反例**：
- ❌ 只用组件级：容易遗漏，新组件开发时忘记处理就破功
- ❌ 只用全局兜底：所有动画都变成瞬间切换，连淡入淡出都没有，体验过于生硬

### 决策 3：`usePresenceAnimation` 提供与 `useModalAnimation` 完全兼容的返回签名

**选择**：新 hook 返回 `{ mounted, visible, handleTransitionEnd }`，与旧 hook 一字不差。

**理由**：
- 3 个调用方（Modal、ComicInfoDrawer、ComicReaderModal）可以**零改动**切换到新 hook
- 测试 `Modal.test.tsx:106` 不需要改时序假设
- 降低本变更的风险——hook 切换是机械替换，不触及组件内部逻辑

**实现差异**：新 hook 内部多了一层 `useReducedMotion()` 判断——当 reduced-motion 开启时，跳过双层 rAF，直接 `setMounted(true); setVisible(true)`（因为反正没有过渡动画，不需要等待 paint）。

**反例**：重新设计签名（如返回 framer-motion 的 variants 对象）会让本变更被迫同时改 3 个调用方，违反"基础设施变更应最小化对调用方的影响"原则。真正的 framer-motion 化在变更 2 做。

### 决策 4：framer-motion 引入但**本变更不消费它**

**选择**：本变更只 `npm install framer-motion`，新增 `src/lib/anim.ts` 导出共享 variants，但**不把任何组件迁移到 framer-motion**。

**理由**：
- 本变更是地基，职责是"引入依赖 + 定义契约"
- 组件迁移是变更 2/3/4/5 的工作——如果本变更就迁移，会膨胀成巨型 PR
- `anim.ts` 在本变更里**只是定义**，没有任何代码 import 它；后续变更按需消费
- bundle 分析留到变更 6，本变更只确认能 install + build 通过

**反例**：本变更顺便把 Modal 迁移到 framer-motion —— 会让"基础设施"和"迁移"耦合，难以独立 review 和回滚。

### 决策 5：`transition-all` 替换为精确属性，**逐处判定**

**选择**：9 处 `transition-all` 不机械全替换为 `transition-[box-shadow]`，而是逐个看动画涉及哪些属性：

| 文件 | 现状 | 涉及属性 | 替换为 |
|------|------|---------|--------|
| BikaCategoryGrid | hover:ring + hover:scale | `box-shadow, transform, ring-width` | `transition-[box-shadow,transform]` + 已有 `transform` |
| ComicCard (CoverCard) | hover:shadow + hover:scale(封面) | `box-shadow` | `transition-shadow` |
| Modal | opacity + scale | `opacity, transform` | `transition-[opacity,transform]` |
| ProgressBar | width 改变 | `width` | `transition-[width]`（变更 6 评估是否换 scaleX） |
| Toast | opacity + translate-y | `opacity, transform` | `transition-[opacity,transform]` |
| MigrationDialog | width 改变 | `width` | `transition-[width]` |
| Sidebar | bg + shadow + text-color | `background-color, box-shadow, color` | `transition-colors` + `transition-shadow` 不行（互斥）→ 保留 `transition-all` 加注释，或拆 hover |
| HistoryPage | hover:shadow | `box-shadow` | `transition-shadow` |
| SettingsPage | width 改变 | `width` | `transition-[width]` |

**理由**：Sidebar 的 hover 涉及 bg + shadow + color，强行拆分会失去原子性；ProgressBar / SettingsPage 的 width 动画用 scaleX 替代是变更 6 的事。本变更只做"能安全替换的"。

**反例**：机械替换 `transition-all → transition-opacity` 会导致部分属性失去过渡，回归 bug。

### 决策 6：Toast 死代码清理但**不重写动画逻辑**

**选择**：删除 `Toast.tsx:64` 的 `translate-y-*` className（被 inline style 覆盖），但保留 mounted/visible + rAF 的整体结构。

**理由**：
- 整体重写是变更 2 的工作
- 本变更只清理"明显死代码"，把 Toast 迁移到 framer-motion 会破坏变更 1 的"基础设施不消费 framer-motion"原则
- 死代码删除是安全的，且为变更 2 减少认知负担

## 与现有实现的兼容性

- **`useModalAnimation` 不删除**：本变更保留它，仅内部委托给 `usePresenceAnimation`。删除留待变更 2 完成 3 个调用方迁移后。
- **测试不动**：`Modal.test.tsx` 的 rAF 时序假设仍然成立——`usePresenceAnimation` 在非 reduced-motion 下行为与旧 hook 一致。
- **Tailwind 默认令牌保留**：`duration-200`、`ease-out` 等 Tailwind 默认值仍然可用，新增令牌是**追加**而非覆盖。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| framer-motion 引入后 vite build 出问题 | 在 tasks 中显式包含 build 验证步骤 |
| `transition-all` 替换后某些 hover 失去过渡 | 逐处判定（见决策 5），保留 Sidebar 的 `transition-all` |
| reduced-motion 全局规则误伤非动画 transition（如路由切换） | 全局规则只压 duration 不删除 transition，行为可接受 |
| 测试 jsdom 不支持 prefers-reduced-motion 媒体查询 | 本变更不写 reduced-motion 的单元测试，留到变更 6 用真机验证 |

## 不在本变更范围

- 把任何组件迁移到 framer-motion（变更 2/3/4/5）
- 删除 `useModalAnimation`（变更 2）
- ProgressBar 改用 scaleX（变更 6）
- 虚拟列表（不在本工程范围）
- 引入 framer-motion 替代品（react-spring 等）—— 已在决策阶段选定 framer-motion
