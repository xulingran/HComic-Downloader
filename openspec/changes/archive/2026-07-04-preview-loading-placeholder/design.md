## 上下文

漫画预览阅读器（`ComicReaderModal`）整体强制深色背景 `#1a1a2e`，与其内嵌页面的"加载中"占位视觉长期不一致：

- **翻页模式**（`PageFlipView.tsx` 的 `FlipPage`）：未就绪时渲染 `<Skeleton variant="rect" .../>`。`Skeleton` 用 `var(--bg-secondary)`/`var(--bg-tertiary)` 驱动 shimmer——浅色主题下为 `#f5f7fa`/`#eef1f5`（近白色），在深色阅读器里形成刺眼的白色色块；深色主题下为 `#16213e`/`#0f3460`（深蓝 shimmer），与阅读器背景 `#1a1a2e` 接近但并非同色。
- **滚动模式**（`ReaderPage.tsx`）：分两块——
  1. 未进入视口/非 `priority`：`repeating-linear-gradient` 横纹（懒加载占位）。
  2. 已进入视口但未加载完：孤立的 `animate-spin h-6 w-6 text-gray-600`，**无背景填充**（透明），spinner 浮在阅读器背景上，缺少占位块的"页面感"。

约束：
- 阅读器背景固定 `#1a1a2e`，不随主题切换（`ComicReaderModal` 的 `bg-[#1a1a2e]` 是硬编码常量）。
- 全局 reduced-motion CSS 兜底（`src/styles/index.css` 第 69 行 `@media (prefers-reduced-motion: reduce)`）会把所有 CSS `animation-iteration-count` 压成 `1`，`animate-spin` 自动停止；组件级 `useReducedMotionPreference()` 是第二层（见 `ui-animation` 规范）。
- 失败态占位由 `preview-error-recovery` 规范管理，不在本设计范围。
- `Skeleton` 组件本身被 `startup-skeleton-screen` 体系使用，本变更**不应**修改 `Skeleton` 的主题变量行为，以免影响启动屏与列表加载反馈。

## 目标 / 非目标

**目标：**
- 消除翻页模式在浅色主题下的白色占位色块。
- 让滚动模式与翻页模式的"加载中"占位**视觉完全一致**。
- "加载中"占位明确传达加载语义（背景色 + 中心 spinner）。
- 保留滚动模式的"未进入视口"横纹二态区分，避免满屏 spinner 喧闹。
- 加载中占位保持 `aspect-ratio: 3/4`，避免加载完成时高度跳动。
- 复用现有 reduced-motion 双层降级，不引入新的动画令牌。

**非目标：**
- 不修改失败态（`error`）占位。
- 不修改整章加载态（`ReaderLoadingState`，全屏 spinner + "加载中..."文字）。
- 不修改空白态（`ReaderEmptyState`）。
- 不改变 `Skeleton` 组件本身的行为（避免波及启动屏与列表加载反馈）。
- 不引入新的第三方依赖。
- 不改变阅读器背景色 `#1a1a2e` 的硬编码方式。

## 决策

### 决策 1：新建 `ReaderPagePlaceholder` 共享组件，不扩展 `Skeleton`

**选择**：新建 `src/components/common/ReaderPagePlaceholder.tsx`，封装"阅读器背景色 + 中心 spinner + `aspect-ratio: 3/4`"。

**理由**：
- `Skeleton` 的设计语义是"shimmer 内容填充占位"，配色绑定主题变量，被 `startup-skeleton-screen` 与 `list-loading-feedback` 复用。强行给它加 `reader` 变体会让一个组件承担两种语义冲突的配色策略（主题跟随 vs 硬编码深色），增加维护心智负担。
- 阅读器内的占位需求与 `Skeleton` 的 shimmer 语言不同：用户要的是"明确的转圈加载信号"，不是"内容正在填充"的暗示。
- 独立组件便于在 `ReaderPage` 与 `PageFlipView` 间共享，且职责单一。

**替代方案（已否决）**：
- 给 `Skeleton` 加 `reader` 变体——语义冲突，且会让 `Skeleton` 知道"阅读器背景色"这个业务常量，破坏组件通用性。
- 在 `ReaderPage`/`PageFlipView` 各自内联实现——重复代码，违反 DRY。

### 决策 2：背景色直接硬编码 `#1a1a2e`，与 `ComicReaderModal` 一致

**选择**：`ReaderPagePlaceholder` 的背景色硬编码 `#1a1a2e`，不引入新 CSS 变量。

**理由**：
- `ComicReaderModal` 已在 `motion.div` 上硬编码 `bg-[#1a1a2e]`（`ComicReaderModal.tsx:473`），阅读器是"强制深色全屏接管"场景，背景色不随主题变化是既定设计。
- 占位色与阅读器背景色保持同色，让占位"融入"阅读器，仅靠 spinner 传达加载状态，符合用户"无色或黑色带加载转圈"的诉求。
- 若引入新变量（如 `--reader-bg`）需要同步改 `ComicReaderModal`，扩大变更范围，收益不大。

