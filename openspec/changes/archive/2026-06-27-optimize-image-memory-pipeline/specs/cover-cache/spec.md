# cover-cache 规范（增量）

## 修改需求

### 需求:对外 API 契约必须与旧实现兼容

`CoverCacheDB` 的对外方法签名**必须**改为（本变更显式覆盖该需求的原内容——原要求 `get(url) -> str | None` 返回 dataUri、`put(url, data_uri: str) -> None`、保持调用方不变；为消除 base64 全栈拷贝，改为返回 `url_hash`、put 接收原始字节，并要求调用方相应迁移）：
- `get(url) -> str | None`：返回 `url_hash`（即 `sha256(url).hexdigest()`，同时是磁盘文件名），**禁止**返回 dataUri 或重新 base64 编码字节。
- `put(url, raw_bytes: bytes) -> None`：接收**原始图片字节**，**禁止**接收 dataUri 字符串或内部再做 base64 decode。
- `get_stats() -> dict`、`clear_all() -> None`、`update_max_size(max_size_mb: int) -> None`、`db_dir -> str`、`close() -> None` 保持不变。

签名变更后 `CoverCacheDB` 与 `PreviewCacheDB` 的字节级 API 对齐（两者均 `put(url, raw_bytes)`、`get(url) -> 路径标识`）。调用方（`cover_mixin`）**必须**相应迁移：fetch 后直接 `put(url, raw_bytes)`，从 `get(url)` 拿 url_hash 下发给前端。

`put` 写入的 `size` 元数据**必须**等于 `len(raw_bytes)`（已是原始字节，无需 decode）。`get_stats()["total_size_bytes"]` 口径不变。

#### 场景:get 返回 url_hash 而非 dataUri

- **当** `put(url, raw_bytes)` 后调用 `get(url)` 且命中
- **那么** 返回 `sha256(url).hexdigest()`（url_hash 字符串）
- **且** **禁止**读取磁盘文件字节、**禁止**执行 base64 编码
- **且** 该 url_hash 与磁盘文件名一致

#### 场景:put 接收原始字节

- **当** 调用 `put(url, raw_bytes)`，其中 `raw_bytes` 为 N 字节的原始图片字节
- **那么** 系统将 `raw_bytes` 直接写入 `{files_dir}/{url_hash}` 文件
- **且** SQLite 记录 `size = N`
- **且** **禁止**接收 dataUri 字符串或内部 base64 decode

#### 场景:缓存缺失返回 None

- **当** 调用 `get(url)` 且 url 不在 LRU 索引中
- **那么** 返回 `None`
- **且** 不发起任何磁盘读

#### 场景:get_stats 口径不变

- **当** 缓存中有 M 个有效条目，总磁盘字节数 S
- **那么** `get_stats()` 返回 `{"file_count": M, "total_size_bytes": S}`
- **且** `total_size_bytes` 等于所有磁盘文件实际字节数之和（即各 `put` 时 `len(raw_bytes)` 之和）

### 需求:get 必须清理无法识别字节的脏条目

`get(url)` 命中时**必须**做 `os.path.exists` 存在性校验（因 `get` 不再读字节、改为返回 url_hash，脏数据检测策略调整：`get` 仅做存在性校验，深度脏数据检测移至 `put` 落盘前的 `detect_image_type` 校验——已在 fetch 路径完成）：若文件缺失（被外部删除），**必须**清理 SQLite 记录与 LRU 索引项后返回 `None`。深度脏数据检测（magic bytes 无法识别）不再在 `get` 内执行——因 fetch 路径在 `put` 前已用 `detect_image_type` 校验过字节合法性，落盘文件可信。清理失败**禁止**抛出异常。

#### 场景:文件被外部删除时 get 清理记录返回 None

- **当** `get(url)` 命中 LRU 索引，但对应磁盘文件已被外部删除
- **那么** 系统删除该 url 对应的 SQLite 记录与 LRU 索引项
- **且** 返回 `None`
- **且** 不抛出异常

#### 场景:清理失败不阻断流程

- **当** 文件存在性校验或记录清理过程中因权限/并发失败
- **那么** 系统记录 debug 日志而非抛出异常
- **且** SQLite 记录与 LRU 索引项仍尽力移除
