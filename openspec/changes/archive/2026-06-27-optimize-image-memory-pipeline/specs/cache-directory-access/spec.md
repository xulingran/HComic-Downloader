# cache-directory-access 规范（增量）

## 新增需求

### 需求:自定义协议 handler 必须复用缓存目录路径安全语义

`app-image://` 协议 handler 在解析 `url_hash` 到磁盘文件路径时，**必须**复用本能力既有的路径安全语义：最终路径必须为绝对路径、必须不含路径遍历片段（`..`）、必须约束在授权的缓存目录（`CoverCacheDB.files_dir` 或 `PreviewCacheDB.files_dir`）内。这通过 `path.resolve` + 前缀检查实现，与「打开下载/缓存目录」的安全校验同源。

handler 的缓存目录来源**必须**基于已初始化的缓存实例的真实 `files_dir`（遵循「缓存目录路径必须来源于缓存实例的真实位置」需求），**禁止**在 handler 内重复硬编码默认目录常量，以保证自定义目录的单元测试能一致覆盖。

#### 场景:协议 handler 使用缓存实例真实 files_dir

- **当** 协议 handler 解析 `app-image://cover/{url_hash}`
- **那么** 定位到的目录必须等于已初始化的 `CoverCacheDB.files_dir`
- **且** 自定义 `files_dir` 的测试环境下 handler 跟随该自定义目录

#### 场景:协议 handler 复用路径遍历校验

- **当** 请求路径经 `path.resolve` 后逃出缓存 `files_dir`
- **那么** handler 拒绝（返回 4xx），与「打开目录」对 `..` 遍历的拒绝语义一致

#### 场景:cover 与 preview 路由到各自真实目录

- **当** 协议 URL 首段为 `cover` 或 `preview`
- **那么** handler 分别使用 `CoverCacheDB.files_dir` 或 `PreviewCacheDB.files_dir` 的真实路径
- **且** 两者可能不同（虽默认同根，但遵循各自实例的真实位置）
