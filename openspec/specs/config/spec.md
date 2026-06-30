# config 规范

## 目的

定义应用配置文件和 IPC 配置契约，保证配置字段命名、持久化兼容性与前后端读写行为一致。

## 需求

### 需求:配置键 `jmDomain` 替代 `jmcomicDomain`

配置文件中与 JM 来源域名相关的配置键必须使用 `jmDomain`，同时必须向后兼容旧键 `jmcomicDomain`。

#### 场景:写入配置时使用新键

- **当** 系统持久化配置到 JSON 文件时
- **那么** JM 域名配置必须写入键 `jmDomain`，而非 `jmcomicDomain`

#### 场景:读取配置时兼容旧键

- **当** 系统从 JSON 文件加载配置时
- **那么** 如果 `jmDomain` 不存在但 `jmcomicDomain` 存在，系统必须将 `jmcomicDomain` 的值复制到 `jmDomain`

#### 场景:IPC 配置界面读写使用新键

- **当** 前端发送 `python:get-config` 或 `python:set-config` IPC 请求时
- **那么** 请求中的配置键必须为 `jmDomain`，返回结果中也必须包含 `jmDomain`

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
- **那么** 系统必须不影响 `defaultSource`（搜索页默认来源）的值，二者必须独立存储与读写

#### 场景:后端配置归一化

- **当** Python `Config` dataclass 初始化或反序列化时遇到 `default_favourite_source`
- **那么** 系统必须对其进行来源键归一化，非法或不在 `SOURCES_WITH_FAVOURITES` 中的值必须回退为空字符串

### 需求:所有触发配置持久化的 IPC handler 必须串行化写盘

任何触发 `Config.save()` 的 IPC handler——包括但不限于 `handle_set_config` 以及登录/应用认证类 handler（`handle_apply_auth`、`handle_moeimg_login`、`handle_bika_login`、`handle_hcomic_login`）——**必须**通过 `IPCServer` 级别统一的 `_config_write_lock` 串行化其"修改 `config` 状态 + `save()` 原子写盘"的临界区。该锁**必须**与 `ConfigMixin.handle_set_config` 复用同一实例（同一 `IPCServer` 实例上的所有 mixin 共享），以保证跨 handler 的 `os.replace` 与字典读改写互斥。

理由：认证 handler 与 `set_config` handler 同样运行在 `_request_executor` 线程池中，并发执行时会对同一 `config_path` 触发 `os.replace`（在 Windows 上抛 `WinError 5`），并对 `config.source_auth` 字典产生读改写竞态。`handle_set_config` 已为此引入 `_config_write_lock`，认证路径必须复用同一把锁才能形成有效互斥。

#### 场景:认证保存临界区持锁

- **当** 任意认证 handler（apply_auth / moeimg_login / bika_login / hcomic_login）在完成网络登录后准备落库
- **那么** 其 `set_source_auth(...)` 与 `self.config.save(_get_config_path())` **必须**整体包裹在 `with self._config_write_lock:` 内
- **且** 网络登录（`login()` / `extract_auth_from_curl()` / `verify_login_status()`）与 parser 配置（`configure_auth` / `set_jm_domain` / `set_username`）等可在锁外执行，避免长事务阻塞

#### 场景:并发认证保存不竞态

- **当** 两个认证 handler 在 `_request_executor` 中并发执行并先后到达落库阶段
- **那么** 二者的 `os.replace` 由 `_config_write_lock` 串行化，不再触发 `WinError 5`
- **且** 二者对 `source_auth` 字典的写操作互斥，不再出现后写覆盖先写的字典竞态

#### 场景:认证保存与 set_config 互斥

- **当** 一个认证 handler 正在持锁落库，同时另一个请求触发 `handle_set_config` 准备落库
- **那么** 二者通过同一 `_config_write_lock` 实例互斥
- **且** 任一方先完成，另一方在其后安全执行，不产生损坏的 config.json

#### 场景:锁失败/落库失败时回退为 IPC error

- **当** 认证 handler 在持锁落库阶段 `save()` 抛异常
- **那么** 异常向上冒泡为 JSON-RPC error 下发前端（认证 handler 不吞异常），用户可见失败提示
- **且** **禁止**在网络登录已成功但落库失败时返回 `success: True`

### 需求:配置键 `myTags` 支持分来源的推荐标签白名单

