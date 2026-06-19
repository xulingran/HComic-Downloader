## 为什么

目前不同 tab（搜索、下载管理、收藏夹、历史记录、工具箱、设置、关于）之间的切换是瞬时的——旧页面直接 unmount，新页面直接 mount，没有任何过渡动画。项目已经集成了 framer-motion（^12.40.0）并建立了完整的动画基础设施（`src/lib/anim.ts`），其余 UI 元素（Modal、Drawer、ComicCard 列表、阅读器翻页）都已使用动画。tab 切换的顿挫感是唯一的缺口，补齐后可显著提升应用的整体精致度。

## 变更内容

- **为 tab 页面切换添加方向感知的 slide + fade 动画**：点击 sidebar 的 tab 按钮时，页面内容根据导航方向（向"右" vs 向"左"）从相应侧滑入，同时旧页面向反方向滑出
- **在 `src/lib/anim.ts` 中新增 tab 页面切换 variants**：复用现有的 `DURATION`、`smoothTransition` 等基础设施，定义方向感知的 slide + opacity variants，以及 reduced-motion 退化路径（纯 opacity crossfade）
- **修改 `src/App.tsx`**：用 `<AnimatePresence mode="wait">` + `<motion.div key={activePage}>` 替换 `renderPage()` 的直接调用，通过 `custom` prop 传递导航方向

## 功能 (Capabilities)

### 新增功能
- `tab-navigation`: 涵盖 tab 页面切换时的动画过渡体验——方向感知的滑入/滑出、reduced-motion 降级、程序化跳转（onNavigateToSettings / pendingSearch）的兼容

### 修改功能

（无）

## 影响

- **`src/App.tsx`**：引入 `framer-motion` 的 `AnimatePresence`、`motion`，修改 `renderPage()` 的使用方式；新增 `useRef` 追踪 tab 索引历史以计算方向
- **`src/lib/anim.ts`**：新增 `getTabPageVariants()`、`getReducedTabPageVariants()` 以及 `useTabPageVariants()` 钩子
- 所有 Page 组件无需修改
- Sidebar 组件无需修改
- 无依赖变更
