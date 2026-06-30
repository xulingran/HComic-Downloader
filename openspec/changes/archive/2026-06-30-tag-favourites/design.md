## 上下文

现有「收藏夹标签推荐」是**被动反推 + 直接生效**机制：

```
sync_favourite_tags → favourite_tag_index(tag, source, count)
                              │
                              ▼ 直接生效
                   SearchPage.recommendedTags → 卡片琥珀高亮
```

`favourite_tag_index` 的语义被过载了——它既是「高频检测结果」，又直接充当「推荐高亮源」。用户没有主动权：既不能主动声明「我关注 NTR」，也无法决定哪些高频结果该被采用。

同时项目已有成熟的对称先例：`tag_blacklist`（`dict[source] → list[str]`，存 `config.json`，原子写）作为「屏蔽标签」黑名单。它分来源隔离、走 `get_config`/`set_config` IPC、有现成的校验器与 store 持久化订阅。这套基础设施可以**完整复用**给一个对称的「推荐标签」白名单。

约束：
- `favourite_tag_index` 现有数据是用户已 `sync` 累积的，但 `sync` 的 `clear()` 是破坏性操作（`favourite_tags_mixin.py:267`），任何让 `my_tags` 与 `favourite_tag_index` 共享存储的方案都会被 `clear()` 抹掉——这是探索阶段被排除的「存储层融合」方案的核心风险。
- `config.json` 持久化要求向后兼容：旧版客户端读取新字段时应安全忽略，新版读取旧文件时应补齐默认值。
- `copymanga` parser 不解析标签，必须排除在能力之外。

## 目标 / 非目标

**目标：**
- 引入 `my_tags`（「推荐标签」白名单），作为搜索卡片高亮的**唯一生效源**，对称 `tag_blacklist`。
- 将 `favourite_tag_index` 降级为「检测标签」候选池，仅展示，不直接生效。
- 提供三个入口填充 `my_tags`：候选池挑选、手动输入、详情抽屉。
- 后端零 DB schema 变更、零迁移脚本、零新增 IPC handler（复用 `get_config`/`set_config`）。

**非目标：**
- 不迁移存量 `favourite_tag_index` 数据到 `my_tags`（用户升级后 `my_tags` 为空，高亮暂时全部失效——这是预期行为，决策权回归用户）。
- 不改动 `favourite_tag_index` 的 schema、`sync_favourite_tags` 的逻辑、`clear()` 的行为（它回归「检测标签」重建本职）。
- 不引入「定期 sync」或「基于 my_tags 的新漫画推送」——这些是后续可能的扩展。
- 不支持 copymanga 的标签收藏。
- 不做跨来源标签归一化（如 jm 的「校園」与 nh 的「school」不做对齐）。

## 决策

### 决策 1：`my_tags` 存 `config.json` 而非 SQLite（对称 `tag_blacklist`）

**选择**：`my_tags` 作为 `Config` dataclass 的新字段，存 `config.json`。

**理由**：
- 与 `tag_blacklist` 完全对称（二值、手动管理、需原子写、量小），复用 `_default_source_list_map` / `_normalize_source_list_map` / `Config.save()` 原子写。
- 走现有 `get_config`/`set_config` IPC，**无需新增 Python handler**、无需改 `ipc_server.py` 的 `_HANDLER_NAMES`。
- 数据特性匹配：用户手动管理的标签量级远小于高频检测的全量标签，JSON 足以胜任。

**考虑过的替代方案**：
- *存 `favourite_tags.db` 新表*：要新增 handler、改 IPC 路由、改校验器、改 preload，改动面大且与「检测标签」混在一个 DB 易混淆。
- *复用 `favourite_tag_index` 加 `origin` 列*：被 `sync` 的 `clear()` 抹掉的风险高，且改 schema 要写迁移。排除。

### 决策 2：`my_tags` 高亮源替换 `favourite_tag_index`（核心逻辑翻转）

**选择**：`SearchPage` 的 `recommendedTags` 集合从「读 `getFavouriteTags(source)` 返回的 `favourite_tag_index`」改为「读 `myTags[source]`」。

**理由**：
- 高亮的语义本是「用户想关注的标签」，应由用户主动声明而非被动统计。
- 翻转后 `favourite_tag_index` 回归「检测标签候选池」本职——它是建议，不是决策。

**影响**：`SearchPage.tsx:297-312` 的 `recommendedTags` useMemo、`favTags` 加载 effect 需重写。`favouriteTagHighlight` 开关含义从「高亮被动反推」变为「高亮 `my_tags`」，语义更清晰且向后兼容（开关名不变，用户感知是「我加的标签现在生效了」）。

**考虑过的替代方案**：
- *高亮源同时包含 `my_tags` 和 `favourite_tag_index`*：违背「用户决策闸门」原则，且 `favourite_tag_index` 仍会推用户未确认的标签，与提案目标冲突。排除。

### 决策 3：`favourite_tag_index` 保留为候选池，`sync` 逻辑不动

**选择**：`favourite_tags_mixin.py`、`favourite_tag_index` schema、`sync_favourite_tags`、`clear()` 全部保持现状。

