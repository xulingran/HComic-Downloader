## 上下文

当前 Bika 解析器已复用单一 `requests.Session`，该 Session 在构造时注入系统代理，并由 `_request` 统一添加签名、图片质量和 bearer token。参考项目 haka_comic 在用户资料加载成功后读取 `user.isPunched`，仅当未签到时调用 `POST users/punch-in`。本项目的 Bika 搜索页在认证成功后展示分类入口，适合作为每日自动签到的触发边界。

## 目标 / 非目标

**目标：**

- 复用 Bika 认证 Session 查询资料并按需签到，禁止绕过系统代理。
- 用户进入或切换到 Bika 搜索页且认证有效时自动执行一次签到流程。
- 新签到成功给出 Toast；已签到保持安静；任何签到失败都不阻塞搜索与分类浏览。
- 通过共享类型、preload、主进程和 Python JSON-RPC 闭合 IPC 契约。

**非目标：**

- 不增加手动签到按钮、签到历史或跨设备签到状态缓存。
- 不在应用启动时、其他来源页面或后台定时器中签到。
- 不改变 Bika 登录、搜索或 token 自动重登录策略。

## 决策

1. **后端采用“资料检查 + 按需写入”的单一方法。** `BikaParser.check_in()` 先 `_ensure_token()`，再 `GET users/profile` 读取 `isPunched`；仅在明确为 `False` 时调用 `POST users/punch-in`。返回 `checked_in`（本次完成）或 `already_checked_in`（此前完成）的结构化状态。相比前端先调用两个接口，该方案把站点字段解析和请求签名留在来源层，并避免暴露用户资料。

2. **复用现有 parser 实例和 Session。** IPC handler 从 `MultiSourceParser` 取得 Bika parser 并调用上述方法；不创建新 Session，因此认证、自动重登录和系统代理约束天然一致。

3. **签到是搜索页的 best-effort 副作用。** React 在 Bika 认证校验成功后调用签到 IPC，但不把它纳入搜索页 loading gate。成功且为本次新签到时显示“Bika 签到成功”；已签到不提示；异常只记录为普通失败并保持页面可用。相比把签到并入 `verify_auth`，独立 IPC 不会让只读认证检查产生隐式写操作，也便于契约测试。

4. **用页面会话内 ref 去重。** 同一次 `SearchPage` 挂载期间只触发一次自动签到，涵盖默认来源为 Bika、缓存恢复为 Bika和手动切换为 Bika。失败后切出再切回不自动重试，避免短时间内反复请求；重新进入页面可再次尝试。

## 风险 / 权衡

- [Bika 资料字段缺失或类型变化] → 仅接受布尔 `isPunched`，缺失时抛出可诊断错误且前端静默降级，禁止盲目 POST。
- [认证过期导致额外请求] → 复用 `_request` 现有自动重登录逻辑，不新增凭据处理分支。
- [页面快速切源后迟到成功 Toast] → 前端在 Promise 完成时确认当前来源仍为 Bika再提示。
- [签到失败对用户不可见] → 这是为保证入口非阻塞作出的取舍；错误仍经现有 IPC 错误链路和后端日志可诊断。

## 迁移计划

无数据迁移。各层契约与消费方在同一变更提交；回滚时整体移除新增通道及触发逻辑即可。

## 开放问题

无。
