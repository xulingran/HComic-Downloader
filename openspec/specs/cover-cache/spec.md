# cover-cache 规范

## 目的
待定 - 由归档变更 startup-optimization-v3 创建。归档后请更新目的。
## 需求
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

`put` 与迁移路径写入的 `size` 元数据**必须**等于解码后的原始图片字节数（`len(raw_bytes)`），**禁止**记录 base64 data URI 字符串长度。`get_stats()["total_size_bytes"]` **必须**等于所有有效条目磁盘文件实际字节数之和，与 `PreviewCacheDB` 口径一致。

#### 场景:get 返回的 data URI 与写入时解码字节一致

- **当** `put(url, "data:image/jpeg;base64,/9j/...")` 后调用 `get(url)`
- **那么** 返回的 data URI 解码后的字节与原写入字节逐字节相同
- **且** MIME 类型一致（`image/jpeg`）

#### 场景:get_stats 返回文件数与总字节数

- **当** 缓存中有 M 个有效条目，总磁盘字节数 S
- **那么** `get_stats()` 返回 `{"file_count": M, "total_size_bytes": S}`
- **且** `total_size_bytes` 等于所有磁盘文件的实际字节数之和（即写入时 `len(raw_bytes)` 之和），**不得**为 base64 字符串长度

#### 场景:put 记录的字节大小为原始解码字节数

- **当** 调用 `put(url, data_uri)`，其中 data_uri 的 base64 部分解码后为 N 字节
- **那么** SQLite 中该条目 `size` 字段值为 N
- **且** 后续 `get_stats()["total_size_bytes"]` 计入 N（而非 base64 字符串长度）

#### 场景:LRU 淘汰阈值基于真实磁盘字节数

- **当** 缓存配置 `max_size_mb = X`，磁盘实际占用接近 `X * 1024 * 1024`
- **那么** 淘汰在真实磁盘字节总和超过上限时才触发
- **且** **禁止**因用 base64 长度（约真实字节 1.35 倍）记账而提前约 35% 触发淘汰

### 需求:旧格式数据必须自动迁移

当 `CoverCacheDB.__init__` 打开一个含旧 `data_uri` 列（旧 schema）的 SQLite 文件时，**必须**自动执行一次性迁移：(1) 逐行 decode base64 → 写入磁盘文件；(2) 将元数据写入新 schema，其中 `size` **必须**为解码后的真实字节数，**禁止**沿用旧 `data_uri` 字符串长度；(3) 删除旧的 `data_uri` 列或标记迁移完成。迁移**必须**幂等，对已迁移或全新数据库**禁止**重复执行。

迁移的 schema 重建（rebuild-via-temp-table：`CREATE TABLE cover_cache_new ... INSERT ... SELECT ... DROP ... RENAME`）**必须**在单一事务内原子完成，**禁止**使用手动 `BEGIN` 语句（Python `sqlite3` 在隐式事务上下文中 `BEGIN` 会抛 `cannot start a transaction within a transaction`）；**必须**通过 `commit()` 提交、异常时 `rollback()` 回滚。

#### 场景:首次启动迁移旧数据

- **当** 存在旧格式 `cover_cache.db`（含 `data_uri` 列、N 条记录），首次以新实现打开
- **那么** 系统逐条将 base64 decode 为字节写入 `{files_dir}/{url_hash}`
- **且** 在新 schema 中记录对应元数据，`size` 为解码后真实字节数
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
- **且** 续迁时对剩余记录的 `size` 同样按解码后真实字节数计算

#### 场景:全部记录已迁移但未执行 finalize 时安全完成

- **当** 数据库存在 `migrated = 1` 的全部记录且仍保留 `data_uri` 列（上次运行迁移完成但未执行 schema 重建）
- **那么** 本次启动检测到无待迁移记录后，直接执行 schema 重建 finalize
- **且** finalize 通过 `commit()`/`rollback()` 完成，**禁止**抛出事务嵌套错误
- **且** finalize 后 `data_uri`、`migrated` 列被移除

### 需求:get 必须清理无法识别字节的脏条目

当 `get(url)` 命中缓存但读取的磁盘字节无法通过 magic bytes 探测出合法 MIME 类型（`detect_image_type` 返回空）时，系统**必须**将该条目视为脏数据完整清理：(1) 删除对应磁盘文件；(2) 删除 SQLite 记录；(3) 从内存 LRU 索引移除；然后返回 `None`。清理**禁止**抛出异常。

#### 场景:不可识别字节触发对称清理

- **当** `get(url)` 命中，但文件字节 `detect_image_type` 返回空字符串
- **那么** 系统删除该 url 对应的磁盘文件、SQLite 记录与 LRU 索引项
- **且** 返回 `None`
- **且** 后续再次 `get(url)` 因记录已不存在而返回 `None`，不重复触发解码

#### 场景:清理失败不阻断流程

- **当** 脏条目清理过程中文件删除因权限/并发失败
- **那么** 系统记录 debug 日志而非抛出异常
- **且** SQLite 记录与 LRU 索引项仍被移除

