# ipc-startup-async 规范

## 新增需求

### 需求:Python 后端模块顶层禁止强制导入运行期才使用的重依赖

`python/ipc_server.py` 模块顶层（即 `import ipc_server` 触发的加载阶段）**禁止**导入仅在实际处理请求时才使用的重型依赖，特别是 `asyncio`。这类依赖**必须**延迟到首次调用的函数/方法内部导入。

#### 场景:import ipc_server 不触发 asyncio

- **当** 执行 `import ipc_server`（尚未实例化 `IPCServer`）
- **那么** `asyncio` 模块**不得**被加载（`'asyncio' not in sys.modules`）
- **且** 该 import 操作的耗时相比延迟前**必须**减少（约 50ms 量级）

#### 场景:运行期首次需要 asyncio 时才导入

- **当** `IPCServer.run()` 或 `_dispatch_request()` 首次执行
- **那么** `asyncio` 在该方法内部被导入
- **且** 后续调用复用已导入的模块，无重复加载开销

### 需求:sources 包顶层禁止强制导入全部来源解析器模块

`sources/__init__.py` 顶层**禁止**通过 `from sources.<src>.parser import <Class>` 形式强制导入所有来源（hcomic/moeimg/jmcomic/bika/copymanga）的解析器模块。解析器模块**必须**按需懒加载——仅在首次请求该来源（`_get_parser(name)`）时通过 `importlib.import_module` 导入。

#### 场景:import sources 不加载未使用的来源解析器

- **当** 执行 `import sources`（或 `from sources import MultiSourceParser`）
- **那么** 默认来源（hcomic）以外的解析器模块（moeimg/jmcomic/bika/copymanga）**不得**被加载
- **且** `requests`、`PIL`、`lxml` 等由这些模块引入的依赖**不得**因 import sources 而被强制加载（除非默认来源本身需要）

#### 场景:首次访问某来源才加载其解析器模块

- **当** 首次调用 `_get_parser("bika")`
- **那么** `sources.bika.parser` 模块被 `importlib.import_module` 加载
- **且** 加载结果被缓存，后续 `_get_parser("bika")` 不重复导入
- **且** 此前未访问的其他来源解析器模块仍未加载

#### 场景:类型注解仍可静态校验

- **当** 静态类型检查器（mypy/pyright）处理 `MultiSourceParser` 中对解析器类型的引用
- **那么** 通过 `TYPE_CHECKING` 守卫下的字符串注解或 `from __future__ import annotations`，类型信息仍可被解析
- **且** 运行期不触发实际导入

### 需求:Python 后端启动时序必须可度量和回归保护

`IPCServer.__init__` 的各阶段（配置加载、解析器初始化、下载引擎、线程池、各数据库、handler 注册）**必须**保持可度量。新增的缓存初始化改造**禁止**导致已优化的阶段（如懒实例化解析器、进度信号）出现性能回退。变更**必须**附带或更新启动时序的基准测量方式（如 `-X importtime` 或 `__init__` 各阶段耗时打点），便于后续回归监控。

#### 场景:__init__ 各阶段耗时可观测

- **当** 以调试方式启动 Python 后端
- **那么** 可获得 `__init__` 各主要阶段（CoverCacheDB、其他 DB、handler 注册等）的耗时
- **且** CoverCacheDB 初始化耗时相比旧实现（全量预加载）显著下降

#### 场景:启动耗时回归保护

- **当** 本轮变更完成后再次冷启动 Python 后端
- **那么** 整体 `import + __init__` 耗时相比变更前基准（约 640ms）**必须**明显下降（目标 < 450ms）
- **且** 不引入新的顶层强制导入导致已下降的耗时回升
