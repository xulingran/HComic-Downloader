## 新增需求

### 需求:详情抽屉 tag enrich 失败必须向用户暴露可见反馈

当 `ComicInfoDrawer` 为补全漫画元数据而发起 `getComicDetail` enrich 请求时，**禁止** 静默吞掉任何失败情况（请求抛异常、或后端返回 `comic === null`）。失败 **必须** 将 enrich 状态置为 `error`，并在满足触发条件时向用户呈现可见的失败反馈。当前用 `.catch(() => {})` 静默吞错、且对 `.then` 中 `result.comic === null` 不做处理的行为 **必须** 消除。

#### 场景:详情页请求抛异常时状态为 error

- **当** 抽屉打开触发 enrich，且 `getComicDetail` 的 Promise 被 reject
- **那么** enrich 状态必须置为 `error`，**禁止** 保持 `loading` 或静默回退

#### 场景:后端返回 comic 为 null 时状态为 error

- **当** enrich 的 `getComicDetail` resolve 但 `result.comic === null`
- **那么** enrich 状态必须置为 `error`（当前 bug 核心：此情况原被静默忽略）

#### 场景:enrich 成功时状态为 success

- **当** enrich 的 `getComicDetail` resolve 且 `result.comic` 非空
- **那么** enrich 状态必须置为 `success`，`enrichedComic` 设为返回的 comic，**禁止** 出现失败反馈 UI

#### 场景:不需要 enrich 时不触发请求

- **当** 当前来源 `needsDetailEnrich` 为 false 且列表项已有 tags（`hasCompleteData` 为真）
- **那么** enrich 状态保持 `idle`，不发起 `getComicDetail` 请求，也不显示失败反馈

### 需求:enrich 失败时必须提供内联重试入口

当且仅当满足"确实需要 enrich"（`sourceNeedsDetailEnrich(comicSource)` 为真 **或** 列表项 `tags` 为空）**且** enrich 处于 `error` 状态 **且** 当前展示的 tags 为空（列表项与 enriched 均无 tags）时，标签区域 **必须** 渲染失败反馈 UI，包含"标签加载失败"文案与一个可点击的"重试"按钮。点击重试 **必须** 重新发起同一次 enrich 请求。该反馈 UI 的显示 **禁止** 影响其它来源（如 hcomic，列表项已自带 tags）的正常展示。

#### 场景:JM 收藏夹条目且 enrich 失败时显示重试 UI

- **当** 列表项 `sourceSite === "jm"`、列表项 `tags` 为空、enrich 状态为 `error`
- **那么** 标签区域必须显示"标签加载失败"文案与"重试"按钮

#### 场景:点击重试重新发起 enrich

- **当** 用户在失败反馈 UI 上点击"重试"按钮
- **那么** enrich 状态重置为 `loading` 并重新调用 `getComicDetail`，**禁止** 关闭抽屉或重置其它抽屉状态（如收藏状态）

#### 场景:重试成功后失败 UI 消失

- **当** 重试发起的 enrich resolve 且返回非空 comic
- **那么** enrich 状态置为 `success`，失败反馈 UI 消失，标签渲染为返回 comic 的 tags

#### 场景:hcomic 来源列表项有 tags 时不显示失败 UI

- **当** 来源 `needsDetailEnrich` 为 false 且列表项 `tags` 非空
- **那么** 即使某次 enrich 因任何原因失败，也 **禁止** 显示标签失败反馈 UI（此场景本就不应触发 enrich）
