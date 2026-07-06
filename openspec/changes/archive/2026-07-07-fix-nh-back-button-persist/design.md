## 上下文

`SearchPage.tsx` 当前用单一 React state `viewingNhEntry` 同时承担两个职责：

1. 控制「返回 NH 入口」按钮的显隐（line 889-899）。
2. 控制 `NhEntryGrid` 入口页网格的渲染（line 1007 的 `!viewingNhEntry`）。

各事件处理器对这个 state 的写入语义不一致：

| 处理器 | 当前行为 | 是否正确 |
|--------|---------|---------|
| `handleNhLatest` / `handleNhPopular` / `handleNhEntryTag` | 置 `true` | ✓ 进入子功能 |
| `handleBackToNhEntry` | 置 `false` | ✓ 显式返回 |
| `handleSourceChange`（切走 NH） | 置 `false` | ✓ 切来源 |
| `handleRandom` | 置 `false` | ✓ 随机=主动离开 |
| 挂载恢复缓存（line 198） | 按 `mode !== 'keyword'` 派生 | ⚠️ 同样有 keyword 误判问题 |
| **`handleSearch`（line 456）** | 按 `mode === 'ranking' \|\| 'tag'` 重算 | ❌ keyword 搜索误置 `false` |
| `handleToggleTag` / `handleClearAllTags`（NH 分支） | 置 `true` | ✓ 标签切换仍在入口体系 |

Bug 触发链：用户进入「热门排行」（`viewingNhEntry=true`，按钮显示）→ 输入关键词点搜索 → `handleSearch` line 456 因 `mode==='keyword'` 把它重置为 `false` → 按钮消失。同时由于 `!viewingNhEntry` 变 `true`，若搜索无果，入口页网格会错误重新出现（二次 bug）。

## 目标 / 非目标

**目标：**

- 「返回 NH 入口」按钮在用户进入任一 NH 入口子功能后持续可见，直到用户显式退出入口体系。
- 解耦「按钮显隐」与「入口页网格渲染」两个职责，消除单 state 双职责导致的语义纠缠。
- 修正所有误重置按钮可见性的代码路径（`handleSearch`、挂载恢复派生）。
- 保持既有入口页网格渲染、返回操作、切来源、随机等行为不变。

**非目标：**

- 不改变 NH 后端契约、IPC 通道、认证语义。
- 不重构 `viewingCategory`（bika 分类）——它有对称结构但当前无 bug 报告；本变更不扩展到它（见 Open Questions）。
- 不改变搜索结果缓存、预加载、分页逻辑。

## 决策

### 决策 1：新增独立的按钮可见性 state，与 `viewingNhEntry` 解耦

**前置事实核对（关键）：** `viewingNhEntry` 的真实语义是 **`true` = 用户在 NH 入口子功能结果里（`NhEntryGrid` 网格隐藏），`false` = 在入口页本体（网格显示）**。依据：网格渲染条件是 `!viewingNhEntry`（line 1007 取反）；`handleNhLatest` 设 `true`（line 537，进入子功能→隐藏网格）；`handleBackToNhEntry` 设 `false`（line 588，返回入口→显示网格）。命名略反直觉，但运行时所有现有写入都正确，本变更不改动它们的取值。

**选择：** 新增 `showBackToNhEntry` state（默认 `false`），专责控制「返回 NH 入口」按钮显隐。`viewingNhEntry` 保留原职责（控制 `NhEntryGrid` 渲染），其所有现有运行时写入保持不变。`showBackToNhEntry` 的写入规则与 `viewingNhEntry` 在所有路径**取值相同**——拆分的价值不在让两者 diverge，而在**语义解耦与防御未来回归**：`viewingNhEntry` 字面含义「正在查看 NH 入口」与实际控制「网格隐藏」名实不符，正是这种混淆让 `handleSearch` 作者误以为「mode 变了要重算」。拆成两个语义自释义的 state 后，每个 handler 只写它该写的，未来若两者需要独立控制（如某场景显示网格但不显示按钮）也可直接扩展。

**写入规则（`viewingNhEntry` 保持现状，`showBackToNhEntry` 镜像同步）：**

| 事件 | `viewingNhEntry`（true=隐藏网格） | `showBackToNhEntry`（true=显示按钮） |
|------|------------------------------|---------------------------|
| 进入 Latest / Popular / Tag | `true`（现状） | `true`（新增同步） |
| `handleBackToNhEntry`（点返回） | `false`（现状，重现网格） | `false`（新增同步，隐藏按钮） |
| `handleSourceChange`（切走 NH） | `false`（现状） | `false`（新增同步） |
| `handleRandom` | `false`（现状） | `false`（新增同步） |
| `handleSearch`（关键词 / 翻页 / 任意） | **不触碰**（删除 line 456 的错误重置） | **不触碰** |
| `handleToggleTag` / `handleClearAllTags`（NH 分支） | `true`（现状） | `true`（新增同步） |
| `handleNhRankingChange`（排行下拉切换） | 现状未显式设置（继承上次值） | `true`（新增同步，确保按钮可见） |
| 挂载恢复缓存 | `cached.source === 'nh'`（修正，见决策 2） | `cached.source === 'nh'`（新增） |

