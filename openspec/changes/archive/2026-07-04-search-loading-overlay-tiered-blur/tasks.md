## 1. 遮罩强度状态

- [x] 1.1 在 `src/pages/SearchPage.tsx` 顶部组件 state 区新增 `overlayIntensity: 'light' | 'strong' | null`（初始 null），及其 setter。
- [x] 1.2 在 `withLoading`（第 364-413 行）内，`setLoading(true)` 前根据 `opts.keepExisting` 设置强度：`keepExisting` → `'light'`，否则 → `'strong'`。在 `finally` 的 `setLoading(false)` 处同步清空为 null（仅当 gen 匹配时）。
- [x] 1.3 在 `handleSourceChange`（第 587-600 行）认证窗口：`setLoading(true)` 前显式设置强度为 `'strong'`；校验失败转 `setNeedsLogin(true)` 分支与 `setLoading(false)` 处同步清空强度；校验通过后进入 `withLoading(...)`，强度由 `withLoading` 的 `keepExisting=false` 自然设为 `'strong'`。

## 2. 遮罩渲染层

- [x] 2.1 修改 `SearchPage.tsx` 第 907-912 行遮罩 DOM：根据 `overlayIntensity` 渲染对应 class。文案统一「加载中...」（不与 SearchBar 按钮的「搜索中...」撞车）。定义组件内常量映射：
  ```
  light:   bg-[var(--bg-primary)]/40  backdrop-blur-[2px]   「加载中...」
  strong:  bg-[var(--bg-primary)]/85  backdrop-blur-[10px]  「加载中...」
  ```
- [x] 2.2 渲染条件保持 `isLoading && filteredComics.length > 0`，但额外确保 `overlayIntensity !== null` 时才渲染（防御性：强度未设置则退回 light 默认值，避免状态不同步导致无遮罩）。

## 3. 边界与一致性

- [x] 3.1 核对初始化挂载路径的 `setLoading` 调用（第 194、297 行）是否会触发遮罩渲染——若这些路径 `filteredComics.length === 0` 则不渲染遮罩（走骨架），强度 state 可不设置；若有旧结果残留风险，补设强度为 `'strong'`。
- [x] 3.2 确认 `handleRandom` / `handleCategory` / `handleNhEntry` / `handleNhRanking` / `handleNhTag`（第 463-543 行）等走 `withLoading` 的路径在 `keepExisting` 缺省（即 false）时强度自动为 `'strong'`，无需单独标注。
- [x] 3.3 确认翻页路径 `handleSearch`（第 450 行）`isPaging` 为 true 时强度为 `'light'`，缓存命中分支（第 426-444 行）不触发遮罩（因不进 `withLoading` 的 setLoading 流程）。

## 4. 测试

- [x] 4.1 新增/更新前端测试（`tests/unit/pages/SearchPage.test.tsx`）：覆盖 `withLoading` 在 `keepExisting: true/false` 下设置不同 `overlayIntensity` 的真实 DOM 渲染差异（断言遮罩容器的 className 包含 `backdrop-blur-[2px]`（light）或 `backdrop-blur-[10px]`（strong），以及背景不透明度 class）。遵守 `test-quality-gate`——必须断言真实 DOM/状态，禁止仅断言 mock 被调用。
- [x] 4.2 测试 `handleSourceChange` 切换到认证来源（jm）时，校验窗口期间遮罩 DOM 为 strong 档（含 `backdrop-blur-[10px]`）；校验失败转登录态时强度被清空、遮罩不残留。
- [x] 4.3 测试翻页（`keepExisting: true`）时遮罩为 light 档（className 含 `backdrop-blur-[2px]` 与 `bg-[var(--bg-primary)]/40`）。

## 5. 验证

- [x] 5.1 `npm test` 通过（前端测试）。
- [x] 5.2 `npx tsc --noEmit` 通过（类型检查）。
- [x] 5.3 `npm run lint` 通过（ESLint）。
- [x] 5.4 `npm run lint:test-quality` 通过（测试质量闸门）。
- [x] 5.5 手动验证（`npm run dev`）：
  - 翻页：旧结果可读，轻遮罩（blur-2px + bg/40）。
  - 切换来源（hcomic→jm）：认证窗口重遮罩（blur-10px + bg/85），通过后进入搜索加载保持 strong。
  - 同来源新搜索/随机：重遮罩。
  - 切换到 bika/nh 未认证：直接骨架，无遮罩（现有行为不变）。
- [x] 5.6 `openspec-cn validate search-loading-overlay-tiered-blur --strict` 通过。
