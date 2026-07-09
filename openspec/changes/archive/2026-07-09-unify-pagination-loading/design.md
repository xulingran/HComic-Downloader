## 上下文

三个列表页（搜索/收藏夹/历史）的翻页加载反馈当前各搞各的，且收藏夹页最弱：

| 页面 | 翻页遮罩模糊 | 加载指示器 | 旧结果去留 |
|------|------------|-----------|-----------|
| SearchPage | light=`backdrop-blur-[2px]`/40% | 静态「加载中...」文字 | 保留 |
| FavouritesPage | `backdrop-blur-[1px]`/60%（最弱） | 静态「加载中...」文字 | 保留 |
| HistoryPage | 无遮罩 | 静态「加载中...」文字 | **卸载** |

现有 `list-loading-feedback` 规范定义了"轻档（旧结果基本可读）/ 重档（旧结果几乎不可辨认）"两档契约（spec.md:81-106），但收藏夹未实现 light/strong 区分、历史页根本不在契约覆盖范围内。遮罩内的指示器在所有页面都是静态文字，缺乏"正在进行"的动态信号。

约束：
- `CircularProgress`（src/components/common/CircularProgress.tsx）是**确定性进度环**（按 progress 百分比绘制 + 显示数字），不适合不确定加载场景。Spinner 应采用 PageSkeleton.tsx:11 已验证的 `border-2 border-t-accent rounded-full animate-spin` 模式。
- SearchPage 的 light/strong 两档语义（spec.md:81-106）需保留：翻页=light、整页替换=strong。本次只调整两档的**强度数值**，不改语义划分。
- reduced-motion 兜底：`src/lib/anim.ts` 与全局 CSS 已有 reduced-motion 策略，spinner 的 `animate-spin` 在 reduced-motion 下应停转（Tailwind 内置 `motion-safe:animate-spin` / 全局兜底二选一，见决策 4）。
- `--bg-primary` / `--accent` / `--text-secondary` 是现有 CSS 变量 token，遮罩继续复用。

利益相关者：所有使用分页浏览的用户，尤其在收藏夹翻页时对加载状态感知弱。

## 目标 / 非目标

**目标：**
- 翻页（light 档）遮罩强度提升到"旧结果基本不可辨认"，让"正在加载"在视觉上足够强烈。
- 所有列表页加载遮罩内的居中指示器从静态文字改为 spinner。
- 搜索/收藏夹/历史三页的翻页加载反馈统一为同一套视觉模式（保留旧结果 + 遮罩 + spinner）。
- 保留 light/strong 两档语义与"整页替换前奏"的认证窗口重档规则。

**非目标：**
- 不改 light/strong 的**语义划分**（翻页=light、整页替换=strong 不变）。
- 不改缓存命中优先路径（spec.md:65-79 不变）。
- 不改"未提交输入保持渲染稳定"契约（spec.md:125-160 不变）。
- 不引入新的加载进度数据（spinner 为不确定动画，不显示百分比）。
- 不改新查询/整页替换的骨架网格路径（无旧结果时仍走骨架，spec.md:7-26 不变）。

## 决策

### 决策 1：抽共享 `LoadingOverlay` 组件 vs 各页内联

**选择：抽共享 `LoadingOverlay` 组件**（`src/components/common/LoadingOverlay.tsx`）。

**理由：** 三页遮罩结构完全一致（`fixed inset-0` + 居中 spinner + 可选文案），数值差异只在模糊半径/不透明度。抽组件后：
- 收藏夹、历史页不再各写一份遮罩 div，消除"收藏夹只有 1px"这类漂移根源。
- 数值集中在一处，未来调整强度只需改一处。

**定位语义：fixed inset-0（相对视口），而非 absolute inset-0（相对网格容器）。** 理由：spinner 必须在视口正中（用户视线落点），而非网格容器中心——当内容比视口高（需滚动）时，absolute 定位会让 spinner 跟着内容跑到视口外；内容比视口矮时偏离视口中心。fixed 让遮罩覆盖整个窗口（含标题栏、来源侧栏、翻页控件），spinner 永远在视口正中，最强烈地表明"正在加载"。z-50 确保遮罩在网格与控件之上。

**替代方案：** 继续各页内联。**否决**：历史已证明内联会导致收藏夹漏跟 Search 的强度调整（现状就是证据）。

**替代方案：** 把 `OVERLAY_STYLES` 字符串字面量提到常量但不抽组件。**否决**：spinner 指示器逻辑仍会重复三份。

**替代方案：** spinner 用 fixed 飘到视口中心，但遮罩仍 absolute 只盖网格区。**否决**：网格比视口矮时 spinner 会飘到遮罩外的背景上，视觉割裂；且全视口遮罩更符合"强烈表明加载"的原始诉求。

### 决策 2：两档遮罩的新强度数值

**选择：**
- **light（翻页）**：`backdrop-blur-[8px]` + `bg-[var(--bg-primary)]/80` —— 旧结果基本不可辨认。
- **strong（整页替换）**：`backdrop-blur-[16px]` + `bg-[var(--bg-primary)]/92` —— 几乎完全遮蔽。

**理由：** 用户明确要求"基本看不清旧内容"。`backdrop-blur-[8px]` 是实践中"旧结果只剩色块、文字不可读"的阈值（当前 Search strong 用 10px 已接近此效果，但本次将 light 档也拉到这个量级）。strong 档需明显高于 light 以保持 spec.md:88"两档视觉差异足以直观区分"的契约，故上调到 16px/92%。

