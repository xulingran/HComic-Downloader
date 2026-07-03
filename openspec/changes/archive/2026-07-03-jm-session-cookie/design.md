## 上下文

JM 来源当前把登录窗口获取的 cookie（`remember`/`remember_id`）和配套 user-agent 持久化到 `config.json` 的 `source_auth["jm"]`，并在每次启动时由 `Config.load()` → `MultiSourceParser(source_auth=...)` → `JmParser(cookie=...)` 恢复。

现状数据流：

```
登录窗口 → apply_auth(jm) → handle_apply_auth
        → config.set_source_auth("jm", cookie/ua) + config.save()   [落盘]
        → parser.configure_auth(cookie/ua, source="jm")             [内存]

启动 → Config.load() → config.source_auth["jm"]["cookie"]
      → MultiSourceParser(source_auth=...)
      → factory["jm"](cookie=source_auth["jm"]["cookie"])           [恢复]
      → _apply_post_init → parser.configure_auth(cookie/ua)         [恢复]
```

关键约束：
- JM cookie 与 Cloudflare 挑战通过态绑定，跨进程复用常失效或触发新人机验证。
- `jm_domain` 是独立连接配置，与认证态无关，必须保留持久化。
- credential-persistence spec 已将 jm 排除在账号密码持久化之外，本变更与之正交。
- jm-source spec 的 cookie jar 双写、verify 依赖 `_cookie` 针对运行期 parser 行为，不受持久化变更影响。

## 目标 / 非目标

**目标：**
- JM cookie/UA 在进程存活期内存可用，进程退出即失效。
- 启动时 JM parser 处于匿名状态，无视 `config.source_auth["jm"]` 中的 cookie/UA。
- 登录路径对 JM 不落盘，其他来源落盘语义零变化。
- 存量 `config.json` 残留字段不触发破坏性写操作。

**非目标：**
- 不改变 JM 登录窗口交互流程（Electron 端无改动）。
- 不清理存量 `config.json` 文件（容忍残留脏数据）。
- 不影响 `jm_domain`、bika/hcomic/moeimg/copymanga 的认证持久化。
- 不引入"会话级凭据"通用框架——仅针对 JM，避免过度抽象。

## 决策

### 决策 1：cookie 与 user_agent 成对丢弃，而非仅丢 cookie

**选择**：JM 的 cookie 与 user_agent **一起**不持久化、不恢复。

**理由**：登录窗口抓取 cookie 时连 UA 一起抓（`rawUaHeader`），服务端可能将二者绑定（Cloudflare 指纹/会话指纹）。启动时若保留旧 UA 配空 cookie，会造成"旧指纹 + 空认证"的不一致组合，反而增加被挑战概率。语义上二者同属"登录态衍生品"，应整体作为会话级凭据处理。

**替代方案**：仅丢 cookie 留 UA——被否决，理由如上（指纹不一致风险），且 UA 单独保留无实际价值（无 cookie 时 UA 不构成有效认证）。

### 决策 2：拦截点放在 factory lambda + `_apply_post_init`，而非 Config 层

**选择**：在 `sources/__init__.py` 消费侧拦截 JM 持久化残留流入 parser——factory lambda 从独立运行期内存字段 `_jm_session_auth`（而非持久化 `source_auth`）读取 cookie/UA 注入 `JmParser`；`_apply_post_init` 的 JM 分支用完整三元组调 `configure_auth` 补 bearer_token（见决策 4 修正）。`config.py` 不做任何修改——`config.source_auth["jm"]` 字段仍可被读取（容忍残留），只是 factory 与鉴权查询都不消费它。

（初版曾用"factory 恒传空串"实现拦截，但代码审查证明它会同时阻断运行期注入，已被决策 4 的运行期凭据通道方案取代。）

**理由**：
- Config 是纯数据层，不应感知"哪个来源该不该持久化"的业务规则。把判断放在消费侧（MultiSourceParser）更内聚。
- 避免给 Config 加 source-specific 分支，防止配置层被来源语义污染。
- 存量字段在 Config 层面"看起来正常"，符合"容忍残留"的非目标——文件不动，读取层忽略。

**替代方案 A**：在 `config.py` 的 `get_source_auth("jm")` 强制返回空 cookie/UA——被否决，会让 Config 层感知来源语义，且 `handle_apply_auth` 内部读取 `existing` 做合并写时会拿到空值，行为不直观。
**替代方案 B**：删除 `AuthConfig` 中 jm 的 cookie/UA 字段——破坏性过大，且存量数据迁移无意义（本就要丢弃）。

