## 为什么

历史记录页**封面网格布局**（cover grid）的漫画卡片，把"来源站点 + 页码 + 章节 + 阅读时间"元信息行追加在共享 `ComicCard` 之后，包在 `<div className="px-2 pb-2 -mt-1">` 里。两个问题让来源行与卡片主体的标题/作者"挤"在一起，看不出是两个独立区域：

1. **`-mt-1` 负边距**吃掉了 `ComicCard` 主体 `p-2` 留下的间距，来源行被向上拉、贴到作者行底部。
2. **没有任何分隔**（无 `border-t`、无背景区分、无留白），来源行不像独立区域。

用户原话："历史记录页的漫画卡片来源与漫画卡片中间不太对，应该是分开的。" `detailed` 列表布局不受影响（来源标签是同一行的内联 span，用 `·` 分隔）。

## 变更内容

- 将封面布局历史卡片的来源/元信息行容器从 `px-2 pb-2 -mt-1` 改为 `px-2 pt-2 pb-2 mt-2 border-t border-[var(--border)]`：
  - 去掉 `-mt-1` 负边距，改用 `mt-2` + `pt-2` 留出正向间距。
  - 加 `border-t border-[var(--border)]` 顶部分割线，与 `detailed` 布局用 `border-b border-[var(--border)]` 分隔行的既有约定一致。
- 不改 `detailed` 布局，不改 `ComicCard` / `CoverCard` 共享组件，不动来源标签文案与顺序。

## 功能 (Capabilities)

### 新增功能

- `history-card-source-divider`: 历史记录页封面布局卡片的"来源/元信息行"与卡片主体（标题/作者）之间的视觉分隔契约——必须正向留白、必须有上边框分割线，禁止使用负边距把元信息行拉向卡片主体。

### 修改功能

（无）

## 影响

- **代码**：`src/pages/HistoryPage.tsx`（`HistoryCard` 函数 cover 分支，约第 489 行的单个 `<div>` className）—— 单 className 调整。
- **测试**：无新增测试（纯样式 className 调整，项目测试质量闸门禁止仅断言 mock 调用 / className 字符串往返属低价值断言；改动已通过 `npm test` 1442/1442）。
- **规范**：新增 `openspec/specs/history-card-source-divider/spec.md`（封面布局卡片元信息行的视觉分隔契约）。
- **无后端 / IPC / 依赖变化**。纯前端单 className，零运行时风险。
