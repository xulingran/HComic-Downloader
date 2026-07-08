## 修改需求

### 需求:浮标叠层必须实现四态状态机

浮标叠层必须实现四个互斥状态：`idle`（胶囊按钮）、`extracting`（提取中）、`counting`（倒数关窗）、`error`（错误卡片，仅失败时出现）。状态转换必须确定、不可卡死，每个状态必须有明确的出口。**禁止**保留原 `expanded` 态作为点击触发前的中间确认步骤——idle 态单击必须直接进入 extracting，不得经过任何"先展开再确认"的二次点击。

- 胶囊态（idle）：右上角显眼胶囊按钮，带渐变背景与文字「✓ 我已登录」（登录模式）/「✓ 我已完成验证」（挑战模式）；单击直接转 extracting 态并触发凭证提取。
- 提取中态（extracting）：胶囊变形为卡片，按钮 disabled + 转圈，提示「正在获取凭证… / 正在确认验证状态…」；收到主进程结果后转 counting（成功）或 error（失败）。
- 错误态（error）：220px 卡片，含标题 + ✕ 关闭（点 ✕ 回 idle 胶囊态）+ 错误 hint 文案 + 「重试」按钮（click → extracting）。
- 倒数态（counting）：显示「✅ 登录成功 / ✅ 验证成功」+ 大号数字（3→2→1，每秒减 1）+ 「N 秒后自动关闭」+ 「取消」按钮；倒数到 0 请求关窗；点「取消」回 idle 胶囊态。

#### 场景:胶囊态单击直接触发提取

- **当** 叠层处于 `idle` 胶囊态
- **且** 用户单击胶囊按钮
- **那么** 叠层必须直接切换为 `extracting` 态
- **且** 必须通过 `ipcRenderer.invoke(IPC_CHANNELS.LOGIN_EXTRACT, source)` 触发主进程提取
- **且** 该 invoke 必须返回一个"已受理"快响应（不得阻塞到提取完成）
- **且** 禁止存在任何"先展开为卡片再点按钮"的中间态

#### 场景:提取成功转倒数

- **当** 叠层处于 `extracting` 态
- **且** 收到 `NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT` 且 `success: true`
- **那么** 叠层切换为 `counting` 态
- **且** 倒数从 3 开始每秒减 1

#### 场景:提取未登录展开错误卡片可重试

- **当** 叠层处于 `extracting` 态
- **且** 收到 `LOGIN_EXTRACT_RESULT` 且 `notLoggedIn: true`
- **那么** 叠层必须切换为 `error` 卡片态
- **且** 在 hint 位置显示客观文案「未检测到登录状态」（挑战模式可附加"请先在当前窗口登录"）
- **且** 必须提供「重试」按钮且按钮保持可用（允许再次点击重新触发提取）
- **且** 必须提供 ✕ 关闭按钮（click 回 idle 胶囊态）

#### 场景:提取异常展开错误卡片可重试

- **当** 叠层处于 `extracting` 态
- **且** 收到 `LOGIN_EXTRACT_RESULT` 且 `success: false` 且无 `notLoggedIn`
- **那么** 叠层必须切换为 `error` 卡片态并显示 message 中的错误文案
- **且** 必须提供「重试」按钮且按钮保持可用
- **且** 必须提供 ✕ 关闭按钮（click 回 idle 胶囊态）

#### 场景:错误卡片点重试重新触发提取

- **当** 叠层处于 `error` 卡片态
- **且** 用户点击「重试」按钮
- **那么** 叠层必须切换为 `extracting` 态
- **且** 必须再次通过 `ipcRenderer.invoke(IPC_CHANNELS.LOGIN_EXTRACT, source)` 触发主进程提取

#### 场景:错误卡片点 ✕ 收起为胶囊

- **当** 叠层处于 `error` 卡片态
- **且** 用户点击卡片右上角 ✕
- **那么** 叠层必须切换回 `idle` 胶囊态

#### 场景:倒数到 0 请求关窗

- **当** 叠层处于 `counting` 态
- **且** 倒数减到 0
- **那么** 通过 `ipcRenderer.invoke(IPC_CHANNELS.LOGIN_FINISH)` 请求主进程关闭登录窗
- **且** 停止倒数定时器

#### 场景:倒数可取消回胶囊态

- **当** 叠层处于 `counting` 态
- **且** 用户点击「取消」按钮
- **那么** 停止倒数定时器
- **且** 切换回 `idle` 胶囊态
- **且** 不得发送 `LOGIN_FINISH`（保持窗口开）

