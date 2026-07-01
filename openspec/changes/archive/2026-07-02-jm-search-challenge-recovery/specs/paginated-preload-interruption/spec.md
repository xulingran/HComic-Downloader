## 新增需求

### 需求:搜索预加载必须以非交互模式调用搜索 IPC

搜索页预加载（`useSearchPreloader`）调用 `search` IPC 时必须传递 `allowInteractiveChallenge=false`（或省略该参数使其缺省为 false）。这确保相邻页预加载、后台缓存刷新等非用户主动触发的搜索请求遇到 JM 反爬挑战时静默失败，保留既有缓存，绝不打开可见或隐藏的验证窗口。

#### 场景:预加载被挑战时静默失败

- **当** 搜索预加载请求 JM 搜索相邻页，Python 返回结构化挑战错误（`-32002`），且预加载以 `allowInteractiveChallenge=false` 调用
- **那么** 主进程禁止打开验证窗口
- **且** 该预加载请求按可恢复挑战错误结束
- **且** 预加载结果不写入缓存（由既有中断语义处理），已显示的搜索结果缓存保留

#### 场景:用户主动搜索可触发交互恢复

- **当** 用户主动点击搜索（`handleSearch`），以 `allowInteractiveChallenge=true` 调用 `search`，Python 返回结构化挑战错误
- **那么** 主进程可打开 JM 验证窗口
- **且** 验证完成后用原参数重试搜索一次

#### 场景:预加载与主动搜索的交互标志分离

- **当** 同一搜索页同时存在用户主动搜索（交互）和相邻页预加载（非交互）的请求
- **那么** 主动搜索请求携带 `allowInteractiveChallenge=true`，预加载请求携带 `allowInteractiveChallenge=false`
- **且** 两者独立判定是否触发验证窗口，互不干扰
