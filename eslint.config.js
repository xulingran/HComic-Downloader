import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": "warn",
      // 渲染进程边界护栏：禁止直接导入 Node/Electron 模块。
      // 渲染进程只能通过 window.hcomic（contextBridge 暴露的窄 API）与主进程通信，
      // 任何 Node 能力（fs/path/child_process/os/crypto）或直接 electron 导入
      // 都会绕过 contextIsolation 安全边界。新增需求应扩展 preload 暴露的 API。
      "@typescript-eslint/no-restricted-imports": ["error", {
        paths: [
          { name: "electron", message: "渲染进程禁止直接导入 electron，请通过 window.hcomic API 访问主进程能力。" },
          { name: "fs", message: "渲染进程禁止直接访问文件系统，请通过 window.hcomic IPC 请求主进程文件操作。" },
          { name: "path", message: "渲染进程禁止直接访问 path 模块，文件路径处理应由主进程完成。" },
          { name: "child_process", message: "渲染进程禁止 spawn 子进程。" },
          { name: "os", message: "渲染进程禁止直接访问 os 模块。" },
          { name: "crypto", message: "渲染进程禁止直接访问 Node crypto，请使用 Web Crypto API 或走 IPC。" },
          { name: "node:fs", message: "渲染进程禁止直接访问文件系统，请通过 window.hcomic IPC 请求主进程文件操作。" },
          { name: "node:path", message: "渲染进程禁止直接访问 path 模块，文件路径处理应由主进程完成。" },
          { name: "node:child_process", message: "渲染进程禁止 spawn 子进程。" },
          { name: "node:os", message: "渲染进程禁止直接访问 os 模块。" },
          { name: "node:crypto", message: "渲染进程禁止直接访问 Node crypto，请使用 Web Crypto API 或走 IPC。" },
        ],
      }],
      // 兜底：禁止 require() 形式绕过上面的 import 限制
      "no-restricted-syntax": ["error", {
        selector: "CallExpression[callee.name='require'][arguments.0.value=/^(electron|fs|path|child_process|os|crypto|node:)/]",
        message: "渲染进程禁止 require Node/Electron 模块，请通过 window.hcomic API。",
      }],
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
