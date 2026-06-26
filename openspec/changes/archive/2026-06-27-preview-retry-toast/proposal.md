## 为什么

漫画预览（阅读器）界面在加载图片时，单页失败只能逐页手动重试；翻页模式（FlipPage）甚至连单页重试入口都没有。当网络抖动或来源限流导致多页失败时，用户被迫一页页点重试，体验割裂且容易遗漏。需要一种"失败聚合 + 一键批量重试"的机制，让用户能在失败规模较大时快速恢复。

## 变更内容

- **新增**：阅读器层面的失败页聚合状态（`useFailedPages` hook），跟踪所有加载失败的页索引
- **新增**：当累计失败页数 > 3 时，弹出**常驻 Toast**（不自动消失），文案为"N 页加载失败"，带"全部重试"按钮
- **新增**：点击"全部重试"后，所有失败页重新进入加载流程；恢复后 Toast 文案更新为"已恢复 N 页"并短暂停留后消失
- **新增**：失败数降回 ≤ 3 时 Toast 自动隐藏
- **扩展**：`useToastStore` 支持 `actionLabel` / `onAction` / `persistent` 选项，让 store 驱动的 Toast 也能带按钮与常驻（当前仅 `<Toast>` 组件原生支持，store `show()` 不支持）
- **扩展**：翻页模式（`FlipPage`）失败态补**单页重试按钮**，修复其当前仅显示文字、无重试入口的遗留

## 功能 (Capabilities)

### 新增功能
- `preview-error-recovery`: 漫画预览（阅读器）界面的失败页聚合、阈值检测、批量重试与状态反馈机制。涵盖失败上报、>3 阈值触发常驻 Toast、"全部重试"行为、重试后的恢复反馈、失败数回落时自动隐藏。

### 修改功能
- `error-display`: 扩展全局 Toast 系统——`useToastStore` 的 `show` 系列方法支持 `actionLabel` / `onAction` / `persistent` 选项；`Toaster` 在 persistent 模式下不启动自动消失定时器。现有 4 秒自动消失的非持久 Toast 行为保持不变。

## 影响

- **新增代码**：
  - `src/hooks/useFailedPages.ts`（失败页状态 hook）
  - `src/components/preview/PreviewRetryToast.tsx`（常驻重试 Toast 渲染逻辑，或在 ComicReaderModal 内联）
- **修改代码**：
  - `src/stores/useToastStore.ts`（扩展 show 签名）
  - `src/components/common/Toaster.tsx`（persistent 分支）
  - `src/components/ComicReaderModal.tsx`（挂载失败聚合 + Toast）
  - `src/components/ReaderPage.tsx`（接收 onFailed / retryGen props，两条失败路径上报）
  - `src/components/PageFlipView.tsx`（FlipPage 接收 props，失败态加重试按钮）
- **测试**：`tests/` 下新增 useFailedPages 单测、阈值/重试交互测试、Toaster persistent 行为测试
- **不受影响**：Python 后端、IPC 契约、预加载器（预加载失败已天然由叶子组件的失败捕获兜底）、CBZ 打包、下载流程
