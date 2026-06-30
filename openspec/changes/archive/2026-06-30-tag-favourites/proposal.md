## 为什么

现有的「收藏夹标签推荐」是**被动反推**机制：`sync_favourite_tags` 从已收藏漫画统计高频标签，结果**直接生效**为推荐标签用于卡片高亮。用户无法主动表达「我关注哪些标签」，也无法决定哪些高频结果该被采用。

这造成两个问题：

1. **无主动权**：用户不能主动收藏一个标签作为「我感兴趣的」。看到喜欢的标签（NTR、人妻、纯爱…）只能任由系统从收藏夹反推，缺乏与 `tag_blacklist`（屏蔽标签）对称的「关注标签」能力。
2. **决策缺位**：高频检测结果直接生效，用户不知道「为什么这个被推荐」，也不能筛选掉误检或不想高亮的标签。被动的统计结果应该作为**建议候选**，由用户挑选确认后才生效。

## 变更内容

引入新的「推荐标签」(my_tags) 概念作为**唯一高亮生效源**，对称现有 `tag_blacklist`。现有 `favourite_tag_index` 降级为纯展示的「检测标签」候选池。

- **新增「推荐标签」(`my_tags`) 配置字段**：`dict[source] → list[str]`，结构完全对称 `tag_blacklist`，存 `config.json`，原子写。这是搜索卡片高亮的唯一生效来源。
- **现有「收藏夹标签推荐」语义翻转**：`favourite_tag_index`（高频检测结果）从「直接生效的推荐标签」变为「检测标签候选池」，仅用于展示，不再直接参与高亮计算。**不迁移存量数据**——`my_tags` 初始为空，用户首次需手动挑选。
- **用户确认闸门**：用户通过三个入口填充 `my_tags`：
  1. 设置页「检测标签」候选池 chip 点击 → 加入「推荐标签」（已选的打勾置灰）
  2. 设置页「推荐标签」区的手动输入框（可添加 sync 未检测到的标签）
  3. 详情抽屉 tag chip 的小按钮弹窗，从现有「屏蔽 / 取消屏蔽」二选一扩展为「加入推荐 / 屏蔽 / 取消」
- **`favourite_tag_highlight` 开关复用**：含义从「高亮被动反推标签」变为「高亮 `my_tags`」。最少命中数 `favourite_tag_min_matches` 含义不变（命中 `my_tags` 的数量阈值）。
- **范围限定**：支持来源与现有推荐能力一致——`hcomic / moeimg / jm / bika`，不含 `copymanga`（其 parser 不解析标签）。

## 功能 (Capabilities)

### 新增功能
- `tag-favourites`: 用户主动管理的「推荐标签」白名单。对称 `tag_blacklist` 的黑名单能力，分来源隔离，作为搜索结果卡片高亮的唯一生效源。

### 修改功能
- `tag-recommendation-highlight`: 推荐高亮的数据源从「被动反推的 `favourite_tag_index`」改为「用户主动确认的 `my_tags`」。视觉规范（琥珀色高亮、CoverCard/DetailedCard 样式、与选中态优先级）保持不变。
- `config`: 新增 `my_tags` 配置字段（`dict[source] → list[str]`），纳入 IPC `get_config`/`set_config` 契约，遵循与 `tag_blacklist` 一致的持久化、来源键归一化与默认值补齐规则。

## 影响

- **Python 后端**（轻量）：
  - `config.py`：新增 `my_tags` 字段（对称 `tag_blacklist`，复用 `_default_source_list_map` / `_normalize_source_list_map`）
  - `python/ipc/config_mixin.py`：`handle_get_config`/`handle_set_config` 增加 `my_tags` 的 camelCase 映射
  - `python/ipc/favourite_tags_mixin.py`：**不动**（`favourite_tag_index` 回归「检测标签候选池」本职，schema/sync/clear 全部保持现状）
  - `python/ipc_server.py`：**不动**（复用现有 `get_config`/`set_config` IPC，无需新增 handler）
- **Electron 层**：
  - `electron/validators.ts`：新增 `myTags()` 校验器（对称现有 `tagBlacklist()`，5 来源数组校验）
  - `electron/main.ts`：`set_config` 已支持透传，无需新增 IPC handler
- **前端**（主要改动）：
  - `shared/types.ts`：`MyTags` 类型 + config schema
  - `src/stores/useSettingsStore.ts`：新增 `myTags` state + setter + 持久化订阅
  - `src/hooks/useInitConfig.ts`：初始化加载 `myTags`
  - `src/pages/SearchPage.tsx`：`recommendedTags` 计算源从 `favTags`（favourite_tag_index）改为 `myTags[source]`（**核心逻辑翻转**）
  - `src/components/ComicInfoDrawer.tsx`：tag chip 小按钮弹窗交互扩展；`recommendedTagSet` 改读 `myTags`
  - `src/components/settings/FavouriteTagSettings.tsx`：拆为「推荐标签」(my_tags CRUD) 与「检测标签」(候选池展示+挑选) 两区
- **数据库**：无 schema 变更，无迁移脚本（`favourite_tags.db` 完全不动）
- **向后兼容**：不迁移存量 `favourite_tag_index`；用户升级后 `my_tags` 为空，高亮暂时全部失效，需主动挑选——这是预期行为（决策权回归用户）。
