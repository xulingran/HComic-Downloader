## 为什么

收藏重复检测功能每次运行都是无状态的——用户每次都得重新审视全部疑似重复组，包括那些已经判定过"不是重复"或"已处理"的组。对于收藏量大、重复组稳定存在的用户，这是一种重复劳动。需要一种方式让用户把人工判定沉淀成持久规则，下次检测时自动折叠这些已确认的组别，保持主视野清爽，同时仍可回溯和撤销。

## 变更内容

- **新增黑名单持久化字段**：在 `Config` 中加入 `duplicate_blacklist: dict[str, list[str]]`，按来源隔离，结构与现有 `tag_blacklist` 完全同构。条目为组指纹（`normalizeTitle` 结果，无来源前缀）。
- **新增组指纹算法**：组的代表指纹取组内所有漫画 normalized title 的字典序最小者，保证与收藏分页顺序、成员增删无关的稳定性。
- **检测结果分层渲染**：检测后按指纹将组拆分为 active / ignored 两段。active 组默认展开并带"忽略此组"按钮；ignored 组默认折叠并带"取消忽略"按钮。组始终被检测和渲染，不删除、不过滤（Render-only 策略）。
- **统计文案增强**：检测完成后显示 `发现 N 组疑似重复（其中 M 组已忽略）`。
- **新增"管理已忽略"弹窗面板**：工具箱·重复检测区块标题行加入"管理已忽略"按钮，点击弹出面板，支持按来源切换、列出已忽略指纹、逐个移除（无二次确认，因取消忽略非破坏性）。

## 功能 (Capabilities)

### 新增功能
- `duplicate-detector`: 收藏重复检测的黑名单（已忽略）机制——用户可将疑似重复组标记为已忽略，持久化按来源隔离，下次检测自动以折叠态渲染，并可在管理面板中回溯与撤销。

### 修改功能
<!-- 无。重复检测功能此前无 spec，本次首次建立规范。 -->

## 影响

- **契约层**：`config.py`（Config dataclass 新字段）、`python/ipc/types.py`（CONFIG_KEY_MAP 映射）、`shared/types.ts`（AppConfig / ConfigKey / CONFIG_KEYS 三处同步，由 `ipc-channel-consistency.test.ts` 保护一致性）。
- **状态层**：`src/stores/useSettingsStore.ts`（新状态 + 增删方法 + subscribe 函数）、`src/hooks/useInitConfig.ts`（挂载新 subscribe）。
- **逻辑层**：`src/utils/titleSimilarity.ts`（导出 `groupFingerprint`）、`src/components/tools/DuplicateDetector.tsx`（指纹计算 + active/ignored 分组 + 统计文案 + 管理面板入口）。
- **UI 层**：`src/components/tools/DuplicateGroup.tsx`（initialExpanded / 忽略按钮 / 取消忽略按钮）、`src/components/tools/DuplicateBlacklistManager.tsx`（新弹窗组件）。
- **测试**：`titleSimilarity.test.ts`、`DuplicateDetector.test.tsx`、`DuplicateGroup.test.tsx`、`DuplicateBlacklistManager.test.tsx`（新）。
- **配置兼容性**：`Config.load()` 已有"未知 key 忽略 + 损坏文件备份"机制，老配置文件无此字段时由 dataclass 默认值填充，向后兼容无风险。
