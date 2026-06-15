## 上下文

收藏重复检测是工具箱中的纯前端功能（`src/components/tools/DuplicateDetector.tsx` + `DuplicateGroup.tsx` + `src/utils/titleSimilarity.ts`），当前完全无状态：每次点击"开始检测"都重新拉取收藏、用 LCS≥0.6 的并查集聚类重新计算、渲染可折叠卡片组。组的折叠状态（`DuplicateGroup` 的本地 `expanded` state）每次刷新即丢失，更无法跨次检测保留。

后端配置（根目录 `config.py` 的 `Config` dataclass）已有一个高度同构的先例 `tag_blacklist: dict[str, list[str]]`——按来源（hcomic/moeimg/jmcomic/bika）隔离的字符串列表，通过 `CONFIG_KEY_MAP`（`python/ipc/types.py`）与前端 camelCase 双向映射，前端经 `useSettingsStore` 的 add/remove 方法和 `subscribeToBlacklistChanges` 订阅持久化。这套契约面由 `ipc-channel-consistency.test.ts` 保护三处定义一致（AppConfig / ConfigKey / CONFIG_KEYS）。

本设计在此之上为重复检测引入持久化的"已忽略"机制。

## 目标 / 非目标

**目标：**
- 让用户把人工判定（"这组不是重复"或"已处理"）沉淀为持久规则，下次检测自动以折叠态呈现。
- 与现有 `tag_blacklist` 架构同构，最大化复用既有契约/store/订阅模式，降低实现与维护成本。
- 撤销路径清晰：既能在检测结果区逐组取消忽略，也能在专门的管理面板批量回溯。
- 向后兼容：老配置文件无新字段时不报错、行为不变。

**非目标：**
- **不**过滤或删除任何重复组——组始终被检测和渲染（Render-only），仅控制展开/折叠初值。
- **不**做自动合并、删除收藏、跨来源去重等重操作。
- **不**在 v1 做阈值灵敏度配置（仍固定 0.6）。
- **不**主动清理陈旧黑名单条目（已不在收藏夹的指纹）——Render-only 策略下它们无害，仅占用少量配置空间。

## 决策

### 决策 1：黑名单钥匙 = 组指纹（normalizedTitle 字典序最小值），不拼来源前缀

**选择**：组的代表指纹取 `min(group.comics.map(c => normalizeTitle(c.title)))`，存入 `duplicate_blacklist[source]` 列表（裸字符串，无来源前缀）。

**理由**：
- `normalizeTitle` 已抹平括号后缀、全角字符、空白等噪声，比原始标题抗噪。
- 字典序最小值是**确定性函数**——与收藏分页顺序、成员增删无关。只要字典序最小的那个成员还在组内，指纹就稳定不变（即便其他成员被取消收藏或被站方改名）。对比"取 `comics[0]`"：后者依赖收藏分页返回顺序，翻页/取消收藏后 `[0]` 会漂移，导致同一组下次指纹不同而漏匹配。
- 来源前缀冗余——dict 的 key 已按来源分桶，条目内再带 `hcomic::` 前缀纯属重复。

**考虑过的替代方案**：
- *取 `comics[0].title`*：实现最简单（现状的 de facto 代表），但脆弱（依赖顺序）。**否决**。
- *存组内所有 comic id 的集合*：精确但脆——成员增删导致集合漂移，匹配变难。且语义错位（用户想"记住这一组"，而非"记住这几个 id"）。**否决**。
- *指纹拼来源前缀*：与"按来源隔离的 dict"重复。**否决**。

### 决策 2：行为策略 = Render-only（折叠而非过滤）

**选择**：黑名单组始终被 `findDuplicateGroups` 计算并渲染，仅以折叠态呈现，头部带"取消忽略"按钮。不在检测管道中过滤掉它们。

**理由**：
- 过滤（Filter）会让组"消失"，用户难以发现"我是不是误忽略了某组"。折叠保留可见性，撤销路径天然存在。
- 即便指纹偶尔漏匹配（成员被改名），最坏后果只是"那组又展开了"——用户再点一次忽略即可，**零数据损失**。这是 Render-only 相对 Filter 的关键优势。
- 统计文案区分两段计数（`发现 N 组（其中 M 组已忽略）`），让用户对"有多少被折叠了"有感知。

**考虑过的替代方案**：
- *Filter 为主 + "显示已忽略"开关*：主视野更干净，但隐藏态下的组难以回溯。**否决**（保留折叠可见性更符合"黑名单 = 我已处理但仍可找回"的语义）。

### 决策 3：数据结构 = 结构化条目 {fingerprint, memberCount}，支持成员变动检测

