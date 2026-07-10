# HComic Downloader

<p align="center">
  <img src="assets/icon.svg" alt="HComic Downloader Logo" width="128">
</p>

一个跨平台的漫画下载与管理工具，基于 Electron + React + TypeScript 前端 + Python 后端构建，支持多个漫画来源的搜索、下载、阅读、收藏管理和数据迁移。

## 功能特性

### 多来源支持

| 来源        | 站点           | 搜索  | 收藏  | 登录方式                       |
| --------- | ------------ | --- | --- | -------------------------- |
| hcomic    | h-comic.com  | ✅   | ✅   | curl 导入 / 应用内用户名密码 / 内嵌浏览器 |
| moeimg    | moeimg.fan   | ✅   | ✅   | curl 导入 / 应用内用户名密码         |
| jm   | jm（含镜像） | ✅   | ✅   | curl 导入 / 内嵌浏览器            |
| bika      | 哔咔           | ✅   | ✅   | 应用内用户名密码（API 登录）           |
| nh        | nhentai.net  | ✅   | ✅   | API Key（账号密码登录已移除，升级时清理旧凭据）|
| copymanga | 拷贝漫画         | ✅   | —   | curl 导入（Cookie）                    |

- **搜索模式**：`keyword`（关键词）、`author`（作者）、`tag`（标签）、`ranking`（排行榜）
- **随机推荐**：hcomic、jm、bika 支持
- **漫画详情**：封面预览、标签、作者、章节列表（含 `album` 多章节本）

### 搜索与浏览

- 多模式搜索 + 来源切换
- 随机推荐
- 封面预览（域名白名单 + 异步线程池 + 磁盘缓存）
- 标签黑名单过滤（按来源分组）
- SFW 模式（默认开启，启动时自动应用，隐藏封面图）

### 下载管理

- 多任务并发下载（线程数 1-10 可调）
- 任务控制：暂停 / 恢复 / 重试 / 取消
- 全局暂停开关
- 自动重试（可配置 0-5 次）
- 批量下载（可配置 0-60 秒间隔延迟）
- 下载冲突检测（占用目标路径时提示）
- 输出格式：`folder` / `zip` / `cbz`（CBZ 内嵌 `ComicInfo.xml`，文件名模板支持 `{author}` / `{title}` / `{id}` 占位符）
- 章节级下载（`chapterIds` 选择性下载）
- 断点续传

### 本地漫画库

- “漫画库”工作区同时提供本地书库与原有“下载任务”页签；切换到书库浏览时，下载任务仍会在后台持续更新
- 以设置中的 `downloadDir` 作为唯一书库根目录，支持顶层 CBZ、ZIP、单本图片文件夹及多章节图片文件夹
- 首次打开或更换下载目录后会扫描书库；后续下载完成、重命名或编辑会增量更新，也可手动刷新或取消扫描
- 书库索引保存在独立 SQLite 数据库中，仅作为可重建缓存；索引损坏或删除不会修改漫画文件，重新扫描即可恢复
- 支持搜索、来源/格式/健康状态筛选、排序、网格/列表视图、详情查看、章节阅读与阅读进度续读
- 支持在文件管理器中显示、单项健康检查、安全重命名、元数据编辑和删除；删除使用操作系统回收站，不直接永久删除文件
- CBZ 元数据编辑会原子写回唯一的 `ComicInfo.xml`；ZIP 与文件夹只保存应用内索引覆盖值，不改写原文件内容

> 当前采用单根目录模型：漫画库只索引 `downloadDir` 下的内容。不要依赖 `library.db` 作为数据备份，漫画文件始终是事实来源。

### 内置漫画阅读器

- 翻页浏览模式 + 缩放控制
- 章节切换（适用于多章节本）
- 图片懒加载 + 本地缓存（避免重复下载）
- 阅读进度自动写入历史（支持续读）

### 收藏与历史

- 收藏夹（hcomic / jm / moeimg / bika / nh）
- 阅读历史记录（最近阅读、章节定位）
- 收藏标签推荐与高亮（从收藏夹提取标签，搜索结果中高亮推荐标签）
- 批量选择 + 批量下载

### 其他功能

