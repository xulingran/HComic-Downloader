## 为什么

收藏夹页的来源侧边栏顶部紧贴内容区顶部（0px），而设置页、工具箱页的同类侧边栏顶部均有 24px 间距，视觉不一致。根因是上一轮修复 `fix-favourites-sidebar-shift` 给 `<aside>` 加了 `self-start` 以阻止 flex stretch 干扰 sticky，副作用是 aside 容器高度收缩到导航内容自身高度，导致 `sticky top-6` 不再在未滚动时产生初始 24px 偏移——而设置/工具箱页的侧边栏容器因默认 stretch 被拉到很高，sticky 在未滚动时即落在 24px 处。

## 变更内容

- 在 `FavouriteSourceSidebar.tsx` 的 `<aside>` className 上增加 `pt-6`（padding-top: 24px），显式补回顶部 24px 间距，使收藏夹侧边栏初始垂直位置与设置页、工具箱页一致。
- 保留既有 `self-start`（仍为 sticky 漂移修复所必需），`pt-6` 仅补正其带来的顶部间距缺失，不影响 sticky 滚动吸附行为。

## 功能 (Capabilities)

### 新增功能

（无）

### 修改功能

- `favourite-source-sidebar`: 补充"来源侧边栏顶部间距必须与设置页、工具箱页的同类侧边栏一致"的需求，明确未滚动状态下来源导航顶部距内容区顶部必须保持 24px。

## 影响

- 受影响代码：`src/components/favourites/FavouriteSourceSidebar.tsx`（`<aside>` className 增补 `pt-6`）。
- 不涉及后端、IPC、配置或数据流变更。
- 不影响设置页、工具箱页（它们未改动，作为对齐基准）。
- 视觉行为变更：收藏夹来源侧边栏顶部从 0px 变为 24px，与设置/工具箱页侧边栏对齐；滚动时 sticky 仍按 `top-6` 吸附，行为不变。
