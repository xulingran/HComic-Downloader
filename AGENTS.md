# AGENTS.md

此文件为代码智能体（如 CodeArts）在本仓库中工作提供指导。

## 项目概述

HComic Downloader 是一个基于 Electron + React + TypeScript 前端的漫画下载工具，Python 后端负责解析、下载、打包和维护。漫画以 CBZ 格式（含 ComicInfo.xml 元数据）保存，支持 h-comic、moeimg、jmcomic、bika（哔咔）、copymanga 五个来源，并提供维护中心用于下载健康管理、孤儿临时目录清理和存储空间分析。

## 关键约束：系统代理

**所有网络请求必须走程序内的系统代理。** 每个来源解析器（`sources/hcomic/`、`sources/moeimg/`、`sources/jmcomic/`、`sources/bika/`）在 `__init__` 中调用 `apply_system_proxy_to_session(self.session)`，下载器（`downloader.py`）同样调用。新增任何网络请求时，创建 `requests.Session` 后必须立即调用 `apply_system_proxy_to_session()`。

`utils.py` 中的 `get_system_proxies()` 通过 `urllib.request.getproxies()` 跨平台获取系统代理并标准化格式，`apply_system_proxy_to_session()` 将代理注入 Session 同时保持 `trust_env=True` 以兼容 `NO_PROXY` 规则。

## 架构

```
Electron 主进程 (TypeScript)
  ├── IPC 路由 + 参数校验 (electron/validators.ts)
  ├── PythonBridge (electron/python-bridge.ts) — spawn 子进程，JSON-RPC 2.0 over stdin/stdout
  └── Preload (electron/preload.ts) — contextBridge 暴露 API
        ↓
Python 后端 (python/ipc_server.py) — IPCServer 类，Mixin 模式组合各功能模块
  ├── sources/__init__.py — MultiSourceParser 分发层
  │   ├── sources/hcomic/parser.py
  │   ├── sources/moeimg/parser.py
  │   ├── sources/jmcomic/parser.py  (含 descrambler.py 反混淆)
  │   ├── sources/bika/parser.py
  │   └── sources/copymanga/parser.py
  ├── downloader.py — 多线程下载 + 断点续传
  ├── download_manager.py — 任务队列 + 状态机
  ├── cbz_builder.py — CBZ 打包 + ComicInfo.xml
  ├── maintenance/ — 维护中心（scanner / health_checker / orphan_cleaner / storage_analyzer）
  └── config.py — dataclass 配置管理 (JSON 持久化到 ~/.hcomic_downloader/config.json)
        ↓
React 前端 (src/)
  ├── Zustand stores (src/stores/)
  ├── Tailwind CSS (深色模式: class 或 data-theme="dark")
  ├── pages/MaintenancePage.tsx — 维护中心（健康检查 / 孤儿清理 / 存储分析）
  └── shared/types.ts — 前后端共享的 IPC 通道常量 + TypeScript 类型契约
```

**关键模式：**
- **IPC 通信**：Electron 主进程 ↔ Python 后端通过 `JSON-RPC 2.0` over `stdin/stdout`，不是 HTTP
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
# 旧版 tkinter 入口（run.bat / run.sh）已移除，仅保留 npm run dev 与 npm run dev.bat
```

### 测试

```bash
# Python
pytest                                              # 全部
pytest tests/test_models.py                         # 单文件
pytest tests/test_models.py::TestComicInfo::test_default_values  # 单个用例
pytest --cov=. --cov-report=html                    # 覆盖率

# 前端 (vitest)
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

# Python 格式化 (black，必须在 venv 中)
# Windows: venv\Scripts\black.exe --check .
# macOS/Linux: venv/bin/black --check .
black --check .                     # 仅检查
black .                             # 格式化
```

**注意**：`npm run lint:py` 封装了跨平台 ruff 调用（`scripts/lint-py.mjs`），优先使用而非直接调 ruff。

### 完整验证流程（提交前必须全部通过）

```bash
pytest                   # 1. Python 测试
npx tsc --noEmit         # 2. TypeScript 类型检查
npm test                 # 3. 前端测试
npm run lint:py          # 4. Python lint (ruff)
black --check .          # 5. Python 格式化检查
npm run lint             # 6. JS/TS lint (ESLint)
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

### 配置文件
- `ruff` 配置在 `pyproject.toml`：行长 120、启用 E/F/W/I/UP/B/SIM 规则、E501 忽略
- `black` 无独立配置，依赖 pyproject.toml 中的通用设置
- `tsconfig.json`：strict 模式、`noUnusedLocals`/`noUnusedParameters` 开启、`@/*`→`src/*`、`@shared/*`→`shared/*`
- `vitest.config.ts`：jsdom 环境、setup 文件 `tests/setup.ts`、测试文件 `tests/**/*.test.{ts,tsx}`

### 重要实现细节

- **ComicInfo** 实现了 `__hash__` 和 `__eq__`，可作为 `set` 元素用于批量选择
- **图片 URL** 由 `ComicInfo.get_image_url(page)` 动态生成，`suffix` 由 `comic_source` 决定：`mms`(MMCG_SHORT) / `mml`(MMCG_LONG) / `nh`(默认)
- **配置原子写入**：使用 temp file + rename 防止 JSON 损坏，权限 0o600
- **安全**：Context Isolation + Sandbox、CSP 按环境分发、IPC 参数严格校验（类型/长度/范围/路径遍历/控制字符）、域名白名单 + Referer 防盗链
- **版本号管理**：`npm run version:from-git` 执行 `scripts/set-version-from-tag.mjs`，从最近的 git tag（如 `v1.2.3`）提取版本号写入 `package.json` 的 `version` 字段。Electron 运行时通过 `app.getVersion()` 读取该值。此脚本为手动触发，未集成到 `dev` 或 `build` 流程中
- **jmcomic 图片反混淆**：`sources/jmcomic/descrambler.py` 在下载后对图片进行解混淆处理
- **动画系统**：所有动画用 framer-motion（AnimatePresence/motion.div/layout），令牌集中在 `tailwind.config.js`（duration/easing/keyframes）与 `src/lib/anim.ts`（variants/transition）。reduced-motion 用全局 CSS 兜底 + 组件级 `useReducedMotionPreference()` 双层策略。性能约束详见 `docs/animation-performance.md`
