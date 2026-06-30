## 为什么

当前侧边栏是固定 64px 的纯图标栏（`w-16`），8 个菜单项的中文标签仅通过原生 `title` tooltip 暴露，鼠标悬停约 1 秒后才出现。新用户无法快速辨认"📥"是下载管理还是收藏夹，可发现性差；资深用户也缺少一次性的标签浏览入口。本次变更为侧边栏引入收起/展开能力，展开后在图标右侧显示标题，让导航语义在需要时可见。

## 变更内容

- **新增** 侧边栏展开态：宽度从 `w-16`（64px）过渡到 `w-52`（208px），在每个菜单项图标右侧渲染中文标题（搜索 / 下载管理 / 收藏夹 / 历史记录 / 工具箱 / 维护 / 设置 / 关于）。标签文字已存在于 `menuItems[].label`，此前仅喂给 `title` 属性，本次改为条件渲染。
- **新增** 底部 toggle 按钮：用 `mt-auto` 推至侧边栏最下，点击切换收起/展开。展开态移除菜单项的 `title` 属性（避免原生 tooltip 与可见标签重复），收起态保留。
- **新增** 会话级展开状态：新建 Zustand store `useSidebarStore`（默认收起 `isOpen: false`），复刻 `useDrawerStore` 的 `isOpen` / `open` / `close` / `toggle` 模式。**不持久化**——重启回到默认收起态。
- **新增** 收展动画：宽度过渡走 CSS `transition-[width]`（不触发 JS 驱动布局抖动），曲线 `cubic-bezier(0.4,0,0.2,1)` 300ms，与 `anim.ts` 的 `smoothTransition` 同源值；标题用 framer-motion `AnimatePresence` 淡入淡出。整套动画消费 `ui-animation` 既定契约（Tailwind 令牌管理曲线、`useReducedMotionPreference()` 退化、不常驻 `will-change`），不改变动画规范本身。
- **可选增强** 全局快捷键 `Ctrl+B`（VS Code 惯例）切换收展，作为 toggle 按钮的补充入口。

## 功能 (Capabilities)

### 新增功能
- `sidebar-collapse`: 侧边栏可收起/展开，展开态在图标右侧显示菜单标题；包含 toggle 触发、会话级状态、收展动画与 reduced-motion 降级。

### 修改功能
<!-- 无。动画细节消费 ui-animation 既有契约（Tailwind 曲线令牌、共享 variants 集中导出、reduced-motion 全局降级），不改变规范级行为。 -->

## 影响

- **前端组件**：`src/components/Sidebar.tsx`（主改动，当前仅 43 行——新增 toggle 按钮、条件渲染 label、动态宽度 class、AnimatePresence 包裹）。
- **状态层**：`src/stores/useSidebarStore.ts`（新建，复刻 `useDrawerStore` 结构）。
- **动画模块**：`src/lib/anim.ts`（可选——若新增 `sidebarLabelVariants` 则在此导出；亦可内联于 Sidebar.tsx，由 design.md 定夺）。
- **shell 布局**：`src/App.tsx`——内容区已是 `flex-1`，侧边栏宽度变化会自动 reflow，无需改动布局结构；若启用 `Ctrl+B` 快捷键，需在 App.tsx 注册 `useEffect` 键盘监听。
- **无后端 / IPC / shared 类型契约改动**——临时态决策明确排除跨端持久化。
- **测试**：`tests/` 下新增 store 单测与 Sidebar 组件测试（收起/展开两态渲染、toggle 行为、reduced-motion 退化路径），遵循 `test-quality-gate`（断言真实行为而非裸 mock 调用）。
