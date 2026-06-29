## 为什么

登录弹窗叠层在 cookie 提取成功 / JM 人机验证成功后进入倒数态，从 5 秒倒数到 0 再自动关窗。用户已明确成功，5 秒等待偏长，体验拖沓；缩短为 3 秒可让成功反馈更快收尾，同时仍保留可中途取消的窗口。

## 变更内容

- 将登录弹窗叠层（`electron/login-preload.ts`）的成功自动关窗倒数起始秒数从 5 秒改为 3 秒。
- 此常量 `COUNTDOWN_START` 同时驱动两个场景：
  1. **普通登录模式**（cookie 提取成功后的自动关窗）。
  2. **JM 人机验证模式**（手动验证成功后的自动关窗）。
- 两场景共用同一个倒数函数与起始秒数，改一处即同时生效。
- 同步更新相关注释、规范文字与单测断言（5→3）。

## 功能 (Capabilities)

### 新增功能

（无）

### 修改功能

- `login-overlay`: 浮标叠层倒数态的起始秒数从 5 秒改为 3 秒（普通登录与 JM 人机验证两个场景均受影响）。

## 影响

- **代码**：`electron/login-preload.ts`（`COUNTDOWN_START` 常量值）。`electron/login-window.ts` 中描述渲染端倒数的注释需同步（仅文档，无逻辑影响）。
- **规范**：`openspec/specs/login-overlay/spec.md`（倒数起始秒数的两处文字描述）。
- **测试**：`tests/unit/preload/login-preload.test.ts`（多处断言数字 `5` 与时间 `5_000`ms）。
- **API/依赖**：无变化（纯前端叠层行为调整，不涉及 IPC 通道或 Python 后端）。
- **主进程兜底**：`LOGIN_FINISH_FALLBACK_MS = 10_000` 保持不变（仍留足余量，不受倒数缩短影响）。
