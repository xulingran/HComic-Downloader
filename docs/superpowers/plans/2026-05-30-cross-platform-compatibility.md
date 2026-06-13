# Cross-Platform Compatibility Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 cross-platform issues that cause build failures or broken runtime behavior on macOS and Linux.

**Architecture:** Four independent fixes targeting specific files — a cross-platform ruff launcher script, icon format generation, single-instance protocol handling, and conditional PyInstaller UPX.

**Tech Stack:** Node.js (scripts), Electron API, PyInstaller spec, npm devDependencies (`png2icons`)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `scripts/lint-py.mjs` | **Create** | Cross-platform ruff launcher |
| `package.json` | **Modify** | Update `lint:py` / `lint:py:fix` scripts |
| `scripts/generate-icons.mjs` | **Modify** | Add ICO/ICNS generation alongside existing PNGs |
| `electron-builder.yml` | **Modify** | Update icon paths to `.ico` / `.icns` |
| `electron/main.ts` | **Modify** | Add single-instance lock + `second-instance` handler |
| `python/hcomic_backend.spec` | **Modify** | Conditional UPX based on platform |

---

### Task 1: Cross-platform lint:py script

**Files:**
- Create: `scripts/lint-py.mjs`
- Modify: `package.json` (lines 21–22)

- [ ] **Step 1: Create `scripts/lint-py.mjs`**

```javascript
import { spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')

const ruff = process.platform === 'win32'
  ? path.join(projectRoot, 'venv', 'Scripts', 'ruff.exe')
  : path.join(projectRoot, 'venv', 'bin', 'ruff')

const args = ['check', '.', ...process.argv.slice(2)]
const result = spawnSync(ruff, args, { stdio: 'inherit', cwd: projectRoot })
process.exit(result.status ?? 1)
```

- [ ] **Step 2: Update `package.json` scripts**

Replace lines 21–22 in `package.json`:

```json
"lint:py": "node scripts/lint-py.mjs",
"lint:py:fix": "node scripts/lint-py.mjs --fix",
```

- [ ] **Step 3: Verify lint:py works**

Run: `npm run lint:py`
Expected: Ruff runs and reports lint results (same behavior as before on Windows, now also works on macOS/Linux).

- [ ] **Step 4: Commit**

```bash
git add scripts/lint-py.mjs package.json
git commit -m "fix: cross-platform lint:py script"
```

---

### Task 2: Icon format generation (ICO + ICNS)

**Files:**
- Modify: `scripts/generate-icons.mjs`
- Modify: `electron-builder.yml` (lines 23, 37)
- Modify: `package.json` (add devDependency)

- [ ] **Step 1: Install `png2icons` devDependency**

Run:
```bash
npm install --save-dev png2icons
```

Expected: `png2icons` added to `devDependencies` in `package.json`.

- [ ] **Step 2: Update `scripts/generate-icons.mjs`**

Replace the entire file with:

```javascript
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import png2icons from 'png2icons';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sizes = [512, 256, 128, 64, 48, 32, 16];
const inputSvg = path.join(__dirname, '../assets/icon.svg');
const outputDir = path.join(__dirname, '../assets');

async function generateIcons() {
  console.log('Generating icons from SVG...');
  console.log(`Input: ${inputSvg}`);
  console.log(`Output directory: ${outputDir}`);
  console.log('');

  // Generate PNGs at all sizes
  for (const size of sizes) {
    const outputFile = path.join(outputDir, `icon_${size}.png`);
    try {
      await sharp(inputSvg)
        .resize(size, size)
        .png()
        .toFile(outputFile);
      console.log(`✓ Generated: icon_${size}.png`);
    } catch (error) {
      console.error(`✗ Failed to generate icon_${size}.png:`, error.message);
    }
  }

  // Generate ICO (Windows) from 512x512 PNG
  const icoSource = path.join(outputDir, 'icon_512.png');
  if (fs.existsSync(icoSource)) {
    try {
      const input = fs.readFileSync(icoSource);
      const output = png2icons.createICO(input, png2icons.BICUBIC, 0, false, true);
      if (output) {
        const icoPath = path.join(outputDir, 'icon.ico');
        fs.writeFileSync(icoPath, output);
        console.log(`✓ Generated: icon.ico`);
      } else {
        console.error('✗ png2icons.createICO returned null');
      }
    } catch (error) {
      console.error('✗ Failed to generate icon.ico:', error.message);
    }
  }

  // Generate ICNS (macOS) from 512x512 PNG
  if (fs.existsSync(icoSource)) {
    try {
      const input = fs.readFileSync(icoSource);
      const output = png2icons.createICNS(input, png2icons.BICUBIC, 0);
      if (output) {
        const icnsPath = path.join(outputDir, 'icon.icns');
        fs.writeFileSync(icnsPath, output);
        console.log(`✓ Generated: icon.icns`);
      } else {
        console.error('✗ png2icons.createICNS returned null');
      }
    } catch (error) {
      console.error('✗ Failed to generate icon.icns:', error.message);
    }
  }

  // Copy 512x512 as icon.png for Linux
  const linuxSource = path.join(outputDir, 'icon_512.png');
  const linuxTarget = path.join(outputDir, 'icon.png');
  if (fs.existsSync(linuxSource)) {
    fs.copyFileSync(linuxSource, linuxTarget);
    console.log('✓ Generated: icon.png (for Linux)');
  }

  console.log('');
  console.log('Icon generation complete!');
}

generateIcons().catch(console.error);
```

