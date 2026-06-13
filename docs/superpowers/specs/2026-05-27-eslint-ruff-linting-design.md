# ESLint + Ruff Linting 配置设计

**日期**: 2026-05-27
**状态**: 已批准

## 目标

为 hcomic-downloader 项目配置 ESLint（TypeScript/React）和 Ruff（Python）静态分析工具，实现：
1. 统一代码风格
2. 捕获潜在 bug 和代码质量问题
3. 推荐配置（不极端严格）
4. 通过 npm/CLI 命令集成
5. 配置完成后自动修复现有代码

## 项目上下文

- **前端**: Electron + React + TypeScript (Vite 构建)
- **后端**: Python IPC 服务
- **测试**: Vitest (TS), pytest (Python)
- **环境**: Node.js v24.9.0, Python 3.13.12
- **现有配置**: 无 ESLint/Ruff 配置，`pyproject.toml` 仅有 pytest 配置

## 方案 A：ESLint (flat config) + Ruff

### 第1节：ESLint 配置（TypeScript/React）

**文件**: `eslint.config.js`（项目根目录）

**新增依赖**:
- `@eslint/js` — ESLint 推荐规则
- `typescript-eslint` — TypeScript 解析器 + 推荐规则
- `eslint-plugin-react-hooks` — React Hooks 规则检查
- `eslint-plugin-react-refresh` — React 组件热更新检查

**配置结构**:
```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": "warn",
    },
  },
  {
    ignores: ["node_modules/", "out/", "dist/", "coverage/", "venv/", ".ruff_cache/"],
  },
);
```

**覆盖范围**:
- `src/**/*.ts,tsx` — React 前端代码
- `electron/**/*.ts` — Electron 主进程代码
- `shared/**/*.ts` — 共享类型
- `tests/**/*.ts,tsx` — 测试代码

**规则严格度**: 推荐配置，不强制 `no-any` 等过于严格的规则。

### 第2节：Ruff 配置（Python）

**文件**: `pyproject.toml`（扩展现有文件）

**配置内容**:
```toml
[tool.ruff]
line-length = 120
target-version = "py313"

[tool.ruff.lint]
select = [
    "E",   # pycodestyle errors
    "F",   # pyflakes
    "W",   # pycodestyle warnings
    "I",   # isort (import sorting)
    "UP",  # pyupgrade
    "B",   # flake8-bugbear
    "SIM", # flake8-simplify
]
ignore = [
    "E501",  # 行过长 — 由 formatter 处理
]

[tool.ruff.lint.isort]
known-first-party = [
    "auth_parser", "cbz_builder", "config", "constants",
    "download_history", "download_manager", "downloader",
    "image_downloader", "image_formats", "migration",
    "models", "parser", "theme_manager", "url_validator", "utils",
]

[tool.ruff.lint.per-file-ignores]
"tests/**" = ["B"]
```

**覆盖范围**:
- 根目录 `*.py` — 主要 Python 模块
- `python/ipc/*.py` — IPC 混入模块
- `tests/*.py` — 测试文件

**规则集说明**:
| 规则集 | 用途 |
|--------|------|
| E/W | pycodestyle 风格检查 |
| F | 未使用导入、未定义变量等 |
| I | import 排序 |
| UP | 使用现代 Python 语法（如 `list` 替代 `List`） |
| B | 常见 bug 模式（如可变默认参数） |
| SIM | 代码简化建议 |

### 第3节：npm 脚本与集成

**`package.json` 新增脚本**:
```json
{
  "scripts": {
    "lint": "eslint src electron shared tests",
    "lint:fix": "eslint src electron shared tests --fix",
    "lint:py": "ruff check .",
    "lint:py:fix": "ruff check . --fix"
  }
}
```

**使用方式**:
- `npm run lint` — 检查 TS/TSX 代码
- `npm run lint:fix` — 自动修复 TS/TSX 问题
- `npm run lint:py` — 检查 Python 代码
- `npm run lint:py:fix` — 自动修复 Python 问题

## 实施步骤

1. 安装 ESLint 相关依赖 (`npm install -D @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh`)
2. 创建 `eslint.config.js`
3. 更新 `pyproject.toml` 添加 Ruff 配置
4. 更新 `package.json` 添加 lint 脚本
5. 运行 `npm run lint:fix` 自动修复 TS/TSX 问题
6. 运行 `ruff check . --fix` 自动修复 Python 问题
7. 手动审查剩余无法自动修复的问题

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新增 | `eslint.config.js` | ESLint flat config |
| 修改 | `package.json` | 添加 lint 脚本和依赖 |
| 修改 | `pyproject.toml` | 添加 Ruff 配置 |
