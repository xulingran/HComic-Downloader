## 上下文

项目的测试套件在 `tests/` 下与生产代码共用根目录。`IPCServer` 在初始化时会调用 `_init_library()`，后者通过 `library_db.get_default_library_db_path()` 打开 `~/.hcomic_downloader/library.db`。`CBZBuilder` 和 `ComicDownloadManager` 默认使用 `Config.load().download_dir`（即 `~/Downloads/hcomic`）。

现有的 `tests/test_ipc_library.py` 试图用 `patch("python.ipc.library_mixin.get_default_library_db_path", ...)` 隔离 library DB，但由于 `python/` 目录在 `sys.path` 中，运行时会同时存在 `ipc.library_mixin` 和 `python.ipc.library_mixin` 两个模块对象；`_init_library` 的全局命名空间属于前者，因此 patch 没有生效，测试数据写入了真实 `library.db`。

`tests/test_ipc_download_conflict.py` 只 patch 了 `_get_config_path`，没有隔离 `download_dir`，导致冲突检测文件直接创建在 `~/Downloads/hcomic`。

## 目标 / 非目标

**目标：**
- 所有 IPC 测试实例化 `IPCServer` 时，`library.db` 必须指向临时目录。
- `test_ipc_download_conflict.py` 的测试必须在临时下载目录中运行，不污染真实下载目录。
- 清理已写入真实 `library.db` 的测试记录和真实下载目录中的测试文件。
- 增加一个回归测试或配置隔离守卫，防止未来再次污染真实数据目录。

**非目标：**
- 不改 library、下载或配置的业务逻辑。
- 不新增前端功能或 IPC API。
- 不重构整个测试 helper 体系（只修复隔离缺口）。

## 决策

1. **统一 patch 目标为 `ipc.library_mixin.get_default_library_db_path`**
   - 理由：`_init_library` 定义在 `ipc.library_mixin` 模块中，其全局命名空间里的 `get_default_library_db_path` 来自该模块。`python.ipc.library_mixin` 只是同名模块的另一个副本。

2. **所有 `_create_test_server` helper 同时 patch `Config.load` 和 `get_default_library_db_path`**
   - 理由：只隔离 config.json（`HCOMIC_CONFIG_DIR`）不够；`library.db` 路径与 `download_dir` 都需要显式控制。

3. **`test_ipc_download_conflict.py` 的 `ipc_server` fixture 返回 `download_dir=str(tmp_path / "downloads")`**
   - 理由：该测试需要真实文件系统来验证冲突检测，因此必须使用临时下载目录。

4. **清理动作作为独立任务，在代码修复之后执行**
   - 理由：先堵住污染源，再清理已存在的测试数据，避免反复污染。

5. **`library.db` 与 `config.json` 共用 `HCOMIC_CONFIG_DIR` 覆盖**
   - 理由：`tests/conftest.py` 已为每个测试设置独立应用数据目录。让库路径读取同一环境变量后，未来新增的 IPC 测试即使忘记局部 patch，也只会打开 pytest 临时目录。
   - 验证：隔离守卫同时断言 `config.json` 和 `library.db` 均远离真实 HOME，并覆盖环境变量显式覆盖与未设置时的生产回退路径。

## 风险 / 权衡

- **风险**：修改多个测试 helper 可能破坏现有测试的隐式假设（例如某些测试依赖真实下载目录来验证路径）。
  - 缓解：逐个文件运行相关测试，确认通过。
- **风险**：清理脚本误删用户真实漫画。
  - 缓解：只删除明确匹配测试残留文件名和 `library.db` 中测试标题的记录，并先备份。
- **风险**：未来新增的 IPC 测试忘记隔离 `library.db`。
  - 缓解：`get_default_library_db_path()` 读取全局 autouse fixture 设置的 `HCOMIC_CONFIG_DIR`，隔离守卫断言其解析结果位于当前测试的 `tmp_path`，同时保留现有 helper 的显式 patch 作为双重保护。

## 迁移计划

1. 修复 `tests/test_ipc_library.py` 的 patch 目标。
2. 为所有 IPC 测试 helper 添加 `get_default_library_db_path` patch。
3. 修复 `tests/test_ipc_download_conflict.py` 的 `download_dir` 隔离。
4. 运行相关 pytest 验证隔离有效。
5. 清理真实 `library.db` 中的测试记录和 `~/Downloads/hcomic` 中的测试文件。
6. 运行完整测试套件确保无回归。
