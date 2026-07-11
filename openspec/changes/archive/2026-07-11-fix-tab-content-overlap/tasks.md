## 1. 动画契约与回归测试骨架

- [x] 1.1 在 `src/lib/anim.ts` 中定义 Tab fade-through 的 150ms 半阶段 transition、方向感知的进入起点/最终目标和退出目标，并删除同步 crossfade 专用目标
- [x] 1.2 更新 `tests/unit/anim.test.ts`，验证左右方向的 ±8% 位移、进入/退出各 150ms、总时长 300ms，以及 reduced-motion 不返回位移或透明度动画
- [x] 1.3 为 Tab 页面容器补充可观察的 phase/display 测试接口，并先建立“任意时刻最多一个页面真实内容可见”的回归断言

## 2. 集中式 Tab 过渡协调

- [x] 2.1 在 `App` 层实现 `desiredPage`、`visiblePage`、`idle/exiting/entering`、方向和过渡身份组成的集中状态机，侧边栏点击与程序化跳转统一进入该状态机
- [x] 2.2 重构 `KeepAlivePage`，保留每页独立 `AnimationControls` 和组件实例存活，但移除各页面自行并发启动进入/退出及无条件 Promise 收尾的逻辑
- [x] 2.3 实现顺序阶段：旧页单独退出并隐藏后，目标页设置进入起点、显示并单独进入；确保中点切换在统一背景上完成且不出现双页内容叠加
- [x] 2.4 实现首屏直接可见与首次访问目标隐藏挂载，确保首次访问在 controls 已绑定后进入且不会重现永久 opacity 为 0 的白屏
- [x] 2.5 实现 latest-intent-wins：退出阶段合并到最新目标、进入阶段结束后继续最新请求，并让过期动画完成结果失效
- [x] 2.6 实现 reduced-motion 的瞬时单页切换，同时保留 keep-alive、最新目标和同页点击无动画语义

## 3. 行为测试

- [x] 3.1 更新 `tests/unit/App.test.tsx`，使用可控动画完成时机分别断言退出阶段仅旧页可见、进入阶段仅新页可见、完成后仅目标页可见
- [x] 3.2 覆盖首次访问、切回已访问页面、左右方向、同页点击、`onNavigateToSettings` 与 `pendingSearch` 程序化跳转
- [x] 3.3 覆盖退出阶段与进入阶段的快速连续点击，断言 latest-intent-wins、过时中间页不显示、旧完成回调不隐藏当前页
- [x] 3.4 覆盖 reduced-motion 瞬时切换以及首屏无动画、无白屏行为
- [x] 3.5 复核既有 keep-alive 测试，确认页面实例、本地状态、滚动位置和页面内 stagger 不因本次重构重新挂载

## 4. 验证与质量闸门

- [x] 4.1 运行 Tab 动画相关 Vitest 定向用例并确认新增回归测试通过
- [x] 4.2 运行 `npx tsc --noEmit` 与 `npm test`
- [x] 4.3 运行 `npm run lint` 和 `npm run lint:test-quality`
- [x] 4.4 运行 `pytest`、`npm run lint:py` 与 `npm run format:py`，确认完整提交前验证流程无回归
- [x] 4.5 运行 `openspec-cn validate fix-tab-content-overlap --strict` 并确认变更产出物严格验证通过
