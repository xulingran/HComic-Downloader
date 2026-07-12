## 1. 扩展后端语言筛选链路

- [x] 1.1 扩展 `python/ipc/search_mixin.py` 的来源和值校验，使 `language_filter='chinese'` 仅允许 NH 与 moeimg，并为非法值及其他来源保留明确拒绝行为
- [x] 1.2 扩展 `sources/__init__.py` 的搜索分发，让 NH 与 moeimg 显式接收语言筛选，同时保持其他 parser 既有签名不变
- [x] 1.3 为 Python 搜索编排与 MultiSourceParser 增加测试，覆盖 moeimg 合法转发、非法枚举、其他来源拒绝及未筛选兼容路径

## 2. 实现 moeimg 服务端优先与安全回退

- [x] 2.1 扩展 `MoeImgParser.search` 接收可选语言筛选：空关键词中文筛选优先请求 `/spa/language/chinese?page=N`，未筛选仍请求 `/spa/latest-manga?page=N`
- [x] 2.2 为中文端点实现严格响应结构判定及最近更新回退，确保合法空列表不回退、两次请求复用已注入系统代理的同一 Session、回退也失败时正常抛错并记录日志
- [x] 2.3 修改 `_parse_search_manga_list`，规范化并透传列表项 `language`，缺失或空白值保持未确定
- [x] 2.4 增加 moeimg parser 单元测试，覆盖中文端点成功与分页、网络/HTTP/JSON/结构错误回退、合法空结果、回退二次失败、语言字段规范化以及关键词/作者/标签原请求不变

## 3. 泛化前端搜索筛选状态

- [x] 3.1 将 `SearchBar` 的 NH 专属语言筛选 props 和显示守卫泛化为 NH/moeimg 支持的“仅显示中文”控件，保持其他来源不显示
- [x] 3.2 将 `SearchPage` 的 NH 专属 state/ref/handler/effective guard 泛化为语言筛选状态，并覆盖搜索、默认入口、翻页、标签操作、缓存恢复及来源切换
- [x] 3.3 更新 `useSearchPreloader`、搜索缓存类型与上下文命名/注释，使 moeimg 筛选与未筛选分页、缓存和迟到结果隔离保持一致
- [x] 3.4 增加 React/hook/store 测试，覆盖 moeimg 开关展示、默认关闭、切换后第一页请求、分页和预加载参数、缓存键隔离以及不支持来源不携带筛选

## 4. 扩展 IPC 契约

- [x] 4.1 更新 `shared/types.ts`、`electron/preload.ts` 与 `electron/main.ts` 的来源守卫和注释，允许 NH/moeimg 传递唯一合法值 `chinese`，继续拒绝非法值与其他来源
- [x] 4.2 更新 Electron/preload 契约测试，验证 moeimg 合法逐层转发、缺省省略参数、其他来源拒绝和 Python 参数不包含 UI 控制字段

## 5. 实现占位式语言过滤

- [x] 5.1 在 `SearchPage` 合并标签屏蔽与 moeimg 语言屏蔽判定：筛选开启时仅屏蔽已知且规范化后非 `chinese` 的条目，缺失语言保持可见，且不受全局标签过滤开关控制
- [x] 5.2 继续复用 `BlockedPlaceholder` 呈现语言不匹配项，并将全量屏蔽提示泛化为“所有结果均已被筛选”或等价文案
- [x] 5.3 增加前端测试，覆盖非中文占位、大小写/空白中文正常显示、未知语言保持可见、标签过滤关闭时语言过滤仍生效、推荐高亮不应用于 blocked 项及全量屏蔽通用提示

## 6. 完整验证

- [x] 6.1 运行 moeimg parser、SearchMixin、Electron IPC、SearchPage、SearchBar、预加载与缓存相关定向测试并修复回归
- [x] 6.2 按仓库提交前流程运行 `pytest`、`npx tsc --noEmit`、`npm test`、`npm run lint:py`、`npm run format:py`、`npm run lint` 和 `npm run lint:test-quality`，确保全部通过
