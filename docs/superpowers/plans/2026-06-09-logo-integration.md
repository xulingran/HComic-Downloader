# Logo 全项目集成 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `assets/icon.svg` 部署到项目的所有 logo 展示位置

**架构:** 4 个独立改动点，互不依赖，可按任意顺序实施。创建 1 个新 React 组件，修改 3 个现有文件

**技术栈:** Electron 28, React 18, TypeScript, Vite, SVG

---

## 文件结构

| 文件 | 操作 | 职责 |
|---|---|---|
| `src/components/LogoIcon.tsx` | 新建 | 内联渲染 icon.svg 的 React 组件，接收 `size` 和 `className` props |
| `index.html` | 修改 | 在 `<head>` 中添加 SVG favicon |
| `electron/main.ts` | 修改 | BrowserWindow 添加 icon 选项 |
| `src/pages/AboutPage.tsx` | 修改 | 将 📖 emoji 替换为 LogoIcon 组件 |
| `README.md` | 修改 | 标题下方添加 logo 图片 |

---

### Task 1: 创建 LogoIcon React 组件

**Files:**
- Create: `src/components/LogoIcon.tsx`

- [ ] **Step 1: 创建 LogoIcon 组件文件**

```tsx
// src/components/LogoIcon.tsx
interface LogoIconProps {
  size?: number
  className?: string
}

export function LogoIcon({ size = 80, className = '' }: LogoIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
    >
      <defs>
        <linearGradient id="logoBgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6366f1" stopOpacity={1} />
          <stop offset="50%" stopColor="#8b5cf6" stopOpacity={1} />
          <stop offset="100%" stopColor="#a855f7" stopOpacity={1} />
        </linearGradient>
        <linearGradient id="logoPageGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={1} />
          <stop offset="100%" stopColor="#f1f5f9" stopOpacity={1} />
        </linearGradient>
        <linearGradient id="logoArrowGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity={1} />
          <stop offset="100%" stopColor="#06b6d4" stopOpacity={1} />
        </linearGradient>
      </defs>

      {/* 主背景圆角矩形 */}
      <rect x="16" y="16" width="480" height="480" rx="96" ry="96" fill="url(#logoBgGrad)" />

      {/* 装饰性圆形元素 */}
      <circle cx="400" cy="120" r="60" fill="#fff" opacity={0.1} />
      <circle cx="440" cy="160" r="30" fill="#fff" opacity={0.08} />

      {/* 漫画书主体 */}
      <g transform="translate(120, 100)">
        <rect x="20" y="20" width="240" height="300" rx="8" fill="#c4b5fd" opacity={0.5} />
        <rect x="10" y="10" width="240" height="300" rx="8" fill="#ddd6fe" opacity={0.7} />
        <rect x="0" y="0" width="240" height="300" rx="8" fill="url(#logoPageGrad)" />

        {/* 漫画内容装饰线条 */}
        <rect x="30" y="40" width="180" height="12" rx="6" fill="#e2e8f0" />
        <rect x="30" y="70" width="140" height="12" rx="6" fill="#e2e8f0" />
        <rect x="30" y="100" width="160" height="12" rx="6" fill="#e2e8f0" />

        {/* 漫画图片占位区域 */}
        <rect x="30" y="140" width="180" height="120" rx="8" fill="#f0f9ff" stroke="#bfdbfe" strokeWidth={2} strokeDasharray="8 4" />

        {/* 图片中的漫画图标 */}
        <g transform="translate(90, 170)">
          <path d="M30 0 L60 20 L60 50 L0 50 L0 20 Z" fill="#93c5fd" opacity={0.5} />
          <circle cx="20" cy="25" r="8" fill="#60a5fa" />
          <path d="M35 35 L55 50 L15 50 Z" fill="#60a5fa" />
        </g>

        {/* 底部文字装饰 */}
        <rect x="30" y="280" width="100" height="8" rx="4" fill="#e2e8f0" />
        <rect x="140" y="280" width="70" height="8" rx="4" fill="#e2e8f0" />
      </g>

      {/* 下载箭头 */}
      <g transform="translate(300, 300)">
        <circle cx="60" cy="60" r="70" fill="#0891b2" opacity={0.9} />
        <circle cx="60" cy="60" r="65" fill="url(#logoArrowGrad)" />

        <g transform="translate(25, 20)">
          <path d="M50 0 L50 50 L70 50 L35 90 L0 50 L20 50 L20 0 Z" fill="white" opacity={0.95} />
          <rect x="0" y="95" width="70" height="8" rx="4" fill="white" opacity={0.95} />
        </g>
      </g>

      {/* 装饰性小元素 */}
      <circle cx="100" cy="400" r="15" fill="#fbbf24" opacity={0.8} />
      <circle cx="130" cy="420" r="10" fill="#f472b6" opacity={0.8} />

      {/* 闪光效果 */}
      <g opacity={0.6}>
        <path d="M380 80 L385 90 L395 90 L387 97 L390 107 L380 100 L370 107 L373 97 L365 90 L375 90 Z" fill="white" />
        <path d="M420 200 L423 206 L430 206 L425 211 L427 218 L420 213 L413 218 L415 211 L410 206 L417 206 Z" fill="white" opacity={0.4} />
      </g>
    </svg>
  )
}
```

