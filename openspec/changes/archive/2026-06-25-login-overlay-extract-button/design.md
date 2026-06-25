## 上下文

弹窗登录（`electron/login-window.ts`）目前对 hcomic / jm / copymanga 三个来源走"用户手动关窗 → `close` 事件里提取 cookie"。提取对用户隐形，新手不知道"关窗才会取 cookie"。当前架构要点：

- 登录窗用 `defaultSession`（便于提取 cookie），preload 为 `electron/login-preload.ts`，跑在 isolated world。
- `login-preload.ts` 现通过 `contextBridge.executeInMainWorld(func)` 在 **main world** 注入两个 prototype 补丁：`MutationObserver.prototype.observe`（屏蔽 jquery.avs 异常）和 jm "我的"入口点击修复。
- 提取链 `extractAndApplyCookies` = `extractCookiesForSource` → `verifyLoginCookies` → `applyAndVerifyAuth`，当前只在 `close` 事件处理器 `bindManualCloseExtraction` 里调用。
- ctx 有 `settled` / `extractInProgress` 双标志防重入，`done()` 用 `destroy()` 收尾。
- 登录窗宽松 CSP 由共享 `csp-relaxed-registry` 注入（`script-src` 含 `'unsafe-eval'`），不靠独立 webRequest 监听器。

## 目标 / 非目标

**目标：**
- 在登录窗内提供**显式可见**的 cookie 提取入口（右上角浮标叠层），不破坏第三方站点登录表单。
- 成功提取后自动倒数 5 秒关窗（可取消），保留关窗作为静默兜底。
- 叠层与第三方站点 CSS / JS 双向隔离。
- 叠层与关窗两条触发路径互不重复提取。
- 不新增运行时依赖、不引入 WebContentsView / BaseWindow 等新窗口形态。

**非目标：**
- 不改 moeimg / bika（走账号密码，无弹窗）。
- 不持久化浮标位置（跨导航回默认位）。
- 不重启 sandbox、不改主窗口 `window.hcomic` API。
- 不为叠层做跨导航状态恢复（倒数中导航会重置，但主进程侧 destroy 照常）。

## 决策

### 决策 1：叠层注入位置——isolated world（preload 顶层），非 main world

**选择**：叠层逻辑放在 `login-preload.ts` 顶层（isolated world），与现有 `executeInMainWorld(func)` 的 prototype 补丁并存。

**理由**：叠层 click 要 `ipcRenderer.invoke`，而 `ipcRenderer` 只在 preload 的 isolated world 可用。DOM 节点两个世界共享，所以 isolated world 创建的 Shadow host 会真实出现在页面上，click handler 闭包留在 isolated world 能拿到 `ipcRenderer`。

**替代方案**：
- 放 main world：`ipcRenderer` 不可用，得靠 `window.postMessage` 桥接到 isolated world，多一层复杂度。否决。
- 独立 `WebContentsView`：项目零先例（grep 无任何 View 用法），双 webContents 定位 + 额外 HTML bundle，复杂度高得多。否决。

### 决策 2：隔离手段——Shadow DOM（closed mode）

**选择**：叠层 host = `position:fixed; z-index:2147483647` 的 div，`attachShadow({mode:'closed'})`，所有结构/样式塞进 Shadow Root。

**理由**：第三方站点 CSS 穿不透 closed shadow（无法被 `host.shadowRoot` 取到），页面 JS 碰不到内部节点；z-index 顶格避免被站点模态盖住。样式全用内联（`<style>` 在 shadow 内）+ 自带配色，不依赖站点 CSS 变量（登录窗是第三方 origin，没有本应用的 `--bg-*` 变量）。

**替代方案**：
- 高 z-index + 唯一类名前缀 + `!important`：z-index 战争、CSS 特异性对抗脆弱。否决。
- iframe + srcdoc：隔离更强但通信要 postMessage，且 Electron 登录窗 preload 不会注入到 srcdoc iframe，叠层失去 ipcRenderer。否决。

### 决策 3：导航后浮标自愈——依赖 preload 重注入，去重守卫

**选择**：preload 顶层调用 `injectOverlay()`，内部：
- `document.getElementById('hcomic-login-overlay')` 已存在 → 跳过；
- `document.body` 不存在 → 等 `DOMContentLoaded` 再试；
- 否则创建 host + closed shadow + 绑定 click。

**理由**：同 frame 导航到新文档时 Electron 会重注入 preload，叠层逻辑重跑一次；去重守卫防止同一文档内多次注入。倒数进行中若发生导航，叠层重置回默认态、倒数中断——但主进程侧的"成功后等待 LOGIN_FINISH"不依赖渲染端倒数，主进程会在收到 `login:finish` 或自身超时收尾，视觉上倒数闪一下即关窗，可接受。

