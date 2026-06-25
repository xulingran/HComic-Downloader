## 上下文

收藏夹 tab 当前在 `FavouritesPage` 挂载时通过 `useEffect` 读取 `useFavouritesStore.currentSource`（默认硬编码 `'hcomic'`）并立即调用 `loadFavourites(1, activeSource)`。来源切换完全依赖顶部下拉框（`<select>`），列出全部 5 个来源（包括不支持收藏的 copymanga）。

本变更新增「启动后首次进入引导选择」与「持久化默认来源」两个维度，二者通过优先级组合：**持久化默认值 > 会话态引导 > 硬编码兜底**。改动横跨前后端 6 层配置契约链路，但后端无运行时副作用（纯前端消费），实现风险集中在状态机正确性与契约一致性。

## 目标 / 非目标

**目标：**
- 未设置默认来源时，每次应用启动后首次进入收藏夹 tab 引导用户选择来源；本会话内不再重复引导。
- 已设置默认来源时，直接加载该来源，永不弹窗。
- 新增 `defaultFavouriteSource` 配置项，完整贯穿 shared types / electron 校验 / python config / IPC key map，与现有 `defaultSource` 完全独立。
- 来源选择器仅展示 `SOURCES_WITH_FAVOURITES`，排除 copymanga。
- 选择器处理完成后，所有后续交互（切换/刷新/分页/预加载/批量）零改动复用现有路径。

**非目标：**
- 不改变顶部下拉框的现有行为（保留全部来源切换能力，作为「后续切换」入口）。
- 不持久化「本会话是否已选过」标志（该标志仅随进程生命周期存在）。
- 不修改后端 `getFavourites` 解析逻辑或各来源解析器。
- 不新增「记住这次选择」之类的持久化选项（持久化语义完全由 `defaultFavouriteSource` 承担）。

## 决策

### 决策 1：会话标志存于 `useFavouritesStore`（内存级，非持久化）

**选择：** 在 `useFavouritesStore` 新增 `sessionPickerShown: boolean`（默认 `false`）及配套 setter `markPickerShown()`。

**理由：**
- zustand store 随 React/JS 进程生命周期存在。Electron 应用重启 = 渲染进程销毁重建 = store 重新初始化 → 标志自动归零，精确匹配「每次启动第一次」语义。
- 跨 tab 切换时 React 组件树保留、store 单例保留 → 标志保持，匹配「本会话内不再重复弹」。
- 无需 localStorage / 时间戳 / 启动计数等额外机制，零额外复杂度。

**替代方案（已否决）：**
- localStorage 持久化：跨重启保留，与「每次启动都问」语义矛盾，需额外清理逻辑。
- App 层 `useState`：作用域过大，且 `FavouritesPage` 是 lazy 挂载组件，无法跨 tab 切换持久（切走再切回会重挂载丢失状态）。store 是天然合适的载体。

### 决策 2：未设置默认值用空字符串 `''` 表示

**选择：** `defaultFavouriteSource: string`，默认 `''` = 未设置。

**理由：**
- 与现有 string 型配置项（`defaultSource`、`jmDomain`）模式一致，校验器可写 `oneOf(['', ...SOURCES_WITH_FAVOURITES])`。
- Python 侧 `getattr(self.config, 'default_favourite_source', '')` 兜底，老用户配置文件无此键时平滑迁移为「未设置」，触发引导而非报错。
- 避免 `Optional[str]` 带来的 null/undefined 双重判断（前后端 JSON 边界易出错）。

**替代方案（已否决）：**
- `null` 表示未设置：与现有 string 配置项不一致，校验器与类型需特殊处理。

### 决策 3：挂载 effect 改造为三态分支

**选择：** `FavouritesPage` 挂载 `useEffect` 改为：

```
读取 config.defaultFavouriteSource 与 store.sessionPickerShown
  ├─ defaultFavouriteSource 非空 → 直接 loadFavourites(1, defaultFavouriteSource)
  │                              （设置 currentSource，不弹窗）
  ├─ defaultFavouriteSource 空 且 sessionPickerShown=false
  │     → 不加载任何来源，渲染 <SourcePickerModal>，等待用户选择/关闭
  └─ defaultFavouriteSource 空 且 sessionPickerShown=true
        → 复用现有缓存优先逻辑（loadFavourites 或显示缓存）
```

**理由：** 新增逻辑高度集中在「defaultFavouriteSource 空 且 首次」单一分支，现有两条路径（有缓存读缓存、无缓存加载）零改动。

