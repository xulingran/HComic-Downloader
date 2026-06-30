# Changelog

本项目所有重要变更均记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本管理遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

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

[1.7.0]: https://github.com/xulingran/HComic-Downloader/releases/tag/1.7.0
[1.6.0]: https://github.com/xulingran/HComic-Downloader/releases/tag/1.6.0