- [ ] **Step 3: Run icon generation**

Run: `npm run generate:icons`
Expected: All PNGs + `icon.ico` + `icon.icns` + `icon.png` generated in `assets/`.

- [ ] **Step 4: Update `electron-builder.yml` icon paths**

Replace line 23:
```yaml
    icon: assets/icon.ico
```

Replace line 37:
```yaml
    icon: assets/icon.icns
```

The `linux:` section (`icon: assets`) stays unchanged.

- [ ] **Step 5: Verify build config is valid**

Run: `npx electron-builder --config --win --dry-run`
Expected: Config loads without icon-related errors (may show other errors unrelated to icons; that's fine — we're only checking the icon paths resolve).

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-icons.mjs electron-builder.yml assets/icon.ico assets/icon.icns assets/icon.png assets/icon_*.png package.json package-lock.json
git commit -m "fix: generate ICO/ICNS icons for cross-platform builds"
```

---

### Task 3: Windows single-instance lock + protocol activation

**Files:**
- Modify: `electron/main.ts` (before line 927, and after line 951)

- [ ] **Step 1: Add single-instance lock before `app.whenReady()`**

Insert the following code **before** the `app.whenReady().then(...)` block (currently at line 927 in `electron/main.ts`):

```typescript
// ── Single instance lock ──
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}
```

The `app.whenReady()` call stays in place right after.

- [ ] **Step 2: Add `second-instance` event handler**

Insert the following code right after the existing `app.on('open-url', ...)` handler block (after line 951):

```typescript
// ── Handle URI protocol activation (Windows) ──
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})
```

- [ ] **Step 3: Build and verify no TypeScript errors**

Run: `npm run build`
Expected: TypeScript compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "fix: add single-instance lock and Windows protocol activation"
```

---

### Task 4: Conditional UPX in PyInstaller spec

**Files:**
- Modify: `python/hcomic_backend.spec`

- [ ] **Step 1: Add platform detection and update UPX references**

At the top of `python/hcomic_backend.spec` (after the existing imports on lines 1–2), add:

```python
import platform

# UPX is unavailable on macOS ARM64; disable to prevent build failures
_use_upx = not (platform.system() == 'Darwin' and platform.machine() == 'arm64')
```

Then change line 43 (`upx=True,` in the `EXE()` call) to:
```python
    upx=_use_upx,
```

And change line 54 (`upx=True,` in the `COLLECT()` call) to:
```python
    upx=_use_upx,
```

- [ ] **Step 2: Verify spec file parses without errors**

Run: `python -c "exec(open('python/hcomic_backend.spec').read().split('a = Analysis')[0]); print('UPX enabled:', _use_upx)"`
Expected: Prints `UPX enabled: True` on Windows x64, `UPX enabled: False` on macOS ARM64.

- [ ] **Step 3: Commit**

```bash
git add python/hcomic_backend.spec
git commit -m "fix: disable UPX on macOS ARM64 to prevent build failures"
```
