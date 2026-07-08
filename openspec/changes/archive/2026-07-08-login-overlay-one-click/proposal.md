## 为什么

登录弹窗叠层当前要求用户**两次点击**才能触发凭证提取：先点右上角 28×28 的小圆点展开卡片，再点卡片里的「我已登录 / 我已完成验证」按钮。这个中间展开态既增加操作步骤，又因为小圆点本身体积小、半透明深色、用 `✓` 符号容易让人误以为"已经完事了"，导致用户难以发现入口、发现后也要多点一次。用户体验与"显式确认入口"的初衷（防止误触发）并不匹配——一次明确的胶囊按钮点击已经足够表达用户意图。

## 变更内容

- **移除 `expanded` 作为点击触发前的中间态**：`idle` 态点击直接进入 `extracting`，不再经过"先展开卡片再点按钮"。
- **把 `idle` 态从 28×28 小圆点改为显眼的胶囊按钮**：带渐变背景 + 文字「✓ 我已登录 / 我已完成验证」，单击即触发提取。失败/未登录时胶囊变形为展开卡片展示错误信息 + 重试按钮，让用户知道为什么失败并能再试。
- **保留固定右上角、不可拖动、Shadow DOM 隔离、自带配色、四窗口模式文案**等既有约束。
- 成功路径（counting 倒数关窗）不变。

## 功能 (Capabilities)

### 新增功能

（无）

### 修改功能

- `login-overlay`: 状态机从四态（idle/expanded/extracting/counting）改为 idle 态直接一步触发 extracting；idle 态视觉从 28px 圆点改为带文字的胶囊按钮；失败反馈从"回 expanded 卡片"改为"展开 error 卡片含重试按钮"。倒数关窗、Shadow DOM 隔离、固定定位、模式文案等需求维持。

## 影响

- **代码**：`electron/login-preload.ts` 的 `buildOverlay` 状态机（`renderDot` / `renderExpanded` / `setState` / `onExtractClick` / `onExtractResult` / `cancelCountdown`）和 `OVERLAY_STYLES` CSS。
- **测试**：`tests/unit/preload/login-preload.test.ts` 现有 20+ 个测试用例基于"两步路径"（dot click → expanded → btn click → extracting），需重写为"一步路径"（胶囊 click → extracting），失败路径改为"error card → 重试 → extracting"。
- **主进程**：`electron/login-window.ts` 的 IPC handler（`LOGIN_EXTRACT` / `LOGIN_FINISH` / `LOGIN_EXTRACT_RESULT`）和提取链**不变**——渲染端只是少了一个中间态，主进程协议保持兼容。
- **无破坏性 API 变更**：IPC 通道、preload 顶层副作用、host 元素 id 均不变。
