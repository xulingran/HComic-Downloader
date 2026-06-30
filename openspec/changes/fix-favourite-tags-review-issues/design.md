## 上下文

最近 11 个提交中，`tag-favourites` 系列改动引入了收藏标签同步进度功能，但进度 IPC 的类型/hook/事件源/测试 mock 仍停留在工作区未提交状态，而已提交的 `FavouriteTagSettings.tsx` 却引用了这些符号——导致干净 HEAD 的 `tsc` 报 `TS2305`/`TS2724`、Vitest 17/1287 失败。同时审查发现两个独立缺陷：NH 来源在抽屉里可"加入推荐"但下游（搜索页高亮、设置页管理、后端持久化）均不消费/丢弃该写入；连续触发操作 Toast 时计时器不会重置。

三类问题彼此独立，但共享同一修复窗口（必须一起纳入主干才能让 HEAD 通过全套闸门）。本设计聚焦修复策略，不引入新功能域。

约束（来自 AGENTS.md）：
- 所有网络请求走系统代理（本变更不新增网络请求，无关）。
- 完整验证流程：`pytest` / `npx tsc --noEmit` / `npm test` / `npm run lint:py` / `black --check .` / `npm run lint` / `npm run lint:test-quality` 必须全过。
- 来源能力标志集中在 `SOURCE_META`（`shared/types.ts`），通过 `utils/source.ts` 的 `sourceSupports*` 访问器消费，禁止散落硬编码。

## 目标 / 非目标

**目标：**
- 干净 HEAD（无工作区未提交改动）通过 `tsc --noEmit` 与完整 Vitest，消除"未提交改动掩盖编译失败"的状态。
- "加入推荐"动作在入口处即按来源能力门控，杜绝 NH 等不支持推荐的来源出现可写但无效的操作。
- 连续 Toast 提示能正确刷新超时，第二条提示不被第一条计时器提前关闭。
- 为三项修复补充回归测试，并通过 `test-quality-gate`（禁止裸 mock 调用断言、纯 store CRUD 往返）。

**非目标：**
- 不重构 `tag-favourites` 的整体架构或同步算法。
- 不改变 `SOURCE_META` 的能力定义（不把 NH 改为支持推荐）——NH 不支持推荐是既定产品决策，本次只让 UI 入口与之一致。
- 不调整 Toast 的视觉/动画系统（仅修正计时器重置逻辑）。
- 不处理 `favourite-tags-sync-progress` 归档目录之外的其它历史变更。

## 决策

### D1. P0：将进度 IPC 改动转为正式提交（而非回退引用）
工作区已存在完整的进度 IPC 实现（类型 + hook + 主进程桥接 + Python 事件源 + 测试），且 `FavouriteTagSettings.tsx` 已依赖它。两条路径：
- **(a) 提交进度 IPC（采纳）**：把这些改动正式纳入主干，使引用与定义在同一提交内闭合。
- **(b) 回退 `FavouriteTagSettings.tsx` 的进度订阅**：删除引用，保留主干可编译，但丢失已实现的进度反馈功能。

理由：进度反馈是有价值且基本完成的功能（已有测试），回退会丢弃工作成果且未来需重做。采纳 (a)，但要求把所有相关文件（types/hook/main/preload/python/测试/spec）作为一个原子变更提交，避免再次出现"部分提交"。

### D2. P1：入口门控优先于 store/backend 门控
失效链路有三处（抽屉入口、搜索页高亮、后端 normalize）。门控点选择：
- **(a) 仅在抽屉入口门控（采纳）**：在 `ComicInfoDrawer.tsx` 渲染标签按钮时，按 `sourceSupportsTagRecommendation(comicSource)` 决定是否生成 `favourite`/`unfavourite` 动作；不支持的来源该按钮退化为仅"屏蔽/取消屏蔽"。
- **(b) 同时在 `addMyTag` store 与后端 `_normalize_source_list_map` 加拒绝**：写入即报错。
- **(c) 在 `tag-recommendation-highlight` 搜索页门控**：已在做（既有代码），无需改动。

理由：(a) 在最早可触达处拦截，避免假成功写入从源头产生；与搜索页既有门控形成一致的用户心智（入口、搜索、设置三处都不出现 NH 推荐）。(b) 作为纵深防御可补充，但 store/backend 拒绝会引入"按钮点了却失败"的体验倒退，本次不作为主修复，仅在规范层记录约束。`SOURCE_META` 已是单一事实源，入口直接复用 `sourceSupportsTagRecommendation`，零硬编码。

### D3. P2：用可重置 timer ref 替代布尔 effect 重触发
当前 effect 依赖 `[showOpToast]`（布尔），连续 `showToast` 时 `true→true` 不重渲染、effect 不重跑。修复选项：
- **(a) timer ref 模式（采纳）**：参照仓库内 `ComicInfoDrawer.tsx` 的 `tagToastTimerRef`，在 `showToast` 内 `clearTimeout` 旧 ref 再 `setTimeout` 新计时器，卸载时 cleanup。effect 仅负责卸载清理。
- **(b) effect 依赖 `opToastMessage`**：每次文案变化重跑 effect 重置计时器。

理由：(a) 是仓库既有、经过验证的模式，语义清晰（"显示即重置计时"），且不引入"文案不变则不刷新"的边界 bug。(b) 在 `showToast(同一条消息)` 连续调用时仍不会重置（文案未变），治标不治本。

## 风险 / 权衡

- **[风险] P0 提交范围误判，漏提某个文件再次导致 HEAD 编译失败** → 在 `tasks.md` 中明确列出全部受影响文件清单（与 `git status` 一一对应），并以"stash 后跑 `tsc`+`npm test`"作为完成判据。
- **[风险] P1 门控后，NH 抽屉里标签按钮失去"加入推荐"动作，用户可能困惑** → 退化后的按钮仍保留"屏蔽/取消屏蔽"，与该来源不支持推荐的产品定位一致；不额外加文案提示（避免 UI 膨胀）。
- **[权衡] P2 采纳 timer ref 而非布尔 effect，轻微偏离该文件既有 effect 风格** → 但与 `ComicInfoDrawer.tsx` 已有模式一致，跨文件统一反而更好；新增单测覆盖"连续 showToast 时第二条不被提前关闭"。
- **[风险] `addMyTag` store 与后端 normalize 仍接受 NH 写入（纵深防御缺口）** → 本次不扩展（避免体验倒退），但在 `tag-favourites` spec 中记录"入口门控是主防线"的约束，未来如需加固另开变更。

## 迁移计划

无数据迁移。这是纯代码修复，部署即生效：
1. 按本变更提交进度 IPC + P1 门控 + P2 计时器修正 + 测试 + spec。
2. 验证：`git stash`（清空工作区）后 `npx tsc --noEmit` exit 0、`npm test` 全过、其余闸门全过。
3. 回滚：若主干仍不稳定，`git revert` 本变更即可恢复（无副作用数据）。
