# ssrf-protection 规范

## 目的

定义下载 URL 对内网与保留地址、DNS 重绑定、可信 CDN、非法 scheme 和重定向链的验证要求，确保所有网络入口在代理环境下仍然阻止 SSRF 绕过。

## 需求

### 需求:SSRF 防护必须验证各类内网与保留 IP 拦截

系统必须提供测试，验证 `UrlValidator` 对所有已定义的内网与保留 IP 段（IPv4 与 IPv6 黑名单）的正确拦截，防止下载 URL 指向内网或保留地址。

#### 场景:IPv4 私网与保留地址被拦截

- **当** 传入直接以 IPv4 私网或保留地址为主机的 URL（如 `http://127.0.0.1/`、`http://10.0.0.1/`、`http://169.254.1.1/`、`http://192.168.1.1/`）
- **那么** `validate_url` 必须抛出 `DownloadError`，错误信息必须表明该 IP 被拦截

#### 场景:IPv6 本地与保留地址被拦截

- **当** 传入以 IPv6 本地或保留地址为主机的 URL（如 `http://[::1]/`、`http://[fe80::1]/`、`http://[fc00::1]/`）
- **那么** `validate_url` 必须抛出 `DownloadError`

#### 场景:localhost 与全零地址被拦截

- **当** 传入 hostname 为 `localhost`、`0.0.0.0`、`::1` 的 URL
- **那么** `validate_url` 必须抛出 `DownloadError`

### 需求:DNS 解析必须阻止指向内网的域名

系统必须提供测试，验证当域名解析结果指向内网或保留 IP 时，`validate_url` 必须拦截，防止通过域名绕过 IP 黑名单。

#### 场景:域名解析到内网 IP 被拦截

- **当** 一个非可信 CDN 的域名，其 DNS 解析结果包含内网或保留 IP（如解析到 `127.0.0.1`）
- **那么** `validate_url` 必须抛出 `DownloadError`，错误信息必须包含解析到的被拦截 IP

#### 场景:可信 CDN 域名跳过 DNS 解析验证

- **当** 传入 hostname 属于可信 CDN 白名单的 URL（如 `h-comic.com`、`jmcomic.me`、`picacg.com`）
- **那么** `validate_url` 必须直接放行，不得发起 DNS 解析（防止 TOCTOU 攻击）

#### 场景:无法解析的域名报错

- **当** 传入一个非可信 CDN 且 DNS 无法解析的域名
- **那么** `validate_url` 必须抛出 `DownloadError`，错误信息必须表明无法解析

### 需求:可信 CDN 白名单必须按实例配置生效

系统必须验证 `UrlValidator` 实例化时传入的自定义可信 CDN 域名白名单在 `validate_url` 中实际生效，防止类属性与实例属性脱节导致安全配置静默失效。

#### 场景:自定义可信域名被放行

- **当** 实例化 `UrlValidator` 时传入自定义 `trusted_cdn_domains`（包含一个非默认域名），并验证该域名 URL
- **那么** `validate_url` 必须放行该域名，不得因 DNS 解析而拦截

#### 场景:非可信域名解析仍受校验

- **当** 实例化时传入自定义白名单，并验证一个不在自定义白名单且非默认白名单的域名
- **那么** `validate_url` 必须对该域名执行 DNS 解析校验

### 需求:URL scheme 与 hostname 校验必须拒绝非法输入

系统必须验证 `validate_url` 对非法 scheme、空 hostname 等异常输入的正确拒绝。

#### 场景:非 http/https scheme 被拒绝

- **当** 传入 scheme 为 `file`、`ftp`、`gopher` 等非 http/https 的 URL
- **那么** `validate_url` 必须抛出 `DownloadError`，错误信息必须表明 scheme 被拦截

#### 场景:空 hostname 被拒绝

- **当** 传入 hostname 为空的 URL
- **那么** `validate_url` 必须抛出 `DownloadError`

### 需求:重定向链必须逐跳校验并管理认证头

系统必须验证 `resolve_redirects` 在跟随重定向时逐跳执行 URL 安全校验，并在跨域跳转时正确剥离与恢复认证头，防止凭据泄漏到非可信域。

#### 场景:重定向到内网地址被逐跳拦截

- **当** 一个 URL 的重定向链中某一跳指向内网或保留地址
- **那么** `resolve_redirects` 必须抛出 `DownloadError`，不得继续跟随

#### 场景:离开可信域时剥离认证头

- **当** 从可信域（如 hcomic）重定向到非可信域
- **那么** Session 的 `Cookie` 与 `Authorization` 头必须被剥离，不得发送给非可信域

#### 场景:跳回可信域时恢复认证头

- **当** 从非可信域重定向回原始可信域
- **那么** 先前剥离的 `Cookie` 与 `Authorization` 头必须被恢复

#### 场景:超过最大跳数报错

- **当** 重定向链超过最大跳数限制
- **那么** `resolve_redirects` 必须抛出 `DownloadError`，错误信息必须表明跳数过多

#### 场景:重定向无 Location 头报错

- **当** 收到重定向状态码但响应无 `Location` 头
- **那么** `resolve_redirects` 必须抛出 `DownloadError`
