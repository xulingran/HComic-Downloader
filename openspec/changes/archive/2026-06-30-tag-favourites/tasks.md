## 1. 后端配置层（Python）

- [x] 1.1 在 `config.py` 的 `Config` dataclass 中新增 `my_tags: dict[str, list[str]]` 字段，复用 `_default_source_list_map` 作为 `default_factory`（对称现有 `tag_blacklist`，`config.py:101`）
- [x] 1.2 确认 `Config.__post_init__`（`config.py:135`）通过 `_normalize_source_list_map` 自动补齐 `my_tags` 的 5 个来源键，逻辑与 `tag_blacklist` 一致；若 `_normalize_source_list_map` 是通用函数则无需改动，若硬编码字段名则补充 `my_tags`
- [x] 1.3 在 `python/ipc/config_mixin.py` 的 `handle_get_config`（`:153-212`）中增加 `my_tags` 字段输出，经 `CONFIG_KEY_MAP` 转 camelCase `myTags`
- [x] 1.4 确认 `handle_set_config`（`:214-249`）的单字段写入路径支持 `my_tags`（`CONFIG_KEY_MAP` 已映射即可，无需改动逻辑）；新增对应的 `my_tags` → `myTags` 映射条目
- [x] 1.5 编写 Python 测试：`Config.load()` 加载不含 `my_tags` 的旧配置文件时，`my_tags` 默认补齐 5 来源空数组；`Config.save()` 后重读保持一致；非法来源键被拒绝

## 2. Electron 校验层（TypeScript）

- [x] 2.1 在 `electron/validators.ts` 中新增 `myTags()` 校验器，对称现有 `tagBlacklist()`（`:200-228`）：5 来源对象、每来源数组、每项非空字符串 ≤64 字符、去重、每来源 ≤500 项
- [x] 2.2 确认 `set_config` 的 IPC 转发路径（`electron/main.ts`）对新键 `myTags` 透明透传，无需新增 `ipcMain.handle`
- [x] 2.3 编写校验器测试：合法 `myTags` 通过；缺失来源键、非数组值、超长标签、重复项、非法来源键各被拒绝

## 3. 前端共享类型（shared/types.ts）

- [x] 3.1 新增 `MyTags` 类型：`Record<SourceKey, string[]>`（对称 `TagBlacklist`，参考 `shared/types.ts` 中现有定义）
- [x] 3.2 在 `CONFIG_KEYS` 白名单（如有）与 config 类型契约中加入 `myTags` 字段
- [x] 3.3 确认 `SOURCE_META` 中 `copymanga` 的能力位无需新增（标签收藏复用 `supportsTagRecommendation`，copymanga 已为 `false`）

## 4. 前端 Store（useSettingsStore.ts）

- [x] 4.1 在 `useSettingsStore` 中新增 `myTags: MyTags` state（默认 `DEFAULT_TAG_BLACKLIST` 同构的空 map），对称 `tagBlacklist`（`useSettingsStore.ts:12,57`）
- [x] 4.2 新增 `addMyTag(source, tag)` action：去重（大小写不敏感）、长度校验、**与 `tagBlacklist` 互斥校验**（若该来源已屏蔽该标签则拒绝）、更新 state
- [x] 4.3 新增 `removeMyTag(source, tag)` action：从 `myTags[source]` 移除指定标签（大小写不敏感）
- [x] 4.4 新增 `setMyTags(myTags)` action：整体替换（用于初始化加载），对称 `setTagBlacklist`（`:95`）
- [x] 4.5 同步修改 `addTag`/`removeTag`（黑名单 action，`:70-95`）增加**与 `myTags` 互斥校验**：加入黑名单时若该标签已是推荐标签则拒绝
- [x] 4.6 新增 `subscribeToMyTagsChanges(setConfig)` 持久化订阅，对称 `subscribeToBlacklistChanges`（`:202-210`），`myTags` 变更时调 `setConfig('myTags', ...)`
- [x] 4.7 编写 store 测试：添加/移除推荐标签、去重、互斥校验（双向：黑名单→推荐、推荐→黑名单）、持久化订阅触发

## 5. 前端配置初始化（useInitConfig.ts）

- [x] 5.1 在 `useInitConfig.ts` 中加载 `myTags`，对称 `tagBlacklist` 的加载逻辑（`:31-37`）：从 `get_config` 结果取 `myTags`，归一化为含 5 来源键的对象，调 `setMyTags`
- [x] 5.2 在 `App.tsx` 或配置订阅挂载点注册 `subscribeToMyTagsChanges(setConfig)`，对称现有 `subscribeToBlacklistChanges` 的挂载

## 6. 搜索页高亮逻辑翻转（SearchPage.tsx）—— 核心改动

