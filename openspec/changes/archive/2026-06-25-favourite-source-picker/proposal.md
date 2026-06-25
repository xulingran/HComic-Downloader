## 为什么

收藏夹 tab 当前在挂载时总是硬编码从 `hcomic` 来源加载，用户每次都要手动通过顶部下拉框切换到常用来源（如 jm、bika）。对于常用某个非 hcomic 来源的用户，这是反复出现的摩擦；而对于未设置偏好的用户，应用启动后第一次进入收藏夹就默默加载 hcomic，缺乏一次显式选择的机会，不利于发现「不同来源有各自的收藏夹」。

需要在「记住偏好」与「不强迫」之间取得平衡：用户可以在设置中指定默认收藏夹来源以彻底跳过询问；未指定时，应用每次启动后第一次进入收藏夹 tab 时引导用户选择，本会话内不再重复询问。

## 变更内容

- **新增配置项 `defaultFavouriteSource`**：可持久化的收藏夹默认来源，空字符串表示「未设置」。贯穿前后端配置契约（shared types / electron 校验 / python config dataclass / IPC key map）。
- **收藏夹 tab 首次进入逻辑**：挂载时若 `defaultFavouriteSource` 为空且本会话未处理过选择，弹出来源选择器引导用户选择；选择后加载对应来源。若已设置默认来源，直接用该来源加载，永不弹窗。
- **来源选择器组件**：新增 `<SourcePickerModal>`，仅列出支持收藏的来源（`SOURCES_WITH_FAVOURITES`，排除 copymanga）。
- **设置页配置入口**：在「来源」分区新增「默认收藏夹来源」选项组，参照现有「默认来源」实现，并包含一个「未设置（每次询问）」选项。
- **会话标志**：在 `useFavouritesStore` 新增内存级 `sessionPickerShown` 标志，跨 tab 切换保留、应用重启自动归零，精确匹配「每次启动第一次」语义。

## 功能 (Capabilities)

### 新增功能
- `favourite-source-picker`: 收藏夹 tab 首次进入时的来源选择引导交互——何时弹出、用户选择或跳过后的状态流转、与持久化默认值和会话标志的优先级关系。

### 修改功能
- `config`: 新增配置键 `defaultFavouriteSource`，定义其默认值（空字符串=未设置）、取值范围（`SOURCES_WITH_FAVOURITES` ∪ {''}）、持久化与 IPC 读写契约。

## 影响

- **共享类型契约** (`shared/types.ts`)：`AppConfig` 接口、`ConfigKey` 联合类型、`ConfigValueMap`、`CONFIG_KEYS` 数组新增字段。
- **Electron 主进程** (`electron/main.ts`)：新增 `set-config` 参数校验器（`oneOf(['', ...SOURCES_WITH_FAVOURITES])`）。
- **Python 后端配置** (`config.py`、`python/ipc/types.py`、`python/ipc/config_mixin.py`)：dataclass 字段、key map、get_config 读路径。无运行时 applier（纯前端消费）。
- **前端状态** (`src/stores/useFavouritesStore.ts`)：新增 `sessionPickerShown` 及配套 setter。
- **收藏夹页面** (`src/pages/FavouritesPage.tsx`)：挂载 effect 改造为「判断是否弹窗」三态分支。
- **设置页** (`src/pages/SettingsPage.tsx`)：来源分区新增默认收藏夹来源选项组。
- **新增组件** (`src/components/common/SourcePickerModal.tsx`)：来源选择弹窗。
- **设置 store / 配置初始化** (`src/stores/useSettingsStore.ts`、`src/hooks/useInitConfig.ts`)：默认值与同步逻辑。
- **测试**：config 映射、IPC 契约、组件交互的单元测试。