- 工具箱标签页（标签过滤、推荐标签管理、重复漫画检测、查缺补漏）
- 维护中心：下载健康检查、孤儿临时目录清理、存储空间分析
- 亮色 / 暗色 / 跟随系统 三种主题
- 自定义字体（跨平台 CJK 字体自动检测）与字号（12-20）
- 代理设置（HTTP / HTTPS / NO_PROXY 系统代理）
- 数据迁移工具（`full` 完整迁移 / `repair` 修复模式 + 未匹配项手工配对）
- 缓存管理（封面缓存、预览缓存独立统计与清理）
- 系统通知（下载完成提醒，前台/后台策略可配）
- 自定义协议 `hcomic://` 唤起
- 单实例运行锁定

## 技术架构

```
┌────────────────────────────────────────────────┐
│              Electron 主进程 (TypeScript)       │
│   窗口管理 · 单实例锁 · IPC 路由 · 输入验证         │
│   CSP · Referer 注入 · 域名白名单 · 协议注册       │
├──────────────────┬─────────────────────────────┤
│  React 渲染进程   │        Python 后端           │
│  TypeScript      │   解析 · 下载 · 打包 · 缓存    │
│  Tailwind CSS    │   JSON-RPC 2.0 over         │
│  Zustand         │   stdin/stdout              │
│  electron-vite   │                             │
└──────────────────┴─────────────────────────────┘
```

### 前端技术栈

- **Electron 42** — 桌面容器（contextIsolation + sandbox）
- **React 18** + **TypeScript 5.3** — UI 框架
- **Zustand 4** — 状态管理
- **Tailwind CSS 3.4** — 样式
- **electron-vite 5** + **Vite 5** — 构建 / 开发服务器
- **Vitest 4** + Testing Library — 单元测试（91 个 TS/TSX 测试文件，68 个 Python 测试文件）

### 后端技术栈

- **Python 3.12+**（开发与 CI 使用 3.13）— 爬取与下载引擎
- **requests** / **curl_cffi** — HTTP 客户端（curl_cffi 处理 TLS 指纹）
- **Pillow** — 图片处理
- **PyInstaller** — 打包为单文件可执行
- **JSON-RPC 2.0** — 与 Electron 主进程通过 stdin/stdout 通信

### 安全措施

- **渲染隔离**：Context Isolation + Sandbox + `webviewTag: false`
- **CSP**：根据开发/生产环境分别下发内容安全策略
- **输入校验**：所有 IPC 通道参数严格校验（类型、长度、范围、路径遍历防护、控制字符过滤）
- **域名白名单**：外部链接、封面图、预览图均使用白名单（`h-comic.com` / `moeimg.fan` / `18comic.vip` 等 + jm 镜像动态注入）
- **防盗链**：对 `h-comic.link` / `moeimg.fan` 等图片域注入对应 Referer
- **配置文件权限**：仅当前用户可读写（0o600）
- **原子写入**：配置文件使用 `temp + rename` 防止损坏
- **优雅关闭**：关闭时检测活动下载任务，提示用户确认

## 项目结构

