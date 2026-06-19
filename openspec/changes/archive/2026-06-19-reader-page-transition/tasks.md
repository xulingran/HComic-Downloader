## 1. 扩展 anim.ts 翻页 variants

- [x] 1.1 新增 `getDirectionalPageVariants()`（forward 时新页从右进、旧页向左出；函数形式由 framer-motion custom 注入方向）
- [x] 1.2 新增 `getReducedPageVariants()`（reduced-motion 退化为 opacity crossfade）
- [x] 1.3 新增 `usePageFlipVariants()` hook（根据 reduced-motion 决策）
- [x] 1.4 新增 `PAGE_FLIP_DURATION`（0.25s）与 `pageFlipTransition`（smooth tween）常量，注释说明为何不用 spring

## 2. PageFlipView 方向感知

- [x] 2.1 新增 prevPageRef + direction state
- [x] 2.2 useEffect 监听 currentPage 推断 forward/backward，更新 prevPageRef
- [x] 2.3 注释说明 4 个翻页触发路径都走 setCurrentPage，此处统一推断

## 3. PageFlipView 翻页过渡渲染

- [x] 3.1 isFlipping state + onAnimationComplete 回调
- [x] 3.2 AnimatePresence mode="popLayout" initial={false} + custom={direction}
- [x] 3.3 motion.div key={currentPage} + variants + initial/animate/exit
- [x] 3.4 single 模式：单页 motion.div
- [x] 3.5 double 模式：左右两页 + 空白页用 renderPageContent 整体渲染（在同一 motion.div 内）
- [x] 3.6 动画期间 style.pointerEvents = 'none'

## 4. wheel 节流调整

- [x] 4.1 handleWheel 改为 isFlipping 门控（return if isFlipping）
- [x] 4.2 删除原 wheelTimer 逻辑
- [x] 4.3 注释说明避免层堆积

## 5. 点击翻页区域协调

- [x] 5.1 goNext/goPrev 不变，依赖 AnimatePresence mode="popLayout" 自动处理；handlePointerDown 已加 isFlipping 守卫

## 6. scroll 模式隔离

- [x] 6.1 核对 ComicReaderModal scroll 分支不调用 PageFlipView（保持隔离）
- [x] 6.2 PageFlipView 内部无 scroll 逻辑

## 7. 验证

- [x] 7.1 tsc 通过
- [x] 7.2 npm test 924 通过（含 ComicReaderModal 翻页/预加载/滑块用例）
- [x] 7.3 npm run lint 通过
- [x] 7.4 npm run build 通过（renderer 970 KB）
- [ ] 7.5 手动验证（deferred）：single 模式键盘 ←/→ 横向滑动
- [ ] 7.6 手动验证（deferred）：double + blankPosition 无半屏闪烁
- [ ] 7.7 手动验证（deferred）：连续滚轮无层堆积
- [ ] 7.8 手动验证（deferred）：翻页中不触发拖拽
- [ ] 7.9 手动验证（deferred）：scroll 模式不变
- [ ] 7.10 手动验证（deferred）：reduced-motion 退化 opacity crossfade
