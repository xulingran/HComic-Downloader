## 为什么

弹窗登录（hcomic / jm / copymanga）目前只支持"用户手动关窗 → 在 `close` 事件里隐式提取 cookie"。"触发提取"这个动作对用户是隐形的——必须知道"登录完关窗才会取 cookie"。对不熟悉的用户，要么关窗前犹豫、要么关早了被静默取消（看到的就是"什么都没发生"）。把"触发提取"变成一个**显式可见的按钮**，能让用户掌控流程、并在成功后自动收尾（倒数 5 秒关窗），同时保留关窗作为静默兜底。

## 变更内容

- **新增**：在登录弹窗内注入一层**右上角浮标叠层**（Shadow DOM，closed mode），承载显式的 cookie 提取触发入口。
  - 收起态为右上角小圆点（不挡登录表单），hover/click 展开为半透明深色卡片。
  - 卡片含主按钮「我已登录」+ 提示「登录后点此获取凭证」。
  - 点击触发提取：成功 → 卡片切到「✅ 登录成功」+ 倒数 5 秒（可取消）→ 倒数结束自动关窗。
  - 未登录/提取异常 → 卡片显示原因，保持开窗，可重试。
  - 浮标可拖动，避免遮挡不同站点的登录表单。
- **新增**：主进程侧抽取可复用的提取编排（叠层与关窗两条路径共用），并增加 IPC 让叠层触发提取、回报结果、请求关窗。
- **保留不动**：现有"关窗即提取"逻辑作为静默兜底；新增 `ctx.alreadySucceeded` 标志防止"叠层已成功后用户又点 ✕"导致二次提取。
- 仅作用于 hcomic / jm / copymanga 三个走弹窗的来源；moeimg / bika 走账号密码，不受影响。

## 功能 (Capabilities)

### 新增功能
- `login-overlay`: 登录弹窗内的右上角浮标叠层——视觉形态（收起圆点 / 展开卡片 / 提取中 / 倒数）、状态机、拖动、与主进程的 IPC 交互契约（触发提取、接收结果、倒数后请求关窗）、Shadow DOM 隔离。

### 修改功能
- `login-window`: 抽取可复用的提取编排函数供叠层与关窗两条路径共用；新增 IPC channel（`login:extract` / 通知 / `login:finish`）；ctx 增加 `alreadySucceeded` 标志协调两条触发路径；保留关窗提取作为静默兜底。

## 影响

- **代码**：
  - `electron/login-preload.ts`（主要工作量：注入 Shadow DOM 叠层 + 状态机 + 倒数 + 拖动 + IPC 绑定）
  - `electron/login-window.ts`（抽 `triggerExtraction`、新增 IPC handler、ctx 加 `alreadySucceeded`）
  - `electron/main.ts`（注册新 IPC channel）
  - `shared/types.ts`（新增 channel 常量）
  - `electron/csp-relaxed-registry.ts`（确认叠层 inline 样式不被 CSP 拦——叠层用 Shadow DOM 内联，宽松 CSP 已含 unsafe-eval，预期无需改）
- **测试**：
  - `tests/unit/main/login-window.test.ts`（叠层触发路径、`alreadySucceeded` 去重、倒数关窗）
  - 新增 `tests/unit/preload/login-preload.test.ts`（Shadow DOM 注入、状态机、倒数、IPC 调用、拖动）
- **依赖**：无新增。
- **契约**：新增登录窗专用 IPC channel（不进主窗口 `window.hcomic` API），主窗口 API 不变。
