## 1. 配置持久化修复

- [x] 1.1 在 `tests/test_config.py` 添加 NH 认证磁盘往返回归测试：保存并重新加载 cookie、user_agent、bearer_token、username、password，先确认当前实现会丢失凭证
- [x] 1.2 修改 `utils.normalize_source_auth()`，将 `nh` 加入标准认证来源和账号密码来源集合，使五个认证字段在归一化后完整保留
- [x] 1.3 扩充认证归一化测试，确认空配置会生成 NH 默认条目、非法来源仍被过滤，且现有来源行为不变

## 2. 启动恢复与设置页契约

- [x] 2.1 在 `tests/test_multi_source_parser.py` 添加使用重载配置构造解析器的测试，验证 NH API Key 被恢复为 `Authorization: Key ...` 且账号密码进入 `set_stored_credentials` 路径，全程禁止真实网络请求
- [x] 2.2 在 Python 配置 IPC 测试中验证重载后的 `hasNhAuth`、`nhUsername`、`nhPassword` 正确返回，同时禁止新增或返回完整 `nhApiKey` 字段
- [x] 2.3 补充设置页前端测试，验证异步配置加载后 NH 账号密码正确回填、密码默认隐藏，并且 API Key 输入框不回填明文

## 3. 验证与收尾

- [x] 3.1 运行 NH/配置相关 Python 与前端定向测试，确认原始“写盘后重载变空”复现已转为通过
- [x] 3.2 运行完整提交前验证：`pytest`、`npx tsc --noEmit`、`npm test`、`npm run lint:py`、`black --check .`、`npm run lint`、`npm run lint:test-quality`
- [x] 3.3 检查最终 diff 不包含真实用户凭证或 `~/.hcomic_downloader/config.json`，并记录旧版本已丢失的 NH 凭证需要用户升级后重新输入一次
