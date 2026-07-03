## 上下文

阅读器翻页动画（`src/components/PageFlipView.tsx`）使用 framer-motion `AnimatePresence` + `mode="popLayout"` 驱动：新页 enter、旧页 exit 同时播放。variants 定义在 `src/lib/anim.ts` 的 `getDirectionalPageVariants()`，被 single 与 double 模式共享。

`enter`/`exit` 端点 opacity 当前为 `0.92`（`PAGE_FLIP_ENDPOINT_OPACITY`），原意是「轻微透明柔化新旧页交替」。但 0.92 离 1.0 太近，淡出几乎不可见。`exit` 动画结束时旧页 opacity 仍是 0.92、停在滑出终点（`x: -100%` 或 `100%`），依然清晰可见；紧接着 framer-motion 卸载该 motion.div，表现为「页面突然消失」。用户反馈的「上一页飞到一边停住然后突然消失」即此机制。

约束（来自 AGENTS.md 与现有 `ui-animation` spec）：
- 翻页过渡**必须**使用 `smoothTransition`（约 300ms，cubic-bezier(0.4,0,0.2,1)），禁止回退到会 overshoot 的默认 spring。
- 翻页方向由 PageFlipView 内部根据 currentPage 变化推断，禁止要求外部传参。
- reduced-motion 下翻页**必须**退化为纯 opacity crossfade（约 150ms），无横向位移。
- 现有 `ui-animation` spec 明文要求「端点**必须**使用轻微 opacity 变化柔化新旧页交替」——这与正确实现冲突，本设计同时校准该规范措辞。

## 目标 / 非目标

**目标：**
- 消除「上一页飞到一边停住然后突然消失」的视觉跳变，让旧页在滑出过程中同步淡出，动画结束时已不可见。
- 修复对 single 与 double 模式同时生效（共享 variants）。
- 校准 `ui-animation` 规范中关于翻页端点 opacity 的措辞，使规范反映正确行为而非 bug 成因。
- 通过测试回归点固化端点 opacity=0 的不变量。

**非目标：**
- 不改变翻页过渡的曲线（`smoothTransition`）、时长（约 300ms）或方向推断逻辑。
- 不修改 `PageFlipView.tsx` 的渲染结构（消费方无需改动）。
- 不处理双页模式下位移幅度相对 motion.div 自身宽度可能偏大的次要观感问题——本次仅修 opacity，避免一次改两处无法隔离效果；若实测仍有位移过大观感，另开变更。
- 不调整 reduced-motion 退化路径（`getReducedPageVariants` 已是纯 opacity crossfade，行为正确）。
- 不引入新功能域、新依赖或数据迁移。

## 决策

### D1. 端点 opacity 改为 0（完全透明），而非调整到「更明显的中间值」
两条路径：
- **(a) opacity = 0（采纳）**：enter/exit 端点完全透明。新页从透明淡入、旧页淡出至透明，位移与透明度同步插值。
- **(b) opacity = 某中间值（如 0.3）**：保留部分可见性。

理由：(a) 是 framer-motion 翻页/轮播的标准模式（exit 完全淡出 + 滑出），位移与 opacity 同步插值天然形成连贯过渡，旧页在动画结束时已不可见，卸载时无跳变。(b) 仍会在端点保留可见性，位移幅度大时（尤其 double 模式）端点处依然能看到旧页残影，治标不治本。原 0.92 已证明「中间值」无效——0.92 本身就是被选中的「轻微透明」，实际等同于不透明。

### D2. 删除 `PAGE_FLIP_ENDPOINT_OPACITY` 常量而非改其值
该常量当前仅服务于「轻微透明」的错误意图，且全代码库无其他消费点。改值（0.92→0）会留下一个语义错误的命名（"endpoint opacity" 暗示「端点保留可见性」），误导后续维护者。直接删除常量、内联 `opacity: 0`，并在 variants 上方注释说明「端点必须为 0」的原因，单一来源更清晰。

### D3. 同步校准 `ui-animation` spec 措辞
现有规范「端点**必须**使用轻微 opacity 变化柔化」与正确实现矛盾——「轻微 opacity 变化」正是 bug 的根源描述。规范是行为契约，措辞必须反映正确行为。本变更用 `MODIFIED Requirements` 重写该需求的相关措辞为「端点必须完全透明」，并把对应场景描述对齐到「旧页滑出过程中同步淡出、终点不可见」。

## 风险 / 权衡

- **[权衡] 端点完全透明可能在快速连续翻页时让新旧页过渡显得偏「淡」** → 这是 framer-motion 翻页的标准观感，且 `popLayout` 模式下新旧页同时存在，opacity crossfade 足以衔接；如未来需要「实体翻书」质感（如 3D 翻转），属另一功能域，不在本次范围。
- **[风险] 双页模式位移幅度问题被本次修复掩盖** → 本次只改 opacity，位移 `x: '100%'` 相对 motion.div 自身宽度（double 模式约 2 倍单页）的次要问题依然存在但被 opacity 淡出缓解观感。已在 proposal/design 的非目标中明确记录，留给后续变更隔离处理。
- **[风险] 修改规范措辞可能被视为「让规范迁就实现」** → 但原措辞描述的「轻微 opacity 柔化」在工程上已被证明是错误设计（端点近不透明导致卸载跳变），规范应当反映经验证的正确行为；本次校准附完整理由，不是迁就而是修正。

## 迁移计划

无数据迁移。纯前端动画参数修复，部署即生效：
1. 应用本变更的代码改动（`anim.ts` opacity 0.92→0 + 删常量 + 注释）与测试改动（断言 0.92→0）。
2. 应用规范改动（`ui-animation` spec 措辞校准）。
3. 验证：`npx tsc --noEmit`、`npm test`（重点 `anim.test.ts` 与 `PageFlipView.test.tsx`）、`npm run lint` 全过。
4. 回滚：`git revert` 本变更即可，无副作用（无数据/配置/依赖变化）。