**替代方案 A（被否决）：** 在 `handleSearch` 里把 line 456 的条件改成「只要 source 是 nh 且曾在入口子功能内就 true」。问题：需要在 `handleSearch` 里读上一个 state，引入 `setViewingNhEntry(prev => ...)` 函数式更新，语义仍然是「派生自 mode」，没解决根因——下次有人加新 mode 或新入口又会漏。

**替代方案 B（被否决）：** 不新增 state，只删除 `handleSearch` line 456（即探索阶段的方向 A）。问题：能修当前 bug，但 `viewingNhEntry` 名实不符的纠缠仍在，未来新入口/新场景容易复发同类 bug；且无法独立表达「按钮可见」与「网格可见」两个关注点。用户已明确选择彻底拆分。

**替代方案 C（被否决）：** 完全移除 `viewingNhEntry`，按钮和网格都用 `showBackToNhEntry`。问题：网格渲染需要区分「入口页本体」与「入口子功能内」，单一布尔表达不了三态（入口页 / 子功能内 / 完全不在 NH 体系），会逼出更多 hack。

### 决策 2：挂载恢复缓存的派生逻辑同步修正

当前 line 198：`setViewingNhEntry(cached.source === 'nh' && cached.mode !== 'keyword')`。这与 `handleSearch` line 456 同病——若缓存是用户在入口子功能里做关键词搜索后的状态（`mode === 'keyword'`），恢复时 `viewingNhEntry` 被设为 `false`，意味着 `!viewingNhEntry === true`，入口页网格会错误重新出现并覆盖 keyword 搜索结果；同时按钮也不会显示。

**选择：** 选项 B 下，两个 state 在挂载恢复时取值相同（不 diverge）：
- `viewingNhEntry = cached.source === 'nh'`（修正：去掉 `mode !== 'keyword'` 条件。缓存来源是 NH 即 `true`，对应「在子功能/搜索结果里→网格隐藏」。无论 mode 是 ranking/tag 还是 keyword，恢复的都是有效结果，不该被入口网格覆盖）
- `showBackToNhEntry = cached.source === 'nh'`（新增：只要缓存来源是 NH 就显示按钮，无论 mode）

边界裁定（产品已确认，采用选项 B）：若用户在入口子功能里做关键词搜索后离开页面再回来，缓存恢复时 `mode` 是 `keyword`。此时**按钮必须显示**（用户仍在 NH 体系内，应能一键回入口），网格**不重现**（`viewingNhEntry=true` → `!viewingNhEntry=false`），keyword 搜索结果本身就是有效内容。

**自洽性：** 运行时 `viewingNhEntry` 与 `showBackToNhEntry` 在所有路径取值相同（见决策 1 表格）；挂载恢复时两者也相同。拆分的价值是**语义清晰 + 防御未来回归 + 为未来独立控制预留扩展点**，而非让两者在当前实现里 diverge。`viewingNhEntry` 字面含义与「网格隐藏」的名实不符是历史包袱，本变更不重命名（避免大面积改动与回归风险），仅通过文档说明其真实语义。

## 风险 / 权衡

- **[风险] 新增 state 增加了维护面** → 缓解：写入规则集中在少数 handler，且有回归测试锁定；state 名 `showBackToNhEntry` 自释义。
- **[风险] `viewingNhEntry` 与 `showBackToNhEntry` 在某些路径可能不同步** → 缓解：当前实现要求两者在所有路径取值相同，回归测试锁定此不变式。未来若需独立控制（如某场景显示网格但不显示按钮），需同步更新测试。
- **[技术债] `viewingNhEntry` 名实不符（true=隐藏网格）** → 本变更不重命名以控制改动面与回归风险；通过 design.md 决策 1 的「前置事实核对」与代码注释说明其真实语义，后续可单独立项重命名。
- **[权衡] 不扩展到 `viewingCategory`（bika）** → 若未来 bika 分类也报类似 bug，需单独变更。本变更范围聚焦 NH。
- **[风险] 决策 2 的边界判断可能不符合产品预期** → 已由产品确认采用选项 B（按钮只要在 NH 体系内就显示），见决策 2。

## 待解决问题

无（Open Question 1 已裁定为选项 B，见决策 2）。
