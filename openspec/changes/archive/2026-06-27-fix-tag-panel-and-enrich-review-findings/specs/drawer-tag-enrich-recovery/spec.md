## 修改需求

### 需求:enrich 失败时必须提供内联重试入口

当且仅当满足“确实需要 enrich”（`sourceNeedsDetailEnrich(comicSource)` 为真 **或** 列表项 `tags` 为空）、enrich 处于 `error` 状态且当前展示的 tags 为空时，标签区域必须渲染失败反馈 UI，包含“标签加载失败”文案与可点击的“重试”按钮。`loading` 状态必须与失败状态分开显示，禁止在请求尚未失败时展示失败文案或重试入口。

#### 场景:JM 收藏夹条目且 enrich 失败时显示重试 UI

- **当** 列表项 `sourceSite === "jm"`、列表项 `tags` 为空、enrich 状态为 `error`
- **那么** 标签区域必须显示“标签加载失败”文案与“重试”按钮

#### 场景:首次 enrich 加载中不误报失败

- **当** 抽屉打开并已发起 enrich 请求，但请求仍处于 `loading`
- **那么** 标签区域禁止显示“标签加载失败”文案和“重试”按钮
- **且** 系统可以显示中性的“标签加载中…”提示

#### 场景:点击重试重新发起 enrich

- **当** 用户在失败反馈 UI 上点击“重试”按钮
- **那么** enrich 状态必须重置为 `loading` 并重新调用 `getComicDetail`
- **且** 重试请求期间必须隐藏失败文案和重试按钮
- **且** 禁止关闭抽屉或重置其它抽屉状态（如收藏状态）

#### 场景:重试成功后失败 UI 消失

- **当** 重试发起的 enrich resolve 且返回非空 comic
- **那么** enrich 状态必须置为 `success`，失败 UI 消失，标签渲染为返回 comic 的 tags

#### 场景:hcomic 来源列表项有 tags 时不显示失败 UI

- **当** 来源 `needsDetailEnrich` 为 false 且列表项 `tags` 非空
- **那么** 即使某次 enrich 因任何原因失败，也禁止显示标签失败反馈 UI
