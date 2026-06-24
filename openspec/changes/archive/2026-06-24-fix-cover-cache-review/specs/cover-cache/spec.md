## 修改需求

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

## 新增需求

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
