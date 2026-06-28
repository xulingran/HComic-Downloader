## 1. 挑战信号与检测

- [x] 1.1 在 `sources/base.py` 增加继承 `ParserResponseError` 的结构化 `AntiBotChallengeError`，供解析器与 IPC 共享且不改变现有异常兼容性
- [x] 1.2 重构 JM 挑战检测：支持 `cf-mitigated: challenge` 响应头和稳定正文标记，移除 500 字节长度排除条件并收窄易误判的宽泛关键词
- [x] 1.3 在 `tests/test_jm_parser.py` 覆盖响应头挑战、超过 500 字节的挑战正文、正常长页面反例以及登录校验挑战提示

## 2. 收藏夹有界恢复

- [x] 2.1 将 JM 收藏夹请求整理为复用当前 Session、系统代理、显式 Cookie/UA 和域名的有界请求流程，挑战时允许首页预热并最多重试两次
- [x] 2.2 确保仅明确挑战触发重试：登录重定向/登录提示继续返回 `needs_login=True`，普通 403 与其他 HTTP 错误沿用原错误路径
- [x] 2.3 在重试耗尽后抛出 `AntiBotChallengeError`，不得清空认证数据或将 Cookie 标记为失效
- [x] 2.4 在 `tests/test_jm_favourites.py` 覆盖首次挑战后成功、持续挑战耗尽、普通 403 不重试、登录重定向和同 Session/请求头复用

## 3. IPC 错误分类

- [x] 3.1 调整 `SearchMixin._auth_error_guard()` 捕获顺序，使 `AntiBotChallengeError` 在通用 `ParserResponseError` 和关键词认证判断之前映射为可恢复的人机验证错误
- [x] 3.2 增加 IPC 回归测试，断言持续挑战不出现“登录凭证已失效”，而真实认证错误仍保持现有 `AuthRequiredError` 语义

## 4. 验证与质量检查

- [x] 4.1 运行 `pytest tests/test_jm_parser.py tests/test_jm_favourites.py` 及新增的 IPC 定向测试并修复失败
- [x] 4.2 运行完整 Python 测试 `pytest`，确认其他来源和 IPC 行为无回归
- [x] 4.3 运行 `npm run lint:py` 与 `black --check .`，确认 Python lint、导入顺序和格式全部通过
