# 图标生成指南

## 新图标设计说明

我已经为 HComic Downloader 设计了一个新的图标，具有以下特点：

### 设计元素
1. **主色调**：紫色渐变（#6366f1 → #8b5cf6 → #a855f7），现代感强
2. **漫画书**：三层叠加的书页效果，展示漫画内容
3. **下载箭头**：青色渐变的下载图标，体现下载功能
4. **装饰元素**：闪光效果和彩色圆点，增加活力
5. **圆角设计**：96px 大圆角，符合现代 UI 趋势

### 文件结构
```
assets/
├── icon.svg          # 主图标（512x512 矢量格式）
├── icon_64.svg       # 64x64 版本
├── icon_48.png       # 48x48 PNG（需要生成）
└── icon_64.png       # 64x64 PNG（需要生成）
```

## 生成 PNG 图标

### 方法 1：使用在线工具（推荐）
1. 访问 [CloudConvert](https://cloudconvert.com/svg-to-png) 或 [Convertio](https://convertio.co/svg-png/)
2. 上传 `assets/icon.svg`
3. 设置输出尺寸为 512x512、256x256、64x64、48x48
4. 下载并替换对应的 PNG 文件

### 方法 2：使用命令行工具（需要安装）

#### 安装 Inkscape（免费开源）
```bash
# Windows (使用 Chocolatey)
choco install inkscape

# macOS (使用 Homebrew)
brew install inkscape

# Linux (Ubuntu/Debian)
sudo apt install inkscape
```

#### 使用 Inkscape 转换
```bash
# 生成 512x512 PNG
inkscape assets/icon.svg --export-filename=assets/icon_512.png --export-width=512 --export-height=512

# 生成 256x256 PNG
inkscape assets/icon.svg --export-filename=assets/icon_256.png --export-width=256 --export-height=256

# 生成 64x64 PNG
inkscape assets/icon.svg --export-filename=assets/icon_64.png --export-width=64 --export-height=64

# 生成 48x48 PNG
inkscape assets/icon.svg --export-filename=assets/icon_48.png --export-width=48 --export-height=48
```

### 方法 3：使用 Node.js 脚本

创建 `scripts/generate-icons.js`：

```javascript
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sizes = [512, 256, 128, 64, 48, 32, 16];
const inputSvg = path.join(__dirname, '../assets/icon.svg');
const outputDir = path.join(__dirname, '../assets');

async function generateIcons() {
  for (const size of sizes) {
    const outputFile = path.join(outputDir, `icon_${size}.png`);
    await sharp(inputSvg)
      .resize(size, size)
      .png()
      .toFile(outputFile);
    console.log(`Generated: ${outputFile}`);
  }
}

generateIcons().catch(console.error);
```

运行脚本：
```bash
npm install sharp
node scripts/generate-icons.js
```

## 生成 ICO 文件（Windows）

### 方法 1：使用在线工具
1. 访问 [ConvertICO](https://www.convertico.com/) 或 [ICOConvert](https://icoconvert.com/)
2. 上传 256x256 的 PNG 文件
3. 选择包含多个尺寸（16, 32, 48, 64, 128, 256）
4. 下载 `icon.ico` 并放到 `assets/` 目录

### 方法 2：使用 ImageMagick
```bash
# 安装 ImageMagick
# Windows: choco install imagemagick
# macOS: brew install imagemagick

# 生成 ICO 文件
magick convert assets/icon_256.png assets/icon_128.png assets/icon_64.png assets/icon_48.png assets/icon_32.png assets/icon_16.png assets/icon.ico
```

## 生成 ICNS 文件（macOS）

### 使用 iconutil（macOS 自带）
1. 创建 `icon.iconset` 目录
2. 放入不同尺寸的 PNG 文件（16x16 到 512x512@2x）
3. 运行命令：
```bash
iconutil -c icns icon.iconset -o assets/icon.icns
```

## 验证图标

生成后，检查以下文件是否存在：
- `assets/icon.ico` (Windows)
- `assets/icon.icns` (macOS)
- `assets/icon.png` (Linux，512x512)
- `assets/icon_64.png` (通用)
- `assets/icon_48.png` (通用)

## 在 Electron 中使用

图标已经在 `electron-builder.yml` 中配置好了：
- Windows: `assets/icon.ico`
- macOS: `assets/icon.icns`
- Linux: `assets/` 目录下的 PNG 文件

运行 `npm run build` 时会自动使用这些图标。