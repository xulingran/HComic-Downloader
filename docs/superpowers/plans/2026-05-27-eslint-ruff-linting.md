# ESLint + Ruff Linting 配置实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 hcomic-downloader 配置 ESLint (TypeScript/React) 和 Ruff (Python) 静态分析工具

**Architecture:** ESLint 9 flat config 格式处理 TS/TSX，Ruff 处理 Python。两者通过 npm scripts 集成。配置完成后对现有代码运行 `--fix`。

**Tech Stack:** ESLint 9, typescript-eslint, eslint-plugin-react-hooks, eslint-plugin-react-refresh, Ruff

---

### Task 1: 安装 ESLint 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 ESLint 及插件**

```bash
cd "E:/Developing/hcomic_downloader"
npm install -D @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh
```

- [ ] **Step 2: 验证安装成功**

```bash
npm ls @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh
```

Expected: 四个包均显示已安装，无 peer dependency 警告。

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add ESLint and typescript-eslint dev dependencies"
```

---

### Task 2: 创建 eslint.config.js

**Files:**
- Create: `eslint.config.js`

- [ ] **Step 1: 创建 ESLint flat config 文件**

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
    ignores: [
      "node_modules/",
      "out/",
      "dist/",
      "coverage/",
      "venv/",
      ".ruff_cache/",
      "*.config.js",
      "*.config.ts",
      "postcss.config.js",
      "electron.vite.config.ts",
      "tailwind.config.js",
    ],
  },
);
```

- [ ] **Step 2: 验证配置文件语法正确**

```bash
cd "E:/Developing/hcomic_downloader"
npx eslint --print-config src/App.tsx > /dev/null 2>&1
```

Expected: 无错误输出（配置文件解析成功）。

- [ ] **Step 3: Commit**

```bash
git add eslint.config.js
git commit -m "feat: add ESLint flat config for TypeScript/React"
```

---

### Task 3: 更新 pyproject.toml 添加 Ruff 配置

**Files:**
- Modify: `pyproject.toml`

- [ ] **Step 1: 追加 Ruff 配置到 pyproject.toml**

在现有 `[tool.pytest.ini_options]` 之后追加：

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

- [ ] **Step 2: 验证 Ruff 能读取配置**

```bash
cd "E:/Developing/hcomic_downloader"
ruff check --show-settings 2>&1 | head -5
```

Expected: 显示 Ruff 配置信息，无解析错误。

- [ ] **Step 3: Commit**

```bash
git add pyproject.toml
git commit -m "feat: add Ruff linting configuration to pyproject.toml"
```

---

### Task 4: 更新 package.json 添加 lint 脚本

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 添加 lint 脚本**

在 `package.json` 的 `scripts` 中添加：

```json
"lint": "eslint src electron shared tests",
"lint:fix": "eslint src electron shared tests --fix",
"lint:py": "ruff check .",
"lint:py:fix": "ruff check . --fix"
```

完整的 scripts 部分应为：
```json
"scripts": {
  "dev": "electron-vite dev",
  "build": "electron-vite build",
  "preview": "electron-vite preview",
  "build:python": "pyinstaller --noconfirm python/hcomic_backend.spec --distpath python/dist --workpath python/build --clean && node -e \"const fs=require('fs'); const exe=process.platform==='win32'?'python/dist/python/python.exe':'python/dist/python/python'; fs.existsSync(exe) || (console.error('ERROR: Python backend executable not found: '+exe), process.exit(1))\"",
  "build:win": "npm run build:python && npm run build && electron-builder --win",
  "build:mac": "npm run build:python && npm run build && electron-builder --mac",
  "build:linux": "npm run build:python && npm run build && electron-builder --linux",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "test:ui": "vitest --ui",
  "lint": "eslint src electron shared tests",
  "lint:fix": "eslint src electron shared tests --fix",
  "lint:py": "ruff check .",
  "lint:py:fix": "ruff check . --fix"
}
```

- [ ] **Step 2: 验证脚本可用**

```bash
cd "E:/Developing/hcomic_downloader"
npm run lint -- --help > /dev/null 2>&1 && echo "lint OK"
npm run lint:py -- --help > /dev/null 2>&1 && echo "lint:py OK"
```

Expected: 两个脚本均可执行，无报错。

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add lint and lint:fix npm scripts"
```

---

### Task 5: 运行 ESLint 自动修复现有代码

**Files:**
- Modify: `src/**`, `electron/**`, `shared/**`, `tests/**`（自动修复）

- [ ] **Step 1: 先运行检查，查看当前问题数量**

```bash
cd "E:/Developing/hcomic_downloader"
npm run lint 2>&1 | tail -5
```

Expected: 显示若干警告/错误（预期存在）。

- [ ] **Step 2: 运行自动修复**

```bash
cd "E:/Developing/hcomic_downloader"
npm run lint:fix 2>&1 | tail -10
```

Expected: 部分问题被自动修复，剩余无法自动修复的问题仍显示为警告/错误。

- [ ] **Step 3: 再次运行检查，确认剩余问题数量**

```bash
cd "E:/Developing/hcomic_downloader"
npm run lint 2>&1 | tail -5
```

Expected: 问题数量明显减少，剩余问题均为无法自动修复的类型。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "style: auto-fix ESLint issues in TypeScript/React codebase"
```

---

### Task 6: 运行 Ruff 自动修复现有 Python 代码

**Files:**
- Modify: `*.py`, `python/**/*.py`, `tests/*.py`（自动修复）

- [ ] **Step 1: 先运行检查，查看当前问题数量**

```bash
cd "E:/Developing/hcomic_downloader"
npm run lint:py 2>&1 | tail -5
```

Expected: 显示若干净告/错误。

- [ ] **Step 2: 运行自动修复**

```bash
cd "E:/Developing/hcomic_downloader"
npm run lint:py:fix 2>&1 | tail -10
```

Expected: 部分问题被自动修复（import 排序、pyupgrade 等）。

- [ ] **Step 3: 再次运行检查，确认剩余问题数量**

```bash
cd "E:/Developing/hcomic_downloader"
npm run lint:py 2>&1 | tail -5
```

Expected: 问题数量明显减少。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "style: auto-fix Ruff issues in Python codebase"
```

---

### Task 7: 最终验证 — 确认所有 lint 命令正常工作

**Files:** 无新增/修改

- [ ] **Step 1: 运行完整 ESLint 检查**

```bash
cd "E:/Developing/hcomic_downloader"
npm run lint
```

Expected: 命令正常执行，输出剩余警告（不应有阻断性错误导致命令失败）。

- [ ] **Step 2: 运行完整 Ruff 检查**

```bash
cd "E:/Developing/hcomic_downloader"
npm run lint:py
```

Expected: 命令正常执行，输出剩余警告。

- [ ] **Step 3: 确认现有测试不受影响**

```bash
cd "E:/Developing/hcomic_downloader"
npm run test 2>&1 | tail -10
```

Expected: 测试全部通过（lint 配置不应影响测试运行）。

- [ ] **Step 4: 确认 Python 测试不受影响**

```bash
cd "E:/Developing/hcomic_downloader"
python -m pytest tests/ --timeout=60 2>&1 | tail -10
```

Expected: 测试全部通过。

- [ ] **Step 5: 最终 Commit（如果还有未提交的变更）**

```bash
cd "E:/Developing/hcomic_downloader"
git status
git add -A
git commit -m "chore: finalize ESLint + Ruff linting setup"
```
