## 上下文

收藏夹页面（`src/pages/FavouritesPage.tsx`）根容器 `<div className="flex gap-0">` 左侧是 `FavouriteSourceSidebar` 的 `<aside>`，内部 `<nav>` 使用 `sticky top-6`。上一轮修复 `fix-favourites-sidebar-shift` 给 aside 加了 `self-start` 以阻止 flex stretch 干扰 sticky 吸附基准。

设置页与工具箱页结构相近：`<div className="flex gap-0 max-w-5xl">` 内左侧是普通 `<div className="w-[150px] shrink-0">`，同样含 `<nav className="sticky top-6">`，但容器未设 `self-start`，被 flex 默认 `align-items: stretch` 拉伸到与主内容等高（约 2944px）。

实测（Playwright `getBoundingClientRect`）：

| 页面 | 侧边栏容器高度 | nav 未滚动时 top |
|------|--------------|----------------|
| 设置页 | ~2944px（stretch 拉伸） | 24px |
| 收藏夹页 | ~222px（self-start 收缩） | 0px |

根因：`position: sticky; top: 24px` 在容器很高时，sticky 元素未滚动即落在 24px；容器收缩到 sticky 元素自身高度时，sticky 不再产生初始偏移，元素停在正常流位置 0px。两者 nav 同为 `sticky top-6`，但因容器高度差异表现出不同的初始顶部位置。

## 目标 / 非目标

**目标：**

- 让收藏夹来源侧边栏未滚动时的顶部位置（24px）与设置页、工具箱页一致，消除跨页面侧边栏视觉不一致。
- 保留 `self-start`（仍为 sticky 漂移修复所必需），不回退上一轮修复。

**非目标：**

- 不统一三个页面侧边栏的实现机制（设置/工具箱靠 stretch 副作用，收藏夹靠显式内边距）——仅保证视觉一致。
- 不改动设置页、工具箱页（作为对齐基准，保持不动）。
- 不调整侧边栏宽度、选中样式、来源切换语义、键盘可访问性。
- 不改变 sticky 滚动吸附位置（`top-6`）。

## 决策

### 决策 1：用 `pt-6` 显式补足顶部间距

在 `FavouriteSourceSidebar.tsx` 的 `<aside>` className 上增加 `pt-6`（padding-top: 24px），使 aside 内容区下移 24px，nav 初始顶部变为 24px。

**为什么选这个方案：** 一行 Tailwind 类即可对齐设置/工具箱页的视觉效果，语义直接——顶部间距本就该显式声明，而非依赖 stretch 与 sticky 的副作用交互。`pt-6` 加在 aside（容器）上而非 nav（sticky 元素）上，避免 margin-top 参与 sticky 计算可能引入的吸附偏移；padding 扩展 aside 的内容盒，nav 在 padding 之下正常布局，sticky 相对滚动祖先的吸附逻辑不受影响。

**考虑过的替代方案：**

- **移除 `self-start` 改回 stretch**：会回退 `fix-favourites-sidebar-shift` 修复的 sticky 漂移问题，右侧数据加载后侧边栏再次下沉。不采用。
- **给 nav 加 `mt-6`（margin-top）**：margin-top 在 sticky 元素上会改变其 sticky 计算的起始基准，可能使吸附位置偏离 `top-6`，行为不可预期。不采用。
- **让设置/工具箱页也加显式间距统一机制**：作用域过大，且设置页当前行为正确无需改动，引入变更反而增加回归风险。不采用。
- **给 flex 容器加 `items-start` 并统一**：会改变右侧主内容区的对齐，作用域过大。不采用。

### 决策 2：spec 用 ADDED 而非 MODIFIED

现有"来源侧边栏垂直位置必须独立于右侧内容高度"需求关注的是**垂直位置不受右侧内容高度影响**（防漂移）。本次新增的是**顶部间距跨页面一致性**这一独立关注点，不改变现有需求的行为，因此用 `## 新增需求` 新增一条，而非修改现有需求。

## 风险 / 权衡

- **[pt-6 增加 aside 高度] → sticky 吸附是否受影响**：`pt-6` 只扩展 aside 的内容盒顶部内边距，nav 仍在 aside 内 sticky，吸附基准仍是滚动祖先（`overflow-auto` 的 motion.div）+ `top-6`。实测修复后滚动吸附位置不变。无需缓解。
- **[与设置页机制不同] → 长期一致性**：收藏夹靠显式 `pt-6`，设置/工具箱靠 stretch 副作用，两者机制不同但视觉一致。若未来设置页也加 `self-start`，需同步补 `pt-6`。已在 spec 中以"不得依赖 flex stretch 与 sticky 的副作用交互"约束，引导显式声明。可接受。
- **[其他页面不受影响] → 已确认**：仅收藏夹页使用 `self-start` + sticky 侧边栏组合，其他页面无此问题。
