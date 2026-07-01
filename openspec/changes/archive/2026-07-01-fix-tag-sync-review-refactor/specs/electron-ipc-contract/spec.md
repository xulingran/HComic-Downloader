# electron-ipc-contract 规范增量

> 对现有 `electron-ipc-contract` 规范中「收藏夹推荐标签同步进度通知必须使用专用通道」需求的收紧。

## 修改需求

### 需求:收藏夹推荐标签同步进度通知必须使用专用通道

`sync_favourite_tags` 的实时进度必须通过专用 Python notification 与渲染进程 notification 通道传递，禁止复用 `tag_list_progress` / `TAG_LIST_PROGRESS`。共享契约必须定义 favourite tags 同步进度事件结构，Electron 主进程必须将 Python notification 转发到对应 renderer channel，preload 必须暴露订阅 API。

事件结构必须包含 `source`、`phase`、`current`、`total`、`status` 或等价状态信息。其中阶段或状态必须能区分运行中、完成与错误，并且必须能表达收藏夹分页扫描和详情补全两个阶段。

**错误事件契约**：每个失败路径**必须恰好推送一次** `error` 事件，禁止重复推送。外层异常兜底是错误事件的**唯一**推送点，内层站点（如第一页预检失败）不得额外推送，避免第一页网络失败路径双发而 `needs_login` 失败路径单发的契约不一致。

#### 场景:Python favourite_tags_progress 被转发到 renderer 专用通道

- **当** Python 后端推送 `favourite_tags_progress` 通知
- **那么** Electron 主进程必须通过 `FAVOURITE_TAGS_PROGRESS` 通知通道转发给渲染进程
- **且** 禁止通过 `TAG_LIST_PROGRESS` 通道转发该事件

#### 场景:preload 暴露 favourite tags 进度订阅 API

- **当** 渲染进程调用 `window.hcomic.onFavouriteTagsProgress(callback)`
- **那么** preload 必须订阅 favourite tags 进度通知通道
- **且** 必须返回取消订阅函数
- **且** callback 参数必须符合共享的 favourite tags 进度事件结构

#### 场景:收藏页扫描事件包含页码语义

- **当** 后端完成任一收藏夹页面的扫描和标签索引更新
- **那么** 推送的 favourite tags 进度事件必须包含当前页与总页数，或包含足以让前端显示 `currentPage/totalPages` 的等价字段
- **且** 事件必须包含当前来源 `source`

#### 场景:详情补全事件包含补全数量语义

- **当** 后端正在对无标签漫画执行详情补全
- **那么** 推送的 favourite tags 进度事件必须包含已补全数量与待补全总数，或包含足以让前端显示 `current/total` 的等价字段
- **且** 事件必须能与收藏页扫描阶段区分

#### 场景:错误事件不吞掉原始 IPC 错误

- **当** `sync_favourite_tags` 同步过程中发生异常
- **那么** 后端必须推送 favourite tags 错误进度事件（包含可显示 message）
- **且** 原 `sync_favourite_tags` 请求仍必须按现有 JSON-RPC 错误路径失败，禁止只靠进度事件表示失败

#### 场景:每个失败路径恰好推送一次 error 事件

- **当** `sync_favourite_tags` 在第一页网络请求阶段失败（最常见的失败路径）
- **那么** 后端必须恰好推送一次 `phase: "error"` 进度事件
- **且** 禁止内层第一页异常处理与外层兜底同时各推送一次（双发）
- **且** 第一页失败路径与 `needs_login` 失败路径推送的 `error` 事件数量必须一致（均为一次）

#### 场景:错误事件 total 字段表达未知总数

- **当** 同步在尚未确定 `total_pages`（如第一页请求即失败）时推送 error 事件
- **那么** 事件的 `total` 字段必须为 0，明确表达「总页数未知」
- **且** 禁止使用误导性的默认值 1（会被前端误读为「总共 1 页全部失败」）
