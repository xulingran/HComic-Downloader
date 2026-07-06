# AGENTS.md

此文件为代码智能体（如 CodeArts）在本仓库中工作提供指导。

## 项目概述

HComic Downloader 是一个基于 Electron + React + TypeScript 前端的漫画下载工具，Python 后端负责解析、下载、打包和维护。漫画以 CBZ 格式（含 ComicInfo.xml 元数据）保存，支持 hcomic、moeimg、jm、bika（哔咔）、copymanga、nh 共六个来源，并提供维护中心用于下载健康管理、孤儿临时目录清理和存储空间分析。

## 关键约束：系统代理

**所有网络请求必须走程序内的系统代理。** 各来源解析器（`sources/hcomic/`、`sources/moeimg/`、`sources/jm/`（含 `domain.py`、`title_resolver.py`）、`sources/bika/`、`sources/copymanga/`、`sources/nh/`）在 `__init__` 中直接调用 `apply_system_proxy_to_session(self.session)`。下载器（`downloader.py`、`image_downloader.py`）则通过 `utils.create_downloader_session()` 创建会话，该函数内部已调用 `apply_system_proxy_to_session()`。新增任何网络请求时，创建 `requests.Session` 后必须立即走上述两种途径之一注入代理。

`utils.py` 中的 `get_system_proxies()` 通过 `urllib.request.getproxies()` 跨平台获取系统代理并标准化格式，`apply_system_proxy_to_session()` 将代理注入 Session 同时保持 `trust_env=True` 以兼容 `NO_PROXY` 规则。

## 架构

```
仓库根目录
├── Python 模块（根目录，被 python/ipc_server.py 通过 sys.path 注入导入）
│   ├── models.py — ComicInfo dataclass（图片 URL / __hash__ / __eq__）
│   ├── config.py — dataclass 配置管理（load/save 原子写入；默认路径 ~/.hcomic_downloader/config.json 由 python/ipc/types.py 解析）
│   ├── downloader.py — 多线程下载 + 断点续传（utils.create_downloader_session）
│   ├── image_downloader.py — 图片下载
│   ├── download_manager.py — 任务队列 + 状态机
│   ├── download_history.py — 下载历史
│   ├── cbz_builder.py — CBZ 打包 + ComicInfo.xml
│   ├── album_coordinator.py / output_staging.py — 下载编排与输出暂存
│   ├── auth_parser.py / migration.py / url_validator.py / image_formats.py
│   ├── constants.py / utils.py
│   └── sources/ — MultiSourceParser 分发层（6 个来源）
│       ├── __init__.py / base.py
│       ├── hcomic/  (parser.py)
│       ├── moeimg/  (parser.py)
│       ├── jm/      (parser.py + descrambler.py 反混淆 + constants/domain/session/title_resolver)
│       ├── bika/    (parser.py + constants.py)
│       ├── copymanga/ (parser.py + constants.py + crypto.py)
│       └── nh/      (parser.py + constants.py) — NHentai API v2，仅 API Key 认证
│
├── python/ — IPC 层与维护中心（PyInstaller 入口）
│   ├── ipc_server.py — IPCServer 类，Mixin 组合 python/ipc/ 下 11 个模块
│   ├── ipc/ — 功能 Mixin（search/cover/preview/download/config/auth/migration/
│   │           history/favourite_tags/tag_list/maintenance）+ cover_cache/preview_cache/
│   │           types/image_utils
│   └── maintenance/ — scanner / health_checker / orphan_cleaner / storage_analyzer
│
├── electron/ — Electron 主进程（TypeScript）
│   ├── main.ts / preload.ts / validators.ts
│   ├── python-bridge.ts — spawn 子进程，JSON-RPC 2.0 over stdin/stdout
│   ├── login-window.ts + login-preload.ts — 登录窗口（哔咔/JM 等）
│   ├── image-protocol.ts — 自定义协议托管图片
│   ├── update-checker.ts / notification-manager.ts / diagnostics.ts
│   ├── jm-challenge-recovery.ts — JM 反爬挑战恢复
│   └── csp-relaxed-registry.ts / log-init.ts
│
├── shared/types.ts — 前后端共享的 IPC 通道常量 + TypeScript 类型契约（根 shared/，非 src/）
│
├── src/ — React 前端
│   ├── App.tsx / main.tsx / styles/
│   ├── stores/ — 12 个 Zustand store
│   ├── pages/ — Search/Download/History/Favourites/Maintenance/Settings/About/Toolbox
│   ├── components/ — common/favourites/maintenance/settings/tools
│   ├── hooks/ / utils/
│   └── lib/ — anim.ts（动画 variants/transition）/ image-url.ts / prefetch.ts / scheduler.ts
│       Tailwind CSS（深色模式: class 或 data-theme="dark"）
│
└── 构建配置：electron.vite.config.ts / electron-builder.yml / tsconfig.json(+tsconfig.node.json)
    eslint.config.js（flat config）+ eslint-rules/test-quality.js / tailwind.config.js
    postcss.config.js / vitest.config.ts / pyproject.toml / requirements*.txt
```

