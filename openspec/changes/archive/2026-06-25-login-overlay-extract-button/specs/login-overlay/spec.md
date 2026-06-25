## ADDED Requirements

### 需求:登录弹窗必须注入右上角浮标叠层

`electron/login-preload.ts` 必须在登录弹窗的每个文档加载后注入一个右上角浮标叠层（host 元素 `id="hcomic-login-overlay"`），承载显式的 cookie 提取入口。叠层必须通过 Shadow DOM（`attachShadow({mode:'closed'})`）实现，与第三方站点 CSS / JS 双向隔离。叠层注入逻辑必须用 try/catch 包裹，注入失败仅记录错误、不得阻断页面加载或现有 prototype 补丁逻辑。

#### 场景:preload 注入叠层并去重

- **当** 登录窗 preload 在新文档加载后执行
- **那么** `document.getElementById('hcomic-login-overlay')` 必须能找到叠层 host
- **且** 同一文档内多次执行注入逻辑时必须跳过（不得重复创建 host）

#### 场景:body 未就绪时延后注入

- **当** preload 执行时 `document.body` 尚不存在
- **那么** 必须监听 `DOMContentLoaded`，在 body 就绪后再注入
- **且** 不得在 body 不存在时抛错

#### 场景:叠层用 closed Shadow DOM 隔离

- **当** 叠层 host 创建后
- **那么** host 的 `shadowRoot` 必须为 `null`（closed mode）
- **且** 第三方页面脚本必须无法通过 `host.shadowRoot` 或 `element.querySelector` 访问到叠层内部节点

#### 场景:注入异常不阻断页面

- **当** 注入逻辑抛出异常（如 document 被导航销毁）
- **那么** 异常必须被 try/catch 吞掉并 `console.error` 记录
- **且** 现有的 prototype 补丁（MutationObserver / jm"我的"入口）必须仍被执行

### 需求:浮标叠层必须实现四态状态机

浮标叠层必须实现四个互斥状态：`idle`（收起圆点）、`expanded`（展开卡片）、`extracting`（提取中）、`counting`（倒数关窗）。状态转换必须确定、不可卡死，每个状态必须有明确的出口。

- 收起态：右上角 28px 圆点；hover 或 click 转为展开态。
- 展开态：220px 半透明深色卡片，含提示「登录后点此获取凭证」+ 主按钮「我已登录」+ 右上角 ✕（点 ✕ 回收起态）；点「我已登录」转提取中态。
- 提取中态：按钮 disabled + 转圈，其余控件禁用；收到主进程结果后转 counting 或回 expanded。
- 倒数态：显示「✅ 登录成功」+ 大号数字（5→4→3→2→1，每秒减 1）+ 「N 秒后自动关闭」+ 「取消」按钮；倒数到 0 请求关窗；点「取消」回 expanded 态。

#### 场景:收起态 hover/click 展开

- **当** 叠层处于 `idle` 态
- **且** 用户 hover 或 click 圆点
- **那么** 叠层切换为 `expanded` 态，展示卡片内容

#### 场景:展开态点 ✕ 收起

- **当** 叠层处于 `expanded` 态
- **且** 用户点击卡片右上角 ✕
- **那么** 叠层切换回 `idle` 态

#### 场景:展开态点「我已登录」转提取中

- **当** 叠层处于 `expanded` 态
- **且** 用户点击「我已登录」按钮
- **那么** 叠层切换为 `extracting` 态
- **且** 通过 `ipcRenderer.invoke(IPC_CHANNELS.LOGIN_EXTRACT, source)` 触发主进程提取
- **且** 该 invoke 必须返回一个"已受理"快响应（不得阻塞到提取完成）

#### 场景:提取成功转倒数

- **当** 叠层处于 `extracting` 态
- **且** 收到 `NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT` 且 `success: true`
- **那么** 叠层切换为 `counting` 态
- **且** 倒数从 5 开始每秒减 1

#### 场景:提取未登录保持开窗可重试

- **当** 叠层处于 `extracting` 态
- **且** 收到 `LOGIN_EXTRACT_RESULT` 且 `notLoggedIn: true`
- **那么** 叠层切换回 `expanded` 态
- **且** 在提示位置显示客观文案「未检测到登录状态」
- **且** 「我已登录」按钮保持可用（允许再次点击重试）

#### 场景:提取异常保持开窗可重试

- **当** 叠层处于 `extracting` 态
- **且** 收到 `LOGIN_EXTRACT_RESULT` 且 `success: false` 且无 `notLoggedIn`
- **那么** 叠层切换回 `expanded` 态并显示 message 中的错误文案
- **且** 「我已登录」按钮保持可用

#### 场景:倒数到 0 请求关窗

- **当** 叠层处于 `counting` 态
- **且** 倒数减到 0
- **那么** 通过 `ipcRenderer.invoke(IPC_CHANNELS.LOGIN_FINISH)` 请求主进程关闭登录窗
- **且** 停止倒数定时器

#### 场景:倒数可取消

- **当** 叠层处于 `counting` 态
- **且** 用户点击「取消」按钮
- **那么** 停止倒数定时器
- **且** 切换回 `expanded` 态
- **且** 不得发送 `LOGIN_FINISH`（保持窗口开）

### 需求:浮标叠层必须可拖动以避免遮挡登录表单

收起态圆点与展开态卡片顶栏必须支持拖动（pointer 事件：`pointerdown` 记录指针与 host 偏移、`pointermove` 更新 `host.style.top/left`、`pointerup` 结束）。拖动不得与"click 展开"冲突（需用位移阈值区分点击与拖动）。拖动后的位置仅在当前文档生命周期内保持；导航到新文档后浮标回默认右上角（不持久化）。

#### 场景:拖动改变浮标位置

- **当** 用户在圆点或卡片顶栏 `pointerdown` 后移动指针超过位移阈值
- **那么** `pointermove` 期间持续更新 host 的 `top`/`left`
- **且** 不触发 click（不误展开/收起）

#### 场景:点击不触发拖动

- **当** 用户 `pointerdown` 后在位移阈值内 `pointerup`
- **那么** 视为 click（按当前态执行展开/收起）
- **且** 不改变 host 位置

#### 场景:导航后位置重置

- **当** 登录窗导航到新文档（preload 重注入）
- **那么** 新文档的浮标回到默认右上角位置（`top:12px; right:12px`）
- **且** 不读取任何持久化的位置

### 需求:浮标叠层视觉必须自带配色不依赖站点 CSS

叠层 host 与内部元素必须使用自带配色（host 卡片 `rgba(17,24,39,.92)` + `backdrop-filter:blur(8px)`，文字 `#f9fafb`，主按钮 `#3b82f6`，成功 `#10b981`，错误 `#ef4444`），不得引用第三方站点的 CSS 变量或类名。样式必须通过 Shadow DOM 内的 `<style>` 元素注入（非内联 `style` 属性），`position:fixed; z-index:2147483647`。

#### 场景:叠层在任意第三方站点呈现一致样式

- **当** 叠层注入到 h-comic / 18comic / copymanga 任意站点
- **那么** 叠层配色与布局必须一致（不受站点 CSS 影响）
- **且** host 的 `z-index` 必须为 2147483647 以避免被站点模态盖住

#### 场景:样式用 shadow 内 style 元素注入

- **当** 叠层构建完成
- **那么** 所有样式规则必须位于 shadow root 内的 `<style>` 元素中
- **且** 不得依赖 `style-src 'unsafe-inline'`（避免被 CSP `style-src` 拦截）
