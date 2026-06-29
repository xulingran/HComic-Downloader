# test-discipline 规范

## 目的

约束本仓库测试套件的质量底线，确保每个测试用例承载被测代码的真实信号，而非重述测试框架基本保证、重述 mock 自身或重述实现细节。通过定义"mock 替换测试""框架 CRUD 同义反复""时序不变量"等判定准则，并在变更记录中强制记录移除理由，使测试精简过程可审计、可回溯，避免同义反复测试在清理后再次进入仓库。
## 需求
### 需求:测试必须提供超越实现的独立信号

每个测试断言必须验证被测代码的行为，而非验证测试自身设置的 mock 响应。系统必须禁止仅断言"mock 函数被调用"而不同时验证真实输出的测试。

#### 场景:同义反令断言被识别

- **当** 一个测试断言仅检查 `mockFn.toHaveBeenCalled()` 或 `mock.assert_called` 而不验证返回值或副作用
- **那么** 该测试必须被重写为验证真实行为（输入→输出的可观察结果），或被移除

#### 场景:行为验证断言被保留

- **当** 一个测试在调用真实逻辑后，断言可观察的状态变化或返回值
- **那么** 该测试必须被保留，即使它使用了 mock 来隔离外部依赖

### 需求:禁止测试框架的基本保证

系统必须移除那些验证编程语言运行时或第三方框架自身保证的测试，因为它们不提供关于本项目代码的任何信号。

#### 场景:枚举值断言被移除

- **当** 一个测试断言 `Enum.MEMBER.value == "literal"` 这类语言保证
- **那么** 该测试必须被移除

#### 场景:框架基本 CRUD 断言被移除

- **当** 一个测试验证 Zustand store 的 `setState` 后 `getState` 返回设置值（框架保证）
- **那么** 该测试必须被移除，除非它验证了 store 特有的派生逻辑或副作用

### 需求:测试价值判定必须可追溯

每个被移除或重写的测试必须在变更记录中标注理由，使精简过程可审计、可回溯。

#### 场景:移除理由被记录

- **当** 实施者移除一个测试用例
- **那么** 必须在该用例所在文件的提交说明或变更注释中记录：(a) 原断言内容，(b) 为何判定为低价值（同义反复/框架保证/语言保证）

### 需求:前端 mock 调用断言必须逐条甄别价值

系统必须对前端测试中所有 `toHaveBeenCalled*` 类断言逐条应用"mock 替换测试"准则——"如果把这个 mock 换成真实实现，断言还成立吗？"——禁止按文件类型批量删除或保留。

#### 场景:桥接参数转换断言被保留

- **当** 一个前端测试断言验证了 IPC 桥接层的真实参数转换逻辑（如 camelCase→snake_case 映射、通道注册完整性），即使使用了 mock 隔离 Python 端
- **那么** 该断言必须被保留，因为它验证了前端代码的真实行为

#### 场景:纯 mock 往返断言被移除

- **当** 一个前端测试断言仅验证"mock 被调用"而无任何状态变化或返回值验证（常见于 hooks/stores 的纯调用断言）
- **那么** 该断言必须被重写为真实行为验证或被移除，理由必须记录

### 需求:并发与时序测试必须验证不变量而非时序细节

系统中的并发、多线程或异步时序测试必须断言最终一致的不变量（如状态守恒、无丢失、无回滚），禁止断言线程调度顺序、精确调用次数或具体耗时。

#### 场景:并发测试断言最终一致状态

- **当** 一个测试验证多线程或并发操作的结果
- **那么** 该测试必须断言最终一致的不变量（任务总数守恒、无重复、已完成状态不回滚），使用 `Barrier`/`Event` 显式同步而非 `sleep`

#### 场景:时序断言被禁止

- **当** 一个测试使用 `time.sleep` 或 `setTimeout` 后断言精确时序、线程调用顺序、或 mock 调用次数的精确值
- **那么** 该测试必须被重写为不变量断言，或被标记为脆弱测试移除

### 需求:模块级缓存与模块身份禁止跨测试泄漏