**关键模式：**
- **IPC 通信**：Electron 主进程 ↔ Python 后端通过 `JSON-RPC 2.0` over `stdin/stdout`，不是 HTTP
- **sys.path 注入**：`python/ipc_server.py` 启动时把仓库根加入 `sys.path`，从而导入根目录的 Python 模块（`models`、`config`、`downloader`、`sources` 等）
- **会话复用**：同一 Session 对象注入认证和代理后，在同一个来源解析器内复用
- **编码处理**：服务器可能返回错误的 Content-Type，`_get_response_text()` 强制 UTF-8
- **JS 对象解析**：`_extract_payload_data()` 用正则提取 HTML 内嵌 JS 对象，然后转为 JSON

## 开发命令

### 环境准备

```bash
# Python 虚拟环境
python3 -m venv venv
# 激活 (Windows: venv\Scripts\activate)
pip install -r requirements.txt
pip install -r requirements-dev.txt
# Node 依赖
npm install
```

### 启动

```bash
npm run dev          # 一键启动 (electron-vite → Electron + Python 子进程) — 推荐
# 旧版 tkinter 入口（run.bat / run.sh）已移除。
# 根目录另有一个字面名为 "npm run dev.bat" 的 Windows 批处理（文件名含空格），
# 内容为 `chcp 65001` 后调用 `npm run dev`，用于解决 Windows 控制台 UTF-8 代码页问题。
```

### 测试

```bash
# Python（pytest）— Python 测试与前端测试共用根 tests/ 目录，无独立 python/tests/
pytest                                              # 全部
pytest tests/test_models.py                         # 单文件
pytest tests/test_models.py::TestComicInfo::test_default_values  # 单个用例
pytest -m 'not smoke'                               # 跳过真实 spawn 子进程的冒烟测试以加速
pytest --cov=. --cov-report=html                    # 覆盖率

# 前端 (vitest) — 测试文件实际全部嵌套在 tests/unit/ 下
npm test                            # 一次性运行
npm run test:watch                  # 监视模式
npm run test:coverage               # 覆盖率
npm run test:ui                     # Vitest UI
```

### 代码检查与格式化

```bash
# TypeScript
npm run lint                        # ESLint (src + electron + shared + tests)
npm run lint:fix                    # 自动修复

# Python lint (ruff)
npm run lint:py                     # 检查 (跨平台自动定位 venv 中 ruff)
npm run lint:py:fix                 # 自动修复

# Python 格式化 (black，跨平台封装定位 venv 中 black)
npm run format:py                   # 检查 (等价 black --check .)
npm run format:py:fix               # 格式化 (等价 black .)

# 测试质量闸门（openspec test-quality-gate 规范）
# 拦截"仅断言 mock 被调用而不同时验证真实行为"的测试（裸 toHaveBeenCalled /
# assert_called）、纯 store CRUD 往返。把 test-discipline 的判断标准转为主动门控。
# 前端 ESLint 自定义规则（eslint-rules/test-quality.js）+ Python AST 扫描（scripts/lint-test-quality.py）
npm run lint:test-quality           # 前端 + Python 全量
npm run lint:test-quality:py        # 仅 Python AST 扫描
```

**注意**：`npm run lint:py`、`npm run format:py` 分别封装了跨平台 ruff/black 调用（`scripts/lint-py.mjs`、`scripts/format-py.mjs`），优先使用而非直接调底层工具。

