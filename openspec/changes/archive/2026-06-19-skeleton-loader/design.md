# 设计：加载骨架屏（skeleton-loader）

本设计解释如何用 shimmer 骨架屏替代散落各处的 SVG spinner。实现细节见 `tasks.md`，行为契约见 `specs/ui-animation/spec.md`。

## 上下文与约束

探查代码库得到的关键事实：

- **spinner 散落多处**：ComicCard 的 CoverImage loading 分支、PageFlipView 的 FlipPage loading（行 274）、BikaCategoryGrid、ReaderLoadingState（ComicReaderModal 行 824）
- **shimmer keyframe 已在变更 1 定义**：`tailwind.config.js` 的 `theme.extend.keyframes.shimmer` + `animation.shimmer`
- **CSS 变量**：`--bg-secondary`（深灰）与 `--bg-tertiary`（更深）已存在，骨架屏配色可用
- **ComicCard 有 cover/detailed 两种变体**：aspect-ratio 不同（cover 用 `aspect-[6/7]`，detailed 用 `w-14 h-14` 方形）
- **CircularProgress 与按钮内 spinner 语义不同**：环形进度有数值、按钮内表达「操作进行中」，本变更不替换它们

## 关键设计决策

### 决策 1：创建通用 Skeleton 组件

**选择**：新增 `src/components/common/Skeleton.tsx`，支持 `variant: 'rect' | 'text' | 'circle'`、`className`、`style`、`aspectRatio`。

**理由**：
- 一个组件覆盖所有骨架场景（封面矩形、标题文本条、圆形头像）
- variant 决定圆角（rect 用 rounded-lg、text 用 rounded、circle 用 rounded-full）
- 配色统一用 `--bg-secondary` 基底 + `--bg-tertiary` 渐变高光

**反例**：每个场景自己写骨架——重复代码，配色不一致。

### 决策 2：shimmer 用线性渐变背景 + backgroundPosition 动画

**选择**：Skeleton 的样式为：
```css
background: linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-tertiary) 50%, var(--bg-secondary) 75%);
background-size: 200% 100%;
animation: shimmer 1.5s linear infinite;
```

**理由**：
- 变更 1 的 shimmer keyframe 是 `backgroundPosition: -200% → 200%`
- 线性渐变 + backgroundSize:200% 让高光从左滑到右
- 1.5s 周期不快不慢，符合主流骨架屏节奏

### 决策 3：ComicCard 封面骨架替换 spinner

**选择**：CoverImage 的 loading 分支（`coverSrc === undefined && coverUrl` 时）用 Skeleton（variant='rect'，aspect-ratio 与封面一致）替代 SVG spinner。

**理由**：
- 封面是网格里最大的视觉元素，spinner 占位与最终封面尺寸不一致导致布局抖动
- 骨架屏预先占好 `aspect-[6/7]` 位置，加载完成无缝替换
- cover 与 detailed 变体的 Skeleton 尺寸通过 COVER_STYLES 配置传递

### 决策 4：阅读器首屏骨架替代 spinner

**选择**：PageFlipView 的 FlipPage loading 分支（`!dataUri` 时）用占满阅读区的 Skeleton（variant='rect'，h-full）替代 SVG spinner。

**理由**：
- 阅读器首屏空白 + 小 spinner 显得空旷
- 全屏骨架更符合「正在加载整页」的语义

**注意**：预加载通常让相邻页已缓存，骨架只在首次加载或跳页时短暂出现。

### 决策 5：搜索结果网格骨架

**选择**：SearchPage 在 `isLoading` 期间渲染「骨架网格」（如 12 张骨架卡片，aspect-[6/7]），替代当前的空白等待。

**理由**：
- 用户搜索后看到骨架网格，感知「正在加载结果」
- 12 张覆盖一屏，不会过度

**约束**：骨架网格仅在 `isLoading && !filteredComics.length` 时显示，已有结果时不显示（避免每次分页都闪骨架）。

### 决策 6：保留 CircularProgress 与按钮 spinner

**选择**：不替换 CircularProgress（下载进度环）与按钮内的 SVG spinner。

**理由**：
- CircularProgress 是「带数值的进度」，语义不同于「内容正在加载」
- 按钮内 spinner 表达「操作进行中」（如「处理中...」），骨架屏不适合

### 决策 7：reduced-motion 退化为静态渐变

**选择**：Skeleton 在 reduced-motion 下 animation 关闭，只显示静态渐变背景（无移动）。

**理由**：
- 全局 CSS 兜底已把 animation-duration 压到 0.01ms，shimmer 几乎瞬时
- 但更干净的做法是显式判断，避免 0.01ms 的残留闪烁
- 静态渐变对 reduced-motion 用户可接受（无移动）

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 骨架尺寸与最终内容不一致仍有抖动 | 严格匹配 aspect-ratio（cover 用 aspect-[6/7]） |
| shimmer 在低端 GPU 卡顿 | 1.5s 周期 + linear 渐变是轻量动画；变更 6 复测 |
| 搜索骨架与实际结果切换时有闪烁 | 仅 isLoading 且无已有结果时显示骨架 |

## 不在本变更范围

- 替换 CircularProgress（语义不同）
- 替换按钮内 spinner（语义不同）
- 虚拟列表（不属于本变更）
- 修改预加载策略（保持 usePaginatedPreloader 现状）
