# 漫画阅读器设置 - 设计文档

**日期**: 2026-05-13
**状态**: 已批准

## 概述

为漫画阅读器添加页面间距和图片宽度两个可调节参数，通过底部栏的设置面板进行控制，设置值通过 localStorage 持久化。

## 需求

- **页面间距**: 页面之间的垂直间距，范围 0-80px，默认 4px，步长 2px
- **图片宽度**: 单页图片的水平宽度占比，范围 30-100，默认 70，步长 1
- **持久化**: 设置值保存到 localStorage，下次打开阅读器自动恢复
- **交互**: 底部栏右侧齿轮按钮，点击弹出设置面板

## UI 设计

### 底部栏改造

当前底部栏：`进度百分比 | 进度条 | 快捷键提示`

改造后：`进度百分比 | 进度条 | 快捷键提示 | 齿轮按钮`

- 齿轮图标按钮（SVG，16px），点击弹出设置面板
- 面板定位在齿轮按钮上方（`position: absolute`，`bottom: 100%`）
- 点击面板外部或再次点击齿轮按钮时关闭面板

### 设置面板

两个标签 + 滑块，每行一个：

| 设置项 | 范围 | 默认值 | 步长 | 显示格式 |
|--------|------|--------|------|----------|
| 页面间距 | 0-80px | 4px | 2px | `{value}px` |
| 图片宽度 | 30-100 | 70 | 1 | `{value}%` |

面板样式：
- 背景：`rgba(0,0,0,0.6)` + `backdrop-filter: blur(8px)`（与顶部/底部栏一致）
- 圆角 8px
- 内边距 12px 16px
- 宽度 220px

### 图片区域改造

当前：`className="w-[70%] max-w-[600px]"` + `gap-1`

改造后：
- 图片容器宽度：`style={{ width: imageWidth + '%' }}`，移除固定的 70% 和 max-width 600px
- 页面间距：`style={{ gap: pageGap + 'px' }}`，移除固定的 `gap-1`

## 技术架构

### 方案：自定义 hook + localStorage

将间距和宽度存储在阅读器组件本地，通过自定义 hook 从 localStorage 读取和持久化。不扩展全局 useSettingsStore。

理由：这两个设置只在阅读器内使用，符合原设计文档"阅读器使用组件本地 state"的原则，改动最小。

### 新增文件

#### `src/hooks/useReaderSettings.ts`

自定义 hook，职责：
- 从 localStorage 读取保存的值，提供默认值
- 提供更新函数，变更时自动写入 localStorage
- 返回 `{ pageGap, imageWidth, setPageGap, setImageWidth }`

localStorage key：
- `hcomic-reader-page-gap` — 页面间距（数字，单位 px）
- `hcomic-reader-image-width` — 图片宽度（数字，单位 %）

```typescript
interface UseReaderSettingsReturn {
  pageGap: number      // 0-80, default 4
  imageWidth: number   // 30-100, default 70
  setPageGap: (gap: number) => void
  setImageWidth: (width: number) => void
}
```

### 修改文件

#### `src/components/ComicReaderModal.tsx`

改动点：
1. 导入 `useReaderSettings` hook
2. 底部栏右侧增加齿轮按钮（设置图标）
3. 齿轮按钮点击时切换设置面板的显示状态
4. 设置面板包含两个滑块控件
5. 图片区域容器使用动态 `gap` 和 `width` 值
6. 添加 `useEffect` 处理点击面板外部关闭逻辑

### 不修改的文件

- `useSettingsStore.ts` — 阅读器设置独立存储
- `useComicReader.ts` — 设置不影响数据获取逻辑
- `ComicCard.tsx`、各页面组件 — 阅读器入口不变

## 错误处理

- localStorage 不可用时使用默认值，不报错
- 存储的值超出范围时自动 clamp 到有效范围
- 存储的值非数字时回退到默认值

## 测试要点

### 新增测试

- `tests/unit/hooks/useReaderSettings.test.ts`：
  - 默认值正确
  - 读取 localStorage 中已保存的值
  - 更新值时写入 localStorage
  - 超范围值自动 clamp
  - 非数字值回退到默认

### 更新测试

- `tests/unit/components/common/ComicReaderModal.test.tsx`：
  - 齿轮按钮渲染
  - 点击齿轮按钮弹出设置面板
  - 滑块调整间距和宽度
  - 设置面板点击外部关闭
  - 图片容器使用动态间距和宽度
