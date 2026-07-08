## 为什么

收藏夹页面左侧来源侧边栏使用 `sticky` 布局，但在右侧主内容区加载出漫画数据后，侧边栏会固定下移一小段距离且不再回正。根因是收藏夹页面根容器 `<div className="flex gap-0">` 沿用 flex 默认的 `align-items: stretch`，使 `<aside>` 被拉伸到与右侧主内容等高；当右侧数据加载导致主内容变高时，aside 的高度变化干扰了 sticky nav 的吸附基准，造成来源列表视觉上下沉。这一问题对任意收藏来源都成立，且与数据加载完成这一时机绑定，严重影响来源切换的可用性与视觉稳定。

## 变更内容

- 在收藏夹来源侧边栏的 `<aside>` 上增加 `self-start`（Tailwind `align-self: flex-start`），阻止 flex stretch 拉伸 aside，使其高度仅由内部导航内容决定。
- sticky nav 的吸附行为由此与右侧主内容区高度解耦：无论右侧是否加载出数据、加载多少卡片，左侧来源列表的垂直位置保持稳定。

## 功能 (Capabilities)

### 新增功能

（无）

### 修改功能

- `favourite-source-sidebar`: 补充"侧边栏垂直位置必须独立于右侧内容高度"的需求，明确来源列表的 sticky 吸附基准不得因右侧主内容区数据加载或高度变化而发生位移。

## 影响

- 受影响代码：`src/components/favourites/FavouriteSourceSidebar.tsx`（`<aside>` className 增补 `self-start`）。
- 不涉及后端、IPC、配置或数据流变更。
- 不影响其他页面（搜索页等其他页面根容器为垂直布局，无 sticky 侧边栏，不受影响）。
- 视觉行为变更：修复后侧边栏在任何来源、任何数据量下都保持初始垂直位置，仅在用户主动滚动时按 `top-6` 吸附。
