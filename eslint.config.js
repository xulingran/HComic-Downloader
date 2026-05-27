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
