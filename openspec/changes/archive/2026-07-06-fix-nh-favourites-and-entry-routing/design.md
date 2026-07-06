## 上下文

NH 最初以匿名来源接入，搜索、详情、排行和标签目录均不需要账号。后续收藏夹变更把 `SOURCE_META.nh.requiresAuth` 设为 `true`，使搜索页来源切换进入通用“认证成功后加载内容”分支；该分支除 JM 外统一调用随机接口，而 NH 的 `supportsRandom` 为 `false`。更糟的是 Python `handle_random` 会把不在允许列表中的来源静默改成 HComic，最终在 NH 选中态下展示了跨来源结果，入口页因结果非空而无法渲染。

收藏链路同时存在契约漂移。当前官方 OpenAPI（`https://nhentai.net/api/v2/openapi.json`）规定 API Key 头为 `Authorization: Key <api_key>`、User Token 头为 `Authorization: User <token>`，登录请求体除用户名密码外还要求 PoW/CAPTCHA 字段，收藏响应使用 `FavoriteResponse.favorited`。现有实现使用 `Token` 前缀、遗漏登录字段、读取 `is_favorited`，并把非成功 HTTP 状态压成布尔 `False`。前端详情抽屉不检查 IPC 返回的 `success`，因此失败会显示为成功。

本变更横跨来源能力元数据、搜索页路由、Python 解析器、IPC 错误传播和详情抽屉状态机。当前工作区另有 NH 凭据持久化修复，本设计以其完成后的 `source_auth.nh` 磁盘往返能力为前提，不重复改变配置结构。

## 目标 / 非目标

**目标：**

- NH 匿名浏览与 NH 收藏认证解耦，未登录用户仍可使用搜索、详情、排行和标签目录。
- 切换到 NH 或冷启动默认来源为 NH 时稳定展示现有入口页，不触发搜索或随机请求。
- 对齐官方 API v2 的登录与收藏请求/响应契约，并让认证失效、限流、功能关闭等失败显式到达 UI。
- 消除详情抽屉收藏“假成功”，使按钮状态、Toast 与服务端结果一致。
- 修正 NH 官方列表响应的 `num_pages` 分页解析，并阻止不支持的随机来源降级为 HComic。
- 用官方响应字段构造测试夹具，覆盖真正的用户交互链路而不是只验证 mock 被调用。

**非目标：**

- 不实现 PoW 求解器、CAPTCHA 自动求解或 NH 浏览器 WebView 登录；当空 PoW/CAPTCHA 字段不足以登录时，继续提示用户使用 API Key。
- 不改变 HComic、MoeImg、JM、哔咔或拷贝漫画的正常搜索、认证和收藏语义。
- 不新增 IPC 通道、配置字段或数据库迁移。
- 不重做 NH 入口页视觉设计，也不改变热门标签数据源和排序方式。

## 决策

### 1. 将 `requiresAuth` 解释为“浏览前是否必须预验证”，NH 设为否

NH 的搜索能力本身是匿名的，只有收藏动作需要身份。`SOURCE_META.nh.requiresAuth` 将恢复为 `false`，从而避免 SearchPage 在选择 NH 时调用 `verifyAuth` 或显示全页登录阻断。收藏页和收藏动作不依赖该前端能力位，而由后端 `_check_nh_auth` 与真实 API 响应独立保护。

替代方案是在 `SearchPage` 中保留 `requiresAuth=true` 并增加 NH 特判。该方案会继续把“来源可浏览性”和“某项能力需认证”混为一谈，其他搜索入口仍可能误用该标志，因此不采用。

### 2. NH 入口路由先于通用认证/自动加载分支

来源切换到 NH 时必须同步重置 query、mode、selected tags、错误、分页和漫画列表，然后停留在 `viewingNhEntry=false` 的入口状态，不发起 `search` 或 `random`。冷启动读取到 `defaultSource=nh` 且没有可恢复的搜索缓存时采用同样行为；从 keep-alive 缓存返回时仍可恢复用户之前的 NH 结果，并保留“返回 NH 入口”的操作。

该顺序使入口状态成为显式路由，而不是“恰好 comics 为空时出现”的偶然副作用。Bika 分类入口和 JM 首页逻辑保持现状。

### 3. 不支持的随机来源必须失败，禁止跨来源回退

