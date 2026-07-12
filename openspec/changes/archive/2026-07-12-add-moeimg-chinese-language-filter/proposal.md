## 为什么

moeimg 搜索列表已经提供语言元数据，并有专用的 `/spa/language/chinese` 分页接口，但当前界面无法只浏览中文漫画。应复用现有“仅显示中文”搜索上下文，在默认浏览时优先使用服务端中文列表，并以占位式前端过滤作为接口不可用及其他搜索模式的降级保障。

## 变更内容

- 将现有 NH 专属“仅显示中文”开关扩展到 moeimg，保持默认关闭，并让筛选状态独立参与搜索、分页、缓存和相邻页预加载。
- moeimg 默认浏览开启筛选时优先请求 `/spa/language/chinese?page=N`；该接口失败或返回不可解析响应时，回退到 `/spa/latest-manga?page=N`，保持搜索可用。
- 为 moeimg 搜索列表项透传 `language` 元数据；筛选开启时，已知语言且不为 `chinese` 的条目复用现有屏蔽卡片占位符，缺失语言的条目不误判为非中文。
- moeimg 关键词、作者和标签搜索继续使用现有服务端接口，并对返回页执行相同的占位式语言过滤；不伪造服务端过滤后的分页总数。
- 将搜索 IPC 的来源限制由仅 NH 放宽为 NH 与 moeimg，同时继续只接受固定枚举值 `chinese`，拒绝其他来源和非法值。
- 将“全部被标签过滤”的空状态文案泛化，使其同时适用于语言筛选。

## 功能 (Capabilities)

### 新增功能
- `moeimg-language-filter`: 定义 moeimg“仅显示中文”筛选、服务端优先与前端降级、分页、缓存及语言元数据行为。

### 修改功能
- `electron-ipc-contract`: 允许 moeimg 搜索安全地携带并转发固定的中文语言筛选参数。
- `blocked-card-placeholder`: 将已知非中文的 moeimg 结果纳入屏蔽占位符与全量筛选提示行为。

## 影响

- 前端搜索状态与界面：`src/pages/SearchPage.tsx`、`src/components/SearchBar.tsx`。
- 搜索缓存与预加载：`src/stores/useSearchCacheStore.ts`、`src/hooks/useSearchPreloader.ts` 中的来源守卫与命名。
- Electron/共享 IPC 契约：`shared/types.ts`、`electron/preload.ts`、`electron/main.ts`。
- Python 搜索编排与来源分发：`python/ipc/search_mixin.py`、`sources/__init__.py`。
- moeimg 解析器：`sources/moeimg/parser.py`，继续复用已注入系统代理的同一 Session，不新增网络会话。
- 对应 Python、Electron 和 React 单元测试；不新增第三方依赖。