**选择**：`duplicate_blacklist: dict[str, list[dict]]`，每项为 `{"fingerprint": str, "memberCount": int | null}`。前端定义新类型 `DuplicateBlacklistEntry`。store 方法 `addDuplicateIgnore` / `removeDuplicateIgnore` / `confirmMemberCount` 参照 `addTag` / `removeTag`。

**理由**：
- 纯字符串列表（`list[str]`）无法支持"组成员数量变化"提示——需要记录忽略时的基线成员数才能比对。
- `memberCount: int | null` 的 nullable 设计：null 表示"基线未知"（旧版纯字符串数据迁移而来），首次检测到对应组时静默填充，不触发变动提示；int 表示已建立的基线，后续检测若组成员数不等则提示。
- 这个选择放弃了与 `tag_blacklist` 的完全同构（后者是 `list[str]`），但换来了变动检测能力。store/订阅/配置映射的模式仍可复用，只是值类型更丰富。

**memberCount 生命周期**：
```
忽略时:      memberCount = group.comics.length (非 null 基线)
null 迁移:   旧字符串 → {fingerprint, memberCount: null}
检测时:
  if memberCount === null:  静默填充为当前值，不提示
  elif != 当前值:           计入变动徽章
用户确认:    memberCount 更新为当前值，清除变动
```

**考虑过的替代方案**：
- *纯字符串 list[str]，不支持变动检测*：最简单，但无法满足"成员变动提示"需求。**否决**。
- *memberCount=0 表示未知*：0 是合法的成员数边界（空组），语义模糊。用 null 更清晰。**否决**。
- *memberCount=null 首次也提示*：会让所有旧条目首次检测都亮徽章，偏吵。静默升级更友好。**否决**。

### 决策 4：管理面板 = 复用项目既有 Modal 范式，无二次确认

**选择**：新建 `DuplicateBlacklistManager.tsx` 弹窗，复用 `PageJumpDialog` / `TagFilterSettings.ConfirmDialog` 确立的范式（`fixed inset-0` + `bg-black/50` 遮罩 + 点击背景关闭 + `max-w-*` 卡片）。面板内含来源切换 tabs + 指纹列表（每项带 ✕ 移除按钮，**点击即移除，无二次确认**）。

**理由**：
- 复用范式保证视觉/交互一致性，无需引入新组件库或设计语言。
- 取消忽略是非破坏性操作（最坏情况是某组下次检测又折叠回来，用户再点忽略即可），与 tag 删除（会改变搜索结果可见性）不同，不需要 `ConfirmDialog` 二次确认。与结果区"取消忽略"按钮行为保持一致。

### 决策 5：挂载点 = `useInitConfig.ts` 与现有 subscribe 并排

**选择**：`subscribeToDuplicateBlacklistChanges` 在 `src/hooks/useInitConfig.ts` 第 48-50 行附近与另外三个 subscribe 并排挂载。

**理由**：这是项目既定的 subscribe 挂载点，遵循即可，无需引入新的生命周期钩子。

## 风险 / 权衡

- **[指纹漂移导致漏折叠]** → 组内字典序最小的成员被取消收藏或被站方改名时，指纹变化，下次检测该组不再被折叠。**缓解**：Render-only 策略下漏折叠的代价仅为"那组又展开了"，用户重新点击忽略即可，零数据损失。可接受。
- **[陈旧黑名单条目堆积]** → 长期使用后，已不在收藏夹的标题指纹残留在黑名单中，无法通过检测结果区的"取消忽略"清除。**缓解**：v1 不处理（无害，仅占少量配置空间）。若用户反馈，后续可在管理面板加"清空当前来源"按钮。已在非目标中明确排除。
- **[三处契约定义不一致]** → `shared/types.ts` 的 AppConfig / ConfigKey / CONFIG_KEYS 必须三处同步，遗漏任一处会导致类型错误或运行时配置不持久化。**缓解**：由 `ipc-channel-consistency.test.ts` 自动保护；实现任务中将三处同步列为单一原子步骤。
- **[跨来源撞标题]** → 不同来源偶有相同 normalizedTitle，但因 dict 按来源分桶，互不影响。**缓解**：设计上已规避，无需额外处理。

## 迁移计划

- **部署**：纯增量变更，无数据迁移。老配置文件加载时，`Config.load()` 的"未知 key 忽略 + 缺字段填默认值"机制会自动补全 `duplicate_blacklist = {}`，行为与旧版完全一致。
- **回滚**：移除新字段后，老版本读取含 `duplicate_blacklist` 的新配置文件时，该 key 被当作未知 key 忽略并告警，不影响其他功能。回滚零风险。