**理由**：
- 候选池本就该被 `sync` 全量重建（每次同步反映最新收藏夹状态），`clear()` 的「破坏性」对候选池是正确语义。
- 不迁移存量数据：`my_tags` 初始为空。用户首次进入设置页会看到「检测到 N 个候选标签，点击挑选」的引导态。

**风险**：升级后老用户的高亮会暂时全部失效（因为 `my_tags` 为空）。缓解：设置页候选池区提供清晰的引导文案与一键挑选路径。

### 决策 4：三个入口共用同一 `my_tags` 写入路径

**选择**：三个入口（候选池挑选、手动输入、详情抽屉）都通过 `useSettingsStore` 的 `addMyTag(source, tag)` / `removeMyTag(source, tag)` action 修改 `my_tags`，并由现有 `subscribeTo*Changes` 模式经 `set_config` 持久化。

**理由**：
- 单一写入路径保证一致性，store 变更自动触发持久化与 UI 联动（如候选池 chip 即时打勾置灰）。
- 详情抽屉的 tag chip 小按钮弹窗从现有「屏蔽/取消屏蔽」二选一扩展为「加入推荐/屏蔽/取消」三态，复用同一 store action。

**考虑过的替代方案**：
- *详情抽屉走独立 IPC*：引入冗余路径，破坏 store 单一数据源原则。排除。

### 决策 5：大小写归一与去重对齐 `tag_blacklist`

**选择**：`my_tags` 的比较与去重规则与 `tag_blacklist` 完全一致——比较时 `toLowerCase()`，存储时去重。

**理由**：`tag-recommendation-highlight` 规范已要求 `recommendedTags` 匹配大小写不敏感（`spec.md:71-74`），`my_tags` 作为新数据源必须延续此行为。复用 `tag_blacklist` 的 `addTag`/`removeTag` 实现模式（`useSettingsStore.ts:73-95`）保证一致性。

### 决策 6：`my_tags` 与 `tag_blacklist` 冲突的处理

**选择**：一个标签**禁止**同时存在于同一来源的 `my_tags` 与 `tag_blacklist`。添加时若冲突，写入端拒绝并提示。

**理由**：「屏蔽」与「推荐」语义互斥。`SearchPage` 现有逻辑中 `isBlocked` 优先于 `isRecommended`（`SearchPage.tsx:309`：`const isRecommended = !isBlocked && ...`），但显式禁止冲突比依赖优先级隐式裁决更清晰，避免用户困惑。

## 风险 / 权衡

- **[升级后高亮暂时全部失效]** → 接受。这是把决策权交还用户的必然代价。设置页提供候选池引导，用户可快速重建。文档（design + spec）明确记录此行为为预期。
- **[详情抽屉弹窗从二选一变三选一，交互复杂度上升]** → 缓解：弹窗按当前状态动态展示——标签已屏蔽时只显示「取消屏蔽」，已推荐时只显示「取消推荐」，未设置时显示「加入推荐 / 屏蔽」两个选项。避免平铺三按钮的认知负担。
- **[`my_tags` 与 `favourite_tag_index` 两套数据源在前端共存]** → 接受。这是「候选建议 vs 用户决策」分离的必然结果。`FavouriteTagSettings` 拆为「推荐标签」(my_tags CRUD) 与「检测标签」(候选池展示+挑选) 两个视觉区，让用户清晰区分。
- **[config.json 字段膨胀]** → 可接受。`my_tags` 与 `tag_blacklist` 同量级（每源 ≤500 项，单标签 ≤64 字符），JSON 体积增量在 KB 级，与现有 `tag_blacklist` 等同。

## 迁移计划

**部署**：纯前端 + 后端配置字段新增，无 DB 迁移、无破坏性 API 变更。
1. 后端 `config.py` 加 `my_tags` 字段（默认空 dict，`__post_init__` 补齐 5 来源键）。
2. `Config.load()` 已有「只保留已知字段」逻辑（`config.py:296-301`），旧文件不含 `my_tags` 时自动用默认值，向后兼容。
3. 前端 store 初始化加载 `my_tags`，与 `tagBlacklist` 同路径。

**回滚**：
- 移除前端 store/UI 对 `my_tags` 的引用即可恢复「高亮读 `favourite_tag_index`」旧行为。
- `config.json` 中残留的 `my_tags` 字段被旧版客户端安全忽略（`Config.load` 丢弃未知 key）。
- `favourite_tag_index` 全程未动，回滚后立即可用。

## 开放问题

- **候选池与 `my_tags` 的 store 联动时机**：用户在详情抽屉加入一个 `my_tag` 后，设置页候选池该标签应即时打勾置灰。由于两者分别来自不同数据源（store vs IPC），需确认是 store 联动还是组件内本地计算。倾向组件内本地计算（候选池组件读 `myTags` store 渲染打勾态），避免引入跨组件订阅。
- **手动输入框的标签校验**：是否限制只能输入「检测标签候选池内已有的标签」，还是允许任意字符串？倾向允许任意字符串（与 `tag_blacklist` 一致），但提供候选池的自动补全作为 UX 增强。