**替代方案：** light=6px、strong=12px。**否决**：6px 时小号标题文字仍部分可读，不满足"基本看不清"。

**替代方案：** 收藏夹/历史统一只做 strong 一档（去掉 light）。**否决**：破坏 spec.md:81-106 的两档语义契约，且翻页与整页替换混用会让翻页时遮罩过重（整页替换时旧结果本就无参考价值，翻页时旧结果作为"上一页位置"仍有微弱空间锚定作用）。

### 决策 3：spinner 复用 PageSkeleton 的 `border-t-accent` 模式

**选择：** 遮罩内 spinner 采用 `w-8 h-8 border-2 border-[var(--text-tertiary)] border-t-[var(--accent)] rounded-full animate-spin`，与 PageSkeleton.tsx:11 完全一致。spinner 下方保留一行 `text-sm text-[var(--text-secondary)]` 文案（"加载中..."）作为辅助。

**理由：**
- `CircularProgress` 是确定性进度环，需传入 progress 数值并渲染百分比，语义不符（翻页加载无进度数据）。
- PageSkeleton 的 border 环是项目内已验证的不确定 spinner，视觉一致。
- 保留一行小字而非纯 spinner：遮罩很强（8px+ 模糊）时，spinner 转动可能被误判为卡顿，文字"加载中..."提供明确的语义锚点。

**替代方案：** 复用 `CircularProgress` 并传固定 progress=0 + 隐藏文字。**否决**：它是确定性组件，强行不确定化是语义滥用，且 `showText` 在 size>=28 时默认显示百分比数字（需额外传参关闭）。

**替代方案：** 引入新的 spinner 库（如 react-spinners）。**否决**：违背项目"零额外动画依赖，spinner 用 Tailwind `animate-spin`"的既有约定（PageSkeleton 证明）。

### 决策 4：reduced-motion 下 spinner 停转

**选择：** spinner 用 `motion-safe:animate-spin`（Tailwind 内置修饰符），reduced-motion 用户看到静止的环 + 文案。不额外加全局 CSS 兜底（项目已有全局 reduced-motion CSS 处理 framer-motion，`animate-spin` 是纯 CSS keyframe，`motion-safe` 足够覆盖）。

**理由：** 与现有 `src/lib/anim.ts` 的 `useReducedMotionPreference()` 双层策略不冲突——该 hook 服务于 framer-motion 组件，spinner 是纯 CSS，`motion-safe:` 是 Tailwind 对 `prefers-reduced-motion` 的标准映射，无需 hook 介入。

**替代方案：** 不处理，spinner 始终转。**否决**：违反项目 reduced-motion 兜底约定（AGENTS.md 动画系统约束 + anim.ts 双层策略）。

### 决策 5：历史页从"卸载旧网格"改为"保留 + 遮罩"

**选择：** HistoryPage 翻页时不再 early-return 卸载整个网格，改为保留旧 `items`、在网格区叠加 LoadingOverlay（light 档）。与 FavouritesPage 的"保留旧结果"路径对齐。

**理由：** 用户要求"顺便统一"。历史页当前 early-return（HistoryPage.tsx:244-250）是最弱的反馈——旧网格直接消失，用户在等待期间看到空白。保留旧网格 + 强遮罩 + spinner 后，三个页面反馈完全一致。

**注意：** HistoryPage 的 `isLoading` 当前同时覆盖"首次加载"（无旧内容）和"翻页"（有旧内容）。改造后：
- 首次加载（`items.length === 0 && isLoading`）：仍显示居中文案/spinner（无网格可遮罩），与现状一致。
- 翻页（`items.length > 0 && isLoading`）：新行为，保留旧网格 + 遮罩。
需在 HistoryPage 内按 `items.length` 区分两条路径，逻辑与 FavouritesPage.tsx:443-480 现有的"空态 vs 有内容遮罩"分支对齐。

**替代方案：** 只统一 Search/Favourites，历史页保持卸载。**否决**：用户明确要求统一三页。

## 风险 / 权衡

- **[性能] 8px/16px backdrop-blur 的合成开销** → `backdrop-filter` 触发 GPU 合成层。当前 Search strong(10px) 已在生产使用无性能投诉，8px（light）与之同量级，可接受。历史页首次引入遮罩，若低端机卡顿，缓解：遮罩仅在加载窗口显示（通常 <1s），且加载结束即卸载。无需提前优化。
- **[可访问性] 强遮罩 + 转动 spinner 可能引发前庭不适** → 决策 4 已用 `motion-safe:` 让 reduced-motion 用户看到静止环。遮罩本身是静态半透明层，不触发动画敏感。
- **[回归] 历史页改"保留旧网格"后，翻页期间旧卡片仍可交互（点击进入）** → 遮罩层 `absolute inset-0` 默认不拦截点击事件需确认；若需拦截，给遮罩加 `pointer-events-auto`。这与 Favourites/Search 现有遮罩行为一致，按现有约定处理（现有遮罩未显式设 pointer-events，沿用）。
- **[测试] 现有 list-loading-feedback 前端测试断言了"加载中..."文字与模糊数值** → 数值与指示器断言需同步更新（见 tasks）。纯文本→spinner 后，断言需改为查询 spinner DOM（`rounded-full.animate-spin` 或 role）。
