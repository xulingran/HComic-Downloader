## 新增需求

> 本 capability 由变更 `animation-foundation` 首次建立。后续变更（animation-consistency、reader-page-transition、list-enter-exit、skeleton-loader、animation-perf-audit）会通过 `## 修改需求` 增量向此 capability 扩展场景。

### 需求: 项目必须通过 Tailwind 令牌集中管理动画时长

系统必须在 `tailwind.config.js` 的 `theme.extend.transitionDuration` 中定义语义化的时长令牌，所有组件应使用令牌类名（如 `duration-base`）而非裸数值（如 `duration-200`），保证全局调整时只需改一处。

#### 场景: 微交互使用快速时长

- **当** 组件渲染按钮 hover、图标 hover、tag hover 等微交互
- **那么** 使用 `duration-fast`（150ms）令牌

#### 场景: 标准容器动画使用基准时长

- **当** 组件渲染 Toast 进出场等标准容器动画
- **那么** 使用 `duration-base`（200ms）令牌

#### 场景: 弹窗进出场使用慢速时长

- **当** 组件渲染 Modal / Drawer / ReaderModal 进出场
- **那么** 使用 `duration-slow`（300ms）令牌

### 需求: 项目必须通过 Tailwind 令牌集中管理动画曲线

系统必须在 `theme.extend.transitionTimingFunction` 中定义语义化的曲线令牌，所有容器级动画应使用令牌类名（如 `ease-spring`）而非裸 `ease-out`。

#### 场景: 容器动画使用 spring 弹性曲线

- **当** 组件渲染弹窗进出场、需要"弹一下"质感的动画
- **那么** 使用 `ease-spring`（cubic-bezier(0.34, 1.56, 0.64, 1)）令牌

#### 场景: 普通过渡使用平滑曲线

- **当** 组件渲染位置过渡、平移类动画
- **那么** 使用 `ease-smooth`（cubic-bezier(0.4, 0, 0.2, 1)）令牌

### 需求: 项目必须定义可复用的 keyframes

系统必须在 `theme.extend.keyframes` 与 `theme.extend.animation` 中定义至少以下关键帧，供后续变更复用：`fade-in`、`slide-up`、`slide-down`、`scale-in`、`shimmer`。

#### 场景: shimmer 关键帧供骨架屏使用

- **当** 后续变更（skeleton-loader）实现骨架屏
- **那么** 复用本变更定义的 `shimmer` keyframe（线性渐变背景从左到右移动）

### 需求: 系统必须在用户启用"减少动画"时全局降级动画

系统必须在 `src/styles/index.css` 中定义 `@media (prefers-reduced-motion: reduce)` 全局规则，把所有 CSS transition 与 animation 的持续时间压缩到 0.01ms，作为兜底防御。

#### 场景: Windows 关闭"播放动画"时所有 CSS 动画瞬时完成

- **当** 用户在 Windows 系统设置中关闭「视觉效果 → 在以下位置播放动画」
- **那么** 应用内所有 CSS transition 与 keyframe animation 几乎瞬时完成（duration 0.01ms）

#### 场景: 即使组件忘记处理 reduced-motion，全局规则仍生效

- **当** 后续新增的组件未在代码中读取 `prefers-reduced-motion`
- **那么** 该组件的 CSS 动画仍被全局规则压缩为瞬时

### 需求: presence hook 必须在 reduced-motion 下跳过过渡

系统必须提供 `usePresenceAnimation` hook，在 `prefers-reduced-motion: reduce` 为真时跳过双层 rAF 与 visible 渐变，直接进入终态，让组件立即显示；在未启用时维持与旧 `useModalAnimation` 完全一致的双层 rAF 时序。

#### 场景: reduced-motion 开启时弹窗立即显示

- **当** 用户启用"减少动画"且打开一个使用 `usePresenceAnimation` 的弹窗
- **那么** 弹窗组件跳过 rAF 等待，`mounted` 与 `visible` 同步为 true，无过渡动画

#### 场景: reduced-motion 关闭时保持原有双层 rAF 行为

- **当** 用户未启用"减少动画"且打开弹窗
- **那么** hook 维持与旧 `useModalAnimation` 完全一致的双层 rAF 时序，保证对调用方零影响

### 需求: 项目必须提供共享动画 variants 的集中导出

系统必须在 `src/lib/anim.ts` 中导出共享的 framer-motion variants、duration 常量与 `useReducedMotion` 薄封装，供后续变更（animation-consistency、reader-page-transition、list-enter-exit、skeleton-loader）按需消费。

#### 场景: 后续变更导入共享 spring variant

- **当** 变更 2 把 Modal 迁移到 framer-motion
- **那么** 从 `src/lib/anim.ts` 导入 `springTransition` variant，而不是在各组件内重复定义

#### 场景: variants 内置 reduced-motion 退化

- **当** 共享 variants 被 motion 组件消费
- **那么** variants 内部已处理 reduced-motion 退化路径，组件无需重复判断

### 需求: 组件必须避免使用 transition-all，改用精确属性

除复合 hover 场景外，系统**必须**避免在动画组件上使用 `transition-all`（会监听所有属性变化，增加浏览器比对开销），改用 `transition-[property]` 或 `transition-colors` / `transition-shadow` / `transition-transform` / `transition-opacity` 等精确形式。对于 hover 涉及多种属性的复合交互（如同时改变背景色、阴影、文字色），可保留 `transition-all`，但**必须**在类名旁加注释说明原因。

#### 场景: 仅 opacity + transform 的容器动画使用精确属性

- **当** 组件（如 Modal 内层）的动画只涉及 opacity 与 transform
- **那么** 使用 `transition-[opacity,transform]` 而非 `transition-all`

#### 场景: 仅 box-shadow 的 hover 使用精确属性

- **当** 组件（如 ComicCard CoverCard）的 hover 只改变阴影
- **那么** 使用 `transition-shadow` 而非 `transition-all`

#### 场景: 复合 hover 可保留 transition-all 并加注释

- **当** 组件（如 Sidebar）的 hover 同时改变背景色、阴影、文字色
- **那么** 可保留 `transition-all`，但在类名旁加注释说明为何不拆分
