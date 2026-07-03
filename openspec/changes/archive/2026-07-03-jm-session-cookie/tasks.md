## 1. 回滚初版缺陷实现

- [x] 1.1 回滚 `sources/__init__.py` 的 factory lambda 硬编码空串（初版决策4缺陷）：JM factory 改为读取运行期凭据通道（任务 2.x 实现），不再硬编码 `cookie=""`。
- [x] 1.2 回滚 `sources/__init__.py` 的 `_apply_post_init` JM 分支无条件 return 的写法：保留 JM 分支跳过通用 cookie/UA 注入（持久化残留不流入 parser），但运行期凭据由 factory 注入，post_init 仅保留 `set_custom_domain`。
- [x] 1.3 回滚 `tests/test_multi_source_parser.py` 中初版添加的 `test_jm_parser_created_anonymous_despite_source_auth_cookie` / `test_jm_apply_post_init_skips_cookie_but_applies_domain`——它们用真实 JmParser 但未覆盖懒创建时序，将被任务 5.x 的集成测试替代。

## 2. 运行期内存凭据通道（sources 分发层）

- [x] 2.1 在 `MultiSourceParser.__init__` 新增运行期凭据字段 `self._jm_session_auth: dict[str, str] = {"cookie": "", "user_agent": ""}`，初始化为空（启动即匿名）。添加注释说明该字段是会话级内存凭据，独立于持久化 `source_auth`，进程退出即失效（jm-session-cookie spec）。
- [x] 2.2 修改 `_factory["jm"]` lambda：`cookie=self._jm_session_auth["cookie"]`、`user_agent=self._jm_session_auth["user_agent"]`。启动时为空串 → 匿名创建；运行期 configure_auth 写入后 → 懒创建时注入。
- [x] 2.3 修改 `MultiSourceParser.configure_auth`：在方法体开头新增 JM 专用分支——若 `current == "jm"`，写入 `self._jm_session_auth`（不写 `source_auth`），若 parser 已创建则即时 `parser.configure_auth`，然后 return。非 JM 来源保持原 `source_auth` 写入路径不变。
- [x] 2.4 保留 `_apply_post_init` 的 JM 分支结构（前置 short-circuit，仅 `set_custom_domain`，不读 source_auth 的 cookie/UA）。确认运行期凭据经 factory 注入而非 post_init，post_init 不需读 `_jm_session_auth`（factory 已在构造时传入）。

## 3. 鉴权状态查询统一接口（sources + ipc 层）

- [x] 3.1 在 `MultiSourceParser` 新增 `get_runtime_auth(source) -> tuple[str, str]`：JM 走 `self._jm_session_auth`，其他来源走 `self.source_auth`（既有行为）。添加注释区分鉴权查询（运行期）与配置回显（持久化）。
- [x] 3.2 修改 `python/ipc/search_mixin.py` 的 `_check_source_auth`：JM 分支改用 `self.parser.get_runtime_auth("jm")[0]` 判定（替换 `self.config.source_auth.get("jm", {}).get("cookie")`）。copymanga 分支保持不变。
- [x] 3.3 修改 `python/ipc/config_mixin.py` 的 `hasJmAuth` 计算：改用 `bool(self.parser.get_runtime_auth("jm")[0])`（替换 `bool(self.config.source_auth.get("jm", {}).get("cookie"))`）。
- [x] 3.4 全仓搜索 `source_auth\["jm"\]` 与 `source_auth.get("jm"` 的所有出现，确认除 settings 回显（`get_auth`，允许读持久化）外，无其他鉴权判定遗漏；遗漏的改为 `get_runtime_auth`。

## 4. 登录落盘拦截（auth mixin 层，初版已完成，确认无回归）

- [x] 4.1 确认 `python/ipc/auth_mixin.py` 的 `handle_apply_auth` 对 `source == "jm"` 跳过 `config.set_source_auth` + `config.save()`（初版已实现），保留 `parser.configure_auth`（现经任务 2.3 写入 `_jm_session_auth`）、`set_jm_domain`、`set_username` 调用。
- [x] 4.2 确认非 JM 来源（hcomic/moeimg/copymanga）落盘逻辑零变化。

## 5. 集成与回归测试（禁止用 MagicMock 替代 JmParser 验证懒创建链路）

