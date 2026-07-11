# test-isolation 规范

## 目的
确保测试套件中的配置、漫画库数据库和下载冲突文件始终写入临时目录，禁止测试运行触碰或污染用户真实数据。
## 需求
### 需求:IPC 测试必须隔离 library.db
所有在测试中实例化 `IPCServer` 的 helper 必须将 `library.db` 路径重定向到临时目录，禁止写入或打开用户真实数据目录中的 `~/.hcomic_downloader/library.db`。

#### 场景:实例化 IPCServer 时不触碰真实 library.db
- **当** 任意测试调用 `_create_test_server()` 或等效 helper 创建 `IPCServer`
- **那么** `server._library_db._db_path` 必须位于 `tmp_path` 临时目录下
- **并且** 测试运行前后 `~/.hcomic_downloader/library.db` 的修改时间不得发生变化

### 需求:下载冲突测试必须隔离 download_dir
`tests/test_ipc_download_conflict.py` 中所有测试必须在临时下载目录中创建冲突文件和临时目录，禁止在 `~/Downloads/hcomic` 中留下 `Conflict Comic*` 或 `temp_hcomic_*` 等残留。

#### 场景:运行下载冲突测试后不污染真实下载目录
- **当** 运行 `tests/test_ipc_download_conflict.py`
- **那么** 测试运行后 `~/Downloads/hcomic` 中不得新增任何文件或目录

### 需求:修复现有错误的 patch 目标
`tests/test_ipc_library.py` 中隔离 `library.db` 的 patch 目标必须从 `python.ipc.library_mixin.get_default_library_db_path` 修正为 `ipc.library_mixin.get_default_library_db_path`，确保 `_init_library` 的全局命名空间被正确替换。

#### 场景:patch 修正后 library.db 指向临时目录
- **当** 使用修正后的 patch 创建 `IPCServer`
- **那么** `get_default_library_db_path` 的 mock 必须被调用一次
- **并且** `server._library_db._db_path` 必须等于临时路径

### 需求:全局测试隔离守卫必须覆盖未来 IPC 测试
默认 `library.db` 路径必须支持 `HCOMIC_CONFIG_DIR` 覆盖；pytest 的全局 autouse fixture 必须将其设置为当前测试的临时应用数据目录，使未添加局部 patch 的新 IPC 测试同样无法访问真实 HOME。

#### 场景:未添加局部 patch 的测试解析库路径
- **当** pytest autouse fixture 已设置 `HCOMIC_CONFIG_DIR`
- **那么** `get_default_library_db_path()` 必须返回当前 `tmp_path` 下的 `library.db`
- **并且** 该路径不得等于 `~/.hcomic_downloader/library.db`

#### 场景:生产环境未设置覆盖变量
- **当** `HCOMIC_CONFIG_DIR` 未设置或为空
- **那么** `get_default_library_db_path()` 必须回退到 `~/.hcomic_downloader/library.db`
