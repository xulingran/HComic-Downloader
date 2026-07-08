## 上下文

收藏夹页面（`src/pages/FavouritesPage.tsx`）根容器为 `<div className="flex gap-0">`，左侧是 `FavouriteSourceSidebar` 的 `<aside>`，内部 `<nav>` 使用 `sticky top-6`；右侧是主内容区（标题 + 卡片网格）。

当前 `<aside>` 未设置 `align-self`，继承 flex 容器默认的 `align-items: stretch`，导致 aside 被拉伸到与右侧主内容等高。当右侧漫画数据加载完成、主内容变高时，aside 高度随之变化，干扰了 sticky nav 的吸附基准，表现为来源列表固定下移一小段且不回正。

滚动祖先链：`<nav sticky>` → `<aside>` → `<div flex gap-0>` → `<motion.div absolute inset-0 overflow-auto>`（App.tsx，真正的滚动容器）。无全局 `transform`/`will-change` 干扰，无代码主动滚动。问题纯属 flex stretch 与 sticky 的交互。

## 目标 / 非目标

**目标：**

- 让来源侧边栏的垂直位置独立于右侧主内容区的高度变化，无论右侧是否加载数据、加载多少卡片，左侧来源列表位置保持稳定。
- 保持 sticky 在用户主动滚动时按 `top-6` 吸附的既有行为不变。

**非目标：**

- 不改变侧边栏宽度、选中样式、来源切换语义、键盘可访问性。
- 不调整右侧主内容区布局或卡片网格。
- 不触碰 `App.tsx` 的滚动容器结构（`absolute inset-0 overflow-auto` 的 `motion.div`）。
- 不处理 reduced-motion / 切页动画的 transform（已确认与本现象无关：现象对所有来源一致且"固定停在下面"，而非切页瞬时的短暂偏移）。

## 决策

### 决策 1：用 `self-start` 覆盖 aside 的 stretch

在 `FavouriteSourceSidebar.tsx` 的 `<aside>` className 上增加 `self-start`（对应 `align-self: flex-start`），使 aside 不再被拉伸到与右侧等高，而是按自身内容高度收缩。

**为什么选这个方案：** 一行 Tailwind 类即可，语义精确——侧边栏本就该按内容高度自洽，等高拉伸对它无任何益处（sticky nav 的吸附只依赖滚动祖先，不依赖 aside 高度）。stretch 是 flex 默认值带来的意外副作用，显式 opt-out 是最直接的修正。

**考虑过的替代方案：**

- **在 flex 容器上加 `items-start`**：会让右侧主内容区也变成 `align-self: flex-start`，即右侧不再拉伸填满容器高度。当前右侧 `<div className="min-w-0 flex-1 space-y-4">` 靠内容撑高，`items-start` 对它无实质影响，但作用域过大、语义不聚焦——修改容器默认对齐会影响未来新增的 flex 子项。故不采用。
- **把 sticky 改成 `fixed`**：脱离文档流需要手动预留宽度/偏移，且会破坏现有的滚动吸附行为（fixed 相对视口，不随滚动容器吸附）。过度改造，不采用。
- **给 aside 设固定高度或 `max-height`**：硬编码高度脆弱，随来源数量变化会失效。不采用。

### 决策 2：spec 用 ADDED 而非 MODIFIED

现有 `favourite-source-sidebar` 规范的"需求:侧边栏与内容区必须在双侧栏布局下保持可用"关注的是**水平**布局（宽度、列数、换行、水平溢出）。本次新增的是**垂直位置独立性**这一独立关注点，不改变现有需求的行为，因此在增量 spec 中用 `## 新增需求` 新增一条需求，而非修改现有需求。

## 风险 / 权衡

- **[aside 不再等高于右侧] → 视觉上侧边栏底部不再与右侧内容底部对齐**：侧边栏内容仅 4 个来源按钮 + 1 个标题，本身远短于右侧内容，等高拉伸本就没有视觉收益（aside 底部留白本就由 stretch 填充）。修復后 aside 按内容收缩，底部留白交给容器背景，视觉无回退。无需缓解。
- **[sticky 吸附行为变化] → 需确认修复后吸附仍正常**：`self-start` 只改变 aside 的 cross-axis 尺寸，不改变 sticky nav 相对滚动祖先的吸附逻辑。吸附基准仍是 `overflow-auto` 的 motion.div + `top-6`。需在实现后人工验证：滚动时来源列表仍吸附在顶部下方 24px。
- **[其他页面不受影响] → 已确认**：仅收藏夹页使用水平 flex + sticky sidebar 布局，其他页面根容器为垂直布局，无此问题。
