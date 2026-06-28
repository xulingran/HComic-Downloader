## 新增需求

### 需求:测试必须隔离真实文件系统配置状态

任何测试**禁止**写入真实的用户配置目录（`~/.hcomic_downloader/`）。所有触发 `Config.save()` 的测试路径——无论是直接调用还是经由 IPCServer handler（如 `handle_apply_auth`、`handle_*_login`、`handle_set_config`、迁移回调）间接触发——**必须**经由统一隔离机制将配置文件重定向到临时目录，禁止依赖各测试文件自行 mock `Config.save` 或逐模块 patch `_get_config_path`。

理由：`_get_config_path()` 被 `auth_mixin`/`config_mixin`/`migration_mixin`/`ipc_server` 各自 `from .types import _get_config_path` 绑定成本地名，逐模块 patch 会因 Python import 陷阱对未显式 patch 的绑定失效。单一、调用时读取的注入点（环境变量 `HCOMIC_CONFIG_DIR`）是唯一能统一覆盖所有现存与未来绑定的隔离方式。

#### 场景:认证 handler 测试不污染真实配置

- **当** `test_ipc_auth_mixin.py` 中任一用例（含登录失败路径）实例化 IPCServer 并调用认证 handler 触发 `config.save(_get_config_path())`
- **那么** 写入目标**必须**是临时目录下的 config.json，禁止是真实的 `~/.hcomic_downloader/config.json`
- **且** 测试运行前后真实用户配置文件的内容（含 source_auth 的 cookie/账号密码字段）**必须**保持不变

#### 场景:配置路径函数支持环境变量重定向

- **当** 环境变量 `HCOMIC_CONFIG_DIR` 被设置为非空路径
- **那么** `python/ipc/types.py` 的 `_get_config_path()` **必须**返回 `${HCOMIC_CONFIG_DIR}/config.json`
- **且** 该环境变量**必须**在 `_get_config_path()` 函数调用时读取（非 import 时），使所有模块的本地绑定统一受控

#### 场景:生产环境路径不受影响

- **当** 环境变量 `HCOMIC_CONFIG_DIR` 未设置或为空串
- **那么** `_get_config_path()` **必须**返回真实的 `~/.hcomic_downloader/config.json`，行为与变更前逐字节一致

#### 场景:隔离机制由全局 autouse fixture 提供

- **当** 任意测试（无论是否显式请求隔离 fixture）运行时
- **那么** `tests/conftest.py` 的 autouse fixture **必须**自动设置 `HCOMIC_CONFIG_DIR` 指向 `tmp_path`
- **且** 该 fixture 对不触发 `Config.save()` 的测试**必须**无副作用（路径函数仅在被调用时读取变量）

#### 场景:隔离失效被守卫测试捕获

- **当** autouse 隔离 fixture 被移除/禁用，或环境变量注入逻辑被破坏，或新增 mixin 绑定 `_get_config_path` 后未被守卫覆盖
- **那么** `tests/test_config_isolation_guard.py` **必须**失败，断言各模块绑定的 `_get_config_path()` 返回值不指向真实 HOME