**替代方案**：跨导航恢复倒数状态（主进程回推"剩余秒数"）。收益低、复杂度高，按 YAGNI 不做。

### 决策 4：IPC 契约——invoke 触发 + send 回推结果 + invoke 关窗

**选择**（定向 `loginWin.webContents.send`，不广播到 mainWindow）：

```
渲染(isolated)
  ──invoke IPC_CHANNELS.LOGIN_EXTRACT(source)──▶ 主进程 LOGIN_EXTRACT handler
  ◀────返回 { accepted: boolean }（快响应，仅表示"已受理"）────────── 主进程

主进程 triggerExtraction(ctx, ...) 跑完
  ──send NOTIFICATION_CHANNELS.LOGIN_EXTRACT_RESULT────────────▶ 渲染
       payload: { success: boolean; message?: string; notLoggedIn?: boolean }

渲染(成功后倒数到 0)
  ──invoke IPC_CHANNELS.LOGIN_FINISH────────────────────────────▶ 主进程 → destroy
```

**理由**：提取链含 `extractJmUsername`（DOM，3s 超时）+ apply + verify，可能 5–10s。若用单个 invoke 等返回，渲染端会长时间挂起，期间无法显示进度/不可取消；改为 invoke 拿"已受理"快响应、send 回推结果，渲染端可立即切到"提取中"态并保持可取消。

**替代方案**：
- 单 invoke 等提取完成：长挂起、不可取消。否决。
- 主进程成功后直接 destroy 不等渲染：渲染端倒数与实际关窗可能错位（倒数还在 3 窗口已关）。保留渲染端驱动关窗（`login:finish`），让主进程在"成功后若渲染端 N 秒内不 finish 则自毁"兜底。

### 决策 5：抽 triggerExtraction 复用，ctx 加 alreadySucceeded

**选择**：把 `bindManualCloseExtraction` 内的提取编排（username 提取 → `extractAndApplyCookies` → 按 notLoggedIn 分支）抽为 `triggerExtraction(ctx, loginWin, source, domain): Promise<ExtractionResult>`，叠层与关窗两条路径都调它。`LoginWindowContext` 新增 `alreadySucceeded: boolean`：

- `close` 处理器首判：`ctx.alreadySucceeded` → 直接 `done(knownResult)`，不二次提取。
- 叠层路径成功 → 置 `ctx.alreadySucceeded = true`，进入倒数；倒数结束 `login:finish` 调用 `done`。
- `done()` 已有 `settled` 守卫防重入，无需改动其语义。

**替代方案**：叠层成功后立即 `done`+destroy，倒数在主进程 setTimeout。会丢失渲染端"倒数可取消"的交互。否决——保留渲染端倒数。

### 决策 6：浮标可拖动——pointer 事件，位置仅在当前文档生命周期内

**选择**：收起圆点 + 展开卡片顶栏均可拖动（`pointerdown` 记录偏移、`pointermove` 更新 `host.style.top/left`）。不持久化（往第三方 origin localStorage 写不合适，跨站点位置也不通用）。

### 决策 7：CSP——复用现有宽松 CSP，叠层样式用 shadow 内 `<style>`

**选择**：叠层结构用 DOM API 构建，样式用 shadow 内 `<style>` 注入（非 inline `style` 属性，避免 `style-src 'unsafe-inline'` 依赖）。登录窗宽松 CSP 已含 `script-src 'unsafe-eval'`，`<style>` 元素不受 `script-src` 约束，预期无需改 CSP registry。若实测被 `style-src` 拦，回退到内联 `style` 属性（`style-src 'unsafe-inline'` 需评估，但 shadow 内 `<style>` 通常更安全）。

## 风险 / 权衡

- **极少数站点主动 `body.removeChild` 清掉未知节点** → 先不加 MutationObserver 自愈；实测遇冷再加（YAGNI）。jm/hcomic/copymanga 三个目标站点已知无此行为。
- **倒数中导航** → 叠层重置、倒数视觉中断；主进程侧兜底（超时或 finish）仍会关窗。可接受。
- **叠层 JS 抛错导致注入失败** → 叠层缺失时，关窗提取兜底仍在，登录功能不退化。注入逻辑用 try/catch 包裹，失败仅 console.error。
- **同时开多个登录窗** → IPC 用定向 `loginWin.webContents.send`，不广播；每个窗有独立 ctx，互不串扰。
- **jm 用户名在叠层路径的提取** → 复用 `extractJmUsername`（DOM 存活），与关窗路径同样安全。
- **浮标遮挡登录表单** → 可拖动 + 默认右上角，三个目标站点登录表单均不挡。

## 开放问题

无。所有含糊点（世界划分、IPC 方向、倒数秒数、文案、视觉、遮挡）已在探索阶段与用户对齐。
