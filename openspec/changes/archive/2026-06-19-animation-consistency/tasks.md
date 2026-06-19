## 1. 扩展 anim.ts 共享 variants

- [x] 1.1 新增 `modalPresenceVariants`（scale+opacity）
- [x] 1.2 新增 `drawerPresenceVariants`（x 100%→0）
- [x] 1.3 新增 `readerPresenceVariants`（y 100%→0）
- [x] 1.4 新增 `toastPresenceVariants`（y -1rem→0 + opacity）
- [x] 1.5 新增 `reduceSafe(variant)` 工厂 + `overlayPresenceVariants`
- [x] 1.6 新增 `tagListVariants`（staggerChildren 0.03, delayChildren 0.1）与 `tagItemVariants`

## 2. Modal.tsx 迁移到 AnimatePresence

- [x] 2.1 用 AnimatePresence + `{isOpen && (...)}` 替换 usePresenceAnimation
- [x] 2.2 外层遮罩 motion.div + overlayPresenceVariants
- [x] 2.3 内层 motion.div + reduceSafe(modalPresenceVariants)
- [x] 2.4 保留 mouseDownOnOverlay ref 与方案 A 判定
- [x] 2.5 删除 handleTransitionEnd 与 CSS 动画类
- [x] 2.6 ESC 监听与 ariaLabel/role 保持不变

## 3. ComicInfoDrawer.tsx 迁移到 AnimatePresence

- [x] 3.1 AnimatePresence + `{isOpen && (...)}` 替换 useModalAnimation
- [x] 3.2 遮罩 motion.div + overlayPresenceVariants
- [x] 3.3 抽屉 motion.div + reduceSafe(drawerPresenceVariants)
- [x] 3.4 tag 列表 motion.div + tagListVariants，每个 tag motion.span + tagItemVariants
- [x] 3.5 tag 前 20 个参与 stagger，第 21+ 立即出现
- [x] 3.6 内嵌 Modal 独立 AnimatePresence（Modal 已自管），无冲突

## 4. ComicReaderModal.tsx 迁移到 motion

- [x] 4.1 motion.div 替换 useModalAnimation（保留 `if (!open) return null`，无 exit 动画——全屏接管场景的有意妥协）
- [x] 4.2 遮罩 motion.div + overlayPresenceVariants
- [x] 4.3 内容层 motion.div + reduceSafe(readerPresenceVariants)
- [x] 4.4 删除 handleTransitionEnd 与 CSS 动画类

## 5. Toast.tsx 迁移到 AnimatePresence

- [x] 5.1 删除自管 show/animate state、rafRef、useEffect
- [x] 5.2 外层定位 div + AnimatePresence + motion.div + reduceSafe(toastPresenceVariants)
- [x] 5.3 水平居中由 left-1/2 + transform: translateX(-50%) 静态实现，variants 仅控制 y
- [x] 5.4 Toaster 无需改动

## 6. 删除旧 presence hook

- [x] 6.1 确认无 import（grep 验证）
- [x] 6.2 删除 useModalAnimation.ts
- [x] 6.3 删除 usePresenceAnimation.ts
- [x] 6.4 更新 index.css 注释

## 7. 更新测试

- [x] 7.1 Modal.test.tsx 删除 rAF 时序用例，改为 motion 渲染验证
- [x] 7.2 交互测试（遮罩点击/ESC/ariaLabel/zIndex/拖选逸出）全部保留通过
- [x] 7.3 Toast/Toaster 测试更新为 queryByText 断言（外层 div 总渲染）

## 8. 验证

- [x] 8.1 tsc 通过
- [x] 8.2 npm test 924 通过
- [x] 8.3 npm run lint 通过
- [x] 8.4 npm run build 通过（renderer 968 KB）
- [ ] 8.5 手动验证（deferred）：4 弹窗 spring 质感、tag 错峰
- [ ] 8.6 手动验证（deferred）：嵌套 Modal zIndex 正确
- [ ] 8.7 手动验证（deferred）：reduced-motion 退化纯 opacity
- [ ] 8.8 手动验证（deferred）：Modal 拖选逸出不误关闭