- [ ] **Step 2: 验证组件结构**

无需测试文件 — 组件在 AboutPage 集成后会在运行中验证。检查 TypeScript 编译即可。

---

### Task 2: 在 index.html 中添加 favicon

**Files:**
- Modify: `index.html`

- [ ] **Step 1: 在 `<head>` 中添加 favicon link**

将：
```html
    <title>HComic Downloader</title>
```

改为：
```html
    <link rel="icon" type="image/svg+xml" href="assets/icon.svg">
    <title>HComic Downloader</title>
```

---

### Task 3: 在 electron/main.ts 中添加窗口图标

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: 在 BrowserWindow 构造参数中添加 icon**

找到 `createWindow` 函数中 `new BrowserWindow({...})` 部分（约第 371 行），在 `show: false` 之前添加 `icon` 属性。

将：
```typescript
    show: false
```

改为：
```typescript
    icon: path.join(__dirname, '../../assets/icon.svg'),
    show: false
```

---

### Task 4: 在 AboutPage 中替换为 LogoIcon

**Files:**
- Modify: `src/pages/AboutPage.tsx`

- [ ] **Step 1: 导入 LogoIcon 组件**

在文件顶部添加导入：
```typescript
import { LogoIcon } from '../components/LogoIcon'
```

- [ ] **Step 2: 替换 emoji 为 LogoIcon 组件**

将：
```tsx
          <div className="w-20 h-20 rounded-2xl bg-[var(--accent)] flex items-center justify-center text-4xl shadow-lg">
            📖
          </div>
```

改为：
```tsx
          <div className="flex justify-center">
            <LogoIcon size={80} className="drop-shadow-lg" />
          </div>
```

---

### Task 5: 在 README.md 顶部添加 logo

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 在标题下方添加 logo 图片**

在 `# HComic Downloader` 行下方、`一个跨平台的漫画下载与管理工具...` 段落上方插入：

```markdown
<p align="center">
  <img src="assets/icon.svg" alt="HComic Downloader Logo" width="128">
</p>
```

---

### Task 6: 最终验证

- [ ] **Step 1: 检查 TypeScript 编译**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 2: 提交所有更改**

```bash
git add \
  src/components/LogoIcon.tsx \
  index.html \
  electron/main.ts \
  src/pages/AboutPage.tsx \
  README.md
git commit -m "feat: 将 SVG logo 集成到项目各处

- 创建 LogoIcon React 组件，内联渲染 icon.svg
- index.html 添加 SVG favicon
- electron/main.ts BrowserWindow 添加窗口图标
- AboutPage 替换 emoji 为实际 logo
- README.md 顶部添加 logo 图片"
```
