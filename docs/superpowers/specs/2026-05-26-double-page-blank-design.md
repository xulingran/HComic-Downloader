# 双页模式空白页偏移功能设计

## 背景

漫画阅读器的双页模式将页面按固定配对显示：`(img[0],img[1])`, `(img[2],img[3])`, ... 对于包含跨页大图（spread）的漫画，如果封面是单页，后续的跨页图可能被拆到相邻的两个视图中，无法正确并排显示。通过在最前面或最后面插入虚拟空白页，可以偏移配对，使跨页图正确对齐。

## 方案

采用偏移量透传方案：空白页是显示偏移问题，不是数据问题。偏移逻辑集中在 `PageFlipView`（配对发生的地方），不影响 `imageUrls`、缓存、预加载等其他模块。

## 状态管理

- **状态位置：** `ComicReaderModal` 中用 `useState<BlankPosition>` 管理
- **类型：** `BlankPosition = 'none' | 'front' | 'end'`
- **生命周期：** 不持久化，关闭模态框或切换漫画时自然重置
- **作用范围：** 仅双页模式生效；切换到其他显示模式时重置为 `'none'`
- **传递方式：** 通过 prop 传给 `PageFlipView`

## PageFlipView 页码偏移逻辑

`currentPage` 和步进逻辑不变（始终奇数，step=2），仅渲染时做索引偏移。

| 模式 | leftIdx 计算 | rightIdx 计算 | 空白页条件 |
|------|-------------|-------------|-----------|
| none | `currentPage - 1` | `currentPage` | 无（原始行为） |
| front | `currentPage - 2` | `currentPage - 1` | leftIdx < 0 时左侧渲染空白页 |
| end | `currentPage - 1` | `currentPage` | rightIdx >= totalPages 时右侧渲染空白页 |

**front 模式配对效果：**
- currentPage=1：(blank, img[0])
- currentPage=3：(img[1], img[2])
- currentPage=5：(img[3], img[4])

**end 模式配对效果：**
- 与 none 相同，仅在最后一屏右侧超出范围时渲染空白页

键盘翻页、滚轮翻页、进度条拖拽不受影响。页码显示（header/footer 的 "3 / 20"）保持逻辑页码。

## 设置面板 UI

- **位置：** 现有阅读设置面板（齿轮图标弹出），在显示模式切换器下方
- **可见性：** 仅 `displayMode === 'double'` 时显示
- **控件：** 三态按钮组，复用 `ModeButton` 组件
  - 「无」— blankPosition='none'
  - 「前补白」— blankPosition='front'
  - 「后补白」— blankPosition='end'
- **图标：** 各配一个 SVG 小图标（无=双页无标记，前补白=左页虚线框，后补白=右页虚线框）
- **模式切换重置：** 从双页切到其他模式时，blankPosition 自动重置为 'none'

## 空白页渲染

空白页显示为与相邻页面等高的 `<div>`，背景色稍亮于阅读器底色，带虚线边框，让用户能区分占位页和真实页面。使用纯色背景 + 虚线矩形即可，无需复杂样式。

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/hooks/useReaderSettings.ts` | 新增 `BlankPosition` 类型导出 |
| `src/components/ComicReaderModal.tsx` | 新增 blankPosition 状态、设置面板三态按钮、切换模式时重置逻辑 |
| `src/components/PageFlipView.tsx` | 接收 blankPosition prop，调整 leftIdx/rightIdx 计算，渲染空白占位 |
