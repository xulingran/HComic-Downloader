# GitHub Actions Multi-Platform Release Workflow

## Overview

Create a GitHub Actions workflow that automatically builds and publishes a release for all three platforms (Windows, macOS, Linux) when a version tag (e.g. `2.0.0`) is pushed.

## Trigger

- Event: `push` tag matching `[0-9]+.[0-9]+.[0-9]+` (pure numeric semver)

## Architecture

```
build-win  ──┐
build-mac  ──┼──→ release
build-linux ──┘
```

Four jobs, release depends on all three builds succeeding.

## Job: build-win

- **Runner:** `windows-latest`
- **Steps:**
  1. Checkout
  2. Setup Node.js 20
  3. Setup Python 3.13
  4. `pip install -r requirements.txt pyinstaller`
  5. `npm ci`
  6. `npm run build:python` (PyInstaller)
  7. `npm run build` (electron-vite)
  8. `npx electron-builder --win`
  9. Upload `dist/*.exe` as artifact

## Job: build-mac

- **Runner:** `macos-latest` (arm64)
- **Environment:** `CSC_IDENTITY_AUTO_DISCOVERY=false` (skip code signing)
- **Steps:**
  1. Checkout
  2. Setup Node.js 20
  3. Setup Python 3.13
  4. `pip install -r requirements.txt pyinstaller`
  5. `npm ci`
  6. `npm run build:python` (PyInstaller)
  7. `npm run build` (electron-vite)
  8. `npx electron-builder --mac --arm64` (arm64 only, since runner is arm64)
  9. Upload `dist/*.dmg` as artifact

## Job: build-linux

- **Runner:** `ubuntu-latest`
- **Steps:**
  1. Checkout
  2. Setup Node.js 20
  3. Setup Python 3.13
  4. Install system deps for curl_cffi (`sudo apt-get install -y libcurl4-openssl-dev libssl-dev`)
  5. `pip install -r requirements.txt pyinstaller`
  6. `npm ci`
  7. `npm run build:python` (PyInstaller)
  8. `npm run build` (electron-vite)
  9. `npx electron-builder --linux`
  10. Upload `dist/*.AppImage` as artifact

## Job: release

- **Needs:** [build-win, build-mac, build-linux]
- **Runner:** `ubuntu-latest`
- **Steps:**
  1. Download all artifacts
  2. Create GitHub Release (tag name = version, published directly)
  3. Upload all build artifacts to the release

## Key Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| macOS architecture | arm64 only | Runner is arm64; PyInstaller can only produce native arch |
| Code signing | Skip | No certificate; `CSC_IDENTITY_AUTO_DISCOVERY=false` |
| Release visibility | Published directly | User preference |
| Node.js version | 20 | LTS, compatible with Electron 28 |
| Python version | 3.13 | Matches project setup |

## Output File

`.github/workflows/release.yml`
