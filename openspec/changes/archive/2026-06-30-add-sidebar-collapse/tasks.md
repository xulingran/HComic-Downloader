## 1. 状态层

- [x] 1.1 新建 `src/stores/useSidebarStore.ts`，复刻 `useDrawerStore` 结构：`{ isOpen: boolean (默认 false), open(), close(), toggle() }`，zustand `create` 单例导出
- [x] 1.2 为 `useSidebarStore` 编写单元测试（`tests/unit/stores/useSidebarStore.test.ts`）：验证默认 `isOpen===false`；`open()` 后 `isOpen===true`；`close()` 后回到 `false`；`toggle()` 在两态间翻转。断言真实状态值，禁止裸 `assert-called`

## 2. 侧边栏组件改造

- [x] 2.1 在 `src/components/Sidebar.tsx` 顶部 `useSidebarStore()` 订阅 `isOpen` 与 `toggle`，移除对 props 的依赖扩展（仍保留 `activePage`/`onPageChange` props）
- [x] 2.2 改造容器 `div`：宽度 class 条件化（收起 `w-16` / 展开 `w-52`），追加 `transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden`；保持 `flex flex-col py-4`，但 `items-center` 仅在收起态保留（展开态需要 `items-stretch` 让按钮撑满宽度）
- [x] 2.3 改造菜单项按钮：展开态用 `w-full flex items-center gap-3 px-3`（icon + label 横排，label 用 `whitespace-nowrap`），收起态保持原 `w-10 h-10 flex items-center justify-center`；active 态视觉在两态下都铺满按钮可用区（展开态 accent 背景铺满整行）
- [x] 2.4 条件渲染 label：用 framer-motion `<AnimatePresence>` 包裹 `{isOpen && <motion.span>{item.label}</motion.span>}`，opacity 渐变（`initial/animate/exit` 三态，时长 `DURATION.base`，从 `src/lib/anim.ts` 导入）；`useReducedMotionPreference()` 为真时退化为纯 `<span>`（无 motion 包裹）
- [x] 2.5 条件化 `title` 属性：`title={isOpen ? undefined : item.label}`（展开态移除避免与可见标签重复，收起态保留）

## 3. toggle 按钮

- [x] 3.1 在 `Sidebar.tsx` 菜单列表之后、容器内追加 toggle 按钮，用 `<div className="mt-auto" />` 间隔或直接 `mt-auto` on the button 顶到最底
- [x] 3.2 toggle 按钮内容：收起态显示 `»` + `title="展开侧边栏"`；展开态显示 `«` + `title="收起侧边栏"`；样式复用菜单项按钮基调（hover 背景、圆角、`transition-all duration-200`）
- [x] 3.3 toggle 按钮 `onClick={() => toggle()}`，`aria-label` 同步 `title` 文案以保无障碍

## 4. 可选：Ctrl+B 快捷键

- [x] 4.1 在 `src/App.tsx` 新增 `useEffect` 注册 `keydown` 监听：匹配 `e.ctrlKey && e.key === 'b'`（兼容 `e.metaKey` for macOS），调用 `useSidebarStore.getState().toggle()`
- [x] 4.2 守卫：监听器内检查 `e.target` 不是 `input`/`textarea`/`[contenteditable]`，且 `e.shiftKey===false && e.altKey===false`，避免与文本输入和其它快捷键冲突；cleanup 在 unmount 时 `removeEventListener`

## 5. 组件测试

- [x] 5.1 新建 `tests/unit/components/Sidebar.test.tsx`：渲染 `<Sidebar activePage="search" onPageChange={fn} />`
- [x] 5.2 验证默认收起态：容器有 `w-16` class，菜单项不渲染 label 文本（`queryByText('下载管理')` 为 null），按钮有 `title` 属性
- [x] 5.3 验证点击 toggle 后展开：容器 class 变为 `w-52`，label 文本出现（`getByText('下载管理')` 可见），按钮 `title` 被移除；再次点击回到收起态（断言真实 DOM 状态变化，非裸 mock）
- [x] 5.4 验证 toggle 按钮位置与图标：toggle 按钮在菜单项之后渲染，收起态显示 `»`、展开态显示 `«`
- [x] 5.5 reduced-motion 路径：mock `useReducedMotionPreference` 返回 `true`，触发收展，断言标题用纯 `<span>` 渲染（无 motion 包裹）且切换功能仍可用

## 6. 验证闸门

- [x] 6.1 `npx tsc --noEmit` 通过（无类型错误）
- [x] 6.2 `npm test` 通过（新增 store 与 Sidebar 测试全绿）
- [x] 6.3 `npm run lint` 通过（ESLint 无新告警，`src/components/Sidebar.tsx` 与 `src/stores/useSidebarStore.ts` 干净）
- [x] 6.4 `npm run lint:test-quality` 通过（无裸 mock 调用断言、无纯 store CRUD 往返误判）
- [x] 6.5 手动 `npm run dev` 验收：toggle 按钮切换流畅、宽度过渡顺滑无掉帧、展开态标签清晰、reduced-motion 下收展瞬时、Ctrl+B 快捷键工作（若实现了 4.x）
