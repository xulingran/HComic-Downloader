## 为什么

项目当前的「加载中」反馈**统一是 SVG spinner**——`ComicCard.tsx`、`BikaCategoryGrid.tsx`、`PageFlipView.tsx`（行 274）、`CoverImage` 的加载分支全部用一个旋转的圆圈。问题：

- **感知性能差**：spinner 是「我在转圈，你等着」的语气，骨架屏（skeleton）是「这是内容大致的样子，正在填充」的语气。研究表明骨架屏在用户感知上比 spinner 快 ~30%。
- **布局抖动**：spinner 占位与最终内容尺寸不一致，加载完成后布局「跳」一下；骨架屏预先占好位置，加载完成是无缝替换。
- **质感断层**：成熟的现代应用（GitHub、Linear、Notion、YouTube）都用骨架屏，spinner 显得过时。

本变更是动画工程中**投入产出比最高**的一项——shimmer 动画用变更 1 引入的 `shimmer` keyframe 即可，组件本身简单，但体验提升明显。

## 变更内容

- **shimmer keyframe 复用**：使用变更 1 在 `tailwind.config.js` 中定义的 `shimmer` keyframe（线性渐变背景从左到右移动）。
- **ComicCard 封面骨架**：`CoverImage` 组件的 loading 分支（当前是 spinner）替换为 `Skeleton` 占位——一个圆角矩形 + shimmer 动画，aspect-ratio 与最终封面一致（`aspect-[6/7]` / `aspect-[1/1]`）。
- **搜索结果网格骨架**：搜索进行中、结果未返回时，渲染「骨架网格」（如 12 张骨架卡片排成网格），替代当前的空白等待。
- **DownloadPage 任务列表骨架**：首次加载任务列表时渲染几行骨架行（标题条 + 进度条形状）。
- **阅读器首屏骨架**：`PageFlipView.tsx:274` 的 spinner 替换为占满阅读区的骨架矩形 + 中央 shimmer 条。
- **Skeleton 组件抽离**：新增 `src/components/common/Skeleton.tsx`，支持 `variant: 'rect' | 'text' | 'circle'`、`width`、`height`、`aspectRatio`，配色与 `--bg-secondary` / `--bg-tertiary` 协调（亮色用浅灰渐变、暗色用深灰渐变）。
- **保留 spinner 作为兜底**：不全部删除，`CircularProgress`（下载进度环）与按钮内 spinner 保留——它们语义不同（环形进度有数值，按钮内 spinner 表达「操作进行中」）。
- **reduced-motion 退化**：shimmer 在 reduced-motion 下退化为静态渐变（无移动）。

## 功能 (Capabilities)

### 修改功能
- `ui-animation`: 扩展规范，新增骨架屏的行为契约——ComicCard 封面 / 搜索网格 / 下载列表 / 阅读器首屏的骨架占位、shimmer 动画参数、与最终内容的尺寸一致性、reduced-motion 退化路径。

## 影响

- 受影响文件：新增 `src/components/common/Skeleton.tsx`；修改 `src/components/common/ComicCard.tsx`（CoverImage loading 分支）、`src/pages/SearchPage.tsx`（搜索中网格）、`src/pages/DownloadPage.tsx`（首屏加载）、`src/components/PageFlipView.tsx`（阅读器首屏）、`src/components/BikaCategoryGrid.tsx`（可选）。
- 不影响：IPC、Python、shared types、store 数据结构。
- 行为差异（用户可感知）：
  - 加载状态从 spinner 变为 shimmer 骨架
  - 布局抖动消除（骨架尺寸与最终一致）
  - 系统开启「减少动画」时退化为静态渐变
- 风险：低。骨架屏是纯展示组件，无复杂状态。
- 依赖：变更 1（`shimmer` keyframe + 令牌）。与变更 2 / 3 / 4 互相独立，可并行。
- 不解决：本变更只覆盖「正在加载」的视觉反馈，不涉及加载性能本身（预加载策略在 `usePaginatedPreloader` 已存在）。
