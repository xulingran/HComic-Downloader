## 新增需求

### 需求:搜索 IPC 必须验证并转发 NH 语言筛选参数

搜索公共 API 必须支持可选 `languageFilter` 参数，当前唯一合法非空值为 `chinese`。preload 与 Electron 主进程必须逐层校验该参数；主进程只能在 `source="nh"` 时将其以 `language_filter` 字段转发给 Python `search`，缺省或空值必须视为未启用筛选。

#### 场景:合法 NH 中文筛选逐层转发
- **当** renderer 对 `source="nh"` 的搜索传入 `languageFilter="chinese"`
- **那么** preload 和主进程必须接受请求
- **且** Python `search` 参数必须包含 `language_filter="chinese"`

#### 场景:缺省筛选参数
- **当** renderer 调用搜索但未提供 `languageFilter`
- **那么** 系统必须按未启用语言筛选处理
- **且** 主进程发给 Python 的参数必须省略 `language_filter`

#### 场景:拒绝非法筛选值
- **当** renderer 为 `languageFilter` 传入非字符串、控制字符或除 `chinese` 外的非空值
- **那么** preload 或主进程必须在发起 Python 调用前拒绝请求

#### 场景:拒绝跨来源语言筛选
- **当** 搜索来源不是 NH 且请求携带非空 `languageFilter`
- **那么** 主进程必须拒绝请求
- **且** 禁止把语言筛选转发给其他来源解析器

## 修改需求

### 需求:收藏夹交互标志必须逐层验证并默认关闭

前端到 Electron 主进程的收藏夹调用可携带可选 `allowInteractiveChallenge` 布尔值；preload 和主进程必须验证其类型，缺省时必须视为 `false`，并禁止将该 UI 控制参数转发给 Python handler。搜索调用同样支持可选 `allowInteractiveChallenge` 布尔值，遵守完全相同的逐层校验、缺省 `false`、不转发 Python 的契约，与收藏夹交互标志保持同构。搜索的 `languageFilter` 是独立的数据查询参数，禁止与交互控制参数混用。

#### 场景:缺省为非交互

- **当** 调用 `getFavourites` 未提供交互标志
- **那么** 主进程按 `allowInteractiveChallenge=false` 处理
- **且** 挑战错误不得打开窗口

#### 场景:非法交互参数

- **当** renderer 为交互标志传入非布尔值
- **那么** preload 在调用主进程前拒绝请求

#### 场景:主进程消费控制参数

- **当** 合法请求携带 `allowInteractiveChallenge=true`
- **那么** 主进程可用它决定是否运行挑战编排
- **且** 发给 Python `get_favourites` 的参数只包含其支持的页码和来源字段

#### 场景:搜索调用缺省为非交互

- **当** 调用 `search` 未提供交互标志
- **那么** 主进程按 `allowInteractiveChallenge=false` 处理
- **且** 搜索挑战错误不得打开窗口

#### 场景:搜索非法交互参数

- **当** renderer 为搜索交互标志传入非布尔值
- **那么** preload 在调用主进程前拒绝请求

#### 场景:搜索主进程消费控制参数

- **当** 合法搜索请求携带 `allowInteractiveChallenge=true`
- **那么** 主进程可用它决定是否运行搜索挑战编排
- **且** 发给 Python `search` 的参数只包含其支持的 `query / mode / page / source / tag / language_filter` 字段，禁止包含 `allowInteractiveChallenge`

#### 场景:仅 JM 来源搜索触发交互恢复

- **当** 搜索请求携带 `allowInteractiveChallenge=true` 但来源不是 `jm`
- **那么** 即使返回挑战错误，主进程也禁止打开验证窗口
- **且** 按普通错误处理（非 JM 来源不产生 `AntiBotChallengeError`）

