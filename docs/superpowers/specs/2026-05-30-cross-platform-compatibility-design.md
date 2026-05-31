# Cross-Platform Compatibility Fix Design

**Date:** 2026-05-30
**Status:** Approved
**Scope:** Code audit + targeted fixes for Windows / macOS / Linux compatibility

## Problem

The project is an Electron + Python (PyInstaller) desktop application primarily developed on Windows. While it has build configs for all three platforms (electron-builder: nsis/dmg/AppImage) and some platform-aware code, several issues will cause build failures or broken functionality on macOS and Linux.

## Findings

### Issues that cause build/runtime failures

1. **`package.json` — `lint:py` scripts** — Hardcoded Windows path `venv\\Scripts\\ruff.exe`, unusable on macOS/Linux.
2. **`electron-builder.yml` — Icon format** — References `assets/icon.svg` for Windows and macOS, but electron-builder requires `.ico` for Windows and `.icns` for macOS. SVG is not a supported icon format.
3. **`main.ts` — Protocol activation** — Only handles macOS `open-url` event. Missing Windows `second-instance` event handling and single-instance lock, so `hcomic://` protocol links won't activate the window on Windows.
4. **`python/hcomic_backend.spec` — UPX** — `upx=True` unconditionally, but UPX is unavailable on macOS ARM64 (Apple Silicon) and may be missing on Linux, causing PyInstaller build failures.

### Already correct (no changes needed)

- `config.py` — File permissions: `os.chmod` for Unix, `icacls` for Windows.
- `download_mixin.py` — Open directory: `os.startfile` / `open` / `xdg-open`.
- `config_mixin.py` — Platform-specific CJK font lists.
- `main.ts` — `window-all-closed` skips quit on macOS.
- `utils.py` — `sanitize_filename` uses Windows-illegal charset; overly restrictive but safe on all platforms.

## Design

### Fix 1: Cross-platform `lint:py` script

Create `scripts/lint-py.mjs` that detects the platform and spawns the correct ruff binary:

- Windows: `venv\Scripts\ruff.exe`
- macOS/Linux: `venv/bin/ruff`

The script receives forwarded CLI args (e.g., `--fix`) and inherits stdio for interactive output.

`package.json` changes:
```json
"lint:py": "node scripts/lint-py.mjs",
"lint:py:fix": "node scripts/lint-py.mjs --fix"
```

### Fix 2: Icon format generation

Extend `scripts/generate-icons.mjs` to produce all required formats from `assets/icon.svg`:

- **Windows**: `assets/icon.ico` — synthesized from 256/48/32/16 PNGs via `png-to-ico`
- **macOS**: `assets/icon.icns` — generated via `png2icons`
- **Linux**: `assets/icon.png` (512×512) — already generated
- All intermediate PNGs (512/256/128/64/48/32/16) as before

New devDependencies: `png-to-ico`, `png2icons`.

`electron-builder.yml` changes:
```yaml
win:
  icon: assets/icon.ico
mac:
  icon: assets/icon.icns
linux:
  icon: assets          # unchanged, directory with PNGs
```

### Fix 3: Protocol activation on Windows

Add single-instance lock before `app.whenReady()`:
```typescript
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}
```

Add `second-instance` event handler to bring window to foreground:
```typescript
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})
```

The existing `open-url` handler (macOS) and `setAsDefaultProtocolClient` (Windows/macOS, already skips Linux) remain unchanged.

### Fix 4: Conditional UPX in PyInstaller spec

In `python/hcomic_backend.spec`, detect platform at build time:
```python
import platform
_use_upx = not (platform.system() == 'Darwin' and platform.machine() == 'arm64')
```

Replace two occurrences of `upx=True` with `upx=_use_upx` in both `EXE()` and `COLLECT()` calls.

## Files Changed

| File | Change |
|------|--------|
| `scripts/lint-py.mjs` | **New** — Cross-platform ruff launcher |
| `package.json` | Update `lint:py` / `lint:py:fix` scripts |
| `scripts/generate-icons.mjs` | Add `.ico` / `.icns` generation |
| `electron-builder.yml` | Update icon paths to `.ico` / `.icns` |
| `electron/main.ts` | Add `requestSingleInstanceLock` + `second-instance` handler |
| `python/hcomic_backend.spec` | Conditional `upx` based on platform |

## Out of Scope

- CI/CD multi-platform build pipeline
- Cross-platform testing infrastructure
- `build:python` script robustness improvements
- Linux icon multi-size PNG generation (already partially works)
