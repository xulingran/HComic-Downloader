## 修改需求

### 需求:搜索 IPC 必须验证并转发受支持来源的语言筛选参数

搜索公共 API 必须支持可选 `languageFilter` 参数，当前唯一合法非空值为 `chinese`。preload 与 Electron 主进程必须逐层校验该参数；主进程只能在 `source="nh"` 或 `source="moeimg"` 时将其以 `language_filter` 字段转发给 Python `search`，缺省或空值必须视为未启用筛选。

#### 场景:合法 NH 中文筛选逐层转发
- **当** renderer 对 `source="nh"` 的搜索传入 `languageFilter="chinese"`
- **那么** preload 和主进程必须接受请求
- **且** Python `search` 参数必须包含 `language_filter="chinese"`

#### 场景:合法 moeimg 中文筛选逐层转发
- **当** renderer 对 `source="moeimg"` 的搜索传入 `languageFilter="chinese"`
- **那么** preload 和主进程必须接受请求
- **且** Python `search` 参数必须包含 `language_filter="chinese"`

#### 场景:缺省筛选参数
- **当** renderer 调用搜索但未提供 `languageFilter`
- **那么** 系统必须按未启用语言筛选处理
- **且** 主进程发给 Python 的参数必须省略 `language_filter`

#### 场景:拒绝非法筛选值
- **当** renderer 为 `languageFilter` 传入非字符串、控制字符或除 `chinese` 外的非空值
- **那么** preload 或主进程必须在发起 Python 调用前拒绝请求

#### 场景:拒绝不支持来源的语言筛选
- **当** 搜索来源既不是 NH 也不是 moeimg 且请求携带非空 `languageFilter`
- **那么** 主进程必须拒绝请求
- **且** 禁止把语言筛选转发给对应来源解析器
