# 设置页面快捷跳转栏

## 概述

在设置页面左侧新增一列 sticky 导航栏，列出所有设置区域的名称。点击任意一项，右侧内容区平滑滚动到对应区域，点击的项短暂高亮后恢复。

## 布局结构

```
┌─ SettingsPage ───────────────────────────────────────────────┐
│ ┌─ Sidebar (150px, sticky) ─┐ ┌─ Content (flex-1) ─────────┐│
│ │                            │ │                             ││
│ │  设置区域                   │ │  设置                       ││
│ │  ┌──────────────────────┐  │ │                             ││
│ │  │ 🎨 外观设置           │  │ │  🎨 外观设置               ││
│ │  │ 📥 下载设置           │  │ │  [主题模式 ...]            ││
│ │  │ 🌐 来源              │  │ │                             ││
│ │  │ 🏷️ 标签过滤          │  │ │  📥 下载设置               ││
│ │  │ 🔑 认证设置           │  │ │  [输出格式 ...]            ││
│ │  │ 🔌 代理设置           │  │ │                             ││
│ │  │ 🔔 通知设置           │  │ │  ...                       ││
│ │  │ 💾 缓存管理           │  │ │                             ││
│ │  └──────────────────────┘  │ │                             ││
│ └────────────────────────────┘ └─────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

## 导航栏内容

8 个设置区域，按现有 SettingsPage 中的顺序排列：

| 标签 | 跳转目标 |
|---|---|
| 🎨 外观设置 | `#section-appearance` |
| 📥 下载设置 | `#section-download` |
| 🌐 来源 | `#section-source` |
| 🏷️ 标签过滤 | `#section-tag-filter` |
| 🔑 认证设置 | `#section-auth` |
| 🔌 代理设置 | `#section-proxy` |
| 🔔 通知设置 | `#section-notification` |
| 💾 缓存管理 | `#section-cache` |

## 交互行为

- **点击跳转**：点击侧栏项 → 对应设置区块调用 `scrollIntoView({ behavior: 'smooth', block: 'start' })`
- **短暂高亮**：点击后该项高亮（accent 色背景 + 白色文字），约 1.5 秒后自动恢复为默认态
- **hover 态**：未选中项悬停时显示浅色背景（`bg-secondary`）
- **默认态**：透明背景，文字使用 `text-primary` 色

## 实现方案

全部改动集中在 `SettingsPage.tsx` 一个文件内：

1. **布局改造**：将外层 `max-w-3xl space-y-6` 改为 `flex gap-6`（或 `gap-0` 用 border 分隔），左侧 150px 宽 `w-[150px]`，右侧 `flex-1`
2. **Sidebar**：内嵌在 SettingsPage 中渲染，提取 8 个设置区域的 id/label/icon 为静态配置数组
3. **sticky**：侧栏容器使用 `position: sticky; top: 24px`（Tailwind: `sticky top-6`）
4. **短暂高亮**：`useState` 维护当前选中项 id，点击时设置，`setTimeout` 1.5 秒后清除
5. **目标区块**：每个设置区域的外层 div 添加 `id` 属性（如 `id="section-appearance"`），同时包裹 `<div>` 作为滚动锚点
6. **平滑滚动**：点击时 `document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })`

## 导航项配置

```typescript
const SECTIONS = [
  { id: 'appearance', label: '外观设置', icon: '🎨' },
  { id: 'download',   label: '下载设置', icon: '📥' },
  { id: 'source',     label: '来源',     icon: '🌐' },
  { id: 'tag-filter', label: '标签过滤', icon: '🏷️' },
  { id: 'auth',       label: '认证设置', icon: '🔑' },
  { id: 'proxy',      label: '代理设置', icon: '🔌' },
  { id: 'notification', label: '通知设置', icon: '🔔' },
  { id: 'cache',      label: '缓存管理', icon: '💾' },
] as const
```

## 文件变更

| 文件 | 变更 | 说明 |
|---|---|---|
| `src/pages/SettingsPage.tsx` | 修改 | 改布局为 flex 横排，新增 sidebar 渲染和状态，给各设置区块加 id |

仅一个文件变更，无新增依赖，无 IPC 改动。
