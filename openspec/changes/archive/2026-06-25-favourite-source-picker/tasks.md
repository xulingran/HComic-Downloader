## 1. 共享类型契约（shared/types.ts）

- [x] 1.1 在 `AppConfig` 接口新增可选字段 `defaultFavouriteSource?: string`（参照 line 114 区 `defaultSource`）
- [x] 1.2 在 `ConfigKey` 联合类型（line 346）新增 `| 'defaultFavouriteSource'`
- [x] 1.3 在 `ConfigValueMap`（line 355）新增 `defaultFavouriteSource: string`
- [x] 1.4 在 `CONFIG_KEYS` 数组（line 1119）追加 `'defaultFavouriteSource'`

## 2. Python 后端配置（config.py / IPC key map）

- [x] 2.1 `config.py`：在 `Config` dataclass 新增字段 `default_favourite_source: str = ""`（位置紧邻 `default_source`，line 83 区）
- [x] 2.2 `config.py`：在 `__post_init__` 新增归一化逻辑——调用 `normalize_source_key`，若结果不在 `SOURCES_WITH_FAVOURITES` 则回退为 `""`（参照 line 124-126 `default_source` 处理，但白名单用支持收藏的来源集合）
- [x] 2.3 `python/ipc/types.py`：在 `CONFIG_KEY_MAP` 新增 `"defaultFavouriteSource": "default_favourite_source"`（line 16 区）
- [x] 2.4 `python/ipc/config_mixin.py`：在 `handle_get_config` 的 `raw` 字典新增 `"default_favourite_source": getattr(self.config, "default_favourite_source", "")`（line 167 区）；`_RUNTIME_APPLIERS` 不添加条目（纯前端消费）

## 3. Electron IPC 参数校验（electron/main.ts）

- [x] 3.1 在 set-config 校验器表（line 237 区）新增 `defaultFavouriteSource: and(string(), oneOf(['', ...SOURCES_WITH_FAVOURITES] as const))`

## 4. 前端状态层（stores）

- [x] 4.1 `src/stores/useFavouritesStore.ts`：新增内存级字段 `sessionPickerShown: boolean`（默认 `false`）及 setter `markPickerShown(): void`
- [x] 4.2 `src/stores/useSettingsStore.ts`：新增 `defaultFavouriteSource: string`（默认 `''`）字段及 `setDefaultFavouriteSource` setter，并添加 `subscribeToDefaultFavouriteSourceChanges` 持久化订阅（参照 line 232 区 `subscribeToFavouriteTagHighlightChanges` 模板）
- [x] 4.3 `src/hooks/useInitConfig.ts`：在 config 加载后同步 `defaultFavouriteSource` 到 settings store（参照其他 config 字段同步点）

## 5. 来源选择器组件

- [x] 5.1 新建 `src/components/common/SourcePickerModal.tsx`：复用 `Modal` 外壳，props 为 `{ isOpen, onSelect: (source: string) => void, onClose: () => void }`
- [x] 5.2 组件内部用 `SOURCES_WITH_FAVOURITES.map(s => ({ value: s, label: SOURCE_LABELS[s] }))` 渲染来源卡片按钮（视觉参照 `SettingsPage` 默认来源选项组：选中态 `bg-[var(--accent)] text-white`）
- [x] 5.3 点击来源按钮调用 `onSelect(source)`；ESC/遮罩点击由 `Modal` 触发 `onClose`

## 6. 收藏夹页面集成（src/pages/FavouritesPage.tsx）

- [x] 6.1 从 settings store 读取 `defaultFavouriteSource`，从 favourites store 读取 `sessionPickerShown` 与 `markPickerShown`
- [x] 6.2 改造挂载 `useEffect`（line 148 区）为三态分支：`defaultFavouriteSource` 非空 → `setSource` + `loadFavourites(1, default)`；空且未弹过 → 不加载，置本地 `showPicker=true`；空且弹过 → 复用现有缓存优先逻辑
- [x] 6.3 新增本地 state `showPicker`（控制弹窗显隐）与「选择来源」按钮点击重开逻辑（重开时 `sessionPickerShown` 不重置，仅手动打开）
- [x] 6.4 实现 `onSelect` 回调：`setSource(s)` + `cache.setCurrentSource(s)` + `markPickerShown()` + `loadFavourites(1, s)` + 关闭弹窗
- [x] 6.5 实现 `onClose` 回调（跳过）：`markPickerShown()` + 关闭弹窗 + 显示空状态（`comics=[]`、`isLoading=false`、`error=null`）
- [x] 6.6 当处于「未选来源」空状态时，渲染 `<EmptyState message="请选择收藏夹来源">` 并附「选择来源」按钮（点击置 `showPicker=true`）