Python `handle_random` 必须按共享来源能力/明确允许集合校验来源。对 NH、MoeImg、CopyManga 等不支持随机的来源返回校验错误，禁止把 `effective_source` 改成 HComic。前端仍只对 `supportsRandom=true` 的来源展示随机按钮。

严格失败可能暴露此前被静默掩盖的错误调用，但这是所需行为：跨来源返回内容会污染缓存、下载元数据和用户判断，风险高于显式报错。

### 4. 认证头由持久化值的语义前缀决定

- 无前缀值继续解释为 API Key，构造 `Key <value>`。
- `User <token>` 原样使用，账号登录成功后持久化此形式。
- 兼容当前错误版本已保存的 `Token <token>`：运行期归一化为 `User <token>`，避免用户升级后必须重新登录。
- Cookie + User-Agent 继续作为既有备用路径；但仅有 User-Agent 不再算作已配置认证。

登录请求体按官方 schema 发送 `username`、`password`、`pow_challenge`、`pow_nonce`、`captcha_response`，后三项默认空字符串。读取官方 `access_token`，同时可保留对旧测试/兼容响应字段的防御性读取。若服务端要求真实 PoW/CAPTCHA，解析器必须返回可操作错误而非伪造成功。

### 5. 收藏方法以 `FavoriteResponse.favorited` 和 HTTP 状态共同决定结果

三个动作均通过共享的 JSON 请求辅助逻辑处理：

- `GET .../favorite`：200 时返回 `favorited`。
- `POST .../favorite`：200 且 `favorited=true` 才返回成功。
- `DELETE .../favorite`：200 且 `favorited=false` 才返回成功。

401 必须转换为项目统一的 `AuthRequiredError`；422、429、503 及其他非成功状态必须作为明确错误传播。禁止把这些状态吞成 `False` 后继续显示成功。IPC 的三个 NH 收藏动作在调用 parser 前都执行 `_check_nh_auth`，与 `handle_get_favourites` 对齐。

### 6. 前端以 IPC 结果提交状态，失败时回滚

`ComicInfoDrawer.handleToggleFavourites` 必须读取 `{ success }`。仅 `success===true` 时更新为已收藏/未收藏并显示成功 Toast；`false` 或异常时恢复操作前状态并显示失败或登录提示。初始 `checkFavourite` 失败不得被解释成“确定未收藏”，但可回到可重试的 idle 状态并在用户动作时重新获得明确结果。

### 7. 官方分页字段优先，旧字段仅作兼容

NH 搜索、首页和收藏列表的官方分页字段是 `num_pages`。解析器统一优先读取 `num_pages`，在缺失时回退 `total_pages`，最后回退当前页。测试夹具必须至少包含一组官方字段，避免继续用错误 mock 固化实现。

## 风险 / 权衡

- **[历史 `Token` 值已落盘]** → `_build_auth_header` 兼容映射为 `User`，并增加重启恢复测试。
- **[密码登录可能需要非空 PoW/CAPTCHA]** → 本次只对齐请求结构并显式报错；API Key 仍是推荐且稳定的主路径。
- **[将 NH 的 `requiresAuth` 改为 false 可能误伤收藏页]** → 收藏页直接调用收藏 IPC，后端 `_check_nh_auth` 是最终闸门；增加未登录收藏页和详情抽屉测试确认。
- **[严格随机校验暴露既有调用错误]** → 增加所有支持随机来源的正向回归测试，并验证 NH 不再调用随机。
- **[OpenAPI 将来漂移]** → 测试只固化本次使用的最小字段集合，并保留有限兼容字段，不复制完整 schema。
- **[缓存恢复与入口页冲突]** → 区分冷启动无缓存和 keep-alive 有缓存；仅前者强制入口，后者恢复用户上下文并提供返回入口。

## 迁移计划

1. 先落地解析器认证/收藏契约与测试，使 API 行为可验证。
2. 再收紧 IPC 认证检查和随机来源校验。
3. 最后调整来源能力位、SearchPage 入口路由和详情抽屉状态提交逻辑。
4. 运行 NH 定向测试后执行项目完整七项验证流程。

无需配置或数据库迁移。已有 `Token <token>` 在运行期透明兼容；回滚时可恢复旧代码与能力位，不影响配置文件可读性。

## 待确认问题

无阻塞性问题。若实际服务端对账号登录要求非零难度 PoW 或 CAPTCHA，应另建变更实现交互式挑战，不在本修复中扩大范围。
