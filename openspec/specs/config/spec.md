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
