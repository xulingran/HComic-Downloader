## 新增需求

### 需求:配置键 `defaultFavouriteSource`

系统必须支持配置键 `defaultFavouriteSource`，用于指定收藏夹 tab 的默认来源。空字符串表示「未设置」（触发启动后首次进入的来源选择器）；非空值必须为 `SOURCES_WITH_FAVOURITES` 中的合法来源之一。

#### 场景:默认值

- **当** 配置文件中不存在 `defaultFavouriteSource` 键或值为空
- **那么** 系统必须将其视为空字符串（未设置），且禁止在收藏夹 tab 直接加载任何来源

#### 场景:持久化与读取

- **当** 系统持久化配置到 JSON 文件或通过 `python:get-config` 读取配置
- **那么** `defaultFavouriteSource` 必须以 camelCase 键名存储与返回，且必须被包含在 `CONFIG_KEYS` 白名单与 IPC 参数校验中

#### 场景:非法取值被拒绝

- **当** 前端通过 `python:set-config` 发送 `defaultFavouriteSource` 的值不在 `['', ...SOURCES_WITH_FAVOURITES]` 范围内（如 `copymanga` 或 `unknown`）
- **那么** Electron 主进程的 IPC 参数校验必须拒绝该请求，禁止将非法值写入配置

#### 场景:与 `defaultSource` 相互独立

- **当** 用户设置或修改 `defaultFavouriteSource`
- **那么** 系统 `必须不` 影响 `defaultSource`（搜索页默认来源）的值，二者必须独立存储与读写

#### 场景:后端配置归一化

- **当** Python `Config` dataclass 初始化或反序列化时遇到 `default_favourite_source`
- **那么** 系统必须对其进行来源键归一化，非法或不在 `SOURCES_WITH_FAVOURITES` 中的值必须回退为空字符串