### 决策 3：`handle_apply_auth` 用 source 分支跳过落盘，而非通用"是否持久化"标志

**选择**：在 `python/ipc/auth_mixin.py` 的 `handle_apply_auth` 内，对 `source == "jm"` 显式跳过 `config.set_source_auth` + `config.save()` 块，但保留 `parser.configure_auth`（内存注入）、`parser.set_jm_domain(domain)`、`parser.set_username(jm_username)` 调用。

**理由**：
- 当前 `handle_apply_auth` 已对 jm 有特例分支（`if source == "jm" and domain` / `if source == "jm" and jm_username`），新增"跳过落盘"分支与现有特例同层，风格一致。
- 不引入"来源是否持久化"的配置开关或抽象——YAGNI，目前只有 JM 一例。
- `parser.configure_auth` 仍调用，确保内存 parser 立即生效（运行期可用需求）。

**替代方案**：在 `MultiSourceParser.configure_auth` 内拦截 jm 的 `source_auth` 字典更新——被否决，因为 `handle_apply_auth` 的落盘逻辑在 AuthMixin 而非 MultiSourceParser，且 `configure_auth` 同时管"内存 parser 即时应用"，拦截它会破坏运行期可用性。

### 决策 4：运行期内存凭据通道，与持久化 `source_auth` 彻底分离

**修正背景**：初版设计采用"factory lambda 硬编码空串"拦截启动恢复，但代码审查暴露出致命缺陷——`MultiSourceParser.source_auth` 字典同时承担了"持久化数据快照"和"运行期内存凭据传递"两个职责。`configure_auth` 在 parser 尚未创建时把凭据写入 `source_auth["jm"]`，但 factory 恒传空串、`_apply_post_init` 又无条件 return，导致运行期刚注入的 cookie 在首次懒创建 parser 时被丢弃。复现：运行期 `configure_auth(cookie="remember=runtime")` 后触发 `parsers["jm"]`，`parser._cookie` 仍为空串。

**选择**：为 JM 引入独立的运行期内存凭据字段 `_jm_session_auth`（`dict[str, str]`，进程存活期有效，不落盘），与 `source_auth`（持久化快照）彻底分离。

```python
# MultiSourceParser.__init__
self._jm_session_auth: dict[str, str] = {"cookie": "", "user_agent": ""}  # 运行期内存，不落盘

# factory：读运行期凭据（启动时为空 → 匿名；运行期 configure_auth 写入 → 生效）
"jm": lambda: _load_parser_class("jm")(
    timeout=timeout,
    cookie=self._jm_session_auth["cookie"],
    user_agent=self._jm_session_auth["user_agent"],
),

# configure_auth：JM 分支写入运行期凭据而非 source_auth，持锁串行化（见决策 6）
if current == "jm":
    with self._parser_lock:
        self._jm_session_auth = {
            "cookie": cookie, "user_agent": user_agent, "bearer_token": bearer_token,
        }
        parser = self._parsers.get(current)
        if parser is not None:
            parser.configure_auth(cookie=cookie, user_agent=user_agent, bearer_token=bearer_token)
    return
# 非 JM 来源：保持原 source_auth 写入路径不变
self.source_auth[current] = {...}

# _apply_post_init 的 JM 分支：用完整三元组补注入（见决策 4 理由）
if name == "jm":
    session_auth = self._jm_session_auth
    parser.configure_auth(  # 完整三元组，禁止只传 bearer_token（会清空 cookie/UA）
        cookie=session_auth["cookie"],
        user_agent=session_auth["user_agent"],
        bearer_token=session_auth.get("bearer_token", ""),
    )
    if self._jm_custom_domain and hasattr(parser, "set_custom_domain"):
        parser.set_custom_domain(self._jm_custom_domain)
    return
```

