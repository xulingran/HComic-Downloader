## 为什么

漫画阅读器翻页模式存在"必须先点击上一页/下一页按钮，之后才能用鼠标滚轮翻页"的缺陷：打开阅读器后直接滚动滚轮无效，只有点过一次边缘按钮后滚轮才恢复。根因是 `PageFlipView` 的翻页锁 `isFlipping` 状态机失衡——上锁源（监听 `currentPage` 变化的 effect）在首次挂载之后的任何 `currentPage` 变化都会上锁，但解锁源（framer-motion 的 `onAnimationComplete` 回调）只在真实动画播放完成时才触发。父组件 `ComicReaderModal` 在 `fetchUrls`、历史续读、显示模式切换等异步路径里改 `currentPage` 时，若该次变更没有真正播动画（首屏图仍在加载、`AnimatePresence` 重挂载、reduced-motion 等），回调不触发，`isFlipping` 永久卡在 `true`，滚轮与拖拽平移被永久吞掉；而点击边缘按钮绕过门控、间接触发一次真实动画解锁，于是表现出"先点按钮才能滚轮"。现有 `reader-flip-input-gating` 规范只覆盖了首次挂载这一种失衡，未覆盖"挂载后程序性改页且动画完成回调丢失"这一类。

## 变更内容

- 为翻页锁 `isFlipping` 增加兜底硬上限：上锁时同步启动一个不超过最大翻页动画时长的定时器，到点强制解锁；正常 `onAnimationComplete` 提前解锁则清除该定时器。即便动画完成回调丢失，门控最多持续该硬上限时长后自愈，`isFlipping` 不会再永久卡死。
- 上锁 effect 与解锁回调共同维护该兜底定时器：上锁时设置、动画完成回调与组件卸载时清除，避免卸载后 setState 或正常解锁后定时器残留。
- 新增回归测试覆盖"首帧后父级异步改 `currentPage` 且动画完成回调丢失"场景下滚轮仍可在硬上限时长后恢复可用，并验证撤销兜底时该用例失败（固化该缺陷不会回归）。

## 功能 (Capabilities)

### 新增功能

无。

### 修改功能

- `reader-flip-input-gating`: 修改"翻页输入门控必须与翻页动画的真实播放状态对称"需求，新增"动画完成回调丢失时门控必须在硬上限时长内自愈"场景，并收紧"真实翻页动画完成后门控恢复"场景使其不依赖 `onAnimationComplete` 一定触发。

## 影响

- 前端组件：`src/components/PageFlipView.tsx`（新增 `FLIP_LOCK_TIMEOUT` 常量、`flipLockTimerRef`，上锁 effect 设置兜底定时器、`handleAnimationComplete` 与卸载 effect 清除定时器）。
- 测试：`tests/unit/components/common/PageFlipView.test.tsx`（新增回归用例 + `afterEach` 恢复真实定时器，`act` 包裹 fake-timer 推进以 flush 解锁状态）。
- 规范：`openspec/specs/reader-flip-input-gating/spec.md` 增量更新。
- 不新增后端 IPC、网络请求或第三方依赖，不改变下载、缓存、阅读进度存储、翻页动画 variants 与翻页方向推断契约。
