## 修改需求

### 需求:收藏夹交互标志必须逐层验证并默认关闭

前端到 Electron 主进程的收藏夹调用可携带可选 `allowInteractiveChallenge` 布尔值；preload 和主进程必须验证其类型，缺省时必须视为 `false`，并禁止将该 UI 控制参数转发给 Python handler。搜索调用同样支持可选 `allowInteractiveChallenge` 布尔值，遵守完全相同的逐层校验、缺省 `false`、不转发 Python 的契约，与收藏夹交互标志保持同构。

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
- **且** 发给 Python `search` 的参数只包含其支持的 `query / mode / page / source / tag` 字段，禁止包含 `allowInteractiveChallenge`

#### 场景:仅 JM 来源搜索触发交互恢复

- **当** 搜索请求携带 `allowInteractiveChallenge=true` 但来源不是 `jm`
- **那么** 即使返回挑战错误，主进程也禁止打开验证窗口
- **且** 按普通错误处理（非 JM 来源不产生 `AntiBotChallengeError`）