- [x] 5.1 在 `tests/test_multi_source_parser.py` 添加**懒创建时序集成测试**（真实 JmParser，不发网络）：`MultiSourceParser(source_auth={"jm": {"cookie": "remember=PERSISTED", "user_agent": "PERSISTED-UA"}})` 构造后，调用 `configure_auth(cookie="remember=runtime", user_agent="RUNTIME-UA", source="jm")`（parser 尚未创建），然后首次访问 `parsers["jm"]`，断言真实实例 `_cookie == "remember=runtime"` 且 `_user_agent == "RUNTIME-UA"`（验证运行期注入生效 + 持久化残留被忽略）。
- [x] 5.2 在 `tests/test_multi_source_parser.py` 添加测试：启动时（未运行期登录）即使 `source_auth["jm"]` 含残留 cookie，`parsers["jm"]` 创建后 `_cookie == ""`（验证启动匿名）。
- [x] 5.3 在 `tests/test_multi_source_parser.py` 添加测试：`configure_auth(source="jm", ...)` 后 `self.source_auth["jm"]` 不含本次写入的 cookie（验证运行期凭据不污染持久化快照），`self._jm_session_auth` 含写入值。
- [x] 5.4 在 `tests/test_multi_source_parser.py` 添加测试：`get_runtime_auth("jm")` 在运行期登录后返回注入值，未登录时返回空串（即使 source_auth 含残留）；非 JM 来源走 source_auth。
- [x] 5.5 在 `tests/test_ipc_auth_mixin.py` 确认/改写 `test_apply_auth_jm_source_does_not_persist_session_credentials`（初版已改写）：除断言不落盘外，补充断言 `parser.configure_auth` 被调用（内存注入）——此项初版已覆盖，确认仍通过。
- [x] 5.6 在 `tests/test_jm_runtime_auth_query.py` 添加 `_check_source_auth` 与 `hasJmAuth` 的测试：运行期登录后 `_check_source_auth("jm")` 不抛异常、`hasJmAuth` 为 true；未登录但有存量残留时 `_check_source_auth("jm")` 抛 `AuthRequiredError`、`hasJmAuth` 为 false。

## 5.7 第三轮审查修复（竞态 + bearer_token + 文档）

- [x] 5.7.1 **[P1]** 修改 `sources/__init__.py` 的 `configure_auth` JM 分支：整体进入 `with self._parser_lock:` 临界区（写 `_jm_session_auth` + 查 `_parsers` + 即时注入原子化），与 `_get_parser` 懒创建临界区互斥。
- [x] 5.7.2 **[P2]** `_jm_session_auth` 增加 `bearer_token` 键；`configure_auth` JM 分支写入三元组；`_apply_post_init` JM 分支在 factory 构造后补 `parser.configure_auth(bearer_token=...)`（JmParser.__init__ 不接受 bearer_token）。
- [x] 5.7.3 **[P1 回归]** 在 `tests/test_multi_source_parser.py` 添加确定性并发测试 `test_jm_configure_auth_concurrent_with_lazy_create_is_consistent`：慢 factory 制造 `_get_parser` 持锁窗口，期间另一线程 configure_auth，断言最终实例 `_cookie` 与 `_jm_session_auth` 一致。
- [x] 5.7.4 **[P2 回归]** 在 `tests/test_multi_source_parser.py` 添加 `test_jm_configure_auth_bearer_token_retained_through_lazy_create`：configure_auth 传 cookie/UA/bearer 后懒创建，**同时断言三项**保留（cookie、UA、Authorization）——见 5.8.1 强化。

## 5.8 第四轮审查修复（bearer 补注入清空 cookie/UA 回归）

- [x] 5.8.1 **[P1]** 修复 `_apply_post_init` JM 分支：改用**完整三元组**调 `parser.configure_auth(cookie=..., user_agent=..., bearer_token=...)`（从 `_jm_session_auth` 读），禁止只传 `bearer_token`——`JmParser.configure_auth` 的 cookie/UA 默认空串会覆盖 factory 刚注入的值。
- [x] 5.8.2 **[P1 回归强化]** 强化 `test_jm_configure_auth_bearer_token_retained_through_lazy_create`：同时断言 `jm._cookie`、`jm._user_agent`、`Authorization` 三项均保留（原测试仅断言 Authorization，漏掉覆盖 bug）。
- [x] 5.8.3 **[文档]** 修正 design.md 决策 2 的"选择"段：删除"恒传空串"的当前选择描述（初版方案已被决策 4 取代，决策 2 改为描述最终消费侧拦截方案）。
- [x] 5.8.4 **[文档计数]** 修正 tasks.md 验证计数：目标测试 164 passed、全量 1009 passed（原误写 162/1007）。

## 6. 验证

- [x] 6.1 运行 `pytest tests/test_multi_source_parser.py tests/test_ipc_auth_mixin.py tests/test_jm_parser.py tests/test_jm_favourites.py tests/test_search_mixin.py tests/test_jm_runtime_auth_query.py`（含新增集成测试）全部通过（164 passed）。
- [x] 6.2 运行全量 `pytest` 确认无其他回归（1009 passed，无失败）。
- [x] 6.3 运行 `npm run lint:py` 与 `black --check .` 通过。
