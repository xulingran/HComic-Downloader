## 上下文

NH 入口页热门标签区当前位于 `src/components/NhEntryGrid.tsx`，通过 IPC `getTagList('nh','','',24,'popular')` 获取 24 个标签（已按 `count` 降序返回），渲染为 24 个完全相同的灰色药丸（`bg-[var(--bg-secondary)]` + `text-xs rounded-full`），仅 hover 态有 20% 强调色背景，计数以 10px 灰字内联。

项目已有成熟的设计资产可直接复用：

- **动画系统**（`src/lib/anim.ts`）：`tagListVariants`（容器 stagger，20ms 间隔，起始延迟 100ms）、`tagItemVariants`（子项 opacity + y:4→0，时长 DURATION.fast=150ms）、`useReducedMotionPreference()`、`reduceSafe()` 退化工具。`ComicInfoDrawer` 已用这套 variants 渲染 tag 列表，并有 STAGGER_LIMIT=40 的封顶模式。
- **配色**（`src/styles/index.css`）：light/dark 双主题 CSS 变量齐全，`--accent`（light #4A90D9 / dark #5ba0e9）已用于 ComicInfoDrawer 的 `bg-accent/10 text-accent` 标签风格。
- **Tailwind 令牌**：`transitionDuration`（fast/base/slow/slower）、`transitionTimingFunction`（spring/smooth/standard）已定义。

数据契约不变：`TagItem = { tag: string; count: number }`，`getTagList` 返回 `{ tags: TagItem[] }`，前端无需新增 IPC 或后端字段。

## 目标 / 非目标

**目标：**

- 让 NH 入口页热门标签的视觉层级与 `count` 热度直接对应——顶流标签一眼可辨。
- 复用项目已有动画系统与配色，保持与 ComicInfoDrawer 标签、上方功能卡的视觉语言一致。
- 改动收敛在 `NhEntryGrid.tsx` 单文件，零后端/IPC/数据契约变更。

**非目标：**

- 不改动标签点击后的搜索语义（仍是 NH 精确 `tag:"<name>"` 搜索，`onSelectTag` 契约不变）。
- 不在入口页增加 name/popular 排序切换（那是 TagDialog 的职责）。
- 不改 IPC `getTagList` 的 limit（仍 24）或分页逻辑。
- 不为标签增加 active/selected 态——点击即跳转搜索并卸载 NhEntryGrid，无原地高亮语义。
- 不引入新的设计 token 或 CSS 变量。
- 不重构 NhEntryGrid 的两个功能卡（最近更新 / 热门排行）。

## 决策

### 决策 1：分档策略——固定数量阈值（top 5 / 5-10 / 11+），而非 count 阈值

**选择**：按固定索引分三档——头部 `[0,5)`、中段 `[5,10)`、长尾 `[10,∞)`。

**理由**：
- IPC 已按 `count` 降序返回，索引即热度排名，固定索引让「头部永远是前 5 名」语义稳定。
- count 阈值方案（如 >100k / >10k / 其余）在不同数据集下档位数量会漂移——某次同步全是冷门标签时可能全部落入长尾，视觉层级失效。
- 固定数量保证「头部 5 个、中段 5 个」的稳定视觉结构，用户每次进来看到一致的布局节奏。

**考虑过的替代方案**：
- *count 分位数（如 top 20%）*：对 24 个标签计算分位数本身不稳定，且 count 分布常呈长尾（头部一两个远超其余），分位数会把视觉权重错配。已否决。
- *count 固定阈值*：见上，漂移问题。已否决。

### 决策 2：三档视觉权重映射

| 档位 | 底色 | 字号 | 计数样式 | hover |
|------|------|------|----------|-------|
| 头部 (top 5) | `bg-[var(--accent)] text-white`（实心强调） | `text-sm font-medium` | 右侧 `bg-white/20` 圆角徽章，加粗 | `hover:bg-[var(--accent-hover)]` |
| 中段 (5-10) | `bg-[var(--accent)]/10 text-[var(--accent)]`（淡强调） | `text-sm` | `ml-1.5 text-xs font-medium text-[var(--accent)]/70` 内联 | `hover:bg-[var(--accent)]/20` |
| 长尾 (11+) | `bg-[var(--bg-secondary)] text-[var(--text-primary)]`（中性） | `text-xs` | `ml-1 text-[10px] text-[var(--text-secondary)]` 内联 | `hover:bg-[var(--accent)]/15` |

**理由**：
- 头部用实心强调底——这是整页除功能卡外最强的视觉锚点，承担「这些是顶流」的语义。白色文字保证实心蓝底上的对比度（WCAG AA）。
- 中段复用 ComicInfoDrawer 普通标签的 `bg-accent/10 text-accent` 风格，保持与 Drawer 内标签的视觉一致性，用户在两处看到同档标签不会有认知断层。
- 长尾保留原灰底小字，作为「还有这些可选」的次要信息层，不抢头部注意力。
- 计数从「10px 灰字贴标签名」升级：头部为徽章（最强），中段加粗放大（中），长尾保持弱化（最弱）——与档位权重严格对应。

