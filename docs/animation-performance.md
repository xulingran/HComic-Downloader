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

## 6. bundle 基线

- framer-motion 全量引入后 renderer JS bundle 约 976KB（gzip ~290KB）
- CSS 约 47KB
- Electron 桌面应用对体积不敏感，不做按需导入

## 7. 验证清单（真机，每次动画相关改动后）

- [ ] DevTools Performance 录制关键场景（翻页/列表/Modal），FPS 稳定 60
- [ ] 长列表（200+）layout 动画无主线程长任务（>50ms）
- [ ] Windows 关闭「视觉效果 → 播放动画」后，所有动画退化为瞬时或纯淡入淡出
- [ ] `npm run build` 后 bundle 不显著超过基线
