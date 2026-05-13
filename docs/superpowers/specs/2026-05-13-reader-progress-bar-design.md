# 漫画阅读器：可拖拽进度条 + 智能预加载

## 背景

当前 `ComicReaderModal` 的底部进度条是纯展示组件，不支持任何交互。用户无法快速跳转到指定页面。同时，现有图片加载通过 IntersectionObserver（400px rootMargin）按需触发，所有进入视口的页面同时开始加载，没有优先级区分。

## 目标

1. 将进度条升级为可拖拽滑块，支持实时滚动跳转
2. 跳转后从目标位置智能预加载，优先加载当前页和后续页面

## 设计决策

- **拖拽模式**：实时滚动（拖动即跳转），非松手跳转
- **加载策略**：保留现有 IntersectionObserver 懒加载用于正常滚动；跳转时由父组件主动预加载目标区域
- **改动范围**：仅涉及 `ComicReaderModal.tsx` 内的 `ComicReaderModal` 和 `ReaderPage` 组件

## 功能一：可拖拽进度条

### 替换范围

将 footer 区域内现有的 `<div>` 进度条替换为自定义滑块组件（内联实现于 `ComicReaderModal` 中）。不使用原生 `<input type="range">`，因为无法做到 1px 精度的实时反馈和自定义拖拽样式。

### 交互行为

- **拖动开始**（mousedown / touchstart）：设置 `isDragging = true`，暂停 IntersectionObserver 对进度条位置的反向更新
- **拖动中**（mousemove / touchmove）：根据指针在滑块轨道上的位置计算目标页码，调用 `scrollContainerRef.current.scrollTo()` 实时滚动到对应页面
- **拖动结束**（mouseup / touchend）：设置 `isDragging = false`，恢复 IntersectionObserver 接管

### 防抖动机制

拖动期间，IntersectionObserver 的回调仍会执行（更新 `currentPage`），但不用于驱动进度条位置。进度条位置仅由指针位置决定。松手后，进度条位置由 IntersectionObserver 的 `currentPage` 驱动。

### 视觉增强

- 拖动时滑块从 14px 放大到 18px
- 滑块上方显示当前页码提示（"第 60 / 120 页"），拖动时淡入，松手后淡出
- 进度条轨道高度 4px，已填充部分使用 `#6c8cff`

## 功能二：跳转时智能预加载

### 预加载触发

父组件维护一个 `preloadTarget` state（目标页码，number | null）。当进度条拖动到新位置时更新此值。

### 预加载范围

当前页 + 往后 5 页 + 往前 2 页。例如跳转到第 60 页时，预加载范围 58-65。

### 加载顺序

串行加载，带宽集中在最需要的页面上：
1. 第 60 页（当前页）
2. 第 61 页
3. 第 62 页
4. 第 63 页
5. 第 64 页
6. 第 65 页
7. 第 59 页
8. 第 58 页

每页加载完成后再发起下一页请求。

### 与现有懒加载协同

- 父组件维护一个 `imageCache: Map<number, string>`，预加载结果写入 cache
- `ReaderPage` 新增 `cache?: Map<number, string>` prop，加载前先检查 cache
- `ReaderPage` 新增 `priority?: boolean` prop，当 `priority=true` 时跳过 IntersectionObserver 的 `isVisible` 等待，直接发起加载
- 去重自然解决：`ReaderPage` 内部已有 `if (dataUri || error) return` 检查，cache 命中时不会重复请求

### 清理时机

每次新的跳转发生时重新计算预加载范围。旧的预加载请求通过 `useEffect` 清理函数中的 `cancelled = true` 自动失效。

## 组件改动详情

### `ComicReaderModal.tsx`

新增 state：
- `isDragging: boolean` — 是否正在拖动进度条
- `preloadTarget: number | null` — 预加载目标页码
- `imageCache: Map<number, string>` — 预加载图片缓存

新增 `useEffect`：
- 监听 `preloadTarget`，串行执行预加载，结果写入 `imageCache`

Footer 区域：
- 替换为自定义滑块，包含 pointer event handlers

### `ReaderPage` 组件

新增 props：
- `priority?: boolean` — 跳过 isVisible 等待
- `cache?: Map<number, string>` — 预加载缓存

加载逻辑调整：
- 优先从 cache 读取 dataUri
- `priority=true` 时，在 useEffect 触发条件中加入 priority，不依赖 isVisible

## 不涉及改动的部分

- `useComicReader` hook
- 后端 Python 代码
- Electron 主进程
- 其他前端组件
