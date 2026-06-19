## 上下文

- App.tsx 通过 `useState('activePage')` 管理当前 tab，`renderPage()` 使用 `switch` 直接返回对应 Page 组件，无任何过渡动画
- framer-motion 已安装（^12.40.0），`src/lib/anim.ts` 已提供 `DURATION`、`smoothTransition`、`useReducedMotionPreference`、`getDirectionalPageVariants` 等基础设施
- Sidebar 以固定顺序 `[search, downloads, favourites, history, toolbox, settings, about]` 排列
- 程序化跳转：`onNavigateToSettings()`（SearchPage/FavouritesPage）、`pendingSearch`（ComicInfoDrawer）也会触发页面切换
- TAB_ORDER 常量可直接定义在 anim.ts 中，作为方向计算的单一来源

## 目标 / 非目标

**目标：**
- 所有 tab 切换（用户点击 sidebar / 程序化跳转）都有平滑的 slide + fade 过渡
- 过渡方向由导航方向决定：向"右"导航时新页从右滑入、旧页向左滑出；向"左"导航时反向
- 首次加载（无前一个 tab）时做 fade in，无位移
- reduced-motion 开启时退化为纯 opacity crossfade
- 与现有 overlay（Toast、ComicInfoDrawer、ComicReaderModal、UpdateDialog）互不干扰

**非目标：**
- 不改动 Page 组件内部的动画（已有自己的 stagger / grid animation）
- 不改动 Sidebar 组件
- 不引入新的外部依赖
- 不做 tab 拖拽重排或 swipe 手势切换（保持 sidebar 点击 + 程序化跳转）

## 决策

### 1. 使用 `mode="wait"` 而非 `mode="popLayout"` 或 `mode="sync"`

**选择：** `mode="wait"` — 旧页面 exit 动画完成后新页面再 enter。

- `popLayout` 会让页面互相堆叠然后移除旧页，不适合左右滑动的方向感知过渡（布局位移不可控）
- `sync`（默认）会同时播放 exit/enter，但两个页面并存期间可能出现滚动条闪烁或内容重叠
- `wait` 确保动画序列干净：旧页面滑出后再滑入新页面，体验连续且可预测

### 2. 方向计算：通过 `useRef` 追踪前一个 tab 索引

- Sidebar 的菜单顺序（`menuItems` 数组）与 TAB_ORDER 对齐
- 每次 `setActivePage` 被调用时，在方向计算中使用新的 `activePage` 值与 `useRef` 中存储的上一个值比较索引
- `direction = newIndex > oldIndex ? 1 : -1`；首次渲染时 `direction = 0`（无位移 fade in）
- `onNavigateToSettings`（SearchPage/FavouritesPage）和 `pendingSearch` 自动跳转都会经过同一个 `setActivePage`，方向由索引差自然决定

### 3. 位移幅度：`x: '8%'` 而非 `x: '100%'`

- 阅读器翻页用 100%（全页翻转），但 tab 页面切换不需要"翻页"的感觉
- 8% 的小幅度位移配合 opacity 过渡，效果更像"内容在视野内微移切换"而非"页面被推走"
- 滑动方向仍然保留语义（左/右），但幅度克制

### 4. 曲线：复用 `smoothTransition`（cubic-bezier 0.4,0,0.2,1）

- 与阅读器翻页一致，避免 spring 的 overshoot（页面不应"弹"）
- 时长用 `DURATION.slower = 0.45s`，比 `DURATION.slow = 0.3s` 稍慢——给用户足够时间感知方向

### 5. Reduced-motion 策略：纯 opacity crossfade，时长 150ms

- 复用 `useReducedMotionPreference()` 钩子
- 退化路径：`opacity: 0 ↔ opacity: 1`，无位移，时长 `DURATION.fast`

## 风险 / 权衡

| 风险 | 缓解 |
|---|---|
| **scrollTarget 在动画过程中失效**：SettingsPage 接收 `scrollTarget` prop，动画期间页面可能未完全渲染 | `mode="wait"` 确保旧页 exit 完成后再 mount 新页，React 渲染生命周期不受影响 |
| **pendingSearch 跳转时动画与搜索逻辑竞争**：`useEffect` 中 `setActivePage('search')` 触发动画，搜索逻辑依赖另一个 effect | 方向计算的 `direction` 为 0（无前一个 tab？索引差仍有效。首次 `search→search` 方向为 0，无位移） |
| **页面内部 list stagger 与 tab 过渡叠加**：页面 mount 后立即播放自己的 card stagger 动画 | tab 过渡 450ms + stagger 最长 400ms（20项×20ms），叠加约 850ms。在视觉上可接受——tab 过渡结束后 stagger 已进行大半 |
| **FatalBanner 区域不受影响** | FatalBanner 在主 `<main>` 外，内容区域只包裹 `<main>` 内的 `renderPage()` |
