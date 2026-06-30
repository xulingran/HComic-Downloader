## 上下文

当前 `src/components/Sidebar.tsx` 是 43 行的纯图标栏：

- 容器 `w-16`（64px）`flex flex-col items-center py-4 gap-2`，8 个菜单项按钮各 `w-10 h-10`，emoji 作为 icon，`title` 属性承载中文标签（仅 hover 原生 tooltip 可见）。
- `menuItems[].label` 字段已齐备（搜索/下载管理/收藏夹/历史记录/工具箱/维护/设置/关于），但当前仅喂给 `title`，未被渲染。
- Shell `src/App.tsx:142` 为 `<div className="flex h-screen">`，Sidebar 是其第一个 flex 子项，内容列 `flex-1`——侧边栏宽度变化会自动 reflow，**无需改动布局结构**。
- 项目有成熟的动画基建：`src/lib/anim.ts` 集中导出 `smoothTransition`（`cubic-bezier(0.4,0,0.2,1)` 300ms）、`useReducedMotionPreference()`；`tailwind.config.js` 有对应 `transitionDuration`/`transitionTimingFunction` 令牌；`ui-animation` 规范已规定「曲线必须用令牌」「reduced-motion 全局 CSS 兜底」等契约。
- 状态层先例：`src/stores/useDrawerStore.ts` 是 10 行的 zustand 最小模式（`isOpen` + `open`/`close`），是会话级开关状态的模板。

利益相关者约束：临时态决策明确排除跨端持久化（不动 Python `config.py` / IPC / `shared/types.ts`），改动须克制在前端 2-3 个文件。

## 目标 / 非目标

**目标：**
- 用户可通过侧边栏底部 toggle 按钮切换收起 / 展开两态。
- 展开态在每个菜单项图标右侧渲染中文标题，宽度从 64px 平滑过渡到 208px。
- 收展动画顺滑、遵循 `ui-animation` 既有契约（令牌化曲线、reduced-motion 降级、无常驻 `will-change`）。
- 展开状态在本次会话内稳定，store API 与 `useDrawerStore` 形态一致。
- 提供可选的 `Ctrl+B` 快捷键作为补充入口。

**非目标：**
- **不**持久化展开状态到磁盘——重启回到默认收起态（如需持久化另开变更，复刻 `useSettingsStore` 走 Python config）。
- **不**做窄窗口自适应断点（小屏自动收起留待后续）。
- **不**做 hover 展开预览、钉住/非钉住多模态——单一 toggle 即可。
- **不**改变 `ui-animation` 规范本身——本变更只消费既有契约。
- **不**重构 `menuItems` 数据结构或引入图标库（emoji 维持现状，仅追加渲染分支）。

## 决策

### 决策 1：宽度过渡走 CSS `transition-[width]`，不走 framer-motion 的 width 动画

宽度动画若由 framer-motion JS 驱动，每帧 `setWidth` 会触发 React 重渲染 + 布局抖动，64px↔208px 跨度下肉眼可见掉帧。CSS `transition-[width]` 让浏览器合成层直接处理，顺滑且零 JS 开销。

曲线用 Tailwind 任意值类 `ease-[cubic-bezier(0.4,0,0.2,1)]`（即 `smoothTransition` 同值）+ `duration-300`，与 tab 切换动画同源。

**替代方案（已否决）**：
- *framer-motion `animate={{ width: ... }}`*：JS 驱动布局动画，性能差。
- *Tailwind 令牌类 `ease-smooth`*：更地道，但 `transition-[width]` 任意值组合已足够，且避免在 `tailwind.config.js` 新增 `transitionProperty` 令牌（超出非目标范围）。

### 决策 2：标题淡入用 framer-motion `AnimatePresence`，reduced-motion 下退化为瞬时显示

宽度过渡期间标题不能突兀出现/消失。用 `<AnimatePresence>` 包裹 `{isOpen && <motion.span>}`，`initial/animate/exit` 三态 opacity 渐变（200ms，`DURATION.base`）。`useReducedMotionPreference()` 为真时跳过 AnimatePresence 的过渡变体，直接渲染纯 `<span>`（瞬时）。

`ui-animation` 规范已要求全局 CSS `@media (prefers-reduced-motion: reduce)` 把所有 transition 压到 0.01ms，本组件的 CSS 宽度过渡天然被兜底；JS 侧的 framer-motion 路径由 `useReducedMotionPreference()` 显式降级，双层覆盖。

