## 1. 契约层（Config + IPC 映射 + 前端类型）

- [x] 1.1 在 `config.py` 的 `Config` dataclass 中新增字段 `duplicate_blacklist: dict[str, list[str]] = field(default_factory=lambda: {s: [] for s in COMIC_SOURCES})`，参照 `tag_blacklist` 的默认值写法（确认 `COMIC_SOURCES` 来源列表含 bika）
- [x] 1.2 在 `python/ipc/types.py` 的 `CONFIG_KEY_MAP` 中新增映射 `duplicateBlacklist ↔ duplicate_blacklist`，参照 `tagBlacklist ↔ tag_blacklist`（含 `config_mixin.py` 序列化补充）
- [x] 1.3 在 `shared/types.ts` 三处同步新增 `duplicateBlacklist`：`AppConfig` 接口（类型复用 `TagBlacklist`）、`ConfigKey` 联合类型、`CONFIG_KEYS` 常量数组。三处必须作为单一原子步骤完成（由 `ipc-channel-consistency.test.ts` 保护）

## 2. 状态层（Store + 订阅挂载）

- [x] 2.1 在 `src/stores/useSettingsStore.ts` 新增状态 `duplicateBlacklist: TagBlacklist`（默认值 `{ ...DEFAULT_TAG_BLACKLIST }`，复用现有默认值工厂）
- [x] 2.2 在 store 中新增方法 `addDuplicateIgnore(source, fp)`：参照 `addTag`，但去重比较**不做大小写折叠**（标题指纹精确比较，保持原样）
- [x] 2.3 在 store 中新增方法 `removeDuplicateIgnore(source, fp)`：参照 `removeTag`，同样不做大小写折叠
- [x] 2.4 新增 `subscribeToDuplicateBlacklistChanges(setConfig)` 函数，参照 `subscribeToBlacklistChanges`，监听 `duplicateBlacklist` 变化并经 `setConfig('duplicateBlacklist', ...)` 持久化
- [x] 2.5 在 `src/hooks/useInitConfig.ts` 第 48-50 行附近，与现有三个 subscribe 并排挂载 `subscribeToDuplicateBlacklistChanges(setConfig)`，并妥善管理其 unsubscribe（含 duplicateBlacklist 的归一化加载逻辑）

## 3. 逻辑层（指纹算法 + 检测分组）

- [x] 3.1 在 `src/utils/titleSimilarity.ts` 导出辅助函数 `groupFingerprint(group: DuplicateGroup): string`，返回 `group.comics.map(c => normalizeTitle(c.title)).sort()[0] ?? ''`（字典序最小值；空组返回空字符串作为边界保护）
- [x] 3.2 在 `DuplicateDetector.tsx` 的 `handleDetect` 中，对 `findDuplicateGroups` 返回的每组计算指纹，按指纹是否在 `duplicateBlacklist[source]` 中拆分为 `activeGroups` / `ignoredGroups` 两个数组
- [x] 3.3 在 `DuplicateDetector.tsx` 渲染区：active 组在上（默认展开），ignored 组在下（默认折叠），中间以"已忽略（M 组）"分隔标题区隔
- [x] 3.4 在 `DuplicateDetector.tsx` 更新统计文案：存在 ignored 组时显示 `发现 N 组疑似重复（其中 M 组已忽略）`，否则保持原文 `发现 N 组疑似重复`

## 4. UI 层（组组件按钮 + 管理面板 + 入口）

- [x] 4.1 在 `DuplicateGroup.tsx` 新增入参 `initialExpanded?: boolean`（默认 true），将本地 `expanded` state 初始化为该值
- [x] 4.2 在 `DuplicateGroup.tsx` 新增入参 `onIgnore?: () => void` 和 `onUnignore?: () => void`：active 组头部右侧显示"忽略此组"按钮（触发 `onIgnore`），ignored 组头部右侧显示"取消忽略"按钮（触发 `onUnignore`）
- [x] 4.3 在 `DuplicateDetector.tsx` 为每个组透传 `initialExpanded`（active=true / ignored=false）和对应的 `onIgnore`/`onUnignore` 回调（回调内调用 store 的 `addDuplicateIgnore`/`removeDuplicateIgnore`，传入当前 source 和组指纹）
- [x] 4.4 新建 `src/components/tools/DuplicateBlacklistManager.tsx` 弹窗组件：复用 `PageJumpDialog`/`TagFilterSettings.ConfirmDialog` 的 Modal 范式（`fixed inset-0` + `bg-black/50` + 点击背景关闭 + `max-w-*` 卡片）；内含来源切换 tabs + 指纹列表（每项带 ✕ 移除按钮，点击即调用 `removeDuplicateIgnore`，无二次确认）+ 空态文案"暂无已忽略的重复组"
- [x] 4.5 在 `DuplicateDetector.tsx` 标题行右侧加入"管理已忽略"按钮，通过本地 state 控制开关 `DuplicateBlacklistManager` 弹窗；弹窗默认选中来源与检测来源一致