### 完整验证流程（提交前必须全部通过）

```bash
pytest                   # 1. Python 测试
npx tsc --noEmit         # 2. TypeScript 类型检查
npm test                 # 3. 前端测试
npm run lint:py          # 4. Python lint (ruff)
npm run format:py        # 5. Python 格式化检查 (black)
npm run lint             # 6. JS/TS lint (ESLint)
npm run lint:test-quality # 7. 测试质量闸门（拦截裸 mock 调用断言 / 纯 store CRUD 往返，test-quality-gate 规范）
```

## 代码规范

### Python 版本
- Python 3.12+（开发 3.13）

### 命名约定
- 类名 PascalCase、函数/变量 snake_case、常量 UPPER_SNAKE_CASE
- 私有方法/属性加前导下划线

### 类型注解
- 所有函数和方法必须有完整的类型注解
- 使用 `Optional[T]`、`List[T]`、`Dict[K,V]`、`Set[T]` 等

### 导入顺序
1. 标准库 → 2. 第三方库 → 3. 本地模块（绝对导入）

### 测试约定
- 文件 `test_*.py`、类 `Test*`、方法 `test_*`
- 使用 pytest fixtures 共享数据
- 冒烟测试用 `@pytest.mark.smoke` 标记（真实 spawn 子进程，可 `-m 'not smoke'` 跳过）

### 配置文件
- `ruff` 配置在 `pyproject.toml`：行长 120、启用 E/F/W/I/UP/B/SIM 规则、E501 忽略、`tests/**` 忽略 B
- `black` 配置在 `pyproject.toml`：行长 120、target py313
- `tsconfig.json`：strict 模式、`noUnusedLocals`/`noUnusedParameters` 开启、`@/*`→`src/*`、`@shared/*`→`shared/*`，并 reference `tsconfig.node.json`
- `vitest.config.ts`：jsdom 环境、setup 文件 `tests/setup.ts`、测试文件 `tests/**/*.test.{ts,tsx}`、coverage 用 v8、alias `@`→src / `@shared`→shared
- `eslint.config.js`（flat config）：含自定义规则 `eslint-rules/test-quality.js`
- 构建：`electron.vite.config.ts`（dev/build/preview）、`electron-builder.yml`（打包 win/mac/linux，先 `build:python` 用 PyInstaller 产出后端可执行文件）

### 重要实现细节

- **ComicInfo** 实现了 `__hash__` 和 `__eq__`（基于 `source_site`/`id`/`comic_source` 三元组），可作为 `set` 元素用于批量选择
- **图片 URL** 由 `ComicInfo.get_image_url(page)` 动态生成，`suffix` 由 `comic_source` 决定：`mms`(MMCG_SHORT) / `mml`(MMCG_LONG) / 其余走默认后缀（含 nh）
- **配置原子写入**：使用 temp file + `os.replace` 防止 JSON 损坏，非 Windows 上 `os.chmod(0o600)`；配置目录可由 `HCOMIC_CONFIG_DIR` 环境变量覆盖
- **安全**：Context Isolation + Sandbox、CSP 按环境分发（`csp-relaxed-registry.ts`）、IPC 参数严格校验（类型/长度/范围/路径遍历/控制字符）、域名白名单 + Referer 防盗链
- **版本号管理**：`npm run version:from-git` 执行 `scripts/set-version-from-tag.mjs`，从最近的 git tag（如 `v1.2.3`）提取版本号写入 `package.json` 的 `version` 字段。Electron 运行时通过 `app.getVersion()` 读取该值。此脚本为手动触发，未集成到 `dev` 或 `build` 流程中
- **jm 图片反混淆**：`sources/jm/descrambler.py` 在下载后对图片进行解混淆处理；`jm/domain.py`/`session.py`/`title_resolver.py` 处理域名轮换与标题解析
- **动画系统**：所有动画用 framer-motion（AnimatePresence/motion.div/layout），令牌集中在 `tailwind.config.js`（duration/easing/keyframes）与 `src/lib/anim.ts`（variants/transition）。reduced-motion 用全局 CSS 兜底 + 组件级 `useReducedMotionPreference()` 双层策略。性能约束详见 `docs/animation-performance.md`