**替代方案（已否决）**：
- *纯 CSS opacity transition*：可工作，但项目既有哲学是「framer-motion variants 集中导出 + reduced-motion 包装」，此处跟随一致性。新 variants 可内联于 Sidebar.tsx（仅本组件消费，无复用价值），**不**强制加入 `anim.ts`。

### 决策 3：状态层新建 `useSidebarStore`，默认 `isOpen: false`

复刻 `useDrawerStore` 结构：`{ isOpen: boolean, open(), close(), toggle() }`。默认收起以保持当前 64px 体感为初始状态（不改变现有用户的视觉默认）。

`Sidebar` 组件直接 `useSidebarStore()` 订阅 `isOpen` 与 `toggle`，**不需要** prop 下传——与 `useDrawerStore` 被 `ComicInfoDrawer` 直接消费的模式一致。`App.tsx` 仅在启用 `Ctrl+B` 时新增一个键盘监听 `useEffect`（订阅同一个 store 的 `toggle`）。

**替代方案（已否决）**：
- *把 isOpen 放进 `App.tsx` useState*：可行但破坏「UI 开关状态进 store」的既有模式（drawer/reader/fatal-error 都在 store），且 `Ctrl+B` 监听若在 App.tsx 仍需把 toggle 下传，多一层 prop。
- *复用 `useDrawerStore` 加字段*：语义混淆（drawer 是详情抽屉，sidebar 是导航栏），违反单一职责。

### 决策 4：toggle 按钮用 `mt-auto` 推至底部，emoji `«»` / `›‹` 作 chevron，无新依赖

侧边栏当前无 header/footer 容器。toggle 按钮作为菜单列表之外的独立元素，用 `mt-auto`（配合容器已是 `flex flex-col`）顶到最下。展开/收起两态分别显示 `»`/`«`（或 `›`/`‹`），跟随项目既有 emoji-as-icon 方案，**不**引入 `lucide-react` 等图标库（package.json 当前无图标库依赖，引入仅为此一处过度）。

### 决策 5：展开态移除菜单项 `title` 属性

展开态标签已可见，原生 tooltip 重复且遮挡内容。条件渲染：`title={isOpen ? undefined : item.label}`。收起态保留 `title` 作为唯一文字提示（无障碍 + 可发现性）。

### 决策 6：active 态视觉从圆角块扩展为整行 accent 背景

当前 active 是 `w-10 h-10` 圆角块 + accent 背景。展开态下若维持 40×40 块，标签会孤立在块右侧的留白里，视觉断裂。改为：展开态按钮宽度撑满容器（`w-full` + 内部 `flex items-center gap-3 px-3`），active 时 accent 背景铺满整行（icon + label 皆白色）。收起态保持原 `w-10 h-10` 居中圆角块，用条件 class 切换。

## 风险 / 权衡

- **[风险] 宽度过渡期间标签文本回流抖动** → 缓解：标题用固定 `whitespace-nowrap`，且 `AnimatePresence` 在宽度过渡启动的同帧开始 opacity 渐变，文本不会在半宽状态下换行。容器 `overflow-hidden` 防止标签溢出裁切前的瞬间露出。
- **[风险] 展开态蚕食小屏内容区** → 缓解：内容列 `flex-1` 自动 reflow 不会破坏布局，仅压缩可用宽度。窄窗口自适应断点列为非目标；如反馈强烈，后续变更加 `min-width` 媒体查询自动收起。
- **[权衡] emoji chevron (`«»`) 不如 SVG 精致** → 接受：与既有菜单 icon 同源（全 emoji），视觉一致；引入图标库仅为一处 chevron 过度。
- **[风险] `Ctrl+B` 快捷键与未来文本输入场景冲突** → 缓解：监听器检查 `e.target` 不是 `input`/`textarea`/`[contenteditable]`，且检查无修饰键冲突（仅 Ctrl+B，不含 Shift/Alt）。若判断复杂可降级为非目标（仅 toggle 按钮），由 tasks.md 定夺。
- **[权衡] 临时态重启丢失** → 接受：本变更是先验证体验，持久化另开变更（已有 `fix-my-tags-config-persistence` 跨端持久化先例可循）。
