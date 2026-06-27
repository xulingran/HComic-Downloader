# 实现任务

## 1. 基础设施（无行为变更，先落地降风险）

- [x] 1.1 将 `PageSkeleton` 从 `App.tsx`（当前内联在 33-42 行）提取为独立组件 `src/components/common/PageSkeleton.tsx`，导出具名 `PageSkeleton`，`App.tsx` 改为 import 引用；视觉与行为零变更
- [x] 1.2 新建 `src/lib/scheduler.ts`，封装 `scheduleIdle(task, options?)`：优先用 `requestIdleCallback`，不支持时降级 `setTimeout(fn, 0)`；返回 cancel 句柄。完整类型注解，导出 `scheduleIdle` 与 `cancelIdle`
- [x] 1.3 在 `tests/setup.ts` 补 `requestIdleCallback` / `cancelIdleCallback` 的 jsdom 全局 mock（基于 `setTimeout`），让所有测试默认可用
- [x] 1.4 为 `scheduler.ts` 写单测 `tests/unit/lib/scheduler.test.ts`：覆盖 idle 回调触发、cancel 生效、降级路径（mock 掉 `requestIdleCallback` 后走 setTimeout）

## 2. 懒加载预热（idle prefetch）

- [x] 2.1 在 `App.tsx` 新增 idle prefetch effect：监听 `startupProgress.done`，为 true 时通过 `scheduleIdle` 依次触发高频 chunk 的 `import()`（ComicInfoDrawer、ComicReaderModal、DownloadPage、FavouritesPage、HistoryPage、SettingsPage），仅加载不渲染
- [x] 2.2 用 `useRef` 守卫确保 prefetch 只触发一次（避免 done 抖动重复触发），prefetch 内单个 chunk 失败不影响其余（每个 import 独立 `.catch(() => {})`）
- [x] 2.3 更新 `tests/unit/App.test.tsx`：mock `scheduleIdle` 或验证 `startupProgress.done` 后高频 lazy import 被调用；fake timers 下推进确认调度时机

## 3. keep-alive 渲染结构重构

- [x] 3.1 在 `App.tsx` 引入 `visitedPages` 状态（`useState<string[]>(['search'])`），`handlePageChange` 中首次访问新 tab 时加入集合（`setVisited(prev => prev.includes(page) ? prev : [...prev, page])`）
- [x] 3.2 重构 `renderPage` 区域：把 `<AnimatePresence><motion.div key={activePage}>` 结构改为 keep-alive 容器——遍历 `visitedPages`，每个页面一个容器 div，激活页 `display:block` + `aria-hidden=false`，其余 `display:none` + `aria-hidden=true`
- [x] 3.3 tab 切换动画（`AnimatePresence` + `getTabPageVariants` + direction）迁移到激活页的容器层，保留 slide 8% + fade 的方向感知过渡与 reduced-motion 退化
- [x] 3.4 保留各 lazy 页面的 `<Suspense fallback={<PageSkeleton />}>` 包裹（低频页面首次加载兜底）；SearchPage 仍 eager 渲染
- [x] 3.5 保留 SearchPage / FavouritesPage 内部 `gridContainerKey` 整页替换语义不动（仅页面级 keep-alive，不影响列表容器级重挂）
- [x] 3.6 验证 keep-alive 下各页面本地状态保留：切走再切回输入框内容、滚动位置、折叠面板状态完整保留（**用户手动测试通过**）

## 4. ~~deferred mount（首次进入骨架兜底）~~ — 已废弃

> **废弃说明**：真机验证后发现 deferred mount 弊大于利（骨架在动画期间全程显示约 300ms，体验劣于直接渲染；且 prefetch + keep-alive 已覆盖其要解决的成本）。整个组 4 已移除。详见 design.md 决策 3'。

- [x] ~~4.1 引入 per-page deferred 状态~~ → **已移除**：`deferredDone` 状态从 App.tsx 删除
- [x] ~~4.2 onAnimationComplete 触发骨架→真实内容~~ → **已移除**：motion.div 不再挂 onAnimationComplete，直接渲染真实内容
- [x] ~~4.3 首屏 search 不走 deferred~~ → **已调整**：所有页面统一首次进入直接渲染真实内容（首屏与非首屏一致）
- [x] ~~4.4 边界处理（快速切走）~~ → **已移除**：无 deferred 状态则无此边界问题
- [x] ~~4.5 reduced-motion 验证~~ → **不再适用**：无 deferred mount 则无此验证项（reduced-motion 仍影响 tab 切换动画本身，归入组 6.3）

## 5. 切回轻量刷新钩子

- [x] 5.1 App 层向 `DownloadPage` 传入 `isActive` prop（该页是否为当前激活 tab）
- [x] 5.2 `DownloadPage` 新增 effect：`useEffect(() => { if (isActive) loadDownloads() }, [isActive])`，仅在 isActive false→true 时触发一次刷新（首挂载时 isActive 已为 true，配合原有 mount effect 避免重复请求）
- [x] 5.3 确认 SearchPage / FavouritesPage / HistoryPage 切回不主动刷新：依赖 store 缓存 + 后台订阅（FavouritesPage `onDownloadProgress` 在 keep-alive 下不中断）保证新鲜度（代码确认：仅 DownloadPage 接入 isActive）
- [x] 5.4 验证 FavouritesPage 的 `onDownloadProgress` 订阅在 keep-alive 切走期间持续生效（手动：切到收藏页发起下载 → 切走 → 完成下载 → 切回，状态已更新）（**用户手动测试通过**）

## 6. 回归测试与验证

- [x] 6.1 更新 `tests/unit/App.test.tsx` 适配 keep-alive 结构：验证存活集合随访问增长、display 切换、首次进入直接渲染真实内容（无骨架）、切回不重挂
- [x] 6.2 逐页回归：SearchPage（缓存恢复 + pendingSearch 跨页跳转）、DownloadPage（任务列表 + 后台进度同步）、FavouritesPage（三态分支 + 下载状态订阅）、HistoryPage（缓存优先）、SettingsPage（scrollTarget 跳转）功能正常（**由全量 vitest 1135 通过覆盖**，各页面专项测试均在 `tests/unit/` 下）
- [x] 6.3 动画回归：tab 切换方向感知正确、slide 8% + fade 流畅、reduced-motion 退化为纯 crossfade、卡片列表 stagger 在 keep-alive 切回不重播（**用户手动测试通过**）
- [x] 6.4 真机性能验证（按 `docs/animation-performance.md` 第 7 节清单）：DevTools Performance 录制 tab 切换，首次进入高频页面（已预热）与切回已访问页面 FPS 稳定 60，无主线程长任务（>50ms）（**用户手动测试通过**）

## 7. 提交前完整验证

- [x] 7.1 `pytest`（Python 测试，确认无后端连带影响——本次纯前端，919 通过）
- [x] 7.2 `npx tsc --noEmit`（TypeScript 类型检查，零错误）
- [x] 7.3 `npm test`（前端测试，82 文件 1135 用例全通过，含新增 scheduler 测试与 keep-alive 专项测试）
- [x] 7.4 `npm run lint:py`（Python lint，All checks passed）
- [x] 7.5 `black --check .`（Python 格式化，本次无 Python 改动；`python/ipc/search_mixin.py` 的格式问题是仓库预存，与本次无关）
- [x] 7.6 `npm run lint`（JS/TS lint，零错误，含新增 scheduler.ts、prefetch.ts、PageSkeleton.tsx）
- [x] 7.7 更新 `docs/animation-performance.md`：补充「5.5 tab 切换性能策略」章节，说明 keep-alive + deferred mount + idle prefetch 的约定
