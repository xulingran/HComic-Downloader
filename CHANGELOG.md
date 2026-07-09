# Changelog

本项目所有重要变更均记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本管理遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

## [Unreleased]

## [2.0.0] - 2026-07-09

> 本版本因 NH 认证方式发生不兼容变更，主版本号升至 2.0.0。

### 🚀 新增（Added）

#### 来源与内容
- **nh**：新增 nhentai 认证与收藏夹支持。
  - 支持 API Key（`Authorization: Key <key>`）认证方式。
  - 支持拉取收藏夹、加入收藏、取消收藏与查询收藏状态。
  - 收藏夹页来源选择器新增 NH 选项。
- **nh**：补充登出 / 清除凭证功能。
- **nh**：新增中文语言筛选。
- **nh**：热门标签按热度分档呈现，复用 stagger 动画。
- **jm**：搜索页接入 Cloudflare 人机验证恢复机制。
- **jm**：搜索挑战恢复增加 DOM 快照兜底 + TLS 指纹对齐。
- **moeimg**：独立采集 parody 与 characters，不再混入 tags。
- **favourites**：新增收藏来源侧边栏。

#### UI 与交互
- **设置页**：新增 NH 认证区域，提供 API Key 输入、应用、登录状态检测与清除认证按钮。
- **search**：加载遮罩分级为轻 / 重两档，换来源时更直观。
- **reader**：统一预览加载中占位为阅读器背景色 + spinner。
- **login**：叠层改为胶囊一步触发并显眼呈现。
- **ui**：加深标签推荐高亮色值，提升深色背景下辨识度。

#### 认证与登录
- **jm**：会话凭据改为会话级，禁止持久化与启动恢复。

#### 工程与测试
- 更新 `tests/unit/main/main.test.ts` 与 `FavouriteSourceSidebar.test.tsx`，覆盖 NH 新增 IPC 通道与收藏夹来源。

### ⚠️ 变更（Changed）

#### 来源与内容
- **nh**（BREAKING）：移除 NH 账号密码登录入口与相关 IPC / 解析器能力，API Key 成为 NH 唯一受支持、唯一可配置、唯一可恢复的认证方式。
  - 设置页移除 NH 用户名、密码、显示密码与账号密码登录按钮，仅保留 API Key 输入、应用、测试与清除控件；已保存的 API Key 不再明文回填。
  - 移除前端 `nhLogin` / `python:nh-login` / Python `nh_login` / `NhParser.login()` / 账号密码存储，新增专用 `nhApplyApiKey` / `python:nh-apply-api-key` / `nh_apply_api_key` / `handle_nh_apply_api_key` 链路。
  - NH 认证契约收敛为 `Authorization: Key <api_key>`；User Token、Cookie、User-Agent 不再作为 NH 登录方式。
  - 配置归一化在升级时清空 `source_auth.nh` 中的 username/password/cookie/user_agent 以及带 `User ` / `Token ` / `Bearer ` 前缀的旧 bearer_token，并通过既有原子写入一次性回写磁盘；保留无前缀或 `Key ` 前缀的有效 API Key。
  - 通用 curl `apply_auth` 对 NH 来源禁用，必须走专用 API Key handler。
  - 其他来源（hcomic、moeimg、jm、bika、copymanga）的认证方式不受影响。
- **jm**：收藏夹禁用相邻页预加载，避免 Cloudflare 挑战请求放大。

### 🐛 修复（Fixed）

#### 阅读器
- 修复首次挂载后滚轮翻页永久失效。
- 翻页方向推断改为渲染期间同步，修复逆向连续翻页方向错误。
- 翻页动画端点改为完全透明，修复旧页滑出后突然消失。
- 缩小预览模式翻页触发区至左右边缘，中央保留拖拽安全区。
- 切换显示模式时叶子组件回写共享缓存，避免重载。
- 清除认证时归零运行期状态，换章清空图片缓存。

#### 搜索
- 修复搜索栏打字 / 删除时结果列表闪烁。
- 清除全部标签也透传交互挑战恢复标志。

#### 来源与路由
- **nh**：修复认证、收藏夹与入口路由；入口子功能内搜索后保留「返回 NH 入口」按钮。
- **comic-card**：卡片 body 点击回退到详情抽屉，消除死区。
- **favourites**：来源侧栏 sticky 位置不受右侧内容高度影响。
- **history**：封面卡片来源行加正向留白与顶部分割线。
- **dev**：修复冷启动 TUN 代理劫持 dev server 首次加载。
- 修复数据库重建与迁移状态生命周期。

### 📝 文档
- 同步 `README.md` 与 `AGENTS.md` 至真实项目结构。
- 补全 / 标记多个 OpenSpec 主规范的「目的」段落与任务状态。

