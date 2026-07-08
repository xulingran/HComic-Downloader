## 1. 状态机重构（login-preload.ts）

- [x] 1.1 把 `OverlayState` 类型从 `'idle' | 'expanded' | 'extracting' | 'counting'` 改为 `'idle' | 'extracting' | 'counting' | 'error'`（移除 `expanded` 作为触发前中间态，新增 `error` 态）
- [x] 1.2 重写 `renderDot` 为 `renderPill`：渲染胶囊按钮（渐变蓝背景 `linear-gradient(135deg, #3b82f6, #2563eb)`，白色文字「✓ 我已登录 / ✓ 我已完成验证」，高度 ≥ 32px，圆角 18px），click 直接调用 `onExtractClick`（不再切到 expanded）
- [x] 1.3 重写 `setState`：`idle` 渲染胶囊；`extracting` 渲染提取中卡片（disabled + spinner）；`counting` 渲染倒数（不变）；`error` 渲染错误卡片（复用 `renderCard`，含 ✕ 关闭回 idle + 重试按钮回 extracting）。移除原 `expanded` 分支与"hover/click 圆点展开"逻辑。
- [x] 1.4 重写 `onExtractClick`：移除 `if (state !== 'expanded') return` 守卫（因为胶囊态直接调用）；保留 invoke `LOGIN_EXTRACT` + catch 回 error 态的逻辑
- [x] 1.5 重写 `onExtractResult`：成功 → counting（不变）；notLoggedIn / 其他失败 → 切到 `error` 态并展示对应 hint 文案（复用 `renderExpanded` 的文案逻辑，但渲染为 error 卡片）
- [x] 1.6 修改 `cancelCountdown`：倒数取消回 `idle` 胶囊态（而非原 expanded）
- [x] 1.7 error 卡片的 ✕ 关闭按钮与重试按钮：✕ → `setState('idle')`；重试 → `onExtractClick`

## 2. CSS 样式更新（login-preload.ts OVERLAY_STYLES）

- [x] 2.1 移除 `.dot` 样式（28px 圆点），新增 `.pill` 样式：渐变蓝背景、白色文字、`cursor: pointer`、padding、圆角、阴影、hover 微缩放
- [x] 2.2 保留 `.card` / `.head` / `.close` / `.hint` / `.btn` / `.count-num` / `.count-label` / `.count-cancel` / `.spinner` 样式（error 卡片与 counting 复用）
- [x] 2.3 确认 `.hint.err` 红色样式保留（error 态展示失败 message）

## 3. 测试重写（tests/unit/preload/login-preload.test.ts）

- [x] 3.1 重写「overlay state machine」describe 块：所有"dot click → expanded → btn click → extracting"两步路径改为"胶囊 click → extracting"一步路径；断言 `.pill` 选择器而非 `.dot`
- [x] 3.2 新增 error 态测试：notLoggedIn → error 卡片展示「未检测到登录状态」+ 重试按钮可用；其他失败 → error 卡片展示 message；重试按钮 click → 触发 LOGIN_EXTRACT；error 卡片 ✕ click → 回 idle 胶囊态
- [x] 3.3 更新 counting 取消测试：取消后回 idle 胶囊态（`.pill`）而非 expanded（`.card`）
- [x] 3.4 重写「overlay fixed (undraggable)」describe 块：把 `.dot` 选择器改为 `.pill`，断言胶囊点击直接触发提取（不再断言"展开为 card"）
- [x] 3.5 重写「challenge mode overlay」describe 块：移除"先展开再看 title/button/hint"的步骤，改为直接断言胶囊文字「✓ 我已完成验证」；challenge 提交失败 → error 卡片；extracting 防抖不变
- [x] 3.6 重写「login mode wording regression」describe 块：断言胶囊文字「✓ 我已登录」而非展开后按钮文字
- [x] 3.7 确认 ipc-channel-consistency 测试与 login-window.test.ts 仍通过（IPC 协议未变，应零改动）

## 4. 验证

- [x] 4.1 运行 `npm test`（前端 vitest），确认 login-preload 相关测试全部通过
- [x] 4.2 运行 `npx tsc --noEmit`，确认 TypeScript 类型检查通过（`OverlayState` 类型变更不引入类型错误）
- [x] 4.3 运行 `npm run lint`，确认 ESLint 通过（含 test-quality 闸门——新测试必须验证真实行为而非裸 mock 调用断言）
- [x] 4.4 手动验证（可选）：`npm run dev` 启动，打开登录弹窗，确认胶囊按钮显眼可见、单击直接触发提取、失败展示错误卡片可重试
