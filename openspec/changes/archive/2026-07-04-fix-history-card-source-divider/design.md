## 上下文

`HistoryPage.tsx` 的 `HistoryCard` 组件（约第 405–502 行）按 `cardStyle` 渲染两种布局：

- **detailed**（列表，第 418–461 行）：横向 flex 行 `[封面缩略图][标题+来源元信息][下载按钮][删除]`，来源标签是同一 `text-xs` div 内的内联 `<span>`，用 `·` 分隔。行间靠父容器 `border-b border-[var(--border)]` 分隔。**无分隔问题。**
- **cover**（网格，第 464–501 行）：渲染共享 `ComicCard`（其内部 `CoverCard` 用 `p-2` 包标题+作者，见 `ComicCard.tsx:224-238`），随后**额外**追加一个来源/元信息 `<div>`：

  ```jsx
  <ComicCard ... />
  <div className="px-2 pb-2 -mt-1">
    <div className="text-xs text-[var(--text-secondary)]">
      <span>{sourceSiteLabel}</span>
      ...
    </div>
  </div>
  ```

两个 bug 让来源行视觉上贴死在卡片主体底部：

1. `-mt-1` 负边距把来源行往上拉，吃掉 `ComicCard` 主体 `p-2` 的下内边距。
2. 来源行与卡片主体之间无任何分割（无 border、无背景区分、无留白）。

约束：`CoverCard` 自身渲染 `bg-[var(--bg-primary)] rounded-xl shadow-sm` 容器，来源行是其**同级**元素、位于外层 `HistoryCard` 容器内。

## 目标 / 非目标

**目标：**
- 把封面布局历史卡片的来源/元信息行做成视觉独立的 footer：与卡片主体之间有正向留白 + 顶部分割线。
- 与项目既有"行间用 `border-[var(--border)]` 分隔"约定一致（detailed 用 `border-b`，cover footer 用 `border-t`）。
- 零运行时风险：单 className 调整。

**非目标：**
- 不改 `detailed` 布局（来源标签已是内联 span，原本就对齐）。
- 不改共享 `ComicCard` / `CoverCard`（影响搜索页、收藏页等其他使用方）。
- 不引入背景色区分 footer（见决策 3 的否决理由）。
- 不新增组件测试（纯样式 className，项目测试质量闸门禁止低价值的 className 字符串往返断言）。

## 决策

### 决策 1：用 `mt-2` + `pt-2` + `border-t` 替代 `-mt-1`

新 className：`px-2 pt-2 pb-2 mt-2 border-t border-[var(--border)]`

- `mt-2`（8px）+ `pt-2`（8px）：来源行与卡片主体底部之间留约 16px 总间距，足够视觉分离。
- `border-t border-[var(--border)]`：1px 顶部分割线，把来源行明确表达为独立 footer 区域。
- 保留 `px-2`：来源行与标题/作者行水平对齐（CoverCard 主体也是 `p-2`）。
- 保留 `pb-2`：卡片底部内边距不变。

**为什么不用更大的 `mt-4`/`pt-4`**：12px 与 16px 视觉差距小，`mt-2 pt-2`（共 16px）已足够，且不破坏卡片整体紧凑度（封面网格卡片本身较矮）。

**为什么不用 `gap-*` 代替 margin**：来源行与 `ComicCard` 是两个独立根级元素（`ComicCard` 返回自己的 `rounded-xl` 容器），它们之间没有共享的 flex/grid 父级可挂 `gap`。父级是外层 `HistoryCard` 的 `div`（无 flex/grid），margin 是唯一选择。

### 决策 2：复用 `--border` 变量，不引入新 token

`border-[var(--border)]` 是项目既有的边框分隔色（detailed 布局 `border-b border-[var(--border)]`、详细卡片 `ComicCard.tsx:257` 等多处使用）。直接复用，确保与详细布局的行分隔视觉一致，且自动适配深/浅色主题。

### 决策 3：不加 footer 背景色（`bg-[var(--bg-secondary)]`）

考虑过给 footer 加 `bg-[var(--bg-secondary)]/40` 做进一步区分，否决原因：

- `CoverCard` 自身渲染 `rounded-xl` 容器，其底部边缘是圆角。footer 是该圆角容器的**同级**元素（位于外层 `HistoryCard` 的直角容器内），footer 背景色会在圆角卡片下方形成一个直角的浅色条带，与卡片圆角不连续，视觉割裂。
- 顶部分割线（决策 1）已足够表达"独立区域"，加背景色属过度设计。

## 风险 / 权衡

- **[footer 在圆角卡片下方视觉不连续]** 如上所述，footer 是圆角卡片同级元素。→ 缓解：决策 3 否决了背景色，仅用顶部分割线 + 留白，分割线是水平直线不涉及圆角连续性问题，无视觉割裂。
- **[来源行内联 span 换行后与分割线贴太近]** 当 `lastChapterName` 较长导致来源行换行时，第二行可能贴分割线。→ 缓解：`pt-2` 已在分割线与文字间留 8px，足够；且来源行 `text-xs` 字号小、`·` 分隔符已限流，极少换行。
- **[回归：其他使用 ComicCard 的页面]** 共享 `ComicCard` 未改动，仅改 `HistoryCard` 的 footer 容器。→ 缓解：搜索页、收藏页等不渲染此 footer（footer 是 `HistoryCard` 独有），零影响。

## 迁移计划

纯前端单 className 改动，无数据/配置/IPC 迁移。

- 部署：随下次发布；无需用户操作。
- 回滚：revert 单个 commit 即可。
- 验证：`npm test`（1442/1442 通过）+ `npm run lint`（仅无关文件预存警告）+ `npx tsc --noEmit`（通过）。

## 待解决问题

（无。`mt-2 pt-2 border-t` 组合、复用 `--border`、否决背景色均已在决策中确定。）