```
hcomic_downloader/
├── electron/                  # Electron 主进程
│   ├── main.ts                # 入口：窗口、CSP、单实例、IPC 路由、协议注册
│   ├── preload.ts             # 预加载脚本（contextBridge + 参数校验）
│   ├── python-bridge.ts       # Python 子进程桥接（stdin/stdout + 重启）
│   ├── login-window.ts        # 内嵌登录窗口（hcomic / jm）
│   ├── login-preload.ts       # 登录窗口预加载脚本
│   ├── validators.ts          # IPC 参数验证器（组合式）
│   ├── image-protocol.ts      # 自定义协议托管图片
│   ├── csp-relaxed-registry.ts # CSP 策略按环境分发
│   ├── update-checker.ts      # 启动更新检查
│   ├── notification-manager.ts# 系统通知
│   ├── diagnostics.ts         # 客户端日志与错误诊断
│   ├── jm-challenge-recovery.ts # JM 反爬挑战恢复
│   └── log-init.ts            # 日志初始化
│
├── src/                       # React 前端
│   ├── main.tsx               # 入口
│   ├── App.tsx                # 根组件（路由 + 主题 + 全局模态）
│   ├── pages/                 # 页面
│   │   ├── SearchPage.tsx
│   │   ├── DownloadPage.tsx
│   │   ├── FavouritesPage.tsx
│   │   ├── HistoryPage.tsx
│   │   ├── ToolboxPage.tsx    # 工具箱（标签过滤 / 推荐标签 / 重复检测 / 查缺补漏）
│   │   ├── MaintenancePage.tsx # 维护中心（健康检查 / 孤儿清理 / 存储分析）
│   │   ├── SettingsPage.tsx
│   │   └── AboutPage.tsx
│   ├── components/            # 业务组件（Reader / Drawer / Sidebar / ChapterPicker 等）
│   ├── components/common/     # 通用组件（Toast / Pagination / ProgressBar 等）
│   ├── components/maintenance/# 维护中心面板（HealthCheckPanel / OrphanCleanupPanel / StorageStatsPanel）
│   ├── components/settings/   # 设置面板分组（外观 / 下载 / 认证 / 通知 / 代理 / 缓存 / 标签过滤 / 推荐标签 / 迁移）
│   ├── components/tools/      # 工具箱组件（DuplicateDetector / MissingChapterDetector 等）
│   ├── hooks/                 # React hooks（useIpc / useTheme / useComicReader / useMigration 等）
│   ├── stores/                # Zustand 状态仓库（12 个）
│   ├── lib/                   # 工具库（anim 动画 variants / image-url / prefetch / scheduler）
│   └── styles/                # 全局样式
│
├── python/                    # Python 后端
│   ├── ipc_server.py          # JSON-RPC 2.0 服务器入口
│   ├── hcomic_backend.spec    # PyInstaller 打包配置
│   ├── maintenance/           # 维护中心模块（scanner / health_checker / orphan_cleaner / storage_analyzer）
│   └── ipc/                   # IPC 功能模块（mixin 拆分）
│       ├── search_mixin.py
│       ├── cover_mixin.py
│       ├── preview_mixin.py
│       ├── download_mixin.py
│       ├── config_mixin.py
│       ├── auth_mixin.py
│       ├── migration_mixin.py
│       ├── maintenance_mixin.py # 维护中心（健康检查 / 孤儿清理 / 存储分析）
│       ├── history_mixin.py
│       ├── favourite_tags_mixin.py  # 收藏标签推荐
│       ├── tag_list_mixin.py        # 标签列表
│       ├── cover_cache.py     # 封面缓存（SQLite）
│       ├── preview_cache.py   # 预览图片缓存（带大小上限）
│       ├── image_utils.py
│       └── types.py
│
├── sources/                   # 漫画来源解析器
│   ├── __init__.py            # MultiSourceParser 分发层
│   ├── base.py                # 解析器基类（ParserContextMixin）
│   ├── hcomic/                # h-comic 解析器
│   ├── moeimg/                # moeimg 解析器
│   ├── jm/               # jm 解析器（含反混淆）
│   │   ├── parser.py
│   │   ├── descrambler.py     # 图片反混淆
│   │   ├── session.py         # 认证与请求
│   │   ├── domain.py          # 镜像域名管理
│   │   ├── title_resolver.py  # 标题解析
│   │   └── constants.py
│   ├── bika/                  # 哔咔解析器（API 登录 + 收藏夹）
│   │   ├── parser.py
│   │   └── constants.py
│   ├── nh/                    # nhentai 解析器（API Key + 收藏夹）
│   │   ├── parser.py
│   │   └── constants.py
│   └── copymanga/             # 拷贝漫画解析器（AES 解密）
│       ├── parser.py
│       ├── crypto.py          # AES-CBC 解密工具
│       └── constants.py
│
├── shared/                    # 前后端共享类型
│   └── types.ts               # TypeScript 类型 + IPC 通道常量 + JSON-RPC 契约 + 来源元数据
│
├── assets/                    # 应用图标
│   ├── icon.svg / icon.ico / icon.icns / icon.png
│   └── icon_16/32/48/64/128/256/512.png
│
├── docs/                      # 文档（含 animation-performance.md、规划/设计稿）
│
├── scripts/                   # 构建与工具脚本
│   ├── lint-py.mjs            # 跨平台 Python lint 封装（ruff）
│   ├── format-py.mjs          # Python 格式化封装（black）
│   ├── lint-test-quality.mjs  # 测试质量闸门（前端 + Python）
│   ├── lint-test-quality.py   # Python AST 扫描（裸 mock 调用断言检测）
│   ├── generate-icons.mjs     # 图标生成
│   ├── set-version-from-tag.mjs # 从 git tag 提取版本号写入 package.json
│   └── extract-changelog.py   # CHANGELOG 提取
│
├── tests/                     # 测试
│   ├── test_*.py              # Python 单元测试（68 个）
│   └── unit/                  # TypeScript/React 单元测试（91 个）
│
├── config.py                  # 配置管理（dataclass + JSON 持久化）
├── downloader.py              # 多线程下载器（断点续传 + 重试）
├── download_manager.py        # 下载任务队列与状态机
├── download_history.py        # 下载历史数据库（SQLite）
├── album_coordinator.py       # 多章节本下载编排
├── output_staging.py          # 输出暂存（临时目录 + 原子移动）
├── cbz_builder.py             # CBZ 打包 + ComicInfo.xml 生成
├── auth_parser.py             # 从 curl 命令提取 Cookie / User-Agent
├── url_validator.py           # URL 校验工具
├── migration.py               # 迁移引擎（计划、执行、状态持久化）
├── constants.py
├── utils.py                   # 系统代理注入 / 会话工厂等通用工具
├── image_downloader.py
├── image_formats.py
├── models.py                  # 数据模型（ComicInfo / PaginationInfo / DownloadTask）
│
├── electron-builder.yml       # 打包配置
├── electron.vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── vitest.config.ts
├── eslint.config.js           # flat config（含自定义规则 eslint-rules/test-quality.js）
├── tsconfig.json
├── pyproject.toml
├── package.json
├── requirements.txt           # Python 依赖
├── requirements-dev.txt       # Python 开发依赖
└── README.md
```

