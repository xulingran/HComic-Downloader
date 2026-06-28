## 为什么

JM 收藏夹会被 Cloudflare 自适应挑战间歇性拦截；当前实现把这类 403 直接当成登录凭证失效，导致有效 Cookie 也无法查看收藏夹，并诱导用户反复登录。现场复现已确认同一组 Cookie 可交替得到 200 与带 `cf-mitigated: challenge` 的 403，因此需要把反爬挑战与真实认证失败分开处理。

## 变更内容

- 为 JM HTML 请求增加可靠的 Cloudflare 挑战识别，使用响应头和稳定页面特征，不再依赖“小于 500 字节”的假设。
- JM 收藏夹请求遇到可恢复挑战时，在同一代理、会话和认证上下文中执行有界重试。
- 引入明确的反爬挑战错误类型，使 IPC 层不会把挑战误报为“登录凭证已失效”。
- 仅在明确出现登录跳转或登录提示时返回需要重新登录；持续挑战则提示用户稍后重试或检查网络/域名。
- 增加挑战检测、重试成功、重试耗尽和认证失效分类的回归测试。

## 功能 (Capabilities)

### 新增功能

- `jm-challenge-recovery`: 定义 JM 来源对 Cloudflare 挑战的识别、有界恢复以及与认证失效相区分的错误语义。

### 修改功能

<!-- 无。现有 jm-source/auth 规范主要约束来源标识及认证字段，本变更新增独立的运行时挑战恢复能力。 -->

## 影响

- Python JM 解析器：`sources/jm/parser.py`，可能新增共享或 JM 专用异常类型。
- Python IPC 错误映射：`python/ipc/search_mixin.py`。
- 测试：`tests/test_jm_favourites.py`、`tests/test_jm_parser.py` 及 IPC 错误分类测试。
- 不改变 IPC 方法签名、配置格式、Cookie 持久化结构或前端页面契约；不新增第三方依赖。
