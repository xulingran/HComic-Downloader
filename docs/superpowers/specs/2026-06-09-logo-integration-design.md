# Logo 全项目集成设计

## 概述

将 `assets/icon.svg`（已有的 SVG 应用图标）部署到项目的各个展示位置，统一应用品牌形象。

## 需要改动的位置

### 1. index.html — favicon

- 在 `<head>` 中添加 `<link rel="icon" type="image/svg+xml" href="assets/icon.svg">`
- SVG favicon 在现代浏览器中广泛支持，无需额外生成多尺寸 favicon

### 2. electron/main.ts — 窗口图标

- 在 `BrowserWindow` 的构造参数中添加 `icon` 选项
- 开发环境下指向 `assets/icon.svg`，生产环境下在 Windows 使用 `icon.ico`、macOS 使用 `icon.icns`
- 利用 `__dirname` 和 `path.join` 构造正确路径

### 3. src/pages/AboutPage.tsx — 关于页面

- 将当前 📖 emoji 替换为 SVG logo
- 创建一个 React 组件 `src/components/LogoIcon.tsx`，内联渲染 SVG
- 组件接收 `size` prop（默认 80），SVG viewBox 保持不变
- 使用 React 组件而非图片引用的原因：
  - 避免 dev/prod 环境路径差异
  - 支持 CSS 主题色动态适配（可选）
  - 更好的 TypeScript 集成

### 4. README.md — 文档顶部

- 在标题下方添加 logo 图片引用
- 使用相对路径 `assets/icon.svg`，GitHub Markdown 原生支持 SVG 渲染
- 图片尺寸限制在合理范围内（~128px），避免文档页眉过大

## 不变动的位置

以下位置经评估后维持现状：

- **Sidebar.tsx**：保持 64px 宽，不加 logo，保持简洁
- **electron-builder.yml**：已正确配置 `.ico` / `.icns` / `assets` 作为打包图标
- **系统托盘图标**：当前无系统托盘功能，不涉及

## 技术细节

### LogoIcon 组件设计

```tsx
// src/components/LogoIcon.tsx
interface LogoIconProps {
  size?: number
  className?: string
}

// 内联渲染 icon.svg 的内容
// 使用 defs 中的渐变定义，保持与原始 SVG 一致的视觉风格
```

### 窗口图标路径

开发环境（`ELECTRON_RENDERER_URL` 存在时）：
- `path.join(__dirname, '../../assets/icon.svg')`

生产环境由 `electron-builder` 自动处理，`BrowserWindow` 的 icon 选项在打包后自动映射。

## 不涉及的部分

- 无需修改 package.json、构建脚本或 electron-builder 配置
- 无需新增 npm 依赖
- 无需生成新图标文件