### 🔧 工程
- 清理 JM 挑战恢复工作的过程记录文件。
- 归档多个 OpenSpec 变更并同步主规范（nh-auth-favorites、fix-favourite-tags-review-issues、add-jm-home-sections、fix-jm-search-challenge-target-validation）。
- 修复 cookie-escape 探测假阳性，探测与调用复用同一命令。
- 格式化 `extract-changelog.py` 以符合 black 行长。
- 修复 OpenSpec 规范格式。

## [1.7.0] - 2026-06-30

### 🚀 新增（Added）

#### 平台
- **Electron 28 → 42**：修复 Cloudflare 人机验证无法渲染的问题。
- 启动封面缓存迁移至文件存储，解析器改为懒加载，显著降低冷启动开销。

#### 来源与内容
- **moeimg**：补全漫画元数据获取与显示（category / language / 更新时间）。
- **jm**：原 `jmcomic` 来源重命名为 `jm`。
- **jm**：实现收藏夹交互式人机验证（captcha）恢复；一次验证支持多页浏览，弱 captcha 标记不再误判已渲染收藏夹。
- **nh**：完善标签目录排序与精确搜索。
- **nh**：热门排行支持「今日 / 本周 / 本月」时间粒度切换。

#### UI 与交互
- **侧边栏**：支持收起 / 展开，展开时在图标右侧显示标题。
- **推荐标签收藏**：用户可主动收藏推荐标签，按来源隔离高亮。
- **收藏夹**：新增来源选择器与默认来源配置。
- **搜索 / 收藏夹页**：统一列表加载反馈。
- **预览**：失败页超阈值时弹出常驻 Toast，支持一键批量重试。
- **阅读器**：标题栏标题改为占满剩余宽度。

#### 登录与认证
- 新增手动 Cookie 输入覆盖层（manual cookie overlay）。
- 登录弹窗成功倒计时由 5s 缩短至 3s。
- 设置面板预填充已保存的密码。

#### 工程与测试
- 建立测试质量闸门（由 warn 升级为 error 级别）并接入提交前流程，拦截「仅断言 mock 被调用」的测试与纯 store CRUD 往返。

### 🐛 修复（Fixed）

#### 认证与登录
- 登录失败时仍持久化账号密码，`apply_auth` 不再覆盖既有凭据。
- 修复 JM 弹窗登录后的收藏夹认证。
- 修复 preview 伪成功与认证并发竞态。
- 测试隔离真实配置文件，不再清空 `source_auth` cookie 与账号密码。

#### 来源与解析
- **nh**：将 nhentai 图片域名加入预览白名单。
- **sources**：懒创建并发加固并修复回归测试。
- **抽屉**：增加标签补全失败反馈与重试。

#### UI 与 IPC
- `myTags` 纳入 `CONFIG_KEYS` 白名单，恢复推荐标签持久化。
- 修复阅读器翻页动画卡顿。
- 修复 cover 模式翻页时封面从左上角飞入。
- 按来源能力门控推荐入口，并修复连续 Toast 提前关闭。
- 对齐屏蔽占位符封面卡片高度与正常卡片一致。
- 登录浮标叠层固定在右上角，不可拖动。
- 闭合 favourite tags 同步进度 IPC，修复 HEAD 编译失败。
- 切换来源清空 favourite tags 进度残留，并修复 Toast 测试假阳性。
- `useTagListProgress` 切换来源时清空旧进度残留。
- 切换来源后中断旧 `contextKey` 的 in-flight 预加载请求。
- 迁移日志首次执行时以 `'w'` 模式截断清空，避免残留。

### ⚡ 性能（Performance）

- **图片管道**：改用 `app-image://` 协议，消除全栈 base64 冗余拷贝。
- **tab 切换**：keep-alive + idle prefetch 优化。
- **jm**：优化收藏夹人机验证恢复路径。

### ♻️ 变更（Changed）

- 抽取 `useSearchPreloader` 并补充 `signal.aborted` 集成测试。
- 消除 tag-favourites / sidebar 审查标记的重复实现与 toast 泄漏。
- 将 UI 文案与代码注释中的 `nhentai` 统一改为 `NH`。
- 简化 Python 测试闸门：`assert_called_with` 系列一律放行。
- 清理死代码并合并逐行同构的重复实现。
- 清理同义反复测试，建立 test-discipline-gate 变更并归档相关 openspec 提案。

## [1.6.0] - 2026-06-24

首次建立发布流水线的稳定版本。

[2.0.0]: https://github.com/xulingran/HComic-Downloader/releases/tag/2.0.0
[1.7.0]: https://github.com/xulingran/HComic-Downloader/releases/tag/1.7.0
[1.6.0]: https://github.com/xulingran/HComic-Downloader/releases/tag/1.6.0
