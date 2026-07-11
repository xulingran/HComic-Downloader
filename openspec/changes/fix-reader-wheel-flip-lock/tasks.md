## 1. 建立翻页锁卡死回归测试

- [x] 1.1 在 `tests/unit/components/common/PageFlipView.test.tsx` 新增用例：首帧挂载后用 `rerender` 模拟父级异步 `setCurrentPage` 改 `currentPage`，再 `vi.advanceTimersByTime(FLIP_LOCK_TIMEOUT)` 推进兜底定时器并断言滚轮 `wheel(deltaY>0)` 触发 `setCurrentPage(当前页+step)`；用 `act()` 包裹定时器推进以 flush 解锁状态
- [x] 1.2 验证该回归用例在撤销兜底定时器修复时失败（`git stash` 实现、跑该用例确认 0 次调用），固化"回调丢失即卡死"缺陷不会回归
- [x] 1.3 增加 `afterEach(() => vi.useRealTimers())` 兜底恢复真实定时器，防止 fake timers 泄漏到依赖真实 `setTimeout`/Promise 的异步用例（如共享缓存回写用例）
- [x] 1.4 保留并继续通过既有的"首次挂载后滚轮立即可用"三条用例，确认首帧路径未被新逻辑破坏

## 2. 实现兜底解锁定时器

- [x] 2.1 在 `src/components/PageFlipView.tsx` 新增 `FLIP_LOCK_TIMEOUT`（=600ms）具名常量，附注释说明其与 `DURATION.slow`(300ms) 的 2 倍裕量关系及"回调丢失自愈硬上限"语义
- [x] 2.2 新增 `flipLockTimerRef`，在上锁 effect 内 `setIsFlipping(true)` 后 `clearTimeout` 上一个再 `setTimeout(…FLIP_LOCK_TIMEOUT)` 强制解锁、置空 ref；更新该 effect 注释说明首帧之后的异步改页路径（fetchUrls/续读/模式切换）也会上锁且回调可能丢失
- [x] 2.3 在 `handleAnimationComplete` 内清除兜底定时器（正常解锁路径），避免回调已解锁后定时器残留
- [x] 2.4 新增组件卸载 effect，cleanup 中 `clearTimeout(flipLockTimerRef.current)`，避免卸载后 `setIsFlipping` 触发 React 警告或内存泄漏

## 3. 验证与规范检查

- [x] 3.1 运行 `npx vitest run tests/unit/components/common/PageFlipView.test.tsx`，确认新增回归用例通过且既有 26 条用例无回归
- [x] 3.2 运行 `npx tsc --noEmit`，确认类型检查通过
- [x] 3.3 运行 `npx eslint src/components/PageFlipView.tsx tests/unit/components/common/PageFlipView.test.tsx`，确认无新增 error（既有 `react-refresh` warning 来自 `inferPageDirection` 导出，非本次引入）
- [x] 3.4 运行 `npm run lint:test-quality`，确认测试质量闸门通过
- [x] 3.5 运行完整 `npm test`，确认 1661 条前端用例全绿、阅读器外行为无回归
- [x] 3.6 运行 `openspec-cn validate fix-reader-wheel-flip-lock --strict` 并确保变更严格校验通过
- [ ] 3.7 在真实 Electron（`npm run dev`）下手动验证：打开阅读器后不点按钮直接滚轮即可翻页；切换章节/续读定位后滚轮立即可用；快速连续滚轮仍受动画期间节流保护
