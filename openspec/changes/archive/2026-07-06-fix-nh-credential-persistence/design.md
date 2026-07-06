## 上下文

NH 认证当前有两条写入路径：账号密码经 `nh_login` 保存 username/password 与返回的 User Token，API Key 经 `apply_auth` 保存为 `source_auth.nh.bearer_token`。两条路径都会调用 `Config.save()`，但 `Config.load()` 构造实例时会经过 `utils.normalize_source_auth()`；该函数的默认来源集合和账号密码来源集合都遗漏了 `nh`，所以磁盘中的 NH 条目在归一化阶段被静默丢弃。

同一进程内的 handler 测试直接读取尚未重载的 `Config`，因此无法发现该问题。设置页的 NH 账号密码回填和 `MultiSourceParser` 的启动恢复代码已经存在，只是收到的配置已被清空。

## 目标 / 非目标

**目标：**

- 让 NH 的 cookie、User-Agent、API Key、用户名和密码完整通过配置保存/重载往返。
- 让重载后的 NH API Key 与账号密码继续进入现有解析器启动恢复和设置页回填链路。
- 用真实临时配置文件测试覆盖持久化边界，并补齐 NH 相关规范范围。

**非目标：**

- 不改变 NH 登录 API、Token 格式或网络请求流程。
- 不新增独立的 `nhApiKey` 配置字段；API Key 继续存放在通用 `bearer_token` 字段。
- 不把完整 API Key 回传并明文填入前端输入框；设置页继续通过 `hasNhAuth` 和登录校验体现已保存状态。
- 不加密现有明文配置格式，也不改变其他来源的持久化策略。

## 决策

### 决策 1：在统一认证归一化函数中补齐 NH

将 `nh` 加入 `normalize_source_auth()` 的标准来源集合，并加入允许保留 username/password 的来源集合。这样 `Config.__post_init__()` 与 `MultiSourceParser.__init__()` 共用的归一化入口会得到一致修复，避免在消费端逐处绕过。

替代方案是在 `Config.load()` 中单独保存并回填 NH 条目；该方案会让配置层与解析器层产生两套归一化规则，且 `MultiSourceParser` 直接接收外部 `source_auth` 时仍会丢失 NH，因此不采用。

### 决策 2：保持 API Key 使用 `bearer_token`

NH 解析器已经把通用 `bearer_token` 映射为 `Authorization: Key ...`，配置、IPC 与解析器契约均围绕该字段建立。新增 `api_key` 字段会带来迁移和双字段优先级问题，没有必要。

### 决策 3：验证必须跨越真实磁盘重载边界

新增测试必须执行 `Config.save(temp_path)` 后再调用 `Config.load(temp_path)`，同时断言 NH 五个认证字段均保持。另以重载后的 `source_auth` 构造 `MultiSourceParser`，验证 API Key 和账号密码被恢复到 NH parser；测试替换网络行为，不发真实请求。

仅断言 `set_source_auth()` 后的内存字典不能作为本缺陷的回归保护。

### 决策 4：前端继续回填账号密码，但不回填 API Key 明文

账号密码沿用现有 `nhUsername`/`nhPassword` 配置契约与密码框隐藏交互。API Key 不新增返回字段，避免在 renderer 中扩大密钥暴露面；重启后 `hasNhAuth` 为真并触发已有认证校验，足以表达其已保存且生效。

## 风险 / 权衡

- **[风险] 用户旧凭证已经被后续配置保存永久覆盖** → 修复只能阻止今后丢失，无法恢复已从文件中消失的值；发布说明应提示受影响用户升级后重新输入一次。
- **[风险] 修改共享归一化函数影响所有来源** → 仅增加 `nh` 条目，不改变现有来源字段与优先级；用现有配置测试和全量 Python 测试验证无回归。
- **[权衡] 账号密码仍按项目既有格式明文落盘** → 本变更遵循现有 credential-persistence 契约；凭证加密属于独立安全改造，不在本次范围。

## 迁移计划

无需配置版本迁移。新版本加载包含 `source_auth.nh` 的文件时直接保留该条目；没有该条目的用户保持空认证状态。曾受缺陷影响且条目已消失的用户需要重新输入凭证一次，此后正常持久化。

回滚时可撤销归一化集合变更；不会产生无法被旧版本解析的新字段，但旧版本会再次丢弃 NH 条目。

## 待定问题

无。
