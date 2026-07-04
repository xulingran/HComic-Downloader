## 为什么

搜索页在「翻页」和「换来源（认证来源）」两种场景下都会短暂保留旧结果并叠加遮罩，但当前遮罩只有 `backdrop-blur-[1px]` + `bg-primary/60`，模糊强度对两档场景一视同仁、且实际几乎肉眼不可见。用户在切换来源时无法直观感受到"旧结果即将被替换"，体感上像是"卡住了"而非"正在更换"。需要按场景分级加强反馈：翻页保持轻模糊（旧结果仍可参考），换来源/新查询的认证窗口用重模糊 + 区分性文字明确传达"正在更换"。

## 变更内容

- 将搜索页加载遮罩从单一强度拆为两档：
  - **轻档（light）**：翻页时，`bg-primary/40` + `backdrop-blur-[2px]` + 文案「加载中...」。旧结果保持可读，仅表明加载进行中。
  - **重档（strong）**：换来源（含认证来源校验窗口）、随机、分类入口、NH 各入口、抽屉/侧栏标签搜索等"整页替换"路径，`bg-primary/85` + `backdrop-blur-[10px]` + 文案「切换中...」/「搜索中...」。旧结果几乎不可辨认，明确传达"即将被替换"。
- 复用现有 `keepExisting` 标志自动分级：`keepExisting === true` → light，`keepExisting === false` → strong。不引入新的显式参数（YAGNI）。
- 认证来源切换时的 `verifySourceAuth` 窗口期（`handleSourceChange` 内）从"统一遮罩"升级为 strong 档，并标示「切换中...」。
- 翻页遮罩文案保持「加载中...」不变。

**非目标**：不改变"新查询立即清空走骨架"的现有行为（仍由 `keepExisting: false` 时 `clearSearchResult()` 触发骨架）；不引入 scale/transform 等额外退场动画；不改 `FavouritesPage` 的遮罩（本变更仅限搜索页）。

## 功能 (Capabilities)

### 新增功能

（无）

### 修改功能

- `list-loading-feedback`: 现有规范要求"翻页保留旧结果+遮罩"，但未覆盖「换来源时的认证校验窗口」这一中间态，也未对遮罩强度/文案做场景分级。本次扩展该规范：明确认证校验窗口的遮罩属于"整页替换前奏"应采用 strong 档，并新增遮罩分级需求（light/strong 两档 + 文案区分）。

## 影响

- **代码**：
  - `src/pages/SearchPage.tsx`：`withLoading`（第 364-413 行）内部根据 `opts.keepExisting` 推导遮罩强度；第 907-912 行遮罩 DOM 根据 strength 渲染不同 class 与文案；`handleSourceChange`（第 587-600 行）认证窗口的 `setLoading(true)` 需额外传递 strong 信号（因该路径不走 `withLoading` 的 `keepExisting` 分支）。
  - 涉及遮罩强度的设计令牌（blur 像素值、bg 透明度）若散落于 className 字面量，考虑收敛到常量或 `tailwind.config.js`，与 `docs/animation-performance.md` 约束一致。
- **规范**：`openspec/specs/list-loading-feedback/spec.md` 新增遮罩分级需求与认证窗口场景。
- **测试**：需补充/更新前端测试覆盖两档强度判定与文案；遵守 `test-quality-gate`（必须断言真实 DOM/状态差异，不得仅断言 mock 被调用）。
- **依赖**：无新依赖；纯前端样式与状态派生。
- **风险**：认证窗口时长因网络而异，strong 档若闪现过短可能造成视觉抖动——需确认 `verifySourceAuth` 极快返回时遮罩不闪烁（可与现有翻页遮罩同样处理，不引入延迟）。
