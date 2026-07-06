## 1. NH 认证契约

- [x] 1.1 更新 `tests/test_nh_parser.py` 的认证夹具，使用官方 `access_token` 响应，断言登录请求体包含 `username`、`password`、`pow_challenge`、`pow_nonce`、`captcha_response`，并断言 User Token 使用 `Authorization: User <token>`。
- [x] 1.2 为无前缀 API Key、显式 `User` 前缀、旧版 `Token` 前缀兼容以及“仅 User-Agent 不算已认证”补充解析器回归测试。
- [x] 1.3 修改 `sources/nh/parser.py` 的认证头构建与密码登录逻辑：API Key 使用 `Key`、User Token 使用 `User`、旧 `Token` 透明归一化，登录请求补齐空挑战字段且禁止在失败时写入伪 token。
- [x] 1.4 确认 NH parser 仍在 Session 创建后立即调用 `apply_system_proxy_to_session()`，本次认证重构不得绕过系统代理或创建未注入代理的新 Session。

## 2. NH 收藏 API 与分页

- [x] 2.1 将收藏解析器测试改为官方 `FavoriteResponse` 夹具，覆盖 GET 的 `favorited=true/false`、POST 成功确认、DELETE 成功确认以及响应缺字段不得成功。
- [x] 2.2 增加 401、404、422、429、503 响应测试，断言认证错误可被上层识别，其他失败不会被吞成成功布尔值。
- [x] 2.3 重构 `NhParser.check_favourite`、`add_to_favourites`、`remove_from_favourites`，统一校验 HTTP 状态并解析 `favorited`；仅服务端明确确认目标状态时返回成功。
- [x] 2.4 更新 NH 搜索、首页和收藏列表分页解析，优先使用 `num_pages`、兼容 `total_pages`，并新增第 3 页/总 8 页的行为断言。
- [x] 2.5 使用官方 `GalleryListItem` 最小字段夹具验证收藏列表仍能生成正确的 `ComicInfo`，避免只靠旧自造字段通过测试。

## 3. IPC 认证与随机来源防线

- [x] 3.1 扩展 `tests/test_nh_search_mixin.py`，分别覆盖未登录调用获取、检查、添加、移除 NH 收藏均产生 `AuthRequiredError`，以及 parser 返回失败时 IPC 禁止返回 `{ success: true }`。
- [x] 3.2 在 `handle_add_to_favourites`、`handle_check_favourite`、`handle_remove_from_favourites` 的 NH 分支调用 `_check_nh_auth`，并保持 `_auth_error_guard` 对 401 的统一转换。
- [x] 3.3 为 `handle_random(source="nh")` 增加回归测试，断言请求明确失败且 HComic parser 未被调用；同时守护 HComic、JM、哔咔随机行为不变。
- [x] 3.4 修改随机 IPC 的来源解析，移除未知/不支持来源静默降级到 HComic 的行为，错误信息明确指出来源不支持随机。

## 4. NH 搜索入口路由

- [x] 4.1 在 `tests/unit/pages/SearchPage.test.tsx` 增加“从 HComic 切换到 NH”测试，分别覆盖存在有效 NH 凭证和没有凭证，两种情况都必须显示最近更新、热门排行、热门标签且不得调用 `random`、`search` 或全页认证阻断。
- [x] 4.2 增加 `defaultSource="nh"` 冷启动无缓存测试，断言直接展示入口页且不自动执行空关键词搜索；保留有 NH keep-alive 缓存时恢复结果并显示“返回 NH 入口”的测试。
- [x] 4.3 将 `SOURCE_META.nh.requiresAuth` 调整为匿名浏览语义，并确保收藏页仍通过后端认证错误展示登录提示。
- [x] 4.4 重排 `SearchPage` 来源切换和初始化逻辑：NH 显式入口路由必须先于通用认证/自动加载分支，切换时清空旧漫画、分页、错误、query、mode 和标签状态。
- [x] 4.5 回归验证 NH 入口的最近更新、热门排行、排行粒度选择、热门标签精确搜索、返回入口和分页缓存行为保持正常。

## 5. 详情抽屉收藏状态提交

- [x] 5.1 改造 `ComicInfoDrawer` 测试 mock，使 `sourceSupportsFavourites` 对 NH 返回真实能力，并让 add/remove hook 可配置返回 `{ success: true|false }` 或认证异常。
- [x] 5.2 增加 NH 加入成功、加入返回 false、移除返回 false、认证失效四条交互测试，断言按钮最终状态与 Toast 文案，而不是只断言 mock 被调用。
- [x] 5.3 修改 `handleToggleFavourites` 检查 IPC `success`；成功才提交新状态，false/异常恢复操作前状态，并区分登录提示、加入失败和移除失败。
- [x] 5.4 回归检查 HComic、MoeImg、JM、哔咔详情抽屉的收藏按钮行为未被 NH 修复影响。

## 6. 契约与完整验证

- [x] 6.1 更新受影响的 NH 认证/收藏测试注释和夹具名称，移除把 `Token`、`is_favorited`、`total_pages` 当作官方主契约的陈旧描述。
- [x] 6.2 运行定向验证：`pytest tests/test_nh_parser.py tests/test_nh_search_mixin.py` 以及 `npm test -- --run tests/unit/pages/SearchPage.test.tsx tests/unit/components/ComicInfoDrawer.test.tsx`（按当前 Vitest CLI 可接受形式执行）。
- [x] 6.3 运行完整提交前验证：`pytest`、`npx tsc --noEmit`、`npm test`、`npm run lint:py`、`black --check .`、`npm run lint`、`npm run lint:test-quality`，全部通过后才完成变更。
- [x] 6.4 对 NH API Key 与账号登录两条路径做最小手工验证：匿名入口可浏览、API Key 可检查/添加/移除收藏；若账号登录被 PoW/CAPTCHA 拒绝，确认界面给出明确提示且不出现假成功。
