## 新增需求

> 本增量向 `ui-animation` capability 新增加载骨架屏的行为契约。

### 需求: 项目必须提供通用 Skeleton 组件用于加载占位

系统**必须**提供 `src/components/common/Skeleton.tsx` 通用骨架组件，支持 `variant: 'rect' | 'text' | 'circle'`，配色用 `--bg-secondary` 基底 + `--bg-tertiary` 高光，动画用变更 1 定义的 `shimmer` keyframe。

#### 场景: rect 变体用于封面占位

- **当** 组件需要为图片封面显示骨架
- **那么** 使用 variant='rect'（rounded-lg），aspect-ratio 与最终封面一致

#### 场景: text 变体用于文本占位

- **当** 组件需要为标题/作者文本显示骨架
- **那么** 使用 variant='text'（rounded），高度匹配文本行高

### 需求: ComicCard 封面加载必须用骨架屏替代 spinner

当封面图片正在加载（coverSrc === undefined 且有 coverUrl）时，ComicCard 的 CoverImage **必须**显示 Skeleton 占位，**禁止**使用 SVG spinner。

#### 场景: 封面加载中显示骨架

- **当** 封面图片尚未加载完成
- **那么** 显示与封面 aspect-ratio 一致的 rect 骨架，shimmer 动画

#### 场景: 骨架尺寸与封面一致避免布局抖动

- **当** 封面从骨架切换为真实图片
- **那么** 骨架与图片 aspect-ratio 严格一致（cover 用 aspect-[6/7]），无布局抖动

### 需求: 阅读器首屏加载必须用骨架屏替代 spinner

当阅读器页面图片尚未加载（PageFlipView 的 FlipPage 无 dataUri）时，**必须**显示占满阅读区的 Skeleton，**禁止**使用小尺寸 SVG spinner。

#### 场景: 阅读器页面加载中显示全屏骨架

- **当** 阅读器某页图片尚未加载完成
- **那么** 显示占满阅读区的 rect 骨架（h-full），shimmer 动画

### 需求: 搜索结果加载必须显示骨架网格

当搜索正在进行（isLoading）且尚无结果（filteredComics 为空）时，SearchPage **必须**渲染骨架网格（约 12 张骨架卡片），**禁止**显示空白或仅 spinner。

#### 场景: 搜索中显示骨架网格

- **当** isLoading 为 true 且 filteredComics 为空
- **那么** 渲染 12 张 aspect-[6/7] 骨架卡片，shimmer 动画

#### 场景: 已有结果时不显示骨架

- **当** isLoading 为 true 但已有 filteredComics（如分页加载）
- **那么** 保持显示现有结果，不闪烁骨架

### 需求: 骨架屏 shimmer 必须在 reduced-motion 下退化为静态渐变

当 `prefers-reduced-motion: reduce` 为真时，Skeleton 的 shimmer 动画**必须**关闭，只显示静态渐变背景，**禁止**产生移动。

#### 场景: reduced-motion 下骨架无移动

- **当** 用户启用「减少动画」且看到骨架
- **那么** 骨架显示静态渐变背景，无 shimmer 移动
