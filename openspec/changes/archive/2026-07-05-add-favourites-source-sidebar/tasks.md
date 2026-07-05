## 1. 来源侧边栏组件

- [x] 1.1 新建 `src/components/favourites/FavouriteSourceSidebar.tsx`，严格从 `SOURCES_WITH_FAVOURITES` 与 `SOURCE_LABELS` 渲染 HComic、MoeImg、JM、哔咔四个原生按钮
- [x] 1.2 实现侧边栏标题、150px sticky 导航布局、当前来源 accent 高亮、`aria-current="page"`、可见焦点及 `activeSource=null` 时无选中状态
- [x] 1.3 新增组件单元测试，覆盖来源白名单、拷贝漫画/NH 不出现、选中语义、未选择状态以及鼠标和键盘触发 `onSelect`

## 2. 统一收藏夹来源切换

- [x] 2.1 在 `FavouritesPage` 抽取 `handleSourceChange`，重复点击当前来源时直接返回，切换时更新当前来源并显式通过 `loadFavourites(1, newSource)` 复用缓存/后台刷新路径
- [x] 2.2 让首次来源选择弹窗的确认回调复用统一切换函数，同时保留 `markPickerShown` 与手动重新打开弹窗的既有行为
- [x] 2.3 移除标题旁来源 `<select>` 和不再需要的 `useSources` 依赖，把常驻 `FavouriteSourceSidebar` 接入页面并在 `noSourceSelected` 时传入空 active 状态
- [x] 2.4 确认侧栏切换只更新会话内当前来源，禁止调用 `defaultFavouriteSource` 配置 setter 或其它持久化入口

## 3. 快速切换竞态保护

- [x] 3.1 为用户触发的收藏加载增加递增请求代次或等价上下文令牌，覆盖无缓存请求与缓存后台刷新两条异步路径
- [x] 3.2 允许迟到结果写入其原始 `source + page` 缓存，但仅允许最新活动请求更新可见漫画、分页、登录状态、当前页和下载状态
- [x] 3.3 保持 `usePaginatedPreloader` 的 AbortSignal 中断机制不变，验证来源切换后旧来源相邻页预加载仍不会提交脏缓存
- [x] 3.4 新增延迟 Promise 回归测试，覆盖 HComic 与 JM 连续切换时旧第一页迟到结果不覆盖当前 JM 内容且不写错缓存

## 4. 双侧栏响应式布局

- [x] 4.1 将收藏夹页面根布局改为左侧固定来源导航、右侧 `flex-1 min-w-0` 内容区，并确保侧栏随内容滚动保持 sticky
- [x] 4.2 将卡片网格断点调整为 `grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`，详细列表模式保持不变
- [x] 4.3 为标题、刷新/批量操作组与顶部分页增加合理的 `flex-wrap`、间距和最小宽度约束，防止全局侧边栏展开时重叠或水平溢出
- [x] 4.4 更新页面测试，断言来源下拉框已移除、侧栏切换命中/未命中第一页缓存的行为、重复点击不请求、跳过首次弹窗后无伪选中项

## 5. 回归与验证

- [x] 5.1 运行 `pytest`，确认 Python 回归测试全部通过
- [x] 5.2 运行 `npx tsc --noEmit`，确认 TypeScript 类型检查通过
- [x] 5.3 运行 `npm test`，确认前端单元与回归测试全部通过
- [x] 5.4 运行 `npm run lint:py` 与 `black --check .`，确认 Python lint 和格式检查通过
- [x] 5.5 运行 `npm run lint` 与 `npm run lint:test-quality`，确认 JS/TS lint 和测试质量闸门通过
- [x] 5.6 手动验证默认来源直达、未设置默认来源首次弹窗、跳过后侧栏选择、四来源快速连续切换、全局侧栏展开以及中等窗口下的网格和工具栏布局
