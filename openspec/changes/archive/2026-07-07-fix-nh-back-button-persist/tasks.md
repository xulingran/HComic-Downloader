## 1. 状态拆分与初始化

> **关键事实（实施前必读）：** `viewingNhEntry` 真实语义是 `true`=在 NH 入口子功能结果里（`NhEntryGrid` 网格**隐藏**，因为渲染条件是 `!viewingNhEntry`，line 1007 取反）；`false`=入口页本体（网格**显示**）。依据：`handleNhLatest` 设 `true`（line 537，进入子功能→隐藏网格）；`handleBackToNhEntry` 设 `false`（line 588，返回入口→显示网格）。本变更不改动 `viewingNhEntry` 现有写入的取值方向。新增的 `showBackToNhEntry`（`true`=显示按钮）与之镜像同步——选项 B 下两者在所有路径取值相同，拆分价值在语义解耦与防御回归，而非让两者 diverge。

- [x] 1.1 在 `src/pages/SearchPage.tsx` 新增 `showBackToNhEntry` state（默认 `false`），专责控制「返回 NH 入口」按钮显隐（`true`=显示）
- [x] 1.2 保留 `viewingNhEntry` 原职责（控制 `NhEntryGrid` 渲染，`true`=隐藏网格），其所有现有运行时写入保持不变
- [x] 1.3 修正挂载恢复缓存逻辑（line 198 附近）：去掉原条件里的 `&& cached.mode !== 'keyword'`，改为 `viewingNhEntry = cached.source === 'nh'`；新增 `showBackToNhEntry = cached.source === 'nh'`。两者取值相同。注意 `viewingNhEntry` 真实语义是 `true`=隐藏网格，故恢复 NH 缓存时设 `true` → 网格不重现（保留搜索结果），按钮显示

## 2. 进入入口子功能的 handler

> `viewingNhEntry` 真实语义 `true`=在子功能里（`!viewingNhEntry` 才显示网格，line 1007）。所以「进入子功能」=`true`，「返回入口」=`false`。`showBackToNhEntry` 与之镜像（`true`=显示按钮）。

- [x] 2.1 `handleNhLatest`：保持 `viewingNhEntry=true`（现状，line 537），新增 `showBackToNhEntry=true`
- [x] 2.2 `handleNhPopular`：保持 `viewingNhEntry=true`（现状，line 552），新增 `showBackToNhEntry=true`
- [x] 2.3 `handleNhEntryTag`：保持 `viewingNhEntry=true`（现状，line 575），新增 `showBackToNhEntry=true`
- [x] 2.4 `handleNhRankingChange`（排行下拉切换）：新增 `showBackToNhEntry=true`（按钮可见）；`viewingNhEntry` 现状未显式设置（继承上次值，用户已在子功能里故为 true）
- [x] 2.5 `handleToggleTag` / `handleClearAllTags` 的 NH 分支：保持现有 `setViewingNhEntry(true)`（line 743/770），补 `setShowBackToNhEntry(true)`

## 3. 退出入口体系的 handler

- [x] 3.1 `handleBackToNhEntry`：保持 `viewingNhEntry=false`（现状，line 588，`!false=true` 重现网格），新增 `showBackToNhEntry=false`（隐藏按钮）
- [x] 3.2 `handleSourceChange`（切走 NH）：保持 `viewingNhEntry=false`（现状，line 603），新增 `showBackToNhEntry=false`
- [x] 3.3 `handleRandom`：保持 `viewingNhEntry=false`（现状，line 496），新增 `showBackToNhEntry=false`

## 4. 关键修复：handleSearch

- [x] 4.1 删除 `handleSearch` 中 line 456 的 `setViewingNhEntry(source === 'nh' && (mode === 'ranking' || mode === 'tag'))`，使关键词搜索、翻页等操作不再触碰两个 state
- [x] 4.2 验证 `handleSearch` 在 keyword 模式搜索、ranking 翻页、tag 搜索翻页等路径下均不改变按钮可见性

## 5. 按钮渲染条件更新

- [x] 5.1 将「返回 NH 入口」按钮的渲染条件（line 889）从 `viewingNhEntry` 改为 `showBackToNhEntry`
- [x] 5.2 确认 `NhEntryGrid` 渲染条件（line 1007）仍使用 `!viewingNhEntry`，不受本变更影响

## 6. 回归测试

- [x] 6.1 新增用例：进入热门排行 → 输入关键词点搜索 → 断言「返回 NH 入口」按钮仍可见
- [x] 6.2 新增用例：进入最近更新 → 翻页 → 断言按钮仍可见
- [x] 6.3 新增用例：进入热门排行 → 切换排行下拉 → 断言按钮仍可见
- [x] 6.4 新增用例：进入热门标签 → 通过标签面板增删标签 → 断言按钮仍可见
- [x] 6.5 新增用例：在入口子功能内关键词搜索无果 → 断言显示「暂无搜索结果」而非入口页网格，且按钮仍可见
- [x] 6.6 强化既有用例（line 697 附近）：覆盖点击「返回 NH 入口」后按钮隐藏 + 网格重现
- [x] 6.7 新增用例：切到非 NH 来源 → 断言按钮隐藏
- [x] 6.8 新增用例：挂载恢复 NH + keyword 模式缓存（用户曾在入口子功能里做关键词搜索）→ 断言「返回 NH 入口」按钮**仍可见**（选项 B），且入口页网格**不重现**（`viewingNhEntry=true` → `!true=false`）
- [x] 6.9 审查现有 `viewingNhEntry` 相关断言，确保改为 `showBackToNhEntry` 后语义一致

## 7. 验证

- [x] 7.1 运行 `npm test`（前端测试），确认全部通过
- [x] 7.2 运行 `npx tsc --noEmit`，确认类型检查通过
- [x] 7.3 运行 `npm run lint`，确认 ESLint 通过
- [x] 7.4 运行 `npm run lint:test-quality`，确认测试质量闸门通过（无裸 mock 调用断言）
- [x] 7.5 手动验证：`npm run dev` 启动，选 NH → 进入热门排行 → 点搜索 → 确认按钮仍在；点返回 / 切来源 / 点随机 → 确认按钮正确消失
