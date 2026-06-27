## 新增需求

## 修改需求

### 需求:IPC handler 主进程必须独立权威校验所有参数

主进程 IPC handler 不得仅依赖 preload 透传的 TypeScript 类型签名作为安全边界。所有接受外部输入（渲染进程可触达）的 handler 必须在主进程内独立调用 `assert(...)` 或等效运行时校验，与 preload 端形成防御深度。标签列表读取通道的可选排序参数必须由主进程校验为允许值。

#### 场景:WRITE_CLIPBOARD 拒绝超长文本

- **当** 渲染进程调用 `WRITE_CLIPBOARD` 通道，传入长度超过 2,000,000 字符的字符串
- **那么** 主进程 handler 必须抛出 `ValidationError`，错误信息标识 `clipboard text`，剪贴板不被写入

#### 场景:WRITE_CLIPBOARD 拒绝非字符串

- **当** 渲染进程调用 `WRITE_CLIPBOARD` 通道，传入非字符串值（如对象、数字）
- **那么** 主进程 handler 必须抛出 `ValidationError`，错误信息标识 `clipboard text`

#### 场景:可选 source 参数统一校验

- **当** 任意接受可选 `source` 参数的 IPC handler（search、random、get_favourites、add_to_favourites、check_favourite、remove_from_favourites、get_comic_detail、get_favourite_tags、clear_favourite_tags、remove_favourite_tag、sync_favourite_tags、get_tag_list、refresh_tag_list）收到非 undefined/null 且不在 `COMIC_SOURCES` 集合内的值
- **那么** handler 必须通过 `withOptionalSource` helper 抛出 `ValidationError`，错误信息包含 `<handler> source` 标签
- **且** 收到 undefined 或 null 时不写入 params.source

#### 场景:get_tag_list 拒绝非法排序参数

- **当** 渲染进程调用 `GET_TAG_LIST` 通道并传入非 undefined/null 且不等于 `popular` 或 `name` 的 sort 参数
- **那么** 主进程 handler 必须抛出 `ValidationError`，错误信息标识 `get_tag_list sort`
- **且** 禁止向 Python 后端发送非法 sort 参数

#### 场景:get_tag_list 接受合法排序参数

- **当** 渲染进程调用 `GET_TAG_LIST` 通道并传入 `popular` 或 `name` sort 参数
- **那么** 主进程 handler 必须将该 sort 参数透传给 Python 后端
- **且** 未传入 sort 参数时必须保持向后兼容

## 移除需求
