## 1. 后端：凭据持久化辅助

- [x] 1.1 在 `python/ipc/auth_mixin.py` 新增私有方法 `_persist_credentials(self, source: str, username: str, password: str) -> None`：读出现有 `config.get_source_auth(source)`，保留 cookie/user_agent/bearer_token，仅更新 username/password 并 `set_source_auth` + `save`，整个操作在 `_config_write_lock` 临界区内。网络相关操作禁止进入该锁。

## 2. 后端：账号密码登录 handler 重排

- [x] 2.1 重排 `handle_moeimg_login`：校验入参后，先 `_persist_credentials("moeimg", u, p)`，再 `moeimg_parser.set_stored_credentials(u, p)`，随后调用 `moeimg_parser.login(u, p)`；登录抛异常时凭据应已在盘上且直接向上传播，成功路径继续走 `set_source_auth(cookie=...)` + `configure_auth`。
- [x] 2.2 重排 `handle_bika_login`：同 2.1 模式，成功路径写 bearer_token。
- [x] 2.3 重排 `handle_hcomic_login`：同 2.1 模式，成功路径写 bearer_token 并 `downloader.configure_auth(bearer_token=token)`。
- [x] 2.4 在三个 handler 的重排逻辑处补充注释，说明「失败也持久化凭据 + 注入懒登录」是预期行为，避免被误判为 bug。

## 3. 后端：apply_auth 合并写

- [x] 3.1 修改 `handle_apply_auth`：在构造 `AuthSourceData` 前先 `existing = self.config.get_source_auth(source)`，将 `existing["username"]` 与 `existing["password"]`（无此键时为空串）回填进 `AuthSourceData`，确保 curl 登录不覆盖既有账号密码。
- [x] 3.2 确认 jm/copymanga 来源经合并写后行为与原实现一致（无 username/password 字段，回填为空）。

## 4. 测试

- [x] 4.1 新增/补充 `handle_moeimg_login` 失败路径测试：mock `parser.login` 抛异常，断言异常被抛出且 `config.source_auth["moeimg"]` 的 username/password 已写入、`set_stored_credentials` 已被调用。
- [x] 4.2 同上为 `handle_bika_login` 补充失败路径测试（ParserResponseError 场景）。
- [x] 4.3 同上为 `handle_hcomic_login` 补充失败路径测试。
- [x] 4.4 为每个来源补充成功路径回归测试，断言 username/password 与 token/cookie 同时写入。
- [x] 4.5 新增 `handle_apply_auth` 合并写测试：预设已有 username/password，调用 apply_auth 应用 curl，断言既有 username/password 未被清空且新 cookie/token 已写入。
- [x] 4.6 新增 `handle_apply_auth` 对 jm 来源的回归测试，断言无 username/password 字段行为不变。

## 5. 验证

- [x] 5.1 运行 `pytest` 全套通过。
- [x] 5.2 运行 `npm run lint:py` 与 `black --check .` 通过。
- [x] 5.3 复核 `_config_write_lock` 临界区：网络请求（`parser.login`）始终在锁外。
