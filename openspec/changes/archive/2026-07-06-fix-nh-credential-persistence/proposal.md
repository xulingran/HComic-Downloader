## 为什么

NH 登录 handler 已将账号、密码和 API Key 写入 `source_auth.nh`，但配置加载时的认证归一化白名单遗漏了 `nh`，导致应用重启后整段 NH 凭证被丢弃。现有测试只覆盖同进程写入，没有覆盖真实的保存后重载，因此该缺陷长期未被发现。

## 变更内容

- 修正多来源认证配置归一化，使 `nh` 与其他持久化认证来源一样保留 cookie、User-Agent、API Key、用户名和密码。
- 保证 NH 凭证经过 `Config.save()` 与 `Config.load()` 往返后保持不变，并能在应用启动时恢复到 `NhParser`。
- 将 NH 纳入账号密码失败持久化与设置页凭证回填的规范范围，消除实现与现有规范之间的漂移。
- 增加磁盘往返、启动恢复和前端配置回填的回归测试，避免只验证内存状态。

## 功能 (Capabilities)

### 新增功能

无。

### 修改功能

- `nh-authentication`: 明确 NH 账号、密码和 API Key 必须经过配置归一化与应用重启完整保留，并在启动时恢复到解析器。
- `credential-persistence`: 将 NH 纳入账号密码提交后持久化（包括登录失败）的来源范围。
- `auth-password-prefill`: 将 NH 纳入设置页已保存账号密码的异步回填范围。

## 影响

- 配置归一化：`utils.py`、`config.py` 的 NH `source_auth` 往返行为。
- 启动认证恢复：`sources/__init__.py` 中 NH 解析器懒创建与凭证注入链路。
- 设置页契约：Python `get_config` 返回的 NH 账号密码字段及 React 设置页回填行为。
- 测试：Python 配置/IPC/多来源解析器测试，以及设置页前端测试。
- 不新增依赖，不改变 IPC 方法签名，也不明文回填 API Key 输入框；API Key 继续通过 `hasNhAuth` 与登录校验反映已保存状态。