系统必须支持配置键 `myTags`（Python 侧 `my_tags`），用于存储用户主动收藏的「推荐标签」白名单，结构为 `dict[source] → list[str]`，对称现有 `tag_blacklist`。该字段必须纳入 IPC `get_config`/`set_config` 契约，遵循与 `tag_blacklist` 完全一致的持久化、来源键归一化与默认值补齐规则。

#### 场景:默认值与来源键补齐

- **当** `config.json` 不存在 `my_tags` 键（首次安装或旧版本升级）
- **那么** `Config.load()` 必须返回含全部 5 个来源键（`hcomic`/`moeimg`/`jm`/`bika`/`copymanga`）的 `dict`，每个来源值为空数组 `[]`
- **且** `Config.__post_init__` 必须通过 `_normalize_source_list_map` 补齐缺失的来源键，逻辑与 `tag_blacklist` 一致

#### 场景:持久化与读取使用一致键名

- **当** 系统通过 `Config.save()` 持久化配置到 JSON 文件
- **那么** 推荐标签必须以 snake_case 键 `my_tags` 写入文件
- **当** 前端通过 `python:get-config` 读取配置
- **那么** 返回结果必须包含 camelCase 键 `myTags`，由 `CONFIG_KEY_MAP` 完成转换
- **当** 前端通过 `python:set-config` 写入
- **那么** 请求键必须为 `myTags`，经 `CONFIG_KEY_MAP` 反向转换为 `my_tags` 后写入 dataclass

#### 场景:IPC 参数校验对称 tag_blacklist

- **当** 前端通过 `python:set-config` 发送 `myTags` 字段
- **那么** Electron 主进程的 IPC 参数校验必须使用与 `tagBlacklist()` 校验器对称的规则：必须是对象、必须含全部 5 个来源键、每个键的值为数组、每项为非空字符串、单标签 ≤64 字符、数组内去重、每来源 ≤500 项
- **且** 校验失败必须拒绝请求，禁止写入配置

#### 场景:非法来源键被拒绝

- **当** `set-config` 的 `myTags` 包含非白名单来源键（如 `"unknown"` 或 `"jmcomic"` 旧键）
- **那么** 校验必须拒绝
- **且** 禁止将非法键写入配置

#### 场景:与 tag_blacklist 独立存储

- **当** 用户设置或修改 `myTags`
- **那么** 系统必须不影响 `tag_blacklist` 的值，二者必须独立存储与读写
- **且** 二者可以在同一来源下共存（不同标签），但同一标签字符串禁止同时出现在两者中（由前端写入逻辑与 store action 强制互斥，见 tag-favourites 规范）

#### 场景:后端配置归一化与向后兼容

- **当** Python `Config` 反序列化时遇到 `my_tags`，且某来源键缺失或值为非数组（如旧文件损坏）
- **那么** 系统必须按 `_normalize_source_list_map` 规则归一化：补齐缺失键为空数组、将非数组值重置为空数组
- **且** `Config.load()` 的「只保留已知字段」逻辑必须保留 `my_tags`（作为已知字段），丢弃其他未知 key

### 需求:运行时配置键白名单必须与公开配置契约一致

系统必须以共享的 `CONFIG_KEYS` 作为 renderer/preload 可持久化配置键的运行时白名单，并保证公开 `ConfigKey` 类型不包含任何未被 `CONFIG_KEYS` 接受的键。所有已声明为可持久化的配置键（包括 `myTags`）必须能够通过 preload 的 `setConfig` 校验并转发到主进程；未声明键必须继续被拒绝。

#### 场景:preload 接受并转发 myTags

- **当** renderer 调用 `window.hcomic.setConfig('myTags', value)`，且 `value` 是合法的分来源标签对象
- **那么** preload 必须接受 `myTags` 配置键
- **且** 必须通过 `python:set-config` 通道将原始键和值转发到 Electron 主进程

#### 场景:未知配置键仍被拒绝

- **当** renderer 调用 `window.hcomic.setConfig` 并传入未包含在 `CONFIG_KEYS` 中的键
- **那么** preload 必须在进入主进程 IPC 前抛出 `Invalid config key`
- **且** 禁止调用 `ipcRenderer.invoke`

#### 场景:配置键类型与运行时白名单防止漂移

- **当** 开发者新增或修改可持久化配置键
- **那么** `ConfigKey` 必须由 `CONFIG_KEYS` 推导或由等价的编译期/测试期守卫验证二者全集一致
- **且** 删除 `CONFIG_KEYS` 中的 `myTags` 时，preload 配置契约回归测试必须失败
