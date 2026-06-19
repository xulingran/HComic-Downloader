## 为什么

变更 1-5 引入了 framer-motion、迁移了大量组件到 AnimatePresence、新增了列表进出场动画、阅读器翻页过渡——这些都会增加动画场景的复杂度。本变更作为整个工程的**收尾校准**，用 DevTools Performance 录制系统性地审计性能与无障碍，确保所有动画达到「不掉帧、不抖动、reduced-motion 真正生效」的标准。

同时，本变更回过头来补齐变更 1 没有完整覆盖的**性能细节**：`will-change` 的精准添加（仅活跃动画时挂、动画后摘除）、GPU 加速层审计（确认 `transform` / `opacity` 优先于 `width` / `height` / `top`）、layout 抖动排查。

## 变更内容

- **`will-change` 精准化**：审计所有动画组件，确认 `will-change` 仅在「即将开始动画」时添加、动画结束后摘除（常驻 `will-change` 会造成 GPU 内存浪费且抑制浏览器优化）。重点检查：Modal 内层、Drawer、ComicCard 网格、PageFlipView 翻页层。
- **GPU 加速层审计**：确认所有容器级动画使用 `transform` / `opacity`（GPU 友好），而非 `width` / `height` / `top` / `left`（触发 layout）。重点检查 ProgressBar 的 `width` 动画（当前是 `transition-all` + width 改变，需评估是否换成 `transform: scaleX`）。
- **layout 抖动排查**：用 DevTools Performance 录制翻页、列表进出、Modal 进出，识别主线程长任务（>50ms）与强制同步布局（forced reflow）。
- **framer-motion layout 动画评估**：变更 4 引入的列表 layout 动画，在长列表（200+ 项）下评估是否卡顿。如发现严重卡顿，记录为待办（引入虚拟列表或减少 layout 范围）。
- **reduced-motion 全面验证**：在 Windows 系统设置「视觉效果 → 在以下位置播放动画」关闭后，逐个验证所有动画场景确实退化为瞬时或纯淡入淡出，确保变更 1 的全局兜底 + 各组件 `useReducedMotion` 分支都生效。
- **framer-motion bundle 分析**：用 `vite-bundle-visualizer` 或类似工具确认 framer-motion 的实际增量符合预期（~32 KB 未压缩），并评估是否需要按需导入（`framer-motion` 支持 `motion/react` 子路径优化）。
- **关键场景 FPS 录制**：阅读器连续翻页 20 次、列表滚动 500 项、Modal 快速开关 10 次，确认 FPS 稳定在 60（高刷新率屏 120）。
- **文档沉淀**：在 `docs/` 或 `AGENTS.md` 补一段「动画性能规范」，沉淀本工程得到的约束（如「列表 stagger 不超过 20 项」「容器动画用 transform 不用 layout 属性」）。

## 功能 (Capabilities)

### 修改功能
- `ui-animation`: 扩展规范，补充性能约束章节——`will-change` 使用约定、GPU 友好属性清单、列表 stagger 上限、长列表 layout 动画的护栏、reduced-motion 验证清单。

## 影响

- 受影响文件：取决于审计结果，可能触及变更 1-5 涉及的任意文件（添加 `will-change`、替换 layout 属性、调整 stagger 上限等）。无新增功能文件，可能新增 `docs/animation-performance.md`。
- 不影响：IPC、Python、shared types、store 结构、用户可见功能。
- 行为差异（用户可感知）：
  - 部分动画更顺滑（FPS 更稳定）
  - 长列表滚动可能从卡顿变流畅（取决于审计结果）
  - 部分动画在低端硬件上不再掉帧
- 风险：低。审计类变更，不引入新功能，仅在发现问题时做局部优化。
- 依赖：变更 1-5 全部完成（否则没有可审计的对象）。
- 不解决：本变更不引入虚拟列表等架构级改动——如果发现需要，会记录为新变更而非在本变更内解决。
