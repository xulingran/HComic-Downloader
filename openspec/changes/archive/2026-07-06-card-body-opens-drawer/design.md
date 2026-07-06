## 上下文

`ComicCard`（`src/components/common/ComicCard.tsx`）通过 `useCardInteraction`（`src/hooks/useCardInteraction.ts`）把卡片拆成三个点击区，分别挂三个 handler：

| 区域 | handler | 当前行为（非批量） |
|------|---------|-------------------|
| 封面区 | `handleReaderClick` | 非 SFW → `onOpenReader`（阅读器） |
| 标题区 `<h3>` | `handleTitleClick` | `onOpenDrawer`（抽屉） |
| 容器（body） | `handleCardClick` | `onClick?.(comic)` —— **无 fallback** |

三个真实使用页面（`SearchPage`、`FavouritesPage`、`HistoryPage`）都只传 `onOpenReader`，从不传 `onClick`。结果 `handleCardClick` 在非批量模式下调用 `onClick?.(comic)` 时 `onClick` 为 `undefined`，整次点击成为空操作。点击落到封面下方标题/作者文字周围的 padding、卡片边缘等 body 区时既不开阅读器、也不开抽屉、也不报错——表现为"小概率点击封面没能进入预览，需要再点一次"。

`onClick` prop 仍被 `ComicCard.test.tsx` 的现有用例（line 42-50）使用，因此不能直接删除该 prop 或其优先语义。

## 目标 / 非目标

**目标：**
- 消除卡片 body 区的点击死区：非批量模式下，body 点击回退到打开详情抽屉。
- 保持 `onClick` prop 优先语义：传入 `onClick` 时它仍是 body 主路由，抽屉仅作 fallback。
- 封面区、标题区、下载按钮、批量勾选的既有路由**完全不变**。
- 覆盖 `CoverCard`（封面/网格模式）与 `DetailedCard`（详细列表模式）两种渲染变体。

**非目标：**
- 不修改 SFW 模式下封面区的现有行为（SFW 时点封面无响应是另一个独立问题，本变更不处理）。
- 不引入新的 prop、不调整区域划分的 DOM 结构、不改 IPC/后端。
- 不改 detailed 模式下"封面缩略图 → 阅读器"的路由（仅让其周围 body 区获得回退）。
- 不统一"整张卡只开阅读器"或"整张卡只开抽屉"（用户已明确要求 body = 抽屉，其余不变）。

## 决策

### 决策 1：body 回退目标定为 `onOpenDrawer`，而非 `onOpenReader`

**选择**：非批量模式下 body 点击 → `onOpenDrawer`（与标题区路由一致）。

**理由**：
- 用户明确要求"卡片 body 设置为点击打开详情抽屉"。
- 标题区现有路由已是 `onOpenDrawer`，body 与标题同属"卡片元信息区"，统一到抽屉在语义上一致。
- body 与封面在视觉上是分离的（封面是图像主体，body 是文字+padding 衬底），用户点 body 通常是想看详情而非直接进入阅读，抽屉是更轻量的预览入口。

**替代方案考虑**：
- *body → `onOpenReader`*：会让"点偏一点点就跳进全屏阅读器"成为常态，比当前死区更激进，违背"封面才是进阅读器的入口"的视觉契约。否决。
- *body → `onClick ?? onOpenReader`*：复用 `onClick` 的 fallback 但目标是阅读器。同样有上述问题，且与标题区（抽屉）分裂。否决。

### 决策 2：回退逻辑放在 `useCardInteraction.handleCardClick` 内，而非各调用页传 `onClick`

**选择**：在 `handleCardClick` 内实现 `onClick?.(comic) ?? onOpenDrawer()` 的优先级链。

**理由**：
- 改动收敛在单一 hook，三个页面零改动即可获得新行为。
- `onClick` 仍是合法 prop（被现有测试使用），保留其优先语义避免破坏契约。
- 不需要给 `ComicCard` 加新 prop 或让页面重复传 `onOpenDrawer`（页面已通过 `useDrawerStore` 间接获得 `openDrawer`，但 hook 内的 `onOpenDrawer` 由 `ComicCard` 从 `useDrawerStore` 取得并注入，链路已通）。

**实现要点**（`useCardInteraction.ts`）：
```ts
const handleCardClick = useCallback(() => {
  if (batchMode) { onToggleSelect?.(comic); return }
  if (onClick) { onClick(comic); return }
  onOpenDrawer()  // 新增 fallback
}, [batchMode, comic, onToggleSelect, onClick, onOpenDrawer])
```
依赖数组需补 `onOpenDrawer`（当前已作为参数传入但未进 deps，会导致闭包陈旧——一并修正）。

### 决策 3：依赖数组补 `onOpenDrawer`

当前 `handleCardClick` 的 `useCallback` 依赖是 `[batchMode, comic, onToggleSelect, onClick]`，未含 `onOpenDrawer`。虽然此前 `onOpenDrawer` 未在回调内使用所以无 bug，但本变更让它进入函数体后**必须**加入依赖数组，否则会引用陈旧闭包。`onOpenDrawer` 来自 `useDrawerStore` 的 `openDrawer`（稳定引用），加入 deps 不会导致额外重渲染。

## 风险 / 权衡

- **[风险] 现有 `ComicCard.test.tsx` 的 `onClick` 用例仍需通过** → 不删除 `onClick` 优先分支，保留 line 42-50 用例；仅新增 fallback 用例。
- **[风险] detailed 模式下整行 body 面积大，回退后用户误触抽屉频率上升** → 这是预期行为变更（用户已确认 body = 抽屉）。封面缩略图（`w-14 h-14`）仍是进阅读器的明确入口，不会丢失该路径。
- **[权衡] `??` 链 vs `if/else`** → 选 `if (onClick) ... else onOpenDrawer()` 显式形式，可读性优于空值合并运算符对函数调用的链式写法，且避免 ESLint 对 `onClick?.(comic) ?? onOpenDrawer()` 可能的 `no-unused-expressions` 误报。
- **[回归] 批量模式** → 批量模式分支提前 `return`，不受 fallback 影响，无需额外守护。
