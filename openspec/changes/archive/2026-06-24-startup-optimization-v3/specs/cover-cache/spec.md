# cover-cache 规范

## 新增需求

### 需求:封面缓存必须采用文件存储架构

封面缓存（`CoverCacheDB`）**必须**采用与预览缓存（`PreviewCacheDB`）一致的混合架构：SQLite 仅存储元数据（`url_hash`、`url`、`file_path`、`size`、`fetched_at`、`last_access`），图片字节以独立文件形式存放在磁盘目录下。SQLite 表内**禁止**存储 base64 data URI 或任何图片字节内容。

#### 场景:写入封面将图片字节写入文件

- **当** 调用 `put(url, data_uri)` 写入一个新封面
- **那么** 系统从 data URI 中 decode 出原始图片字节
- **且** 将原始字节写入 `{files_dir}/{url_hash}` 文件
- **且** SQLite 记录元数据（url、相对文件路径、字节大小、时间戳），不含图片字节

#### 场景:读取封面按需从磁盘读字节并编码

- **当** 调用 `get(url)` 且缓存命中
- **那么** 系统从对应文件读出原始字节
- **且** 通过 magic bytes 探测 MIME 类型
- **且** 返回 `data:{mime};base64,{b64}` 格式的 data URI 字符串
- **且** 该 data URI 与原写入的 data URI 解码后字节一致

#### 场景:缓存缺失返回 None

- **当** 调用 `get(url)` 且 url 不在 LRU 索引中
- **那么** 返回 `None`
- **且** 不发起任何磁盘读

### 需求:启动期禁止全量预加载缓存字节

`CoverCacheDB.__init__` **必须**只读取 SQLite 中维护 LRU 顺序所需的最小字段（如 `url`），建立内存 LRU 索引（`OrderedDict`）。`__init__` **禁止**读取任何图片字节文件、**禁止**将 base64 字符串或图片内容载入内存。

#### 场景:冷启动不读取图片文件

- **当** 缓存目录含 N 个图片文件（N ≥ 1000），构造 `CoverCacheDB`
- **那么** `__init__` 完成后内存中不含任何图片字节或 base64 字符串
- **且** 仅持有 N 个 url key 的 LRU 索引

#### 场景:启动耗时与缓存规模弱相关

- **当** 缓存条目数从 100 增长到 5000
- **那么** `CoverCacheDB.__init__` 耗时增长**不得**超过 30ms（仅元数据索引扫描，不读图片字节）

### 需求:LRU 淘汰必须同时清理文件与数据库记录

当写入新条目导致缓存超过 `max_size_bytes` 上限时，系统**必须**按 LRU 顺序淘汰最旧条目，淘汰时**必须**同时：(1) 删除对应的磁盘图片文件；(2) 删除 SQLite 记录；(3) 从内存 LRU 索引移除。文件删除失败（如权限/并发）**不得**阻断流程，但必须记录日志。

#### 场景:超限淘汰删除最旧文件

- **当** 缓存已达上限，写入新条目使其超出
- **那么** 系统按 `last_access` 升序选出最旧条目
- **且** 删除其磁盘文件（best-effort）
- **且** 删除其 SQLite 记录与 LRU 索引项
- **且** 重复直到总大小回到上限内

#### 场景:文件已被外部删除时淘汰不报错

- **当** 淘汰某条目但其磁盘文件已被外部删除
- **那么** 系统记录 debug 日志而非抛出异常
- **且** SQLite 记录与 LRU 索引项仍被正常移除

### 需求:对外 API 契约必须与旧实现兼容

`CoverCacheDB` 的对外方法签名**必须**与旧实现保持兼容：`get(url) -> str | None`、`put(url, data_uri: str) -> None`、`get_stats() -> dict`、`clear_all() -> None`、`update_max_size(max_size_mb: int) -> None`、`db_dir -> str` 属性、`close() -> None`。构造参数 `db_path`、`max_size_mb` **必须**保留。调用方（`cover_mixin`、`config_mixin`、`ipc_server`、`download_mixin`）**禁止**因本次变更而修改其调用代码。

#### 场景:get 返回的 data URI 与写入时解码字节一致

- **当** `put(url, "data:image/jpeg;base64,/9j/...")` 后调用 `get(url)`
- **那么** 返回的 data URI 解码后的字节与原写入字节逐字节相同
- **且** MIME 类型一致（`image/jpeg`）

#### 场景:get_stats 返回文件数与总字节数

- **当** 缓存中有 M 个有效条目，总字节 S
- **那么** `get_stats()` 返回 `{"file_count": M, "total_size_bytes": S}`
- **且** `total_size_bytes` 等于所有磁盘文件的实际字节数之和

### 需求:旧格式数据必须自动迁移

当 `CoverCacheDB.__init__` 打开一个含旧 `data_uri` 列（旧 schema）的 SQLite 文件时，**必须**自动执行一次性迁移：(1) 逐行 decode base64 → 写入磁盘文件；(2) 将元数据写入新 schema；(3) 删除旧的 `data_uri` 列或标记迁移完成。迁移**必须**幂等，对已迁移或全新数据库**禁止**重复执行。

#### 场景:首次启动迁移旧数据

- **当** 存在旧格式 `cover_cache.db`（含 `data_uri` 列、N 条记录），首次以新实现打开
- **那么** 系统逐条将 base64 decode 为字节写入 `{files_dir}/{url_hash}`
- **且** 在新 schema 中记录对应元数据
- **且** 迁移完成后旧 `data_uri` 数据不再被读取
- **且** `get()` 对任一旧 url 仍返回与原 data URI 字节一致的结果

#### 场景:已迁移或全新数据库不重复迁移

- **当** 数据库已是新 schema（无 `data_uri` 列或已标记迁移完成）
- **那么** `__init__` 跳过迁移逻辑
- **且** 启动耗时与无迁移路径一致

#### 场景:迁移中断后下次启动可继续

- **当** 上一次迁移因崩溃/中断未完成（部分记录已迁移，部分未迁移）
- **那么** 下次启动检测到未迁移记录并继续迁移剩余部分
- **且** 已迁移的记录不被重复处理