**理由**：
- **职责分离**：`source_auth` 专管持久化（启动快照 + 非 JM 来源的运行期+持久化）；`_jm_session_auth` 专管 JM 运行期内存（cookie/user_agent/bearer_token 三元组）。两条通道不交叉，启动恢复与运行期注入互不干扰。
- **factory 自然生效**：启动时 `_jm_session_auth` 为空 → JM parser 匿名创建；运行期登录写入 → 首次懒创建时 factory 读到非空值注入 cookie/UA。
- **bearer_token 经 post_init 用完整三元组补注入**：`JmParser.__init__` 签名不接受 `bearer_token`，故 `_jm_session_auth` 保留 bearer_token，由 `_apply_post_init` 的 JM 分支在 factory 构造后调 `parser.configure_auth(cookie=..., user_agent=..., bearer_token=...)` 补齐。**必须传完整三元组**——只传 `bearer_token` 会让 `JmParser.configure_auth` 的 cookie/UA 默认空串覆盖 factory 刚注入的值（第四轮审查 P1 回归 bug）。`configure_session_auth` 是幂等覆盖写，重设 cookie/UA 无副作用。JM 实际认证用 cookie（无 Bearer），但保留 bearer_token 传递以兼容含 Authorization 头的 curl。
- **`configure_auth` 的懒创建契约得以保留**：原有注释"待懒创建时使用最新认证参数"对 JM 重新成立。

**替代方案 A（初版，已否决）**：factory 硬编码空串——阻断运行期注入，复现已证。
**替代方案 B**：让 `_apply_post_init` 对 JM 读 `source_auth["jm"]`（即运行期 configure_auth 写入的值）——会让"启动恢复"和"运行期注入"重新耦合到同一字段，无法区分"存量持久化残留"与"本次运行期写入"，回到歧义状态。
**替代方案 C**：JM parser 创建后立即由 `configure_auth` 即时应用，不依赖 factory 传递——但 parser 首次创建发生在 `_get_parser` 持锁期间，`configure_auth` 此时还未被调用（登录在 parser 创建之后触发），时序不成立。

### 决策 6：JM configure_auth 持锁，与懒创建临界区互斥

**修正背景**：第二轮审查的并发探针暴露 P1 竞态——`configure_auth` 的 JM 分支更新 `_jm_session_auth` 并查 `_parsers` 时未持 `_parser_lock`。若 `_get_parser` 已在锁内调起 factory（用旧空凭据构造）但尚未写 `_parsers`，并发 `configure_auth` 会读到 `_parsers["jm"]=None` 而 return；最终 `_jm_session_auth` 非空但真实 `JmParser._cookie` 为空。确定性复现：慢 factory 期间注入 cookie，`consistent=False`。

**选择**：`configure_auth` 的 JM 分支整体进入 `with self._parser_lock:` 临界区——"写 `_jm_session_auth` + 读 `_parsers` + 即时注入"原子化。与 `_get_parser` 的创建临界区互斥后，两种交错都收敛到一致：
- `configure_auth` 先获锁 → 更新 `_jm_session_auth` 后释放；`_get_parser` 后获锁，factory 读到新凭据。
- `_get_parser` 先获锁创建 → 释放后；`configure_auth` 获锁，读 `_parsers` 非空，即时注入已存在实例。

**理由**：`_parser_lock` 的语义从"仅守卫实例创建"扩展为"守卫 JM 会话状态与实例创建的协同"。锁粒度仍小（仅 JM 分支持锁，非 JM 路径不变），不引入新锁。

**替代方案**：在 `_jm_session_auth` 上加独立细粒度锁——被否决，无法解决与 `_get_parser` 的跨锁竞态（仍需在两把锁间协调），复杂度高于直接复用 `_parser_lock`。

### 决策 5：鉴权状态查询统一走运行期凭据，不再读 `config.source_auth`

**修正背景**：审查 P1 指出 `search_mixin._check_source_auth` 与 `config_mixin` 的 `hasJmAuth` 仍读 `config.source_auth["jm"]["cookie"]`。由于 `handle_apply_auth` 对 JM 不再写 config，这两个路径会持续误判：新登录被判"未登录"，存量残留 cookie 判"已登录"（假阳性）。

**选择**：在 `MultiSourceParser` 提供统一的运行期鉴权状态查询接口 `get_runtime_auth(source)`，返回该来源**当前进程内**的有效凭据（cookie/UA）；JM 走 `_jm_session_auth`，其他来源走 `source_auth`（既有行为）。`_check_source_auth` 与 `hasJmAuth` 改为调用此接口。

```python
def get_runtime_auth(self, source: str | None = None) -> tuple[str, str]:
    """返回来源的运行期有效凭据（不读持久化快照）。
    JM 走会话级 _jm_session_auth；其他来源走 source_auth（持久化即运行期）。"""
    current = self._resolve_source(source)
    if current == "jm":
        return self._jm_session_auth["cookie"], self._jm_session_auth["user_agent"]
    auth = self.source_auth.get(current, {})
    return auth.get("cookie", ""), auth.get("user_agent", "")
```

