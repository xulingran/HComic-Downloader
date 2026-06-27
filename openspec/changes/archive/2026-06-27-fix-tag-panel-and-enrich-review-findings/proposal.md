## 为什么

当前 NH 标签面板虽已接入排序与精确搜索，但客户端合并会破坏 A-Z 顺序，异步请求可能由旧响应覆盖新选择，并且在最近更新或热门排行上下文中选择标签时不会真正执行标签搜索。详情抽屉还会在 enrich 尚未失败时提前显示红色失败提示，造成误导。

## 变更内容

- 让标签合并逻辑遵守当前的 `popular` 或 `name` 排序，并保证收藏标签合并后仍维持所选顺序。
- 为标签列表加载增加过期响应保护，防止快速切换排序或来源时旧请求覆盖最新结果或提前结束加载态。
- 统一 NH 标签弹窗的搜索语义，使用户从最近更新、热门排行或已有标签结果中选择标签时都进入精确标签搜索。
- 将详情抽屉的 loading 与 error 展示分离，仅在真实失败后显示“标签加载失败”和重试入口。
- 增加覆盖排序结果、请求竞态、NH 非 tag 模式标签选择及 enrich 加载态的回归测试。

## 功能 (Capabilities)

### 新增功能

无。

### 修改功能

- `nh-tag-list`: 明确客户端最终展示顺序、标签面板在任意 NH 搜索上下文中的精确搜索语义，以及异步排序/来源切换时只接受最新请求结果。
- `drawer-tag-enrich-recovery`: 明确 loading 状态不得渲染失败反馈，失败文案与重试入口仅对 error 状态可见。

## 影响

- 前端标签状态管理与弹窗交互：`src/hooks/useTagPanel.ts`、`src/pages/SearchPage.tsx`、`src/components/TagDialog.tsx`。
- NH 搜索参数归一化：`python/ipc/search_mixin.py`。
- 详情抽屉 enrich 状态展示：`src/components/ComicInfoDrawer.tsx`。
- 前端组件/Hook 测试与 Python 搜索 Mixin 测试。
- 不引入新的外部依赖，不改变 Electron IPC 通道结构，也不构成破坏性变更。
