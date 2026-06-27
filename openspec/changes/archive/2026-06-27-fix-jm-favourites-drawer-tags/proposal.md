## 为什么

JM 来源的漫画详情抽屉（`ComicInfoDrawer`）从收藏夹打开时无法显示 tags，但从搜索页打开可以。根因是：JM 收藏夹列表页的服务端 HTML **不含任何 tag 字段**（列表视图只渲染缩略图 + 标题 + 删除按钮），因此列表项 `tags=[]`。抽屉打开时虽会通过 `getComicDetail` 请求详情页补全，但 enrich 的失败分支被 `.catch(() => {})` **静默吞掉**，且 `.then` 里对 `result.comic === null` 也无任何处理——一旦详情页请求失败（Cloudflare 拦截 / 限流 / 限制级需登录），抽屉直接 fallback 到空 tags 列表项，用户得不到任何反馈，表现为"标签区空白且无任何提示"。

搜索页正常是因为搜索卡片 DOM 自带 tags 块，enrich 失败也有列表项 tags 兜底。

## 变更内容

- **修改** `ComicInfoDrawer.tsx` 的 enrich effect：将静默 `.catch(() => {})` 改为写入 `error` 状态；`.then` 中 `result.comic === null` 时也置为 `error`（当前 bug 核心——静默忽略 null）。
- **新增** enrich 状态机 `enrichState`（`idle / loading / success / error`），沿用现有 `favouritesState` 四态模式。
- **新增** 标签区失败兜底 UI：当确实需要 enrich（JM/moeimg 或列表项无 tags）且 enrich 失败、列表项 tags 为空时，显示"标签加载失败 + 重试"内联按钮，点击重新触发 enrich。
- **新增** 对应单元测试（失败显示重试、重试成功、成功不显示失败 UI）。

本次修复仅限前端，不动后端 parser（`_parse_search_item` 提取 `tags=[]` 符合 JM 收藏夹 HTML 实情，无 bug）、不动 IPC、不动数据流。

## 功能 (Capabilities)

### 新增功能
- `drawer-tag-enrich-recovery`: 详情抽屉在 tag enrich（通过详情页补全 tags）失败时，必须向用户提供可见的失败反馈与手动重试入口，禁止静默吞错。

### 修改功能
<!-- 无。现有 capability（jm-source / tag-recommendation-highlight）的规范级行为不变，本次仅为新增失败反馈行为。 -->

## 影响

- **前端代码**：`src/components/ComicInfoDrawer.tsx`（enrich effect 改造 + 标签区兜底 UI + retry 状态）
- **前端测试**：`tests/unit/components/ComicInfoDrawer.test.tsx`（新增 3 个用例，调整 `sourceNeedsDetailEnrich` mock 以支持按来源返回真值）
- **不受影响**：后端 parser、IPC handler、`getComicDetail` 通道、`favourites()` 数据流、`ComicInfo` 类型契约
- **风险**：极低。纯前端状态机 + UI 兜底，不改任何数据流；回退仅需还原单文件改动。