#### 场景:extracting 态防抖禁止重复触发

- **当** 叠层处于 `extracting` 态
- **且** 用户重复点击（胶囊已变形为卡片，按钮 disabled）
- **那么** 禁止再次触发 `LOGIN_EXTRACT` invoke
- **且** 必须保持 extracting 态直到主进程推回结果

### 需求:浮标叠层必须固定在右上角不可拖动

浮标叠层（胶囊态按钮、extracting/counting/error 卡片态）必须固定在视口右上角（`position:fixed; top:12px; right:12px`），**禁止**支持任何形式的指针拖动。叠层 host 的 `top`/`left`/`right` 定位必须保持初始值不变，禁止因指针事件改变。切换状态（idle 胶囊 → extracting → counting → error）时叠层必须始终在右上角原位呈现，禁止偏移产生视觉错位。浮标不得出现 `cursor: grab` / `cursor: grabbing` 等暗示可拖动的视觉提示。胶囊态的 `click → 直接提取` 行为必须直接生效，禁止被任何拖动吞咽逻辑拦截。

#### 场景:叠层始终固定在右上角

- **当** 叠层注入到登录/验证弹窗文档
- **那么** host 必须以 `position:fixed; top:12px; right:12px; z-index:2147483647` 定位
- **且** 在整个文档生命周期内该定位禁止被任何指针交互改变

#### 场景:指针拖动不移动叠层

- **当** 用户在胶囊按钮或卡片顶栏上 `pointerdown` 后移动指针（无论距离是否超过位移阈值）
- **那么** `host.style.top` / `host.style.left` / `host.style.right` 必须保持初始值不变
- **且** 禁止存在 `bindDrag` / 拖动位移阈值（`DRAG_THRESHOLD_PX`）/ 拖动吞咽 click 等机制

#### 场景:胶囊点击直接触发不被吞咽

- **当** 用户在 idle 胶囊按钮上 `pointerdown` 后在任意位置 `pointerup`（含轻微移动）
- **那么** 该交互必须被视为 click
- **且** 叠层必须切换为 `extracting` 态并触发凭证提取
- **且** 禁止因「曾发生过指针移动」而吞咽 click、阻止提取触发

#### 场景:导航后仍回默认右上角

- **当** 登录窗导航到新文档（preload 重注入）
- **那么** 新文档的浮标回到默认右上角位置（`top:12px; right:12px`）
- **且** 不读取任何持久化的位置

#### 场景:不呈现可拖动视觉提示

- **当** 叠层渲染胶囊态按钮或卡片顶栏
- **那么** 这些元素禁止使用 `cursor: grab` / `cursor: grabbing`
- **且** 胶囊按钮必须使用 `cursor: pointer`（提示可点击触发），卡片顶栏使用默认光标

### 需求:浮标叠层视觉必须自带配色不依赖站点 CSS

叠层 host 与内部元素必须使用自带配色（胶囊按钮渐变蓝 `linear-gradient(135deg, #3b82f6, #2563eb)`；卡片 `rgba(17,24,39,.92)` + `backdrop-filter:blur(8px)`，文字 `#f9fafb`，主按钮 `#3b82f6`，成功 `#10b981`，错误 `#ef4444`），不得引用第三方站点的 CSS 变量或类名。样式必须通过 Shadow DOM 内的 `<style>` 元素注入（非内联 `style` 属性），`position:fixed; z-index:2147483647`。

#### 场景:叠层在任意第三方站点呈现一致样式

- **当** 叠层注入到 h-comic / 18comic / copymanga 任意站点
- **那么** 叠层配色与布局必须一致（不受站点 CSS 影响）
- **且** host 的 `z-index` 必须为 2147483647 以避免被站点模态盖住

#### 场景:样式用 shadow 内 style 元素注入

- **当** 叠层构建完成
- **那么** 所有样式规则必须位于 shadow root 内的 `<style>` 元素中
- **且** 不得依赖 `style-src 'unsafe-inline'`（避免被 CSP `style-src` 拦截）

#### 场景:胶囊按钮视觉显眼可识别

- **当** 叠层渲染 idle 胶囊态
- **那么** 胶囊必须使用渐变蓝色背景（非半透明深色）以区别于站点内容
- **且** 必须包含文字「✓ 我已登录」（登录模式）或「✓ 我已完成验证」（挑战模式）
- **且** 胶囊点击区域必须明显大于原 28px 圆点（高度 ≥ 32px）以提高可发现性