**实现要点：**
- `defaultFavouriteSource` 从 `config`（`useInitConfig` 注入到 settings store 或直接读 config）获取，作为 effect 依赖项。
- 弹窗选择回调：`setSource(selected)` + `cache.setCurrentSource(selected)` + `store.markPickerShown()` + `loadFavourites(1, selected)`。
- 弹窗关闭回调：`store.markPickerShown()` + 显示空状态（`comics=[]`、`isLoading=false`、无 error）。空状态 UI 复用 `<EmptyState>`，但消息改为「请选择收藏夹来源」并附「选择来源」按钮重开弹窗。

### 决策 4：`<SourcePickerModal>` 独立组件，复用 `<Modal>` 外壳

**选择：** 新建 `src/components/common/SourcePickerModal.tsx`，复用现有 `Modal` 组件作为遮罩/动画外壳，内部渲染来源卡片列表（`SOURCES_WITH_FAVOURITES.map(...)` + `SOURCE_LABELS`）。

**理由：**
- `Modal` 已实现「方案 A 安全遮罩点击关闭」与 reduced-motion 适配，无需重复造轮子。
- 来源卡片用按钮形式（参照 `SettingsPage` 默认来源选项组的视觉模式：选中态 `bg-[var(--accent)]`），保持视觉一致。
- `closeOnOverlayClick={true}` + ESC 关闭均触发 `onClose`，由父组件统一处理为「跳过」语义。

**替代方案（已否决）：**
- 复用顶部下拉框样式：作为「首次引导」视觉引导力不足，且与「后续切换」入口混淆。
- 全屏向导：过度设计，单一决策点用 modal 足够。

### 决策 5：后端无运行时 applier

**选择：** `python/ipc/config_mixin.py` 的 `_RUNTIME_APPLIERS` 不为 `defaultFavouriteSource` 添加条目；仅 `handle_get_config` 读路径返回该字段。

**理由：** 该配置纯前端消费（决定收藏夹 tab 行为），后端无任何对象需要据此调整。与 `favouriteTagHighlight`、`cardStyle` 等纯前端消费配置一致。

## 风险 / 权衡

- **[风险] `defaultFavouriteSource` 与 `defaultSource` 语义混淆** → 缓解：设置页 UI 明确分区标签（「默认来源」用于搜索 vs「默认收藏夹来源」用于收藏夹），并在 spec 中强制二者独立读写。校验器各自独立，禁止 set-config 同时写两者。

- **[风险] 用户关闭弹窗后陷入「卡住」状态** → 缓解：空状态提供「选择来源」按钮 + 顶部下拉框双重重开入口；ESC/遮罩关闭后 `markPickerShown()`，但用户可主动重开（区别于「自动弹」）。本会话不再「自动」弹，但允许「手动」重开。

- **[权衡] 会话标志放 store 而非 localStorage** → 代价：用户若频繁重启应用且不设置默认来源，每次首次进入都要选。这是需求明确要求的行为（「每次启动第一次」），属预期而非缺陷。

- **[风险] 挂载 effect 依赖项变化导致重复弹窗** → 缓解：`defaultFavouriteSource` 与 `sessionPickerShown` 作为依赖；`sessionPickerShown` 一旦置 true 即不变回 false（无 reset API），effect 不会因标志翻转重复触发弹窗。弹窗显隐由专门的 `showPicker` 本地 state 控制（基于 `!sessionPickerShown && !defaultFavouriteSource && !hasInteracted`），与 mount effect 解耦。

- **[风险] copymanga 误入选择器** → 缓解：来源列表严格使用 `SOURCES_WITH_FAVOURITES` 常量，禁止用 `COMIC_SOURCES`。spec 场景覆盖此约束。

## 迁移方案

- **配置兼容：** 老用户配置文件无 `defaultFavouriteSource` 键 → Python `Config` dataclass 默认值 `""` → `get_config` 返回 `""` → 前端视为未设置 → 触发首次引导。无显式迁移脚本需求，dataclass 默认值即迁移。
- **回滚策略：** 变更全部为新增字段与新增分支，回滚 = 移除 `defaultFavouriteSource` 相关代码 + `FavouritesPage` 挂载 effect 恢复为直接 `loadFavourites`。配置文件中残留的 `defaultFavouriteSource` 键由 dataclass 忽略（未声明字段），不影响回滚后运行。

## 待解决问题

无。所有关键决策已确定，待 tasks 阶段拆解为可执行步骤。
