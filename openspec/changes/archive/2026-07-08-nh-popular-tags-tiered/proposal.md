## 为什么

NH 入口页的热门标签区当前把 24 个标签渲染成完全相同的灰色小药丸，视觉层级丢失——1.2m 次的顶流标签和 67 次的冷门标签长得一模一样，「热门」毫无体现。计数以 `text-[10px]` 灰字紧贴标签名，难以阅读，且未复用项目已有的 `tagItemVariants` stagger 动画与 `bg-accent/10` 配色系统（ComicInfoDrawer 在用），与上方两个功能卡的视觉语言割裂。现在优化是因为它是 NH 入口页的主入口之一，且改进可全部集中在单个前端组件内，风险低、收益明显。

## 变更内容

- 将 NH 入口页热门标签按 `count` 分为三档（热门头部 / 中段 / 长尾），分别采用不同视觉权重（实心强调底+大字 / 淡强调底+中字 / 灰底+小字），让热度差异一眼可辨。
- 计数展示统一为可读徽章或加粗内联形式，不再使用难以辨认的 10px 灰字。
- 标签进场复用项目已有的 stagger 动画（`tagListVariants` + `tagItemVariants`），并保留 reduced-motion 退化路径。
- 区块标题与副文案重写以传达「按热度分层」语义（如副文案标注排序依据与总数）。
- 保持点击行为不变（仍触发 NH 精确标签搜索，`onSelectTag` 契约不变），保持数据来源不变（IPC `getTagList('nh','','',24,'popular')`），保持「标签未同步时提示刷新」「刷新失败不影响功能卡可用性」等既有契约。

## 功能 (Capabilities)

### 新增功能

（无）

### 修改功能

- `nh-entry-page`: 「NH 入口页热门标签快捷入口」需求增加按热度分档呈现与 stagger 进场的展示行为约束——现有规范仅要求「按热门排序展示前若干个标签」「显示标签名」「count 可用时显示数量」，未约束视觉层级与动画；本变更新增分层展示需求。

## 影响

- **前端代码**：`src/components/NhEntryGrid.tsx`（热门标签区渲染逻辑、样式 class、引入 framer-motion stagger variants）。
- **动画系统**：复用 `src/lib/anim.ts` 中的 `tagListVariants` / `tagItemVariants` / `useReducedMotionPreference`，不新增动画 API。
- **样式**：复用 `src/styles/index.css` 中已有的 CSS 变量（`--accent` / `--bg-secondary` / `--text-secondary` 等）与 `tailwind.config.js` 已有令牌，不新增设计 token。
- **后端 / IPC**：无变更，`getTagList` 契约与 NH 标签目录同步逻辑保持不变。
- **测试**：NhEntryGrid 相关前端测试需更新断言（分层样式 / stagger 容器结构），新增 reduced-motion 退化路径覆盖。
