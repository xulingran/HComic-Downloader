# 漫画阅读器模态弹窗 - 设计文档

**日期**: 2026-05-12
**状态**: 待审核

## 概述

在 SFW 模式关闭的情况下，用户点击漫画卡片的封面图或标题时，弹出一个全屏模态阅读器，以垂直滚动方式浏览漫画全部页面。类似 webtoon 阅读体验。

## 需求

- **触发条件**: SFW 模式关闭时，点击 ComicCard 的封面图或标题
- **呈现方式**: 全屏模态弹窗，深色背景，遮罩覆盖当前页面
- **浏览方式**: 所有页面垂直排列，用户上下滚动浏览
- **图片加载**: 懒加载策略，IntersectionObserver 按需加载
- **功能**: 页码指示器（当前页/总页数）、键盘导航（ESC 关闭、方向键/空格滚动）

## UI 设计

### 模态弹窗布局

全屏深色弹窗（背景 `#1a1a2e`），三个固定区域：

**顶部栏**（`position: sticky`，毛玻璃半透明效果）：
- 左侧：关闭按钮 + 漫画标题 + 页码标签（如 "3 / 24"）
- 固定在视口顶部，不随内容滚动

**中间图片区域**：
- 页面图片居中显示，宽度 70%，最大宽度 600px
- 页面之间紧凑间距（4px）
- 未加载的页面显示骨架屏占位符（渐变条纹动画）
- 图片加载中显示加载指示器
- 图片加载失败显示重试按钮

**底部进度条**（`position: sticky`，毛玻璃半透明效果）：
- 阅读进度百分比 + 进度条
- 键盘快捷键提示文字

### 页码计算

通过 IntersectionObserver 追踪哪些页面进入视口，取最靠近视口顶部的可见页面作为"当前页"。页码指示器实时更新。

## 技术架构

### 方案：IPC 获取 URL + Electron 直加载

图片 URL 由 Python 后端提供，前端直接通过 `<img>` 标签从源站加载图片，无需 Python 代理。与现有封面加载机制保持一致。

### 三层改动

#### 1. Python IPC 层

**文件**: `python/ipc_server.py`

新增方法 `handle_get_preview_urls(comic_data)`:
- 输入: `comic_data` 字典，包含 `id`、`source_site`、`comic_source`、`media_id`、`pages`、`image_urls`
- 处理:
  - HComic 源: 通过 `ComicInfo.get_all_image_urls()` 计算 URL，无网络请求
  - Moeimg 源: 通过 `MoeImgParser._fetch_read_data()` + `_extract_manga_images()` 从站点获取
- 输出: `{ image_urls: ["url1", "url2", ...], total_pages: N }`
- 错误: 返回 `{ error: "错误信息" }`

在 `handle_request` 方法中注册新的 method `get_preview_urls`。

#### 2. Electron 桥接层

**文件**: `electron/main.ts`
- 注册新的 IPC 通道 `get-preview-urls`
- 转发 renderer 的请求到 Python bridge，返回结果给 renderer

**文件**: `electron/preload.ts`
- 暴露 `window.hcomic.getPreviewUrls(comicData)` API
- 参数和返回值类型定义在 `shared/types.ts`

**文件**: `shared/types.ts`
- 新增 `getPreviewUrls` 方法签名和返回类型

**Referer 处理**:
- 在 `electron/main.ts` 中使用 `session.webRequest.onBeforeSendHeaders` 为源站图片请求注入正确的 Referer 头

#### 3. React 前端层

**新增文件**: `src/components/ComicReaderModal.tsx`

模态弹窗组件，职责：
- 渲染全屏遮罩和固定布局（顶部栏、图片区域、底部进度条）
- 管理键盘事件监听（ESC 关闭、方向键滚动）
- 管理打开/关闭动画

**新增文件**: `src/hooks/useComicReader.ts`

核心逻辑 hook，职责：
- 调用 `window.hcomic.getPreviewUrls()` 获取图片 URL 列表
- 管理 URL 列表状态、加载状态、错误状态
- 追踪当前可见页码（基于 IntersectionObserver）
- 提供懒加载回调（`onPageIntersect`）
- 管理图片加载状态（loading / loaded / error）

**修改文件**: `src/components/common/ComicCard.tsx`

改动：
- SFW 模式关闭时，给封面图和标题添加 `onClick` 事件
- 点击时调用回调函数打开阅读器，传递漫画数据
- 回调由父组件（SearchPage / FavouritesPage）通过 props 传入

**修改文件**: `src/pages/SearchPage.tsx`、`src/pages/FavouritesPage.tsx`

改动：
- 管理 `ComicReaderModal` 的渲染和状态
- 维护当前打开的漫画数据
- 将打开阅读器的回调传递给 `ComicCard`

### 数据流

```
用户点击封面/标题
  → ComicCard 调用 onOpenReader(comicData)
  → 页面组件设置 activeComic 状态，渲染 ComicReaderModal
  → ComicReaderModal 内部 useComicReader 调用 IPC
  → Python 返回图片 URL 列表
  → 渲染占位列表（每页一个 div）
  → IntersectionObserver 触发懒加载
  → img 标签直接从源站加载图片
  → 滚动时 IntersectionObserver 更新当前页码
```

### 状态管理

使用组件本地 state（`useState` / `useReducer`），不引入全局 Zustand store。原因：同一时间只会有一个阅读器打开，无需跨组件共享阅读器状态。

`useComicReader` hook 内部状态：
- `imageUrls: string[]` — 图片 URL 列表
- `loadingState: 'idle' | 'loading' | 'loaded' | 'error'` — 整体加载状态
- `currentPage: number` — 当前可见页码
- `pageStates: Map<number, 'loading' | 'loaded' | 'error'>` — 每页加载状态

## 错误处理

### 图片加载失败
每张图片独立的错误状态。显示重试按钮，用户点击后重新加载该页。不影响其他已加载页面。

### 漫画无页面数据
如果后端返回 0 页或获取 URL 失败，弹窗显示"无法加载漫画内容"提示文字和关闭按钮。

### SFW 模式变更
阅读器打开期间用户开启 SFW 模式时不主动关闭阅读器（用户已选择查看），但关闭后无法重新打开。

### 登录过期
图片请求返回 403 时，复用现有 `LoginExpiredDialog` 组件提示用户刷新认证。

### 并发控制
同时只允许一个阅读器实例。用户在阅读器打开时点击另一本漫画，关闭当前阅读器并打开新的。

### 内存管理
懒加载天然控制内存。使用 `loading="lazy"` 属性和 IntersectionObserver 双重保障。离开视口的图片由浏览器自行管理缓存释放。

## 测试要点

- Python: `handle_get_preview_urls` 的单元测试，覆盖两个源站
- Electron: IPC 通道的集成测试
- React: `ComicReaderModal` 组件的渲染测试、`useComicReader` hook 的逻辑测试
- 集成: SFW 模式下点击不触发阅读器、非 SFW 模式下正确打开
