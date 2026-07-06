## 为什么

NH 来源新增认证与收藏夹后，搜索页把“收藏操作需要认证”错误提升成“整个来源浏览都需要认证”，导致用户切换到 NH 时跳过既有入口页并触发不受支持的随机请求；同时 NH 收藏实现与官方 API v2 契约存在请求头、登录请求体和响应字段偏差，详情抽屉还会把后端返回的 `success: false` 当作成功，造成“点击加入收藏夹但实际未收藏”的假成功体验。

## 变更内容

- 恢复 NH 搜索、详情、排行和标签目录的匿名浏览语义，仅在收藏夹相关操作中要求 NH 认证。
- 修复搜索页切换到 NH 及以 NH 作为默认来源时的入口路由：初始状态展示“最近更新 / 热门排行 / 热门标签”，不得自动随机或混入其他来源结果。
- 对齐 NH 官方 API v2 认证契约：API Key 使用 `Key`，账号登录返回的 User Token 使用 `User`，登录请求补齐官方要求的 PoW/CAPTCHA 字段。
- 对齐 NH 收藏接口的 `FavoriteResponse.favorited` 响应，并让 401、422、429、503 等失败通过统一错误链路显式传到前端。
- 详情抽屉必须检查收藏 IPC 的 `success` 值；只有真实成功后才能切换按钮状态并显示成功提示。
- 修正 NH 列表分页字段兼容，优先读取官方 `num_pages`，同时保留对既有 `total_pages` 测试夹具或旧响应的兼容。
- 收紧随机请求的来源校验：不支持随机的来源必须明确失败，禁止静默降级为 HComic。
- 增加基于官方 OpenAPI 结构的解析器、IPC 和真实交互回归测试，覆盖 NH 来源切换、默认入口、收藏成功、收藏失败和认证失效。

## 功能 (Capabilities)

### 新增功能

无。

### 修改功能

- `nh-authentication`: 明确匿名浏览与收藏认证的边界，并修正账号登录请求体、User Token 前缀和认证有效性判定。
- `nh-favourites`: 对齐官方收藏响应与错误语义，禁止后端失败被前端显示为成功，并修正收藏列表分页字段。
- `nh-entry-page`: 保证切换或默认进入 NH 时先展示入口页，禁止触发随机请求或跨来源降级。

## 影响

- Python：`sources/nh/parser.py`、`python/ipc/search_mixin.py`、必要的 NH 认证持久化兼容逻辑。
- 前端：`shared/types.ts` 的来源能力元数据、`src/pages/SearchPage.tsx`、`src/components/ComicInfoDrawer.tsx`。
- 测试：`tests/test_nh_parser.py`、`tests/test_nh_search_mixin.py`、`tests/unit/pages/SearchPage.test.tsx`、`tests/unit/components/ComicInfoDrawer.test.tsx` 及相关 IPC 契约测试。
- 外部契约：以 `https://nhentai.net/api/v2/openapi.json` 为 NH API v2 请求与响应结构的真相源；不新增依赖、不改变 IPC 通道名称。
