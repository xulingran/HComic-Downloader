## 1. 共享契约与测试夹具

- [x] 1.1 在 `shared/types.ts` 新增 `SearchSection { title, comicIds }`，并为 `SearchResult` 增加可选 `sections`，保持普通搜索调用方兼容。
- [x] 1.2 从本地 JM 首页结构提炼一个小型、脱敏的 HTML fixture，覆盖五类默认栏目、动态标题、重复漫画、无专辑栏目、损坏卡片和首页挑战检测所需 DOM 标记；禁止提交完整 SingleFile 快照。
- [x] 1.3 为共享搜索响应契约补充类型/IPC 一致性测试，验证 `sections` 可选且栏目只引用顶层漫画 ID。

## 2. JM 首页栏目解析

- [x] 2.1 在 `sources/jm/parser.py` 增加 JM 首页根 URL 构造和专用首页请求入口，复用同一 Session、系统代理、认证 headers、Referer 与 `_request_text_with_challenge_check()`。
- [x] 2.2 实现标题行与紧邻内容行的栏目解析，按“看更多”目标形态识别连载更新、禁漫汉化组、最新韩漫、首个推荐本本和最新漫画，并保留 DOM 动态标题及首页顺序。
- [x] 2.3 复用 `_parse_search_item()` 解析栏目卡片：每栏去重并限制为 10 本，跳过无效卡片和空栏目，排除书库/小说等无 `/album/{id}` 内容。
- [x] 2.4 在 `tests/test_jm_parser.py` 增加首页 fixture 测试，覆盖五栏顺序、每栏上限、动态标题、坏卡容错、非漫画栏目排除以及跨栏重复漫画保留为引用候选。
- [x] 2.5 增加首页正常响应、`cf-mitigated`/稳定正文挑战、非挑战网络异常测试，确认挑战抛出携带根 URL 的 `AntiBotChallengeError` 且不会静默变为空栏目。

## 3. 后端分发与搜索响应编排

- [x] 3.1 在 `MultiSourceParser` 增加有完整类型注解的 JM 首页分发方法，继续通过懒创建的唯一 JM parser 实例访问 Session，禁止新建网络 Session。
- [x] 3.2 在 `SearchMixin.handle_search` 仅对 `jm + keyword + trim 后空串 + page=1` 路由首页方法；非空关键词、ID、排行、其他页和其他来源保持既有分支。
- [x] 3.3 将栏目漫画按 `(source_site, id, comic_source)` 首次出现顺序去重为顶层 `comics`，构造无重复、无悬空 ID 的 `sections`，并返回固定 1/1 分页。
- [x] 3.4 在 `tests/test_search_mixin.py` 与 IPC 契约测试中覆盖空白 JM 首页路由、顶层去重、栏目引用完整性、普通搜索无 `sections`、挑战错误冒泡和 random 语义不变。

## 4. 搜索缓存与统一结果状态

- [x] 4.1 为 `SearchPageCache` 增加可选栏目数据，并更新缓存 store 测试，验证栏目写入、读取、上下文隔离和页面重新挂载恢复。
- [x] 4.2 在 `SearchPage` 引入栏目视图状态，抽取统一的结果提交与清理编排，使挂载加载、`withLoading`、pending search、缓存命中/刷新及错误切换同时更新 comics、pagination 和 sections。
- [x] 4.3 确保普通关键词、排行、随机、切换其他来源及新请求骨架阶段清除旧栏目；迟到或已中止的后台请求禁止恢复陈旧栏目。
- [x] 4.4 扩展 SearchPage/预加载回归测试，覆盖栏目缓存恢复、普通结果清除栏目、上下文切换丢弃迟到栏目以及固定 1/1 首页不触发相邻页预加载。

## 5. JM 首页栏目界面与交互

- [x] 5.1 从现有 `filteredComics` 构建 ID 映射，按栏目顺序渲染标题和独立卡片网格；`sections` 缺失时继续使用现有平铺列表。
- [x] 5.2 复用 `ComicCard`、`BlockedPlaceholder`、`AnimatedCardWrapper` 和下载状态映射，确保标签屏蔽、推荐高亮、阅读、下载、reduced-motion 与两种卡片样式在栏目中一致。
- [x] 5.3 让跨栏目重复漫画共享现有选择键，并确认“全选”和批量下载只消费顶层唯一漫画集合；栏目/卡片 React key 必须避免跨栏冲突。
- [x] 5.4 修改 JM 来源切换行为：认证通过后调用 `search('', 'keyword', 1, 'jm', undefined, true)`，禁止自动 random；保留随机按钮显式调用 `random('jm')`。
- [x] 5.5 保持启动自动加载、缓存后台刷新和预加载的 `allowInteractiveChallenge=false` 边界；为主动切源/空白搜索挑战恢复与后台不弹窗增加主进程或页面测试。
- [x] 5.6 在 `tests/unit/pages/SearchPage.test.tsx` 增加分组标题/顺序、普通平铺回退、屏蔽与高亮、跨栏选择去重、切源不随机、显式随机仍工作及加载骨架测试。

## 6. 验证与收尾

- [x] 6.1 运行 JM parser、search mixin、IPC 契约、搜索缓存、SearchPage 和挑战恢复定向测试并修复所有回归。
- [x] 6.2 运行 `pytest` 与 `npx tsc --noEmit`。
- [x] 6.3 运行 `npm test`、`npm run lint:py` 和虚拟环境中的 `black --check .`。
- [x] 6.4 运行 `npm run lint` 与 `npm run lint:test-quality`，确认新增测试不含裸 mock 调用断言或纯 store CRUD 往返。
- [x] 6.5 使用脱敏首页 fixture 做一次后端到 SearchResult 的行为集成验证，并在可用时通过 Electron 搜索页手工确认五栏展示、随机按钮和人机验证边界。
