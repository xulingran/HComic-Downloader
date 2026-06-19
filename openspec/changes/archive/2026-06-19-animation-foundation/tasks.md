## 1. Tailwind 动画令牌化

- [x] 1.1 在 `tailwind.config.js` 的 `theme.extend.transitionDuration` 新增令牌：`fast: '150ms'`、`base: '200ms'`、`slow: '300ms'`、`slower: '450ms'`（保留 Tailwind 默认值不覆盖）
- [x] 1.2 在 `theme.extend.transitionTimingFunction` 新增令牌：`spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)'`、`smooth: 'cubic-bezier(0.4, 0, 0.2, 1)'`、`standard: 'ease-out'`（保留默认 `ease-out` 不冲突）
- [x] 1.3 在 `theme.extend.keyframes` 新增：`fade-in`（opacity 0→1）、`slide-up`（translateY 8px→0 + opacity）、`slide-down`（translateY -8px→0 + opacity）、`scale-in`（scale 0.95→1 + opacity）、`shimmer`（背景渐变 100% translate）
- [x] 1.4 在 `theme.extend.animation` 注册上述 keyframes 的便捷类：`'fade-in': 'fade-in 200ms ease-out'`、`'slide-up': 'slide-up 300ms ease-out'`、`'shimmer': 'shimmer 1.5s linear infinite'` 等

## 2. reduced-motion 全局兜底

- [x] 2.1 在 `src/styles/index.css` 末尾新增 `@media (prefers-reduced-motion: reduce)` 块

## 3. 引入 framer-motion 与共享 variants

- [x] 3.1 执行 `npm install framer-motion`（实际安装 framer-motion@12.40.0，与 React 18.2 兼容）
- [x] 3.2 新增 `src/lib/anim.ts`，导出 `DURATION` 常量、`springTransition` / `smoothTransition` / `standardTransition`、`createPresenceVariants` 工厂、`useReducedMotionPreference`
- [x] 3.3 在 `src/lib/anim.ts` 顶部加注释说明：本文件是后续变更的共享来源，本变更自身不消费

## 4. 统一 presence hook

- [x] 4.1 新增 `src/hooks/usePresenceAnimation.ts`，签名与 `useModalAnimation` 完全相同
- [x] 4.2 hook 内部用 framer-motion 的 `useReducedMotion()` 判断：reduced-motion 开启时跳过双层 rAF，直接同步终态；关闭时维持双层 rAF 行为
- [x] 4.3 hook 头部加注释说明兼容性
- [x] 4.4 在 `src/hooks/useModalAnimation.ts` 内部委托给 `usePresenceAnimation`（保留导出名不变），标注 @deprecated

## 5. transition-all 清理（逐处判定）

- [x] 5.1 `src/components/BikaCategoryGrid.tsx` —— 替换为 `transition-[box-shadow,--tw-ring-color]`
- [x] 5.2 `src/components/common/ComicCard.tsx`（CoverCard）—— 替换为 `transition-shadow`
- [x] 5.3 `src/components/common/Modal.tsx` —— 替换为 `transition-[opacity,transform]`
- [x] 5.4 `src/components/common/ProgressBar.tsx` —— 替换为 `transition-[width]`
- [x] 5.5 `src/components/common/Toast.tsx` —— 替换为 `transition-[opacity,transform]`
- [x] 5.6 `src/components/settings/MigrationDialog.tsx` —— 替换为 `transition-[width]`
- [x] 5.7 `src/components/Sidebar.tsx` —— **保留 `transition-all`**，在 map 回调内加注释说明原因
- [x] 5.8 `src/pages/HistoryPage.tsx` —— 替换为 `transition-shadow`
- [x] 5.9 `src/pages/SettingsPage.tsx` —— 替换为 `transition-[width]`

## 6. Toast 死代码清理

- [x] 6.1 `src/components/common/Toast.tsx` —— 删除 className 中被 inline style 覆盖的 `translate-y-0` / `-translate-y-4`，加注释说明 transform 由 inline style 接管

## 7. 验证

- [x] 7.1 运行 `npx tsc --noEmit` 通过
- [x] 7.2 运行 `npm test` 全部通过（924 测试，含 Modal.test.tsx 的 rAF 时序用例）
- [x] 7.3 运行 `npm run lint`（ESLint）通过
- [x] 7.4 运行 `npm run build` 通过（renderer bundle 684 KB，含 framer-motion）
- [ ] 7.5 手动验证（**deferred**，需用户在桌面环境执行）：Windows 系统设置关闭「视觉效果 → 在以下位置播放动画」后启动应用，所有动画退化为瞬时；重新开启后动画恢复
- [ ] 7.6 手动验证（**deferred**）：Modal、ComicInfoDrawer、ComicReaderModal 进出场动画在未启用 reduced-motion 时与改动前视觉一致
- [ ] 7.7 手动验证（**deferred**）：Toast 进出场视觉与改动前一致
- [ ] 7.8 手动验证（**deferred**）：步骤 5 中替换 `transition-all` 的组件，hover / 动画行为视觉无回归
