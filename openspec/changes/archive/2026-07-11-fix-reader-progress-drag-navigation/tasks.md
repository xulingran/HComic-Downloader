## 1. 建立拖拽导航回归测试

- [x] 1.1 为 `useSliderDrag` 增加 Hook 测试，覆盖按下定位、持续 pointermove、左右越界钳制、pointerup 最终回调以及 pointercancel/lost capture 幂等清理
- [x] 1.2 更新在线阅读器进度条测试，使用可变页码状态验证连续滚动模式拖动后目标页面元素实际执行即时滚动，而不只断言 `setCurrentPage` 被调用
- [x] 1.3 为本地漫画库阅读器增加同等的连续滚动拖拽测试，并验证拖动期间旧页面的 IntersectionObserver 通知不能覆盖用户目标
- [x] 1.4 增加单页与双页前补白模式测试，验证 `PageFlipView` 获得受有效总页数限制的目标页且不触发越界图片请求

## 2. 实现共享进度导航编排

- [x] 2.1 新增共享 `useReaderProgressNavigation` Hook，在 `useSliderDrag` 之上组合当前页更新、离散目标去重、连续滚动 `scrollIntoView` 和最终目标回调
- [x] 2.2 在共享 Hook 中实现拖动开始冻结、正常释放延迟解冻、取消及丢失 pointer capture 幂等清理，并向调用方暴露 `isDragging` 与页追踪冻结 ref
- [x] 2.3 保持 `useSliderDrag` 的目标页限制与 pointer capture 语义，补齐实现测试暴露的零宽轨道或重复清理等边界保护

## 3. 接入在线与本地阅读器

- [x] 3.1 将 `ComicReaderModal` 现有滑块拖动、即时滚动和约 200ms 解冻编排迁移到共享 Hook，保留在线预加载最终目标回调及显示模式切换滚动行为
- [x] 3.2 将 `LocalLibraryReaderModal` 接入共享 Hook，把真实 `isDragging` 和冻结 ref 传给 `usePageTracking`，并保留本地 `preloadAround` 最终目标回调
- [x] 3.3 确认 `ReaderShell` 的 pointerdown/move/up/cancel/lost-capture 绑定与拖动态视觉继续由共享返回值驱动，且在线、本地两端无重复事件处理

## 4. 验证与规范检查

- [x] 4.1 运行进度导航 Hook、`ComicReaderModal`、`LocalLibraryReaderModal`、`ReaderShell` 和 `PageFlipView` 相关 Vitest 测试并修复失败
- [x] 4.2 运行 `npx tsc --noEmit`、`npm run lint` 和 `npm run lint:test-quality`，确保类型、ESLint 与测试质量闸门通过
- [x] 4.3 运行完整 `npm test`，确认阅读器外的前端行为无回归
- [x] 4.4 使用鼠标在在线与本地阅读器的连续滚动、单页和双页模式中手动验证按下、持续拖动、轨道外释放与取消后再次拖动
- [x] 4.5 运行 `openspec-cn validate fix-reader-progress-drag-navigation --strict` 并确保变更严格校验通过
