# 动画性能规范

本工程（变更 1-6：animation-foundation → animation-perf-audit）建立的动画性能约束。所有新增动画必须遵守。

## 1. 动画令牌（单一来源）

所有动画时长/曲线必须用 `tailwind.config.js` 的令牌，**禁止**裸数值：

| 令牌 | 值 | 用途 |
|------|-----|------|
| `duration-fast` | 150ms | 微交互（hover、按钮） |
| `duration-base` | 200ms | 标准容器（Toast） |
| `duration-slow` | 300ms | 弹窗进出场 |
| `duration-slower` | 450ms | 强调过渡 |
| `ease-spring` | cubic-bezier(0.34, 1.56, 0.64, 1) | 弹窗「弹一下」 |
| `ease-smooth` | cubic-bezier(0.4, 0, 0.2, 1) | 位置过渡、翻页 |

JS 内用 `src/lib/anim.ts` 的 `DURATION` 常量与 variants。

## 2. reduced-motion（无障碍）

**双层策略**：

1. **全局 CSS 兜底**（`src/styles/index.css`）：`@media (prefers-reduced-motion: reduce)` 把所有 transition/animation 压到 0.01ms。这是最后一道防线。
2. **组件级 JS 判断**：所有 framer-motion 容器用 `useReducedMotionPreference()` 或 `reduceSafe()`，在 variants 层把运动分量（x/y/scale）归零，只保留 opacity。

**要求**：新增任何 framer-motion 动画必须处理 reduced-motion。

## 3. will-change 约定

- **禁止**常驻 `will-change`（浪费 GPU 内存）
- **应该**仅在动画进行时通过 framer-motion 的内置优化或显式 `style={{ willChange: ... }}` 提供 hint
- 参考实现：PageFlipView 翻页期间 `willChange: 'transform'`，结束后移除

## 4. GPU 友好属性

容器动画**必须**用 `transform` / `opacity`（GPU 合成层），**禁止**用 `width` / `height` / `top` / `left`（触发 layout）。

**例外**：ProgressBar 的 `width` 动画保留——进度条场景影响小，scaleX 替代会圆角变形。

## 5. 长列表动画护栏

- **stagger 封顶**：列表进出场仅前 `STAGGER_LIMIT=20` 项错峰，之后立即出现（`getCardItemVariants(index)`）
- **CSS contain**：`AnimatedCardWrapper` 用 `style={{ contain: 'layout' }}` 隔离重排
- **layout 动画**：用 framer-motion `layout` prop + `LayoutGroup` 协调，避免整页重排

## 5.5 tab 切换性能策略（keep-alive + idle prefetch）

tab 切换掉帧的根因是「新页面在动画第一帧被完整 mount」造成的主线程突发负载（lazy chunk 加载 + 20-67 个 hooks + N 个 motion.div 注册）。两层优化各自负责不同频次的切换成本：

| 切换频次 | 成本来源 | 优化 | 实现 |
|------|---------|------|------|
| 首次进入某页 | chunk 下载 + 冷 mount | ① idle prefetch | `src/lib/prefetch.ts`（首次 mount 走 store 缓存快路径，足够轻） |
| 再次切回该页 | 重挂 + stagger 重播 | ② keep-alive | App.tsx `visitedPages` + `display` 切换 |

- **idle prefetch**：应用就绪（`startupProgress.done`）后空闲窗口（`src/lib/scheduler.ts` 的 `scheduleIdle`）静默预加载高频 lazy chunk（ComicInfoDrawer/ComicReaderModal/DownloadPage/FavouritesPage/HistoryPage/SettingsPage），仅加载不渲染。低频页面不预热。
- **keep-alive**：页面切走不卸载，改用 `display: none` 隐藏、切回复用实例。懒创建（`visitedPages` 初始仅含 `search`，访问新 tab 才加入）。切回变为纯合成层切换（零 mount、零 stagger 重播）。
- **首次进入直接渲染**：首次挂载时直接渲染真实内容（chunk 已预热、数据走 store 缓存快路径），**不走骨架兜底**——曾尝试 deferred mount（动画期间显示骨架）但因骨架闪现的视觉负担被废弃。
- **切回刷新**：keep-alive 下 mount effect 不重复触发，仅 `DownloadPage` 接收 `isActive` prop 在切回时轻量重拉任务列表；其余页面依赖 store 缓存 + 后台订阅保证新鲜度。

**护栏**：
- lazy 页面的 `<Suspense fallback={<PageSkeleton/>}>` 仅在未预热的低频页面首次加载时出现一次（React.lazy 标准行为），高频页面因 prefetch 已就绪不会触发
- `gridContainerKey`（SearchPage/FavouritesPage 列表容器级重挂）语义保留，与页面级 keep-alive 互不冲突
- `display: none` 让浏览器跳过离屏页的 layout 与 paint，禁止用 `visibility: hidden`（占布局）或 `opacity: 0`（占合成层）

## 6. bundle 基线

- framer-motion 全量引入后 renderer JS bundle 约 976KB（gzip ~290KB）
- CSS 约 47KB
- Electron 桌面应用对体积不敏感，不做按需导入

## 7. 验证清单（真机，每次动画相关改动后）

- [ ] DevTools Performance 录制关键场景（翻页/列表/Modal），FPS 稳定 60
- [ ] 长列表（200+）layout 动画无主线程长任务（>50ms）
- [ ] Windows 关闭「视觉效果 → 播放动画」后，所有动画退化为瞬时或纯淡入淡出
- [ ] `npm run build` 后 bundle 不显著超过基线