## 开发

### 环境要求

- **Node.js** >= 18
- **Python** >= 3.12（推荐 3.13）
- **Git**

### 安装依赖

```bash
# Node.js 依赖
npm install

# Python 依赖（含系统通知等可选依赖）
pip install -r requirements.txt

# Python 开发依赖（pytest、pyinstaller 等）
pip install -r requirements-dev.txt
```

### 启动开发服务器

```bash
npm run dev
```

开发模式下，`electron-vite` 启动 Vite 开发服务器并加载 Electron 主进程，主进程通过 `python-bridge.ts` 自动 spawn Python 子进程（`python python/ipc_server.py`），前端通过 IPC 与 Python 通信，热重载生效。

### 构建

```bash
# 完整构建当前平台安装包
npm run build:win       # Windows（NSIS）
npm run build:mac       # macOS（DMG，x64 + arm64）
npm run build:linux     # Linux（AppImage）

# 各阶段单独执行
npm run build:python    # 仅打包 Python 后端（PyInstaller → python/dist/python/）
npm run build           # 仅构建前端 + 主进程（electron-vite build）
```

> `build:win/mac/linux` 会先执行 `build:python` 把 Python 后端打入 `python/dist/`，再构建 Electron 并用 `electron-builder` 打包。

### 测试

```bash
# 前端（vitest）
npm test                 # 一次性运行
npm run test:watch       # 监视模式
npm run test:coverage    # 生成覆盖率报告
npm run test:ui          # 打开 Vitest UI

# 后端（pytest）
pytest                   # 全部测试
pytest tests/test_models.py              # 单文件
pytest tests/test_models.py::TestComicInfo::test_default_values  # 单个用例
pytest --cov=. --cov-report=html         # 覆盖率
```

### 代码检查

```bash
# TypeScript / React（ESLint）
npm run lint
npm run lint:fix

# Python（ruff + black，均通过跨平台封装脚本调用 venv）
npm run lint:py          # ruff 检查
npm run lint:py:fix      # ruff 自动修复
npm run format:py        # black 检查（--check）
npm run format:py:fix    # black 格式化

# 测试质量闸门（拦截裸 mock 调用断言 / 纯 store CRUD 往返）
npm run lint:test-quality        # 前端 + Python 全量
npm run lint:test-quality:py     # 仅 Python AST 扫描
```

## 配置

应用配置存储在用户数据目录下的 JSON 文件中（`~/.hcomic_downloader/config.json`），支持以下配置项：

