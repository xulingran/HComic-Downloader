# parser-lazy-init 规范

## 目的

定义多来源解析器的按需构造、认证恢复、Session 暴露、错误类型导出与并发安全行为，减少启动成本并确保懒加载前后公开契约保持一致。

## 需求

### 需求:MultiSourceParser 必须按需创建解析器实例

系统在 `MultiSourceParser.__init__` 中**禁止**预先实例化所有来源解析器。必须改为延迟创建：首次通过 `self.parsers[src]` 或等效方法访问某个来源的解析器时，才构造对应的解析器实例。

#### 场景:构造时不创建任何解析器

- **当** `MultiSourceParser(timeout=30, default_source="hcomic")` 被构造
- **那么** 内部 `self.parsers` 字典必须为空或仅包含已构造的解析器
- **且** 任何解析器的 `__init__` 方法在此阶段不得被调用

#### 场景:首次访问时自动创建解析器

- **当** 调用 `parser.search(keyword="test")` 且 `default_source="hcomic"`
- **那么** 系统自动构造 `HComicParser` 实例，传入正确的 `timeout`、`cookie`、`user_agent` 参数
- **且** 后续再次访问 `self.parsers["hcomic"]` 必须返回同一实例（单例创建）

#### 场景:default_source 首次访问无需显式 set_source

- **当** `default_source="hcomic"` 时调用 `parser.search(...)`
- **那么** 系统自动使用默认 source 创建解析器，无需先调用 `set_source("hcomic")`

### 需求:懒创建时源认证数据必须正确传入

懒创建的解析器必须接收与热启动预创建完全相同的认证参数（cookie、user_agent、bearer_token），确保行为一致。

#### 场景:hcomic 解析器懒创建包含认证参数

- **当** `source_auth={"hcomic": {"cookie": "abc", "user_agent": "Mozilla/5.0", "bearer_token": "tok"}}`
- **那么** 首次访问 `self.parsers["hcomic"]` 时，`HComicParser` 以 `cookie="abc"`, `user_agent="Mozilla/5.0"`, `bearer_token="tok"` 构造

#### 场景:moeimg 懒创建后正确恢复凭据

- **当** `source_auth["moeimg"]` 包含 `username` 和 `password`
- **那么** 懒创建的 `MoeImgParser` 实例必须调用 `set_stored_credentials(username, password)`

### 需求:sessions 访问必须报告所有已创建解析器的 session

`get_sessions()` 方法必须只返回当前已创建的解析器的 session，跳过尚未懒加载的解析器。

#### 场景:仅 hcomic 被创建时 sessions 返回长度 1

- **当** 只访问过 `self.parsers["hcomic"]` 时调用 `get_sessions()`
- **那么** 返回列表长度为 1，仅包含 hcomic 的 session

### 需求:configure_auth 必须对已创建和未创建的解析器都生效

调用 `configure_auth()` 时，必须同时更新已创建解析器和未创建解析器的待用认证参数。

#### 场景:configure_auth 后懒创建使用新认证

- **当** 调用 `configure_auth(cookie="new_cookie", source="hcomic")`，然后首次访问 `self.parsers["hcomic"]`
- **那么** 创建的 `HComicParser` 实例使用 `cookie="new_cookie"`

### 需求:set_stored_credentials 恢复逻辑在懒创建时仍执行

在 proposal 中定义的 moeimg/bika/hcomic 凭据恢复（`set_stored_credentials`、`configure_auth`、`set_image_quality`）必须在解析器懒创建时自动执行，确保登录状态不丢失。

#### 场景:bika 懒创建时恢复 token 和质量

- **当** `source_auth["bika"]` 包含 `bearer_token`、`username`、`password`，且 `bika_image_quality="original"`
- **那么** 首次访问 `self.parsers["bika"]` 时，自动执行 `configure_auth(bearer_token=...)`、`set_stored_credentials(username, password)`、`set_image_quality("original")`

### 需求:ParserResponseError re-export 不得触发整包解析器导入

`sources` 包通过模块级 `__getattr__` 惰性 re-export `ParserResponseError`，**必须**直接从轻量的 `sources.base` 导入（`ParserResponseError` 的定义处），**禁止**经由 `sources.hcomic.parser` 等 parser 模块 re-export——后者会连带拉起 `requests`/`lxml` 等重依赖，抵消懒加载收益。`sources.ParserResponseError` 与各 parser 内引用的 `ParserResponseError` **必须**是同一类对象（`is` 相等），以保证 `except sources.ParserResponseError` 仍能捕获各 parser 抛出的实例。

#### 场景:访问 ParserResponseError 不导入 hcomic parser

- **当** 全新进程执行 `import sources` 后访问 `sources.ParserResponseError`
- **那么** 返回 `sources.base.ParserResponseError` 类对象
- **且** `sources.hcomic.parser` 不在 `sys.modules` 中
- **且** `requests`、`lxml` 不在 `sys.modules` 中

#### 场景:re-export 的类与 parser 内引用身份一致

- **当** `import sources` 后比较 `sources.ParserResponseError` 与 `sources.hcomic.parser.ParserResponseError`
- **那么** 两者 `is` 相等（同一类对象）
- **且** `except sources.ParserResponseError` 能捕获 hcomic parser 抛出的 `ParserResponseError` 实例

#### 场景:访问未导出的属性仍抛 AttributeError

- **当** 访问 `sources.<不存在的属性>`
- **那么** 抛出 `AttributeError`，提示该模块无此属性

### 需求:懒创建路径必须并发安全

`_load_parser_class`（类导入）与 `MultiSourceParser._get_parser`（实例创建）在 IPC server 的并发请求线程（`ThreadPoolExecutor`，最多 8 worker）下会被同时调用。两条路径必须用 double-checked locking 守卫：相同 source 在任意并发下只构造**一次**解析器类与**一次**解析器实例，且后续访问返回同一实例。稳态（已有缓存）必须走无锁快路径，避免性能退化。

#### 场景:并发首次访问同一来源只构造一次实例

- **当** 多个线程同时调用 `MultiSourceParser._get_parser("jm")` 且 jm 尚未创建
- **那么** 仅有一个线程执行工厂调用，其余线程阻塞于锁后复用其结果
- **且** 最终 `self._parsers["jm"]` 仅含一个实例
- **且** 所有调用方拿到的实例身份相等（`is`）

#### 场景:并发首次导入同一来源类只缓存一次

- **当** 多个线程同时调用 `_load_parser_class("bika")` 且该类尚未缓存
- **那么** 仅执行一次 `importlib.import_module` + `getattr`
- **且** `_PARSER_CLASSES["bika"]` 被赋值恰好一次

#### 场景:稳态读无锁快路径

- **当** 某 source 的解析器类与实例均已缓存
- **那么** `_load_parser_class` 与 `_get_parser` 的读路径不得获取任何锁
- **且** 返回缓存的类/实例对象

#### 场景:构造与后处理原子化

- **当** `_get_parser` 在锁内构造新实例
- **那么** `_apply_post_init`（凭据/token/质量恢复）必须在同一临界区内执行
- **且** 跳过构造的后到者拿到的实例已被正确应用后处理，不会拿到未配置实例

#### 场景:实例锁与模块锁分离

- **当** 两个独立的 `MultiSourceParser` 实例（如测试中频繁构造）并发创建各自的解析器
- **那么** 它们不得因争抢同一把锁而互相阻塞
- **且** 模块级 `_PARSER_INIT_LOCK` 守卫类导入，实例级 `self._parser_lock` 守卫实例创建，作用域互不重叠