**替代方案（已否决）**：
- 用 `var(--bg-primary)` 深色主题值——阅读器不随主题变，会引入浅色主题下的不一致。
- 抽 CSS 变量 `--reader-bg`——扩大范围，当前只有一个常量，不值得。

### 决策 3：spinner 复用 Tailwind `animate-spin`，reduced-motion 下靠全局 CSS 兜底停止

**选择**：spinner 用 `<svg className="animate-spin ...">`，不在组件内显式判断 `useReducedMotionPreference()`。

**理由**：
- 全局 CSS（`src/styles/index.css:69`）已在 `prefers-reduced-motion: reduce` 下把 `animation-iteration-count` 压成 `1`，`animate-spin` 自动退化为静态展示，满足规范需求"reduced-motion 下 spinner 停止旋转"。
- 这是项目 `ui-animation` 规范定义的"全局 CSS 兜底 + 组件级双层降级"策略的第一层，无需每个 spinner 组件重复实现。
- 占位背景色与 `aspect-ratio` 不依赖动画，reduced-motion 下自然保持。

**替代方案（已否决）**：
- 在 `ReaderPagePlaceholder` 内调用 `useReducedMotionPreference()` 条件渲染——与全局兜底重复，违反"双层降级"中"第一层够用则不叠加第二层"的简化原则。

### 决策 4：滚动模式保留横纹懒加载占位，仅替换"加载中"分支

**选择**：`ReaderPage.tsx` 的渲染逻辑分三态：
- 未进入视口且非 `priority`：**保留**现有 `repeating-linear-gradient` 横纹。
- 已进入视口（或 `priority`）且 `urlHash` 未就绪：**替换**为 `ReaderPagePlaceholder`。
- `urlHash` 就绪：渲染 `<img>`（不变）。

**理由**：用户明确选择"保留横纹"。横纹作为"懒加载占位（未发起请求）"与 spinner 作为"加载中（已发起请求）"的二态区分，是常见的列表懒加载视觉语言（如 Twitter / Instagram 的 feed），避免一打开阅读器就满屏 spinner 喧闹。

**替代方案（已否决）**：
- 把横纹也换成 spinner——满屏 spinner，喧闹且误导（未发起请求的页不该显示"加载中"）。

### 决策 5：`PageFlipView` 的 `FlipPage` 加载分支直接替换为 `ReaderPagePlaceholder`

**选择**：`FlipPage` 在 `!urlHash && !error` 时，把 `<Skeleton variant="rect" .../>` 替换为 `<ReaderPagePlaceholder />`。

**理由**：`Skeleton` 在 `PageFlipView` 的 import 仅用于这一处占位，替换后可同时移除该 import，减少耦合。`ReaderPagePlaceholder` 自带 `aspect-ratio: 3/4`，与原 `Skeleton` 调用传入的 `aspectRatio: '3/4'` 一致，外层布局不变。

## 风险 / 权衡

- **[视觉对比度] spinner 在 `#1a1a2e` 上需有足够对比度** → spinner 用 `text-gray-400`（`#9ca3af`）而非原滚动模式的 `text-gray-600`（`#4b5563`，对比度不足），确保深色背景下可见。这一改动也顺带修了滚动模式 spinner 偏暗的问题。
- **[与 Skeleton 体系的一致性] 项目其他位置仍用 Skeleton** → 本变更不淘汰 `Skeleton`，仅在阅读器内特例化。文档（本 design 的决策 1）明确记录"阅读器内不用 Skeleton"的理由，避免后续维护者困惑。
- **[硬编码色值漂移] `#1a1a2e` 在 `ComicReaderModal` 与 `ReaderPagePlaceholder` 双处出现** → 若未来阅读器背景色变更需同步两处。当前仅一个常量、两处引用，可接受；若后续增多再抽常量。在本 design 中显式记录此耦合。
- **[双页模式的 BlankPage 仍用半透明边框] `PageFlipView` 的 `BlankPage`（双页模式空白补白）与 `ReaderPagePlaceholder` 视觉不同** → `BlankPage` 是"无内容补白"语义（虚线边框 + 半透明底），与"加载中"语义不同，不应统一。本变更不动 `BlankPage`。

## 迁移计划

纯前端 UI 变更，无数据迁移、无 IPC 协议变更、无配置迁移：
1. 新建 `ReaderPagePlaceholder` 组件。
2. 替换 `ReaderPage.tsx` 与 `PageFlipView.tsx` 的加载分支。
3. 移除 `PageFlipView.tsx` 中不再使用的 `Skeleton` import。
4. 新增/更新前端测试。
5. 完整验证流程（`npm test` / `npx tsc --noEmit` / `npm run lint` / `npm run lint:test-quality`）。

**回滚策略**：纯文件级回滚（git revert），无副作用。