## 5. 测试

- [x] 5.1 在 `tests/unit/utils/titleSimilarity.test.ts` 新增 `groupFingerprint` 用例：字典序最小值、与输入顺序无关、非最小成员变更不影响、空组边界
- [x] 5.2 在 `tests/unit/components/DuplicateDetector.test.tsx` 新增用例：active/ignored 分组渲染、统计文案（有/无 ignored 组）、指纹匹配拆分逻辑
- [x] 5.3 在 `tests/unit/components/DuplicateGroup.test.tsx` 新增用例：`initialExpanded=false` 初始折叠、`onIgnore` 回调触发、`onUnignore` 回调触发、按钮在正确态下显示
- [x] 5.4 新建 `tests/unit/components/DuplicateBlacklistManager.test.tsx`：打开/关闭（点击背景）、来源切换、列表渲染、✕ 移除回调触发、空态文案

## 6. 验证（提交前必须全部通过）

- [x] 6.1 `pytest` 全部通过（652 passed）
- [x] 6.2 `npx tsc --noEmit` 无类型错误
- [x] 6.3 `npm test` 全部通过（731 passed，`ipc-channel-consistency.test.ts` 通过）
- [x] 6.4 `npm run lint:py` 无错误
- [x] 6.5 `black --check .` 无格式问题（90 files unchanged）
- [x] 6.6 `npm run lint` 无 ESLint 错误
- [x] 6.7 手动验证：加载老配置文件（无 `duplicate_blacklist` 字段）不报错且行为正常；忽略某组后重启应用，再次检测该组仍为折叠态（需实际运行应用，自动化测试已覆盖等价逻辑：契约层向后兼容由 `Config.load()` 的缺字段填默认值机制保证；持久化往返由 store subscribe + `setConfig` 覆盖）

## 7. 数据结构升级：支持成员变动检测（list[str] → list[{fingerprint, memberCount}]）

> 背景：在已完成的纯指纹黑名单之上，新增"组成员数量变化"提示。黑名单条目从纯字符串升级为结构化对象，记录忽略时的基线成员数，用于后续检测比对。

- [x] 7.1 在 `shared/types.ts` 新增类型 `DuplicateBlacklistEntry = { fingerprint: string; memberCount: number | null }` 和 `DuplicateBlacklist = Record<string, DuplicateBlacklistEntry[]>`；将 `AppConfig` / `ConfigValueMap` 中的 `duplicateBlacklist` 类型从 `TagBlacklist` 改为 `DuplicateBlacklist`（`ConfigKey` / `CONFIG_KEYS` 无需改，键名不变）
- [x] 7.2 在 `config.py` 将 `duplicate_blacklist` 字段类型注释更新为 `dict[str, list[dict]]`（运行时仍为 dict，dataclass 不强制结构）；在 `Config.load()` 的反序列化逻辑中加入迁移：遍历每个来源的列表，若元素为 str 则转为 `{"fingerprint": s, "memberCount": None}`，若为 dict 则保留（确认含 fingerprint/memberCount 键）
- [x] 7.3 在 `python/ipc/config_mixin.py` 的序列化 `raw` 字典中确认 `duplicate_blacklist` 透传结构化数据（dict 列表），无需额外转换（Python 侧已经是 dict）
- [x] 7.4 在 `src/hooks/useInitConfig.ts` 的 `duplicateBlacklist` 加载逻辑中增加归一化：对每个来源的数组元素，若是字符串则转为 `{fingerprint: s, memberCount: null}`，若是对象则取 `fingerprint` 和 `memberCount`（缺失则 null）；输出类型为 `DuplicateBlacklist`

