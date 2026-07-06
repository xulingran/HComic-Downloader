## 为什么

漫画卡片（`ComicCard`）的点击分发存在死区：卡片容器（`handleCardClick`）在非批量模式下只调用 `onClick?.(comic)`，但实际使用页面（`SearchPage` / `FavouritesPage` / `HistoryPage`）均未传入 `onClick`，仅传入 `onOpenReader`。结果点击卡片 body（封面下方的标题/作者文字周围、padding 区、卡片边缘）时不会触发任何动作——既不开阅读器、也不开抽屉、也不报错。用户表现为"小概率点击漫画封面没能进入预览模式，需要再点一次"（实际是第一次点偏到了 body 死区）。

封面区、标题区、下载按钮、批量勾选各自有明确路由，唯独 body 区无 fallback，这是交互契约的缺口。

## 变更内容

- **卡片 body 点击路由补全**：非批量模式下，点击卡片 body（即未命中封面/标题/下载/勾选的容器区域）时，回退到打开详情抽屉（`onOpenDrawer`），不再静默无响应。
- 批量模式下行为不变（仍走 `onToggleSelect`）。
- 封面区 → 阅读器、标题区 → 抽屉、下载按钮 → 下载、批量勾选 → 切换选择，**这些既有路由全部保持不变**。
- 不引入新 prop，不修改 SFW 模式逻辑，不调整 detailed 列表模式下的区域划分语义（仅 body 回退行为生效）。

## 功能 (Capabilities)

### 新增功能
- `comic-card-click-routing`: 漫画卡片（`ComicCard`）各区域（封面 / 标题 / body / 下载按钮 / 批量勾选）的点击分发契约，明确每块区域的默认动作与回退行为。

### 修改功能
<!-- 无既有 capability 覆盖正常卡片的点击分发；此变更首次形式化该契约，故全部归入新增功能。 -->

## 影响

- **代码**：
  - `src/hooks/useCardInteraction.ts` — `handleCardClick` 增加 body 回退到 `onOpenDrawer` 的逻辑。
  - `tests/unit/components/common/ComicCard.test.tsx` — 补充 body 点击 → 抽屉的回归用例。
- **行为**：用户点击卡片非封面/非标题区域时，将打开详情抽屉而非无响应。封面点击进阅读器、标题点击进抽屉的现有体验不变。
- **API/依赖**：无新增 prop，无 IPC/后端变更。
- **回归风险**：低。改动局限于卡片 body 的回退分支，不影响封面、标题、下载、批量等已验证路径。