| 配置项                       | 类型      | 说明                   | 默认值                                  | 范围                                                     |
| ------------------------- | ------- | -------------------- | ------------------------------------ | ------------------------------------------------------ |
| `themeMode`               | string  | 主题模式                 | `auto`                               | `light` / `dark` / `auto`                              |
| `outputFormat`            | string  | 输出格式                 | `folder`                             | `folder` / `zip` / `cbz`                               |
| `downloadDir`             | string  | 下载目录                 | `~/Downloads/hcomic`                 | 绝对路径                                                   |
| `concurrentDownloads`     | number  | 并发下载线程数              | 4                                    | 1-10                                                   |
| `timeout`                 | number  | 请求超时（秒）              | 30                                   | 5-300                                                  |
| `retryTimes`              | number  | 单请求重试次数              | 3                                    | 0-10                                                   |
| `cbzFilenameTemplate`     | string  | CBZ 文件名模板            | `{author}-{title}.cbz`               | 占位符 `{author}` `{title}` `{id}`                        |
| `batchDownloadDelay`      | number  | 批量下载间隔（秒）            | 1                                    | 0-60                                                   |
| `autoRetryMaxAttempts`    | number  | 失败自动重试次数             | 2                                    | 0-5                                                    |
| `notifyOnComplete`        | boolean | 下载完成系统通知             | `true`                               | —                                                      |
| `notifyWhenForeground`    | string  | 通知触发策略               | `inactive`                           | `inactive` / `always`                                  |
| `defaultSource`           | string  | 默认搜索来源               | `hcomic`                             | `hcomic` / `moeimg` / `jm` / `bika` / `copymanga` / `nh` |
| `defaultFavouriteSource`  | string  | 默认收藏夹来源              | `""`（未设置，前端引导选择）                      | 同上，且需支持收藏                                             |
| `fontName`                | string  | 自定义字体                | `""`（自动检测 CJK）                       | —                                                      |
| `fontSize`                | number  | 基础字号                 | 12                                   | 12-20                                                  |
| `sfwMode`                 | boolean | SFW 安全模式（隐藏封面）       | `true`                               | —                                                      |
| `cardStyle`               | string  | 卡片样式                 | `cover`                              | `cover`（封面+标题）/ `detailed`（详细列表）                       |
| `tagBlacklist`            | object  | 标签黑名单（按来源）           | 各来源空数组                               | 每项 ≤ 64 字符                                             |
| `myTags`                  | object  | 推荐标签白名单（按来源，搜索高亮生效源） | 各来源空数组                               | —                                                      |
| `duplicateBlacklist`      | object  | 重复检测已忽略组（按来源）        | 各来源空数组                               | 每项 `{fingerprint, memberCount}`                        |
| `missingBlacklist`        | object  | 查缺补漏已忽略组（按来源，独立存储）   | 各来源空数组                               | 每项 `{fingerprint, memberCount}`                        |
| `previewCacheSizeLimitMB` | number  | 预览缓存上限（MB）           | 500                                  | 100-2048                                               |
| `jmDomain`                | string  | jm 自定义域名             | `""`（自动）                             | —                                                      |
| `favouriteTagHighlight`   | boolean | 收藏标签推荐高亮             | `false`                              | —                                                      |
| `favouriteTagMinMatches`  | number  | 推荐标签最少命中数            | 1                                    | ≥ 1                                                    |
| `checkUpdateOnStart`      | boolean | 启动时检查更新              | `true`                               | —                                                      |
| `bikaImageQuality`        | string  | Bika 预览图片清晰度（下载始终原画） | `original`                           | `low` / `medium` / `high` / `original`                 |
| `previewPreloadForward`   | number  | 阅读器向前预加载页数           | 8                                    | 0-30（0 禁用）                                            |
| `previewPreloadBackward`  | number  | 阅读器向后预加载页数           | 2                                    | 0-10                                                   |
| `previewPreloadConcurrency` | number | 预加载并发 worker 数       | 3                                    | 1-6                                                    |
| `previewPreloadAdaptive`  | boolean | 自适应预加载（按翻页速度动态调节）    | `false`                              | —                                                      |

## 致谢

感谢以下开源项目提供的灵感与参考：

- [ComicGUISpider](https://github.com/jasoneri/ComicGUISpider) — 漫画下载工具
- [haka_comic](https://github.com/raoxwup/haka_comic) — 漫画下载工具

## 许可证

[MIT License](LICENSE)