## 7. 设置页配置入口（src/pages/SettingsPage.tsx）

- [x] 7.1 在「来源」分区（line 515 区）「默认来源」选项组下方新增「默认收藏夹来源」选项组
- [x] 7.2 选项组渲染 `SOURCES_WITH_FAVOURITES` 来源按钮 + 一个「未设置（每次询问）」按钮（值为 `''`）
- [x] 7.3 点击按钮调用 `handleConfigChange('defaultFavouriteSource', source)`，选中态用 `config.defaultFavouriteSource === source` 判断（「未设置」按钮选中态用 `config.defaultFavouriteSource === ''`）
- [x] 7.4 在 config 默认值（line 74 区）与加载（line 145 区）补充 `defaultFavouriteSource: ''` 与 `result.config.defaultFavouriteSource ?? ''`

> **实现注记（7.3 偏离）**：UI 改用 `createHandler` + `useSettingsStore` 模式（与 `cardStyle`/`themeMode` 一致），而非任务描述的 `handleConfigChange` + 本地 config state。原因：FavouritesPage 从 settings store 读取 `defaultFavouriteSource`，`createHandler` 会同时乐观更新 store 与持久化 config，保证设置页修改后 FavouritesPage 立即可见；若用 `handleConfigChange` 只更新本地 state 则 store 不会同步，导致状态不一致。本地 config state 的 `defaultFavouriteSource` 字段保留作为后端值镜像（loadConfig 填充），但 UI 读写均走 store。

## 8. 测试

- [x] 8.1 Python：`tests/test_ipc_config_mapping.py` 新增 `defaultFavouriteSource` 到 CONFIG_KEY_MAP 覆盖断言
- [x] 8.2 Python：`tests/test_ipc_contract.py` 新增 `defaultFavouriteSource: str` 类型断言
- [x] 8.3 Python：新增 `tests/test_config_default_favourite_source.py`，覆盖 dataclass 默认值、归一化（非法值回退 `''`、copymanga 回退 `''`、合法值保留）
- [x] 8.4 前端：新增 `tests/unit/components/SourcePickerModal.test.tsx`，覆盖渲染来源数（4 个，无 copymanga）、点击来源触发 onSelect、ESC 触发 onClose
- [x] 8.5 前端：新增 `tests/unit/pages/FavouritesPage.sourcePicker.test.tsx`，覆盖三态分支：已设默认直接加载不弹窗、未设默认首次弹窗、未设默认已弹过走缓存逻辑；覆盖 onSelect/onClose 回调流转
- [x] 8.6 前端：`tests/unit/pages/SettingsPage.test.tsx`（如存在）补充默认收藏夹来源选项组渲染与切换持久化断言；若无现存测试文件则新建最小覆盖

## 9. 验证（提交前必须全部通过）

- [x] 9.1 `pytest` 全部通过
- [x] 9.2 `npx tsc --noEmit` 无类型错误
- [x] 9.3 `npm test` 全部通过
- [x] 9.4 `npm run lint:py` 无 lint 错误
- [x] 9.5 `black --check .` 格式检查通过
- [x] 9.6 `npm run lint` 无 ESLint 错误
- [ ] 9.7 手动验证：未设默认来源时启动后首次进收藏夹弹窗 → 选择加载 → 切走再切回不重弹；设置默认来源后进收藏夹直接加载不弹窗；重启应用后会话标志归零

> **9.1 注记**：813 通过。另有 4 个 `test_jm_parser.py` 失败，已通过 `git stash` 验证为**预存失败**（与本次变更无关，是 jm cookie/cookiejar 库行为的环境问题）。
> **9.7 注记**：需运行 `npm run dev` 手动验证，自动化测试已覆盖三态分支逻辑（见 8.5）。
