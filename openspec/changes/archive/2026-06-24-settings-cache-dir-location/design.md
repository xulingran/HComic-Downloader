## 上下文

设置页面「缓存管理」区域（`src/components/settings/CacheSettings.tsx`）当前展示封面/预览缓存的文件数、占用大小及上限滑块，并支持清除。封面缓存（`cover_cache.db`，SQLite 存数据 URI）与预览缓存（`preview_cache.db` + `preview_cache/` 目录存原始图片）的根目录都是 `~/.hcomic_downloader`（`python/ipc/cover_cache.py:15`、`python/ipc/preview_cache.py:22-24`）。该路径在代码里硬编码，前端无从得知，也没有打开入口。

同区域的「下载目录」（`DownloadSettings.tsx`）已通过 `OPEN_DOWNLOAD_DIR` + `shell.openPath` 实现「打开目录」，但路径来源是用户配置；缓存目录是后端决定的固定位置，二者路径来源不同但「打开」动作语义一致，可复用安全校验。

利益相关者：终端用户（想定位/排查/备份缓存文件）、维护者（减少「缓存到底在哪」的支持成本）。

## 目标 / 非目标

**目标：**
- 在缓存管理区域展示缓存文件所在根目录的绝对路径。
- 提供「打开目录」按钮，调用系统文件管理器定位到该根目录。
- 路径权威来源为后端，前端不硬编码目录名。
- 「打开」动作复用 `OPEN_DOWNLOAD_DIR` 已验证的安全校验（绝对路径、无遍历、无控制字符、`isDirectory`）。

**非目标：**
- 不允许用户**修改**缓存目录位置（涉及 DB 迁移、配置项、跨平台路径处理，属未来工作）。
- 不展示「封面 DB 文件名」「预览文件子目录名」等内部结构细节——一个根目录路径足够用户定位。
- 不改动缓存读写、淘汰、统计逻辑。

## 决策

### 决策 1：后端新增独立方法 `get_cache_dir`，而非扩展 `get_cache_stats`

考虑过两个方案：
- **A（采用）**：新增 `get_cache_dir` 请求，返回 `{ "dir": "<abs path>" }`。
- **B（放弃）**：在现有 `get_cache_stats` 返回值里加 `dir` 字段。

选 A 的理由：
1. **职责分离**：`get_cache_stats` 是「统计」语义，目录路径是「位置」语义，混在一起会让契约臃肿，且 `get_cache_stats` 已有 cover/preview/total 三段结构，再嵌一层不优雅。
2. **缓存管理区域是懒加载组件**，`CacheSettings` 已在 mount 时调 `getCacheStats`；额外一次轻量 IPC 调用 `getCacheDir` 成本可忽略，且可独立失败（取路径失败不应让统计也显示不出来）。
3. 与既有 `openDownloadDir`（路径来自前端 config）形成对称：缓存路径也由一次专门的 IPC 取回，再交给同一个「打开」动作。

### 决策 2：缓存目录路径由后端从缓存实例推导，而非前端拼 `~/.hcomic_downloader`

`CoverCacheDB` / `PreviewCacheDB` 构造时已 `os.makedirs(_DEFAULT_DB_DIR)` 并持有 `_db_path` / `_files_dir`。让 `IPCServer` 暴露一个 `get_cache_dir()`，优先用缓存实例的真实目录（取 cover db 的 `dirname(_db_path)`，再 `os.path.abspath` 规范化），而非在 `ipc_server.py` 里重复硬编码 `_DEFAULT_DB_DIR`。这样：
- 单元测试注入自定义 `db_path`/`files_dir` 时，`get_cache_dir` 仍返回与实例一致的真实路径，可测。
- 未来若缓存目录可配置，只需改构造参数，`get_cache_dir` 自动跟随。

### 决策 3：「打开缓存目录」复用 `OPEN_DOWNLOAD_DIR` 的校验，但用独立 channel `OPEN_CACHE_DIR`

考虑过：
- **A（采用）**：新增 `OPEN_CACHE_DIR` channel + handler，handler 内复用同一套校验辅助逻辑（抽出 `assertSafeDirectoryPath` 或直接 inline 相同检查）。
- **B（放弃）**：复用 `OPEN_DOWNLOAD_DIR`，前端把缓存目录当 downloadDir 传进去。

选 A 的理由：`OPEN_DOWNLOAD_DIR` 的校验辅助（`downloadDirValidator`）绑定的是「用户可配置下载目录」语义，且 preload 端 `validateDownloadDir` 也是按下载目录命名。缓存目录是程序内部位置，混用同一 channel 会让语义模糊、审计困难（日志/权限意图不分），也违反 IPC channel「一事一通道」的既有风格（每个动作独立 channel + 独立 handler）。安全校验逻辑可抽公共函数复用，但 channel 与 handler 必须独立。

### 决策 4：前端路径取回失败的降级

`getCacheDir` 失败（后端未就绪/异常）时，缓存目录行显示「无法获取缓存目录」并禁用「打开」按钮，不阻塞其下方统计与清除功能的正常使用。与现有 `stats` 取失败时的降级一致。

## 风险 / 权衡

- **[缓存目录未来可配置导致契约变更]** → 当前 `get_cache_dir` 只返回单一路径（cover 与 preview 同根）。若未来二者分目录或可配置，需将返回值扩展为 `{coverDir, previewDir}`；为此本次保持返回结构为 `{ dir: string }` 而非裸字符串，便于向后兼容地扩展字段。
- **[用户在文件管理器中误删 DB/缓存文件]** → 与「清除缓存」按钮的既有风险等同，且打开的是根目录而非定位到具体文件；不额外加确认弹窗，保持与「打开下载目录」一致的轻量体验。在缓存目录行旁附简短说明「该目录包含封面与预览缓存数据」。
- **[缓存目录尚不存在（首次运行、被清理）]** → `openPath` 会返回错误字符串，handler 已 throw，前端 toast 提示「无法打开目录」；不预先创建（构造缓存实例时已 `makedirs`，正常路径下必然存在）。
- **[跨平台路径展示]** → Windows 显示 `C:\Users\xxx\.hcomic_downloader`，POSIX 显示 `/home/xxx/.hcomic_downloader`；后端用 `os.path.abspath` 规范化即可，前端用等宽 + `break-all` 展示长路径。