当某测试模块（如 `test_sources_lazy_import.py`）通过真实工厂填充模块级缓存（如 `sources._PARSER_CLASSES`）时，该缓存必须在每个测试用例结束时被复位，禁止残留到后续测试。同时，清理逻辑禁止通过删除并重导入顶层模块造成模块对象身份漂移；若其他测试文件在 pytest 收集期已从该模块导入类或函数，则这些对象的闭包 `__globals__` 必须继续指向当前模块字典，以保证 `monkeypatch.setattr` 能命中真实调用路径。

#### 场景:懒加载测试后缓存被清空

- **当** `test_sources_lazy_import.py` 中任一用例通过真实 `_load_parser_class` 构造解析器类并缓存进 `sources._PARSER_CLASSES` 后
- **那么** 该用例的 teardown 必须清空 `sources._PARSER_CLASSES`，使下一个用例（无论同文件还是其他文件）从空缓存开始

#### 场景:清理保持顶层模块身份稳定

- **当** `test_sources_lazy_import.py::_clean()` 需要为懒加载测试提供干净导入状态时
- **那么** 它必须清理 `sources.*` 子模块并通过 `importlib.reload(sys.modules["sources"])` 原地重载顶层 `sources`，禁止使用 `del sys.modules["sources"]` 产生新模块对象

#### 场景:后续 monkeypatch 测试不受污染

- **当** `test_multi_source_parser.py::test_jm_domain_applies_after_lazy_parser_creation` 在 `test_sources_lazy_import.py` 之后运行，并通过 `monkeypatch.setattr(sources, "_load_parser_class", fake_factory)` 注入假解析器类时
- **那么** `MultiSourceParser` 必须调用 fake_factory 返回的类，而非 `_PARSER_CLASSES` 中残留的真实类或废弃模块字典中的真实 `_load_parser_class`

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

### 需求:测试价值判断准则必须由自动化闸门主动执行

`test-discipline` 定义的判断准则（裸 mock 调用断言、纯框架 CRUD 往返、时序断言）**禁止**仅以人工审计或事后清理的方式执行。仓库**必须**提供一条或多条自动化闸门（lint 规则 / collection-time 扫描），在测试进入仓库前主动拦截违反准则的新增用例，使准则从被动文档转为主动门控。闸门的判定逻辑与具体能力由 `test-quality-gate` 规范定义。

理由：上一轮 `strengthen-test-suite` 一次性清理了同义反复测试，但因缺乏闸门，新写的同义反复测试（如 `comicStore.test.ts`、`settingsStore.test.ts`、`useReaderStore.test.ts` 整文件）在清理后再次进入仓库。预防优于事后清理。

#### 场景:新引入同义反复测试被闸门拦截

- **当** 贡献者新增或修改一个违反本规范准则的测试用例（裸 mock 调用断言、纯框架 CRUD 往返、时序断言），并尝试提交
- **那么** 自动化闸门**必须**失败，阻止该用例进入仓库，且失败信息**必须**指向对应的准则条目

#### 场景:既有真实行为测试不被误伤

- **当** 闸门扫描既有验证真实行为的测试（参数转换、不变量、状态机转换、派生属性）
- **那么** 闸门**必须**放行，禁止因形式上使用了 mock 而误报

### 需求:框架基本 CRUD 断言的豁免边界必须可判定

"禁止测试框架的基本保证"准则中，"store 特有的派生逻辑或副作用"是唯一的豁免出口。该豁免边界**必须**可被自动化判定，而非依赖主观裁量。具体而言：当且仅当 store 方法体不止于 `(x) => set({ x })` 的单行透传——即包含键生成、字段映射、状态合并、条件分支、副作用触发等逻辑——其测试才属于"验证 store 特有派生逻辑"，豁免 CRUD 同义反复判定。

#### 场景:单行透传 store 测试不获豁免

- **当** 一个 store 方法的实现为单行 `(x) => set({ x })`（无派生、无条件、无副作用），且其测试仅断言 setter 往返
- **那么** 该测试**必须**被判定为框架基本 CRUD 同义反复，**禁止**豁免

#### 场景:含派生逻辑的 store 测试获豁免

- **当** 一个 store 方法的实现包含键生成（如 `createSearchContextKey`）、字段映射（如 `error()` 设置 `type: 'error'`）、状态合并（如 `setPage(setCurrent=false)` 不覆盖当前页）等派生逻辑
- **那么** 验证该派生逻辑的测试**必须**获豁免，即使表面形式含 setter 调用

