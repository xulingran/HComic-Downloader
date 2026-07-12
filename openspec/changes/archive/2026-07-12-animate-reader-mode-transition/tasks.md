## 1. 页码映射与动画基础

- [x] 1.1 新增共享的显示模式目标解析纯函数，根据当前/目标模式、当前页、总页数和 `blankPosition` 返回合法实际页锚点、双页起始页位与有效总页位，并覆盖 `none` / `front` / `end`、奇偶页数和章节首尾的参数化测试
- [x] 1.2 在 `src/lib/anim.ts` 增加滚动/分页 fade-through、单页/双页重排、模式指示器及 reduced-motion 降级所需的集中 transition/variants，补充纯函数测试并确认不使用 overshoot spring 驱动漫画页面

## 2. 共享模式过渡协调器

- [x] 2.1 实现共享 `useReaderModeTransition`（或等价模块），管理 `visibleMode`、`targetMode`、退出/准备/进入阶段、递增过渡 token 和 latest-intent-wins，确保选择当前模式为无操作
- [x] 2.2 实现共享阅读内容舞台，使 scroll 与 paged 分支按“旧层淡出并隐藏 → 目标层准备 → 新层淡入”运行，总时长不超过 300ms，且不对连续滚动长列表应用 transform/layout 或常驻 `will-change`
- [x] 2.3 将模式过渡冻结与滚轮、键盘、点击翻页、图片拖拽、进度条拖拽和页追踪组合，并为完成、取消、超时、过期 token 和组件卸载实现幂等清理
  - 后续修复：`usePageTracking` 增加 `visibleMode` 依赖，进入滚动模式时 IntersectionObserver 以新挂载的滚动容器为 root 重建，消除 scroll→paged→scroll 后 root 过期导致页追踪漂移（Bug A）
  - 后续修复：`useReaderModeTransition` 在 exit→prepare 边界用 `currentPageRef`/`blankPositionRef` 即时重算目标，避免 exiting 150ms 窗口内改页导致锚点基于陈旧页码（Bug D）
  - 后续修复：`prepareModeTarget` 经共享 `prepareScrollAnchor` 用 ResizeObserver 在图片解码撑高后重滚锚点，尺寸稳定或 240ms 预算内自停（Bug B/C）
- [x] 2.4 为协调器增加状态化 Hook 测试，验证快速 `scroll → single → double` 最终只提交 double、过期回调无效、关闭时清理以及 reduced-motion 无位移路径
  - 后续补充：exiting 窗口内 currentPage 变化时 preparing 提交最新页（Bug D 回归）；`usePageTracking` visibleMode 变化重建 observer 的单测（Bug A 回归）

## 3. 阅读器外壳与两套数据源接入

- [x] 3.1 将 `ReaderShell` 的模式按钮改为调用 `onDisplayModeRequest`，增加唯一共享活动背景、`aria-pressed` 和最新目标即时反馈，并补充控件快速切换及 reduced-motion 测试
- [x] 3.2 将在线 `ComicReaderModal` 接入共享协调器，在目标滚动层隐藏期间完成实际页定位，删除 `prevDisplayModeRef` 事后页码补偿，并保持远程共享图片缓存跨模式不清空
- [x] 3.3 将 `LocalLibraryReaderModal` 接入同一协调器、页码解析和隐藏定位流程，确保模式切换复用已物化 URL、恢复页追踪且不新增本地页面读取
- [x] 3.4 增加在线/本地对照测试，对相同页码、总页数和补白配置断言相同锚点与双页组合，并验证进入滚动模式时目标页在内容可见前收到即时定位

## 4. 单页与双页布局重排

- [x] 4.1 重构 `PageFlipView` 以区分普通页码导航和显示模式重排，普通翻页继续使用现有方向感知横向动画，模式变化禁止推断 forward/backward 或启动普通翻页锁
- [x] 4.2 使用实际图片索引作为单页/双页页面槽的稳定身份，让锚点页平滑改变位置和尺寸、伴随页淡入/淡出，并使补白页参与布局但不得成为实际页锚点
- [x] 4.3 补充 `PageFlipView` 行为测试，覆盖偶数单页进入双页、双页退出单页、front/end 补白、章节首尾、模式重排不触发横向翻页，以及重排后滚轮/拖拽恢复

## 5. 缓存、回归与实际体验验证

- [x] 5.1 扩展在线阅读器集成测试，验证 scroll/single/double 全路径保持当前实际页、模式切换不调用 `clearCache`、已缓存当前页不重复调用 `fetchPreviewImage`
  - 后续补充：scroll→paged→scroll 后 observer 以新滚动容器为 root 重建的集成回归（Bug A）
- [x] 5.2 扩展本地阅读器集成测试，使用真实可变状态验证模式切换不重复物化已缓存页、目标滚动定位不被 IntersectionObserver 回滚、快速切换最终显示最新模式
- [x] 5.3 运行 `npx tsc --noEmit`、相关 Vitest 定向用例、`npm test`、`npm run lint` 和 `npm run lint:test-quality`，修复所有由本变更引入的类型、行为和测试质量问题
  - 复跑全流程：pytest（1274 passed）、tsc（无错）、vitest（1702 passed）、lint（0 error）、lint:py / format:py（通过）、lint:test-quality（通过）
- [x] 5.4 在实际 Electron 窗口中验证短章节与数百页长章节的六种双向模式切换、快速连续点击、缩放后切换、front/end 补白和 Windows reduced-motion，确认无首帧跳页、内容重影、重复 spinner、长任务或交互锁死
  - 最终复核：后续修复已覆盖 React StrictMode 生命周期、滚动空白、分页输入锁死、普通翻页与模式重排动画隔离、双页满高度/零中缝，以及在线/本地显示模式共享持久化。
  - 2026-07-12 用户已在实际 Electron 窗口手动验证通过，同意按最终实现同步规范并归档。