- [x] 6.1 修改 `SearchPage.tsx` 的 `favTags` 加载 effect（`:289-295`）：移除对 `getFavouriteTags` 的依赖，改为直接从 `useSettingsStore` 读 `myTags`
- [x] 6.2 修改 `recommendedTags` useMemo（`:297-300`）：来源从 `favTags.tags` 改为 `myTags[source]`，做小写归一；`favouriteTagHighlight` 开关门与 `sourceSupportsTagRecommendation` 门保持不变
- [x] 6.3 确认 `filteredComics` useMemo（`:304-312`）的 `isRecommended` 计算逻辑不变（`!isBlocked && recommendedTags.size > 0 && matchCount >= favouriteTagMinMatches`），仅数据源已切换
- [x] 6.4 编写测试：`my_tags` 非空且开关开启时命中漫画 `isRecommended=true`；`my_tags` 为空时即使开关开启也无高亮；`favourite_tag_index` 有数据但未进 `my_tags` 时不高亮

## 7. 详情抽屉改造（ComicInfoDrawer.tsx）

- [x] 7.1 修改 `recommendedTagSet` useMemo（`:44-47`）：来源从 `drawerFavTags`（getFavouriteTags 结果）改为 `myTags[comicSource]`（来自 store）
- [x] 7.2 移除或改造 `getFavouriteTags` 在抽屉中的使用（`:20,60-67`）：详情抽屉不再需要拉取 `favourite_tag_index`，推荐态完全由 store 的 `myTags` 决定
- [x] 7.3 改造 tag chip 小按钮的 `confirmTag` 状态（`:25,466-476,516-563`）：从 `block`/`unblock` 二态扩展为支持 `block`/`unblock`/`favourite`/`unfavourite` 四态
- [x] 7.4 重写 confirmTag Modal 弹窗内容（`:516-563`）：根据标签当前状态动态展示选项——未设置时显示「加入推荐 / 屏蔽」；已推荐时显示「取消推荐 / 屏蔽」；已屏蔽时显示「取消屏蔽」
- [x] 7.5 在 Modal 的确认处理中调用 `addMyTag`/`removeMyTag`（来自 store），并处理互斥冲突的可见提示（如尝试加入推荐但已屏蔽时提示「请先取消屏蔽」）
- [x] 7.6 修改 tag chip 推荐态样式判定（`:448`）：`isRec` 仍基于 `recommendedTagSet`，但该集合来源已改为 `myTags`；确认屏蔽态与推荐态的视觉互斥正确
- [x] 7.7 编写详情抽屉测试：四态弹窗的选项展示、加入/取消推荐调用 store action、互斥冲突提示

## 8. 设置页推荐标签区改造（FavouriteTagSettings.tsx）—— 主要 UI 改动

- [x] 8.1 在现有 card 内（`section-favourite-tags`）拆出两个视觉区：上方「推荐标签」(my_tags) 区，下方「检测标签」(候选池) 区
- [x] 8.2 「推荐标签」区：展示 `myTags[source]` 的标签 chip（带移除按钮）+ 手动输入框（提交时调 `addMyTag`，去重与校验失败时提示）
- [x] 8.3 「检测标签」区：保留现有 `getFavouriteTags`/`syncFavouriteTags` 逻辑展示 `favourite_tag_index` 候选 chip（带 count）；chip 点击改为调 `addMyTag`（加入推荐）
- [x] 8.4 候选池 chip 的已选态：组件内读 `myTags[source]`，对已在 `my_tags` 中的候选 chip 渲染打勾 + 置灰（不可重复点击加入），提供取消推荐入口（点击移除）
- [x] 8.5 候选池为空时保留引导文案（「请先同步收藏夹以生成检测标签」）与同步按钮
- [x] 8.6 来源切换（`:123-134`）必须同时刷新「推荐标签」区（读 store）与「检测标签」区（重新 `getFavouriteTags`）
- [x] 8.7 移除或改造现有候选 chip 的「移除」语义（`:166-173,214-221`）：原「移除推荐标签」按钮（删 `favourite_tag_index`）改为「加入推荐」；保留对 `favourite_tag_index` 的 `removeFavouriteTag` 能力作为候选池管理（可选，放「显示全部」弹窗内）
- [x] 8.8 编写设置页测试：推荐标签区 CRUD、手动输入校验、候选池挑选加入、候选 chip 已选态置灰、来源切换刷新两区

## 9. 集成与回归验证

- [x] 9.1 运行 `pytest` 全部通过
- [x] 9.2 运行 `npx tsc --noEmit` 类型检查通过
- [x] 9.3 运行 `npm test` 前端测试全部通过
- [x] 9.4 运行 `npm run lint:py`、`black --check .`、`npm run lint`、`npm run lint:test-quality` 全部通过（提交前完整验证流程）
- [x] 9.5 端到端验证：从详情抽屉加入推荐标签 → 搜索页对应卡片高亮；从设置页候选池挑选 → 搜索页高亮；手动输入 → 高亮；互斥冲突提示正确显示
- [x] 9.6 回归验证：现有 `favourite_tag_highlight` 开关关闭时不高亮行为不变；`tag_blacklist` 屏蔽优先于推荐的行为不变；升级后 `my_tags` 空启动、`favourite_tag_index` 候选池仍可正常 sync 与展示
