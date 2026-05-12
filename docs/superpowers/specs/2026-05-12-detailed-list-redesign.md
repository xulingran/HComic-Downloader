# 详细列表模式重新设计

## 概述

将现有"详细列表"（`cardStyle: 'detailed'`）模式从网格布局改为真正的单列列表：一本漫画占满一整行，左侧正方形缩略图，右侧显示标题、作者、页数和 Pill 标签。

## 需求

- 单列布局，每本漫画占一行，宽度撑满容器
- 左侧 56×56px 正方形缩略图
- 右侧：标题（单行截断）+ 作者·页数（灰色副文字）+ Pill 标签（前 3 个，"+N" 展开）
- 下载按钮常驻显示在行右侧（空间足够，不需要 hover 触发）

## 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| Tag 显示方式 | Pill 标签 | 视觉上更突出，与现有风格一致 |
| 缩略图比例 | 1:1 正方形 56×56px | 紧凑，同屏显示更多漫画 |
| 实现方式 | 改造现有 DetailedCard | 避免新增第三种模式，减少代码重复 |
| 额外信息 | 作者 + 页数 | 用户要求保留 |

## 改动范围

### 1. ComicCard.tsx — DetailedCard 组件

改造 `DetailedCard` 为全宽行布局：

- 外层容器：`flex items-center`，移除 `rounded-xl shadow-sm`，改为 `border-b` 分隔线
- 缩略图：`w-14 h-14`（56px），正方形，`rounded-md object-cover`
- 内容区：`flex-1 min-w-0 ml-3`
  - 标题：`text-sm font-medium truncate`
  - 副文字：作者 + "·" + 页数，`text-xs text-[var(--text-secondary)]`
  - Tags：Pill 标签 `text-[10px] px-1.5 py-0.5 rounded-full`，前 3 个 + "+N" 按钮
- 下载按钮：移至行末尾，常驻显示，不再需要 `opacity-0 group-hover:opacity-100`
- 选中状态：左侧 `border-l-2 border-[var(--accent)]` 替代 `ring`
- 悬停：`hover:bg-[var(--bg-secondary)]` 背景微亮
- SFW 模式、加载中、加载失败状态保持不变

### 2. 页面容器布局

SearchPage.tsx、FavouritesPage.tsx、DownloadPage.tsx 中，当 `cardStyle === 'detailed'` 时，容器从 grid 切换为单列：

```
grid: grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4
detailed: flex flex-col gap-0
```

具体方式：从 `useSettingsStore` 读取 `cardStyle`，根据值切换容器 className。

### 3. 不改动的部分

- `cardStyle` 设置项仍为 `'cover' | 'detailed'` 两个选项
- SettingsPage 中的设置 UI 不变
- CoverCard 组件不变
- 批量选择模式逻辑不变（复选框位置调整到行左侧）
- useCoverImage hook 不变

## 交互行为

| 操作 | 行为 |
|------|------|
| 悬停行 | 背景变亮 `hover:bg-[var(--bg-secondary)]` |
| 选中状态 | 左侧 accent 色边框 + 微亮背景 |
| 点击标题 | 展开/收起全文（保留） |
| 点击行 | 批量模式下切换选中，否则触发 onClick |
| Tags "+N" 按钮 | 展开显示全部 tags（保留） |
| Tags "收起" 按钮 | 收起回前 3 个（保留） |
| 下载按钮 | 常驻显示在行右侧，点击触发下载 |
| 批量选择复选框 | 显示在缩略图左侧覆盖层 |
