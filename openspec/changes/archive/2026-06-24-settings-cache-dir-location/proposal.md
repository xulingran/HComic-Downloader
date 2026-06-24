## 为什么

设置页面的「缓存管理」区域目前只显示封面/预览缓存的文件数、占用大小和上限滑块，却没有告诉用户**缓存文件存放在磁盘的哪个位置**。当用户想手动备份、清理或排查缓存（例如缓存目录被安全软件锁定、磁盘空间异常占用）时，无从得知路径；只能去翻文档或猜测 `~/.hcomic_downloader`。同区域的「下载目录」已经有「打开目录」按钮（`OPEN_DOWNLOAD_DIR`），缓存区域缺少同等能力，体验不一致。

## 变更内容

- 在「缓存管理」区域顶部展示缓存文件所在目录的**绝对路径**（封面缓存 DB、预览缓存 DB 与预览图片文件均位于同一根目录 `~/.hcomic_downloader`，显示该根目录即可）。
- 新增「打开目录」按钮，调用系统文件管理器（复用 `shell.openPath`）直接定位到缓存根目录。
- 路径与按钮均由后端（Python）权威返回，前端不硬编码——后端新增 `get_cache_dir` 方法返回缓存根目录绝对路径；前端经 IPC 取回后展示并提供「打开」动作。
- **BREAKING**：无。新增只读方法与展示控件，不改动既有 `get_cache_stats` / `clear_*_cache` 行为。

## 功能 (Capabilities)

### 新增功能
- `cache-directory-access`: 设置页缓存管理区域向用户暴露「缓存文件所在目录」的绝对路径，并提供「在系统文件管理器中打开该目录」的能力。

### 修改功能
<!-- 无既有规范对应「缓存管理」UI；现有相关规范 storage-analytics / orphan-cleanup 等均不涉及此处需求，故保持为空。 -->

## 影响

- **后端（Python）**：`python/ipc_server.py` 新增 `get_cache_dir` 请求处理方法，返回缓存根目录绝对路径（`os.path.abspath` 规范化 `~/.hcomic_downloader`）。`python/ipc/cover_cache.py`、`python/ipc/preview_cache.py` 暴露已存在的目录路径（`_DEFAULT_DB_DIR` / `self._db_path` / `self._files_dir`）供上层读取，避免重复推导。
- **IPC 契约**：`shared/types.ts` 新增 `get_cache_dir` 方法类型、`IPC_CHANNELS.GET_CACHE_DIR` 常量；`ipc_contract`（或对应）方法表新增 `get_cache_dir`。
- **Electron 主进程**：`electron/main.ts` `registerCacheHandlers` 新增 `GET_CACHE_DIR` handler，透传 `bridge.call('get_cache_dir')`；新增「打开缓存目录」handler，复用 `OPEN_DOWNLOAD_DIR` 的安全校验逻辑（绝对路径、无遍历、无控制字符、`isDirectory`）后调用 `shell.openPath`。
- **Preload**：`electron/preload.ts` 新增 `getCacheDir()` 与 `openCacheDir(dirPath)` 两个 API，`openCacheDir` 复用 `validateDownloadDir` 做早期拒绝。
- **前端**：`src/components/settings/CacheSettings.tsx` 在缓存统计上方新增「缓存目录」行（只读路径 + 「打开目录」按钮），打开失败时 toast 提示。
- **测试**：后端单测覆盖 `get_cache_dir` 返回绝对路径；前端测试覆盖路径展示与「打开目录」点击调用；IPC 方法对齐测试（`tests/unit/main/ipc-arity-parity.test.ts`）需补 `get_cache_dir` / `open_cache_dir` 条目。
- **不受影响**：缓存读写、淘汰、统计逻辑；下载目录相关功能；其他设置区域。
