## 上下文

JM 收藏夹存在两个网络上下文：Python 后端使用 `requests/curl_cffi` 发起解析请求，Electron 主进程使用 BrowserWindow/Chromium 加载站点页面。实际运行中，Python 后端即使持有登录 Cookie 和 User-Agent，也可能持续收到 JM 反爬挑战页；而 Chromium 会话通常可以正常渲染收藏夹页面。此前交互恢复已能在可见验证窗口中捕获页面快照并交给 Python 解析，但后续翻页仍会先走 Python 直连，导致重复失败日志、额外延迟和潜在的重复窗口恢复。

本变更在不新增公开 IPC 通道、不泄露 Cookie/HTML 到 React renderer 的前提下，优化主进程内部的 JM 收藏夹恢复策略。

## 目标 / 非目标

**目标：**
- 首次可见验证或浏览器快照兜底成功后，后续 JM 收藏夹翻页优先走隐藏 BrowserWindow 快照解析，避免先请求 Python `get_favourites`。
- 如果可见挑战窗口已经直接显示收藏夹内容，自动完成快照捕获和凭据同步，减少用户手动点击。
- 避免把正常收藏夹页面中残留的 `captcha` 文本误判为仍在人机验证。
- 保持现有 URL 白名单、HTML 大小限制、Cookie 敏感信息边界和失败回退策略。

**非目标：**
- 不尝试绕过 JM 站点反爬或伪造挑战通过结果。
- 不引入新的第三方反爬库、浏览器自动化框架或持久远程调试协议。
- 不改变 React renderer 的公开收藏夹 API 契约。
- 不移除 Python 收藏夹解析路径；非静默模式、首次加载和回退仍可使用 Python `get_favourites`。

## 决策

1. **以“快照兜底成功”为进入静默模式的信号**
   - 只有当可见验证窗口产生可信收藏夹页面快照，并且 Python `parse_jm_favourites_snapshot` 成功解析后，主进程才记录 `preferSilentSnapshotRecovery`。
   - 理由：这证明当前 Chromium 会话可访问收藏夹，而 Python 直连路径不可靠。仅凭一次 challenge 错误不足以启用静默模式。

2. **记录最近一次可信收藏夹快照 URL 并派生页码 URL**
   - 主进程保存 `lastSnapshotSourceUrl`，后续根据目标页码设置或删除 `page` 查询参数。
   - 理由：可以保留用户名、域名和路径，不需要把用户名暴露给 React，也避免构造 `/user/favorite/...` 这类不完整路径。

3. **静默模式优先于 Python 直连，仅限 JM + 交互请求**
   - `python:get-favourites` handler 在 `source === 'jm'`、`allowInteractiveChallenge === true` 且静默模式可用时，先调用 `recoverJmFavouritesSilently`。
   - 静默失败时回退到原 Python `get_favourites` 与可见恢复逻辑。
   - 理由：用户主动翻页仍期望可恢复；后台预加载仍保持不打扰用户的约束。

4. **隐藏 BrowserWindow 复用登录窗口的安全边界**
   - 隐藏快照窗口仍使用同一 URL 校验、CSP 放宽注册、权限处理器和默认 Session；窗口不显示，加载完成后捕获 DOM 快照并销毁。
   - 理由：避免新增不受控 webContents；同时保留 Chromium 会话 Cookie 和站点脚本执行能力。

5. **弱 challenge 标记必须结合页面内容判定**
   - `captcha` 被视为弱标记；当页面已经包含收藏夹卡片或专辑链接时，不再仅因该文本拒绝快照。
   - 强标记（Cloudflare challenge platform、`cf-chl-`、`Just a moment` 等）仍直接判定为挑战页。
   - 理由：正常 JM 页面可能残留 captcha 相关脚本变量，单独匹配会造成误判。

## 风险 / 权衡

- **隐藏窗口仍会消耗 Chromium 资源** → 使用短超时、完成后销毁窗口；仅在用户交互翻页且静默模式已确认可用时触发。
- **站点结构变化导致快照解析失败** → 保留 Python 端 URL/HTML 校验和解析错误回退；静默失败后仍可回到原可见恢复路径。
- **并发翻页/预加载可能产生多个隐藏窗口** → 当前实现保持每次请求独立窗口，避免共享 webContents 状态复杂性；后续可在观察到资源压力后再引入队列或复用窗口。
- **最近快照 URL 过期或域名变化** → 静默恢复失败会回退；登录/验证流程重新成功后会更新最近快照 URL。
- **日志仍可能包含 Python challenge 失败** → 静默优先路径会减少用户主动翻页的直连失败；后台非交互预加载仍可能静默失败并保留调试日志。