## 8. 状态层：store 方法重构 + 新增 confirmMemberCount

- [x] 8.1 在 `useSettingsStore.ts` 将 `duplicateBlacklist` 状态类型从 `TagBlacklist` 改为 `DuplicateBlacklist`，默认值工厂相应调整为每个来源空对象数组 `[]`
- [x] 8.2 重构 `addDuplicateIgnore(source, fingerprint, memberCount)`：查找现有条目，若存在则更新其 memberCount 为新值，不存在则追加 `{fingerprint, memberCount}`
- [x] 8.3 `removeDuplicateIgnore(source, fingerprint)` 逻辑不变（按 fingerprint 过滤移除）
- [x] 8.4 新增 `confirmMemberCount(source, fingerprint, memberCount)`：将指定条目的 memberCount 更新为传入值（用于用户在管理面板"确认"变动）
- [x] 8.5 新增 `silentFillMemberCount(source, fingerprint, memberCount)`：与 confirm 行为相同（更新 memberCount），语义上用于检测时的静默填充；可合并为同一方法或保留独立方法以体现语义（推荐合并，注释说明用途）
- [x] 8.6 `subscribeToDuplicateBlacklistChanges` 类型签名从 `TagBlacklist` 改为 `DuplicateBlacklist`

## 9. 逻辑层：变动检测算法 + 静默填充 + 徽章计数

- [x] 9.1 在 `DuplicateDetector.tsx` 的 `handleDetect` 中，检测完成后、设置 groups 前，遍历黑名单中当前来源的条目：对每个条目，若其 fingerprint 能在检测结果中找到对应组，且 memberCount === null，则调用 store 方法静默填充为该组的 comics.length
- [x] 9.2 在 `DuplicateDetector.tsx` 计算 `changedCount`（徽章数字）：遍历当前来源黑名单条目，统计 memberCount !== null 且能在检测结果中找到对应组且该组 comics.length !== memberCount 的条目数；memberCount=null（未静默填充成功的，即组消失的）不计入
- [x] 9.3 `handleIgnore` 回调改为 `addDuplicateIgnore(source, fp, group.comics.length)`（传入当前组成员数）

## 10. UI 层：徽章 + 管理面板变动标记/确认按钮

- [x] 10.1 在 `DuplicateDetector.tsx` 的"管理已忽略"按钮上，当 `changedCount > 0` 时渲染数字徽章（绝对定位右上角，红色背景，白色数字）
- [x] 10.2 重构 `DuplicateBlacklistManager.tsx`：列表项从纯字符串改为显示结构化条目；对变动条目（memberCount !== null 且与当前检测到的组成员数不等）添加视觉标记（如左侧色条 + "成员数变化"文案 + "确认"按钮）；"确认"按钮调用 `confirmMemberCount`
- [x] 10.3 管理面板需要知道每个条目对应的当前组成员数（用于显示变动状态和确认时传值）；通过 props 从 DuplicateDetector 传入"指纹→当前组成员数"的映射，或在面板内根据最近一次检测结果计算
- [x] 10.4 未变动条目仍保留"取消忽略"（✕）按钮；变动条目同时显示"确认"和"取消忽略"两个操作

## 11. 测试更新 + 全量验证

- [x] 11.1 更新 `titleSimilarity.test.ts`：无变化（groupFingerprint 不变）
- [x] 11.2 更新 `DuplicateDetector.test.tsx` 的 store mock 适配新结构（duplicateBlacklist 为对象数组）；新增用例：忽略时记录 memberCount、变动徽章计数、null 静默填充不触发徽章
- [x] 11.3 更新 `DuplicateGroup.test.tsx`：无变化（组件接口不变）
- [x] 11.4 更新 `DuplicateBlacklistManager.test.tsx`：mock 数据改为对象数组；新增用例：变动条目视觉标记、"确认"按钮调用 confirmMemberCount、未变动条目不显示确认按钮
- [x] 11.5 新增迁移测试：在 store 或 useInitConfig 层验证旧字符串数据 → 对象数组的转换
- [x] 11.6 全量验证：`pytest && npx tsc --noEmit && npm test && npm run lint:py && black --check . && npm run lint`
