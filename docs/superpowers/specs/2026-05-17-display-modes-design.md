# 漫画阅读器显示模式设计

## 概述

在漫画预览阅读器的设置面板中添加显示模式切换功能，支持三种模式：连续滚动（现有）、单页显示、双页显示。采用状态驱动渲染方案，根据当前模式切换不同的视图组件和交互逻辑。

## 需求摘要

- 三种显示模式：连续滚动、单页显示、双页显示
- 单页/双页模式下：点击左/右区域翻页，滚轮翻页，左右箭头键翻页
- 双页模式奇数最后一页靠左显示，右侧留空
- 单页/双页模式：隐藏间距滑块，保留宽度滑块，图片默认适配容器高度，放大后可左右拖动平移
- 设置面板中用分段控件（三个图标按钮）切换模式，选中项高亮

## 数据模型

### displayMode

类型：`'scroll' | 'single' | 'double'`
默认值：`'scroll'`
持久化：localStorage key `hcomic-reader-display-mode`

存储在 `useReaderSettings` hook 中，与 `pageGap`、`imageWidth` 并列。提供 `displayMode` 和 `setDisplayMode` 返回值。

### currentPage 语义

`currentPage` 始终表示"当前可见的第一页编号"（1-indexed）。双页模式下右侧页为 `currentPage + 1`（如果存在）。切换模式时 `currentPage` 保持不变。

### 翻页边界

- 单页模式：`currentPage` 范围 `[1, totalPages]`
- 双页模式：`currentPage` 始终为奇数（1, 3, 5, ...），配对规则为 (1,2), (3,4), (5,6) ...。翻页步进为 2，但最终不超过 totalPages。从其他模式切换到双页模式时，若当前 currentPage 为偶数，则回退到 currentPage - 1

## 渲染逻辑

### 滚动模式（scroll）

保持现有实现不变：所有页面纵向排列在可滚动容器中，通过 IntersectionObserver 追踪当前页。

### 单页模式（single）

渲染一个占满内容区域高度的视口容器。容器内居中显示当前页图片：
- 图片默认适配容器高度（`max-height: 100%`，宽度按比例缩放）
- 当 `imageWidth` 大于容器宽度时，图片宽度受 `imageWidth%` 控制，超出部分可拖拽平移

### 双页模式（double）

视口容器与单页相同，但内部用 flex 横向排列两张图片：
- 左页：`imageUrls[currentPage - 1]`
- 右页：`imageUrls[currentPage]`（仅当 `currentPage < totalPages` 时显示）
- 奇数最后一页：单独靠左显示，右侧不渲染（留空）
- 图片默认适配容器高度，宽度按比例；放大行为与单页模式相同

## 翻页交互（单页/双页模式）

### 点击翻页

在视口上覆盖两个透明点击区域：
- 左侧 40% 宽度：翻到上一页
- 右侧 60% 宽度：翻到下一页
- 鼠标 hover 时在对应边缘显示半透明箭头提示（CSS transition 渐显）

### 滚轮翻页

监听 wheel 事件：
- `deltaY > 0`：翻下一页
- `deltaY < 0`：翻上一页
- 防抖 200ms，避免一次滚动翻多页

### 键盘翻页

- `ArrowLeft` / `ArrowUp`：翻上一页
- `ArrowRight` / `ArrowDown` / `Space`：翻下一页
- `Escape`：关闭阅读器（保持不变）
- `PageDown` / `PageUp`：翻下/上一页

## 放大与平移（单页/双页模式）

当图片实际宽度超过视口容器宽度时，启用拖拽平移：

- 使用 pointer events（pointerdown / pointermove / pointerup）实现拖拽
- 拖动时修改图片容器的 `translateX` 偏移
- 限制平移范围：`translateX` 不超过 `[容器宽度 - 图片实际宽度, 0]`，即图片左边界不超过容器左边界，右边界不超过容器右边界
- 释放后保持当前偏移位置

## 设置面板 UI

### 模式切换器

位于设置面板顶部（间距滑块上方），分段控件样式：
- 三个等宽按钮水平排列，整体有圆角边框
- 每个按钮包含一个 SVG 图标：
  - 滚动：竖线 + 向下箭头（表示连续流动）
  - 单页：一个矩形
  - 双页：两个并排矩形
- 选中项：背景 `rgba(108,140,255,0.2)`，图标颜色 `#6c8cff`
- 未选中项：半透明白色，hover 时微微高亮

### 滑块显示规则

- 滚动模式：显示间距滑块 + 宽度滑块（现有行为）
- 单页/双页模式：隐藏间距滑块，保留宽度滑块

## 组件拆分

1. **`useReaderSettings`**（扩展） — 新增 `displayMode` / `setDisplayMode`，localStorage 持久化
2. **`ComicReaderModal`**（修改） — 根据 `displayMode` 条件渲染滚动视图或翻页视图；设置面板新增模式切换器
3. **`PageFlipView`**（新组件） — 单页/双页模式的翻页视口，处理：
   - 当前页/页对的渲染
   - 点击翻页区域覆盖层
   - 滚轮翻页（防抖）
   - 放大平移（pointer events）
4. **`ReaderPage`**（现有，不变） — 单张图片的懒加载、缓存、错误处理

## 键盘行为

| 按键 | 滚动模式 | 单页/双页模式 |
|------|---------|-------------|
| Escape | 关闭阅读器 | 关闭阅读器 |
| ArrowUp | 向上滚动 300px | 翻上一页 |
| ArrowDown | 向下滚动 300px | 翻下一页 |
| Space | 向下滚动 300px | 翻下一页 |
| ArrowLeft | 无操作 | 翻上一页 |
| ArrowRight | 无操作 | 翻下一页 |
| PageUp | 无操作 | 翻上一页 |
| PageDown | 无操作 | 翻下一页 |

## 涉及文件

- `src/hooks/useReaderSettings.ts` — 扩展 displayMode
- `src/components/ComicReaderModal.tsx` — 条件渲染 + 设置面板
- `src/components/PageFlipView.tsx` — 新建
- `src/hooks/usePageTracking.ts` — 可能需要适配（翻页模式下不需要 IntersectionObserver 追踪）