- `search_mixin._check_source_auth`：`source == "jm"` 分支改用 `self.parser.get_runtime_auth("jm")[0]` 判定。
- `config_mixin` 的 `hasJmAuth`：改用 `bool(self.parser.get_runtime_auth("jm")[0])`。
- `get_auth`（既有方法）保留不变——它读 `source_auth`，语义是"持久化配置中的值"，用于 settings 页回显输入框等非鉴权场景；JM 在该场景回显空（符合"启动匿名"）。

**理由**：鉴权判定（"现在能否发起已认证请求"）与持久化配置（"配置文件里存了什么"）是两个不同问题，必须用不同接口。统一入口避免散落在多处的 `source_auth["jm"]["cookie"]` 直读。

**替代方案**：让 `hasJmAuth` 直接 `getattr(parser.parsers.get("jm"), "_cookie", "")`——被否决，会触发 parser 懒创建（鉴权查询不应有创建副作用），且把鉴权逻辑绑定到 parser 内部属性，耦合过紧。

## 风险 / 权衡

- **[风险] 老用户每次启动需重登 JM，体验回退** → 预期行为，正是变更目标。JM cookie 跨进程本就常失效（Cloudflare 会话），重登是更可靠的状态。
- **[风险] 存量 `config.json` 残留 cookie 字段造成混淆** → 接受残留。鉴权查询路径已全面改走 `get_runtime_auth`，残留无害。`get_auth`（settings 回显）对 JM 读 `source_auth` 返回残留值——可接受，因 settings 页 JM 登录态本就由 `hasJmAuth`（运行期）驱动，残留 cookie 不影响 UI 判定。
- **[风险] 运行期凭据通道被遗漏的查询路径绕过** → 审查已枚举两处（`_check_source_auth`、`hasJmAuth`）；tasks 要求全仓搜索 `source_auth["jm"]` / `source_auth.get("jm"` 确认无其他鉴权判定遗漏。非鉴权的读取（如 settings 回显）允许保留。
- **[风险] 测试用 MagicMock 掩盖懒创建时序缺陷** → 初版即因此漏掉 P1。tasks 要求补充**真实链路集成测试**：`MultiSourceParser.configure_auth(jm)` 在 parser 未创建时调用 → 触发 `parsers["jm"]` 懒创建 → 断言真实 `JmParser._cookie` 非空。禁止用 MagicMock 替代 JmParser 验证此链路。
- **[权衡] 新增 `_jm_session_auth` 字段增加 `MultiSourceParser` 状态维度** → 可接受。比"复用 source_auth 加标志位区分"更清晰，且 JM 是目前唯一会话级来源，YAGNI 原则下不做通用抽象。

## 补充决策：JM 下载认证路径（P2 澄清）

**背景**：审查 P2 指出 spec 原文"搜索、收藏夹、详情、下载都携带运行期凭据"中的"下载"未明确实现路径——`handle_apply_auth` 只为 hcomic 调 `downloader.configure_auth`。

**澄清**：JM 图片下载**不经全局 downloader 的 cookie 注入**。链路为：`download_manager` → `prepare_comic`（`MultiSourceParser.prepare_for_download`）→ `JmParser.get_comic_detail` 用 **parser 自身的 `self.session`**（cookie jar 已在 `_sync_cookies_to_jar` 注入运行期 cookie）解析图片 URL → `ComicDownloader` 仅按 URL 下载 JM 图片 CDN 资源（不要求 cookie 认证）。因此 JM 运行期凭据通过 `parser.session` 的 cookie jar 自然生效，无需 `handle_apply_auth` 调 `downloader.configure_auth`。

**spec 措辞修正**：需求"运行期 JM 会话凭据内存可用"的"下载"场景改为明确表述"通过 parser.session cookie jar 生效，不经全局 downloader.configure_auth"，消除歧义。

## 迁移计划

无需主动迁移。本变更生效后：
1. 老用户首次启动新版本：JM parser 以匿名状态启动，存量 cookie 残留在 config.json 不被读取。
2. 用户运行期重新登录 JM：cookie 仅入内存，关闭程序后失效。
3. 后续启动：JM 持续匿名，直至用户再次登录。

**回滚策略**：若需回退，恢复 factory lambda 从 `source_auth["jm"]` 取值、`_apply_post_init` jm 分支恢复通用 cookie/UA 注入、`handle_apply_auth` jm 分支恢复落盘即可。存量残留 cookie 在回滚后仍可被读取（前提是用户未手动删除 config.json 中该字段）。