**考虑过的替代方案**：
- *头部也用淡底但更大字号*：对比不够，无法形成「锚点」。已否决。
- *全部用实心底但深浅不同*：实心底过多会让整块显得沉重，与上方功能卡的轻快感冲突。已否决。

### 决策 3：动画复用——`tagListVariants` + `tagItemVariants`，带 STAGGER_LIMIT 封顶

**选择**：用 `motion.div`（容器，`variants={tagListVariants}` initial="hidden" animate="show"）包裹三档，每档内标签用 `motion.button`（`variants={tagItemVariants}`）。reduced-motion 时全部退化为普通元素（参考 ComicInfoDrawer 的 `reduceMotion ? 普通div : motion.div` 模式）。

**关键实现点**：
- 三档**共享同一个 motion 容器**还是**各自独立容器**？选择**各自独立容器**（三个 `motion.div`，每个套 `tagListVariants`）。理由：如果共享，头部 5 个会先 stagger 完才开始中段，延迟过长；独立容器让三档几乎同时开始各自错峰，整体观感更紧凑。stagger 仅在档位内（≤5 个），总时长可控。
- **AnimatePresence 包裹**：刷新时 `tags` 数组变化，需要给容器 `key` 绑定一个刷新计数器（如 `refreshKey` state），让 framer-motion 视为新元素重新触发进场动画。否则 React 复用 DOM，动画不重放。
- **STAGGER_LIMIT**：因每档最多 5 个，远低于 ComicInfoDrawer 的 40，无需封顶逻辑，全部参与 stagger。

**reduced-motion 退化**：用 `useReducedMotionPreference()` 判断，true 时容器退化为普通 `<div>`、标签退化为普通 `<button>`，仅保留 opacity 过渡，无位移无 stagger。复用 `reduceSafe()` 或直接条件渲染（ComicInfoDrawer 用的是条件渲染模式，此处跟随）。

**考虑过的替代方案**：
- *layout animation（标签位置过渡）*：刷新时新旧标签位置平滑过渡。但 NhEntryGrid 刷新是全量替换非增量，layout 动画价值低且增加复杂度。已否决。
- *全部标签共用一个长 stagger 队列*：24 个标签按 20ms 间隔 = 480ms+ 才全部出现，头部反而被拖慢。已否决。

### 决策 4：区块标题与副文案

将标题区从「热门标签 / 来自 NH 原始标签目录」改为：

- 标题：`🔥 热门标签`（emoji 火焰，轻量、跨平台、无需 SVG 资产；项目其他处如错误提示、成功状态也用 emoji 风格）
- 副文案：`按热度排序 · 共 {tags.length} 个`（动态显示总数，传达「这里有 N 个可选项」）

刷新按钮文案与位置不变（右上角，`刷新热门标签` / `刷新中...`）。

**理由**：副文案从静态描述（「来自 NH 原始标签目录」对用户无信息量）改为动态计数（「共 24 个」让用户知道浏览范围），且与分档语义呼应。

## 风险 / 权衡

**[风险] 头部 5 个实心强调底在 dark 主题下可能过亮抢眼**
→ 缓解：dark 主题 `--accent` 为 `#5ba0e9`（比 light 的 `#4A90D9` 略亮），白色文字在其上对比度足够（约 4.5:1，达 WCAG AA）。实现后需在 dark 模式实际目检；若过亮可改用 `accent-hover`（dark `#4a90d9`，略暗）作为头部底色。

**[风险] 分档固定数量在标签 count 分布极端长尾时（如头部第 5 名 count=1.2m，第 6 名 count=200）可能档位内对比仍大**
→ 权衡接受。固定数量保证视觉结构稳定，比 count 阈值的漂移问题更可控。档位内的对比通过同档同样式抹平，这是预期行为（档位是离散分级，非连续热度映射）。

**[风险] AnimatePresence + key 刷新导致每次刷新全量重渲染**
→ 缓解：24 个 motion.button 的重渲染开销可忽略（远少于搜索结果的卡片网格）。且刷新是低频操作（用户手动触发），非每帧。

**[风险] reduced-motion 用户失去 stagger 后三档仍需可辨**
→ 已覆盖：三档的视觉差异由样式（底色/字号）决定，不依赖动画。reduced-motion 仅退化位移与错峰，样式分层保留。

**[权衡] 不增加 active/selected 态**
→ 当前点击即跳转搜索、卸载 NhEntryGrid，无原地选中语义。若未来改为多选标签再搜索，届时再补 selected 态，当前不提前设计。
