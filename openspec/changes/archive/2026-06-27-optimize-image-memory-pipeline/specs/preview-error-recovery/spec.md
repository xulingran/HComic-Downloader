# preview-error-recovery 规范（增量）

## 修改需求

### 需求: "全部重试"必须重置所有失败页的加载状态

用户点击常驻 Toast 上的"全部重试"按钮后，系统**必须**让所有当前处于失败态的页组件重新进入加载流程（本变更适配协议 URL 形态：重试触发的具体请求从"刷新 dataUri 字符串"改为"重新 fetch 获取新 urlHash 并拼接协议 URL"，成功判断从"dataUri 存在"改为"协议 URL 就绪"；"全部重试"的总体语义——重置失败页、不影响已成功页——保持不变）：重置本地 error 状态并重新调用 `fetchPreviewImage(url, ...)` 获取新 `{ urlHash }`，以新 urlHash 拼接 `app-image://preview/{urlHash}` 作为 `<img src>` 触发重新加载。**禁止**影响已成功加载的页。成功状态判断条件从"dataUri 存在"改为"该页已拿到 urlHash 并渲染协议 URL、无 error"。

#### 场景:点击全部重试重新获取 urlHash

- **当** 用户在失败 Toast 上点击"全部重试"按钮
- **那么** 所有失败页重置 error 状态并重新调用 `fetchPreviewImage` 获取新 `{ urlHash }`
- **且** 以新 urlHash 拼接 `app-image://preview/{urlHash}` 作为 `<img src>` 触发重新加载
- **且** 不再依赖"刷新 dataUri 字符串"语义

#### 场景:协议 404 触发重试链路

- **当** `<img src="app-image://preview/{urlHash}">` 因磁盘文件被 LRU 淘汰返回 404，触发 onError
- **那么** 该失败被上报至父组件失败索引集合（与其他失败同处理）
- **且** 用户重试时重新 `fetchPreviewImage` 获取新 urlHash（重新下载落盘）

#### 场景:全部重试不影响已成功页

- **当** 某页已成功加载（已拿到 urlHash 并渲染协议 URL、无 error）
- **那么** "全部重试"触发时该页不重新请求图片，显示内容不闪烁
- **且** 成功判断条件为"协议 URL 就绪"而非"dataUri 存在"
