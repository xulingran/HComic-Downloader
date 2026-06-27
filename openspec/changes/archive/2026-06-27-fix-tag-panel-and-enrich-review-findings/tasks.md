## 1. 标签面板排序与异步一致性

- [x] 1.1 修改 `mergeTagSources` 接收当前排序方式，并分别实现 popular 与 name 的最终稳定排序
- [x] 1.2 调整来源切换逻辑，使新来源首次读取直接使用默认 popular，避免用旧排序发起多余请求
- [x] 1.3 为普通读取和刷新后的重新读取增加 latest-wins 请求版本校验，禁止过期响应更新 tags/loading/refreshing

## 2. NH 标签搜索语义

- [x] 2.1 调整搜索页标签选择编排，使 NH 从 keyword、ranking 或 tag 上下文选择标签时统一切换为 tag 模式并同步 state/ref
- [x] 2.2 调整 NH 清空标签后的状态与搜索参数，确保不会继续携带已取消标签或错误恢复 popular 语义
- [x] 2.3 核对并保留 `_build_nh_tag_query` 的单标签、多标签、去重和引号转义行为

## 3. 详情抽屉 enrich 状态反馈

- [x] 3.1 将 enrich 失败 UI 的条件收紧为 error 且无可展示标签
- [x] 3.2 为 loading 状态提供独立的中性提示，并确保首次加载及重试期间不显示失败文案或重试按钮

## 4. 回归测试与验证

- [x] 4.1 增加 `useTagPanel` 测试，覆盖 A-Z 最终顺序、popular 顺序以及较晚返回的旧排序/旧来源响应被忽略
- [x] 4.2 增加搜索页测试，覆盖从 NH 最近更新和热门排行标签弹窗选择标签时发起 tag 模式搜索
- [x] 4.3 扩展 `ComicInfoDrawer` 测试，使用未决 Promise 验证 loading 期间不误报失败，并验证重试状态转换
- [x] 4.4 运行相关 Python/前端测试、`npx tsc --noEmit`、ESLint、ruff 与格式检查
