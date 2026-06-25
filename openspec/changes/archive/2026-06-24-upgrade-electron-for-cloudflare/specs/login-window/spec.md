## ADDED Requirements

### 需求:登录窗口的 Chromium 内核必须能通过现代反爬验证

登录窗口承载的 `BrowserWindow` 必须使用足够现代的 Chromium 内核，确保其 TLS 指纹（JA3/JA4）、`sec-ch-ua` Client Hints 头、V8 引擎行为指纹能被 Cloudflare 等人机验证服务识别为"受支持的现代浏览器"，从而允许用户完成验证并继续登录。

此项约束针对所有通过登录弹窗进行登录的来源（jmcomic 受影响最直接，hcomic/copymanga/bika/moeimg 被动受益）。单纯修改 `userAgent` 字符串不满足此需求——Cloudflare 会综合网络层与 JS 引擎指纹进行校验。

#### 场景:jmcomic 登录通过 Cloudflare 人机验证

- **当** 用户在 jmcomic 登录弹窗中触发 Cloudflare 人机验证
- **那么** 验证页面不再显示"浏览器版本过旧"或同类不兼容提示
- **且** 用户能正常完成人机验证（勾选/等待自动通过）
- **且** 验证通过后能继续输入账号密码并完成登录

#### 场景:Chromium 内核版本维持在 Cloudflare 支持窗口内

- **当** 项目锁定 Electron 主版本（如 42）
- **那么** 该版本对应的 Chromium 内核（如 148）必须处于 Cloudflare 当前支持的浏览器版本范围内（通常为最近 12-18 个月发布的版本）
- **且** 当 Chromium 内核再次临近过期边界时，应启动新一轮 Electron 升级（非强制自动化，作为维护提醒）

#### 场景:内核升级不破坏登录窗口既有隔离逻辑

- **当** Electron 内核升级后打开任意来源的登录弹窗
- **那么** 登录窗口仍满足 `sandbox: false` 的配置（规避 Auth0 SPA 历史崩溃，本次不重启 sandbox）
- **且** 按后续产品要求，`setPermissionRequestHandler` / `setPermissionCheckHandler` 对登录窗口权限请求保持放行
- **且** `setWindowOpenHandler` 仍拒绝陌生域名弹窗，可信登录域名链接改在当前登录窗口打开
- **且** `will-navigate` 域名白名单拦截仍生效
