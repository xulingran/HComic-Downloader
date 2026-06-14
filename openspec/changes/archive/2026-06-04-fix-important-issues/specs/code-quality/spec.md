## 新增需求

### 需求:函数参数数量限制

所有公开函数和方法（不含 `self`/`cls`）的参数数量不得超过 5 个。内部私有函数（`_` 前缀）的阈值相同。

#### 场景:超限函数已对象化

- **当** 代码审查检查参数数量时
- **那么** `download_comic_resume`、`handle_add_history`、`ReadingHistoryDB.upsert`、`Config.set_source_auth` 等超限函数的参数必须已封装为 dataclass 或 TypedDict

### 需求:函数长度限制

所有函数的逻辑行（排除 docstring、注释、空行、类型注解）不得超过 50 行。

#### 场景:巨型函数已拆分

- **当** 代码审查检查函数长度时
- **那么** `JmParser._parse_detail` 的逻辑行数必须已拆分为多个子方法，每个子方法 ≤50 逻辑行

### 需求:代码重复消除

同一逻辑模式在代码库中出现超过 3 次时，必须提取为共享函数、方法或常量。

#### 场景:任务状态过渡已统一

- **当** `pause_task`、`resume_task`、`cancel_task`、`retry_task` 需要变更任务状态时
- **那么** 它们必须通过 `_modify_task_locked` 共享方法完成锁内验证和变更，避免各自实现锁+通知骨架

#### 场景:编码修正已统一

- **当** jmcomic parser 的 HTTP 响应需要修正编码时
- **那么** 必须使用统一的 `_fix_encoding` 方法，不得在 4 处各自重复 iso-8859-1 / latin-1 检查

#### 场景:来源解析已统一

- **当** `MultiSourceParser` 的方法需要确定目标来源时
- **那么** 必须使用 `_resolve_source(source)` 方法，不得在 8 个方法中各自写入 `src = source or self.current_source`

### 需求:异常处理精确性

解析器和 IPC 层不得使用裸 `except Exception` 捕获所有异常。必须指定可预期的异常类型（如 `requests.RequestException`、`ParserResponseError`、`OSError`、`sqlite3.Error`）。

#### 场景:解析器异常被精确捕获

- **当** search/favourites/get_comic_detail 等解析方法处理异常时
- **那么** `except` 子句必须指定 `(requests.RequestException, ParserResponseError, ValueError)` 而非裸 `Exception`

#### 场景:缓存写入异常被精确捕获

- **当** cover/preview 缓存的写入操作失败时
- **那么** `except` 子句必须指定 `(OSError, sqlite3.Error)` 而非裸 `Exception`

### 需求:竞态安全

`download_manager.py` 中对 `DownloadTask` 状态的读写必须在 `self._lock` 保护下进行。禁止锁外读取随后在锁内依赖其结果。

#### 场景:started_at 在锁内设置

- **当** `_process_task` 将任务状态设为 DOWNLOADING 时
- **那么** `task.started_at = time.time()` 必须在同一个 `with self._lock` 块内执行

#### 场景:retry_count 读写保护

- **当** 读取或写入 `task.retry_count` 时
- **那么** 必须在 `self._lock` 保护下进行

#### 场景:drained 回调前二次检查

- **当** `_process_queue` 判定队列已耗尽时
- **那么** 在调用 `_on_queue_complete` 之前必须重新获取锁并确认队列依然为空

### 需求:错误路由准确性

下载成功但打包失败时，不得触发下载重试（自动重试仅适用于网络层面的下载失败）。

#### 场景:打包失败不重试

- **当** `_handle_download_success` 中的 cbz/zip 打包抛出异常时
- **那么** 异常必须直接标记任务为 FAILED，不得流向 `_handle_download_exception` 进而触发 auto-retry

### 需求:魔术数字常量化

代码中出现 2 次及以上的字面量必须定义为模块级命名常量。

#### 场景:常用数字已命名

- **当** 自动重试上限、图片文件扩展名、零填充宽度、Cloudflare 检测字节阈值等被使用时
- **那么** 它们必须引用 `MAX_AUTO_RETRY_CAP`、`DEFAULT_IMAGE_EXT`、`PAGE_FILENAME_WIDTH`、`_CHALLENGE_MIN_LENGTH` 等命名常量

### 需求:嵌套深度限制

关键路径（下载、解析）的嵌套深度不得超过 4 级。

#### 场景:下载函数嵌套已降低

- **当** `image_downloader.download()` 执行分块写入循环时
- **那么** 嵌套深度必须 ≤4 级（通过提取 `_write_chunks` 等辅助方法）

### 需求:上下文管理器统一

所有 parser 类的 `close()` / `__enter__` / `__exit__` 必须通过共享的 `ParserContextMixin` 提供，不得各自复制。

#### 场景:Parser 上下文管理器已统一

- **当** 任一 parser 需要 context manager 支持时
- **那么** 必须继承 `ParserContextMixin`，不再自行定义这 3 个方法
