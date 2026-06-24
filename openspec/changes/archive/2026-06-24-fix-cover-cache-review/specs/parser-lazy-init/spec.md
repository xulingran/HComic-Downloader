## 新增需求

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
