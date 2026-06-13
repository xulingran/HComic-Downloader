# 自动检测更新功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现启动时自动检测 GitHub Release 更新并弹窗提示，同时支持在关于页手动检查、在设置中开关该功能。

**Architecture:** 主进程 UpdateChecker 模块通过 GitHub REST API 获取最新 release 信息，与当前版本比较后通过 IPC 通知渲染进程。渲染进程通过 UpdateDialog 展示更新信息和更新日志，用户可跳转浏览器下载。

**Tech Stack:** Electron `net.fetch()`, GitHub REST API, React (TypeScript), Tailwind CSS, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `shared/types.ts` | Modify | 新增 UpdateInfo、UpdateCheckResult 类型，IPC/通知通道，配置键 |
| `electron/update-checker.ts` | Create | GitHub API 请求 + 版本比较核心逻辑 |
| `electron/main.ts` | Modify | 注册 IPC handler，启动时自动检查 |
| `electron/preload.ts` | Modify | 暴露 checkForUpdates 和 onUpdateAvailable |
| `src/components/UpdateDialog.tsx` | Create | 更新提示对话框 + 轻量 markdown 渲染 |
| `src/pages/AboutPage.tsx` | Modify | 添加"检查更新"按钮 |
| `src/components/settings/NotificationSettings.tsx` | Modify | 添加"启动时检查更新"开关 |
| `src/pages/SettingsPage.tsx` | Modify | 传递 checkUpdateOnStart 配置 |
| `src/App.tsx` | Modify | 注册 onUpdateAvailable 监听，渲染 UpdateDialog |
| `tests/unit/update-checker.test.ts` | Create | UpdateChecker 单元测试 |

---

### Task 1: Add types to shared/types.ts

**Files:**
- Modify: `shared/types.ts`

This is the foundation — all subsequent tasks depend on these type definitions.

- [ ] **Step 1: Add UpdateInfo and UpdateCheckResult types**

Add after the `MigrationStatusResponse` interface (around line 150):

```typescript
export interface UpdateInfo {
  latestVersion: string
  changelog: string
  releaseUrl: string
}

export type UpdateCheckResult =
  | { hasUpdate: true; latestVersion: string; changelog: string; releaseUrl: string }
  | { hasUpdate: false }
  | { error: string }
```

- [ ] **Step 2: Add IPC and notification channel constants**

In `IPC_CHANNELS`, add after `SELECT_DIRECTORY`:

```typescript
  UPDATE_CHECK: 'update:check',
```

In `NOTIFICATION_CHANNELS`, add after `LOGIN_COOKIE_SUCCESS`:

```typescript
  UPDATE_CHECK_RESULT: 'update:check-result',
```

- [ ] **Step 3: Add config key**

In `ConfigKey` union type, add `'checkUpdateOnStart'` to the end of the union.

In `CONFIG_KEYS` array, add `'checkUpdateOnStart'` to the end.

In `ConfigValueMap`, add:

```typescript
  checkUpdateOnStart: boolean
```

In `AppConfig` interface, add:

```typescript
  checkUpdateOnStart?: boolean
```

- [ ] **Step 4: Add HcomicAPI methods**

In `HcomicAPI` interface, add after `onLoginCookieSuccess`:

```typescript
  checkForUpdates(): Promise<UpdateCheckResult>
  onUpdateAvailable(callback: (info: UpdateInfo) => void): () => void
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: Type errors are expected since the new methods aren't implemented yet, but the types themselves should be syntactically valid.

---

### Task 2: Create UpdateChecker with TDD

**Files:**
- Create: `tests/unit/update-checker.test.ts`
- Create: `electron/update-checker.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/update-checker.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFetch, mockGetVersion } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockGetVersion: vi.fn().mockReturnValue('1.0.0'),
}))

vi.mock('electron', () => ({
  net: { fetch: mockFetch },
  app: { getVersion: mockGetVersion },
}))

import { compareVersions, checkForUpdates } from '../../../electron/update-checker'

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })

  it('returns positive when latest is greater (patch)', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBeGreaterThan(0)
  })

  it('returns positive when latest is greater (minor)', () => {
    expect(compareVersions('1.0.0', '1.1.0')).toBeGreaterThan(0)
  })

  it('returns positive when latest is greater (major)', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBeGreaterThan(0)
  })

  it('returns negative when current is greater', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeLessThan(0)
  })

  it('handles v prefix', () => {
    expect(compareVersions('1.0.0', 'v1.0.1')).toBeGreaterThan(0)
  })

  it('handles shorter version strings', () => {
    expect(compareVersions('1.0', '1.0.1')).toBeGreaterThan(0)
  })
})

describe('checkForUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetVersion.mockReturnValue('1.0.0')
  })

  it('returns hasUpdate when newer version found', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v1.1.0',
        body: '## What\'s Changed\n- New feature',
        html_url: 'https://github.com/xulingran/HComic-Downloader/releases/tag/v1.1.0',
      }),
    })

    const result = await checkForUpdates()

    expect(result).toEqual({
      hasUpdate: true,
      latestVersion: '1.1.0',
      changelog: '## What\'s Changed\n- New feature',
      releaseUrl: 'https://github.com/xulingran/HComic-Downloader/releases/tag/v1.1.0',
    })
  })

  it('returns hasUpdate false when already up to date', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v1.0.0',
        body: '',
        html_url: 'https://github.com/xulingran/HComic-Downloader/releases/tag/v1.0.0',
      }),
    })

    const result = await checkForUpdates()
    expect(result).toEqual({ hasUpdate: false })
  })

  it('returns error when API request fails', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
    })

    const result = await checkForUpdates()
    expect(result).toEqual({ error: 'GitHub API returned 403' })
  })

  it('returns error when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const result = await checkForUpdates()
    expect(result).toEqual({ error: 'Network error' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/update-checker.test.ts`

Expected: FAIL — module `../../../electron/update-checker` not found.

- [ ] **Step 3: Write minimal implementation**

Create `electron/update-checker.ts`:

```typescript
import { net, app } from 'electron'
import type { UpdateCheckResult } from '../shared/types'

const GITHUB_REPO = 'xulingran/HComic-Downloader'
const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

export function compareVersions(current: string, latest: string): number {
  const normalize = (v: string): number[] =>
    v.replace(/^v/, '').split('.').map(Number)
  const cur = normalize(current)
  const lat = normalize(latest)
  for (let i = 0; i < 3; i++) {
    if ((lat[i] || 0) > (cur[i] || 0)) return 1
    if ((lat[i] || 0) < (cur[i] || 0)) return -1
  }
  return 0
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  try {
    const response = await net.fetch(RELEASES_API_URL)
    if (!response.ok) {
      return { error: `GitHub API returned ${response.status}` }
    }
    const data = await response.json() as {
      tag_name: string
      body: string
      html_url: string
    }
    const latestVersion = data.tag_name.replace(/^v/, '')
    const currentVersion = app.getVersion()

    if (compareVersions(currentVersion, latestVersion) < 0) {
      return {
        hasUpdate: true,
        latestVersion,
        changelog: data.body || '',
        releaseUrl: data.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
      }
    }
    return { hasUpdate: false }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/update-checker.test.ts`

Expected: All tests PASS.

---

### Task 3: Add config validator and IPC handlers to main.ts

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Add import for checkForUpdates**

At the top of `electron/main.ts`, add after the existing `./python-bridge` import:

```typescript
import { checkForUpdates } from './update-checker'
```

- [ ] **Step 2: Add config validator**

In the `CONFIG_VALIDATORS` object (around line 193), add after `favouriteTagMinMatches`:

```typescript
  checkUpdateOnStart: boolean(),
```

- [ ] **Step 3: Add IPC handler in registerIPCHandlers**

Inside `registerIPCHandlers()`, at the end of the function body (after all `registerXxxHandlers` calls, before the closing brace), add:

```typescript
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, async () => {
    return checkForUpdates()
  })
```

- [ ] **Step 4: Add scheduleStartupUpdateCheck function**

Add before the `app.whenReady()` call (around line 1051):

```typescript
function scheduleStartupUpdateCheck() {
  const bridge = getPythonBridge()
  bridge.call('get_config').then((result: unknown) => {
    const config = (result as Record<string, unknown>)?.config as Record<string, unknown> | undefined
    if (!config) return
    if (config.checkUpdateOnStart === false) return

    setTimeout(async () => {
      try {
        const updateResult = await checkForUpdates()
        if (updateResult.hasUpdate && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(NOTIFICATION_CHANNELS.UPDATE_CHECK_RESULT, {
            latestVersion: updateResult.latestVersion,
            changelog: updateResult.changelog,
            releaseUrl: updateResult.releaseUrl,
          })
        }
      } catch {
        // Silent failure for auto-check
      }
    }, 3000)
  }).catch(() => {
    // Failed to read config, skip update check
  })
}
```

- [ ] **Step 5: Call scheduleStartupUpdateCheck on app ready**

Inside the `app.whenReady().then()` callback, add after `registerIPCHandlers()`:

```typescript
    scheduleStartupUpdateCheck()
```

The block should now look like:

```typescript
app.whenReady().then(() => {
  try {
    if (process.platform !== 'linux') {
      app.setAsDefaultProtocolClient('hcomic')
    }

    createWindow()
    registerIPCHandlers()
    scheduleStartupUpdateCheck()
  } catch (err) {
    dialog.showErrorBox('启动失败', '应用初始化失败: ' + (err as Error).message)
    app.quit()
  }
})
```

- [ ] **Step 6: Verify build compiles**

Run: `npx electron-vite build 2>&1 | tail -5`

Expected: Build succeeds with no errors.

---

### Task 4: Add preload API

**Files:**
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add checkForUpdates API**

Inside `contextBridge.exposeInMainWorld('hcomic', { ... })`, add at the end (before the closing `})`):

```typescript
  checkForUpdates: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK)
  },
```

- [ ] **Step 2: Add onUpdateAvailable listener**

After the `checkForUpdates` entry, add:

```typescript
  onUpdateAvailable: (callback: unknown) => {
    return onChannel(NOTIFICATION_CHANNELS.UPDATE_CHECK_RESULT, callback)
  },
```

- [ ] **Step 3: Verify build compiles**

Run: `npx electron-vite build 2>&1 | tail -5`

Expected: Build succeeds.

---

### Task 5: Create UpdateDialog component

**Files:**
- Create: `src/components/UpdateDialog.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/UpdateDialog.tsx`:

```tsx
import type { UpdateInfo } from '@shared/types'

interface UpdateDialogProps {
  info: UpdateInfo
  onClose: () => void
}

function renderChangelogMarkdown(md: string): string {
  if (!md) return ''
  const lines = md.split('\n')
  const parts: string[] = []
  let inList = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('## ')) {
      if (inList) { parts.push('</ul>'); inList = false }
      parts.push(`<h3 class="text-base font-medium text-[var(--text-primary)] mt-3 mb-1">${inline(trimmed.slice(3))}</h3>`)
    } else if (trimmed.startsWith('### ')) {
      if (inList) { parts.push('</ul>'); inList = false }
      parts.push(`<h4 class="text-sm font-medium text-[var(--text-primary)] mt-2 mb-1">${inline(trimmed.slice(4))}</h4>`)
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) { parts.push('<ul class="list-disc pl-4 my-1">'); inList = true }
      parts.push(`<li>${inline(trimmed.slice(2))}</li>`)
    } else if (trimmed === '') {
      if (inList) { parts.push('</ul>'); inList = false }
    } else {
      if (inList) { parts.push('</ul>'); inList = false }
      parts.push(`<p>${inline(trimmed)}</p>`)
    }
  }
  if (inList) parts.push('</ul>')
  return parts.join('')
}

function inline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-[var(--accent)] hover:underline" target="_blank" rel="noopener noreferrer">$1</a>')
}

export function UpdateDialog({ info, onClose }: UpdateDialogProps) {
  const handleDownload = () => {
    window.hcomic?.openUrl(info.releaseUrl)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[var(--bg-primary)] rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border)]">
          <h3 className="text-lg font-medium text-[var(--text-primary)]">
            发现新版本 v{info.latestVersion}
          </h3>
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {info.changelog ? (
            <div
              className="text-sm text-[var(--text-secondary)] [&_a]:text-[var(--accent)] [&_a]:hover:underline [&_h3]:text-base [&_h3]:font-medium [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-[var(--text-primary)] [&_h4]:text-sm [&_h4]:font-medium [&_h4]:mt-2 [&_h4]:mb-1 [&_h4]:text-[var(--text-primary)] [&_li]:text-sm [&_p]:text-sm [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-1"
              dangerouslySetInnerHTML={{ __html: renderChangelogMarkdown(info.changelog) }}
            />
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">暂无更新日志</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)]"
          >
            稍后提醒
          </button>
          <button
            onClick={handleDownload}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-white"
          >
            去下载
          </button>
        </div>
      </div>
    </div>
  )
}
```

Note: The `[&_xxx]` Tailwind arbitrary variant syntax applies styles to dynamically rendered child elements. This avoids relying on classes generated from `dangerouslySetInnerHTML` strings.

- [ ] **Step 2: Verify build compiles**

Run: `npx electron-vite build 2>&1 | tail -5`

Expected: Build succeeds.

---

### Task 6: Update AboutPage

**Files:**
- Modify: `src/pages/AboutPage.tsx`

- [ ] **Step 1: Add check update button and state**

Replace the entire content of `src/pages/AboutPage.tsx` with:

```tsx
import { useState, useCallback } from 'react'
import type { MouseEvent } from 'react'
import type { UpdateInfo, UpdateCheckResult } from '@shared/types'
import { LogoIcon } from '../components/LogoIcon'
import { UpdateDialog } from '../components/UpdateDialog'

declare const __APP_NAME__: string
declare const __APP_DESCRIPTION__: string
declare const __APP_VERSION__: string

const REPOSITORY_URL = 'https://github.com/xulingran/HComic-Downloader'

type CheckState = 'idle' | 'checking' | 'up-to-date' | 'error'

export function AboutPage() {
  const [checkState, setCheckState] = useState<CheckState>('idle')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  const openRepository = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    if (window.hcomic) {
      window.hcomic.openUrl(REPOSITORY_URL)
    } else {
      window.open(REPOSITORY_URL, '_blank')
    }
  }

  const handleCheckUpdate = useCallback(async () => {
    setCheckState('checking')
    setErrorMessage('')
    try {
      const result: UpdateCheckResult = await window.hcomic.checkForUpdates()
      if (result.hasUpdate) {
        setUpdateInfo({
          latestVersion: result.latestVersion,
          changelog: result.changelog,
          releaseUrl: result.releaseUrl,
        })
        setCheckState('idle')
      } else if (result.error) {
        setCheckState('error')
        setErrorMessage(result.error)
      } else {
        setCheckState('up-to-date')
      }
    } catch {
      setCheckState('error')
      setErrorMessage('检查更新失败')
    }
  }, [])

  const statusText = checkState === 'checking'
    ? '检查中...'
    : checkState === 'up-to-date'
      ? '已是最新版本'
      : checkState === 'error'
        ? errorMessage || '检查失败'
        : ''

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-6">关于</h2>

      <div className="bg-[var(--bg-primary)] rounded-xl border border-[var(--border)] p-8 space-y-6">
        {/* 应用图标 */}
        <div className="flex justify-center">
          <LogoIcon size={80} className="drop-shadow-lg" />
        </div>

        {/* 应用名称 */}
        <div className="text-center">
          <h3 className="text-2xl font-bold text-[var(--text-primary)]">
            {__APP_NAME__}
          </h3>
          <p className="text-sm text-[var(--text-secondary)] mt-2">
            {__APP_DESCRIPTION__}
          </p>
        </div>

        {/* 信息列表 */}
        <div className="border-t border-[var(--border)] pt-6 space-y-4">
          <div className="flex items-center justify-between py-2 px-4 rounded-lg bg-[var(--bg-secondary)]">
            <span className="text-sm text-[var(--text-secondary)]">版本号</span>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-[var(--text-primary)]">
                v{__APP_VERSION__}
              </span>
              <button
                onClick={handleCheckUpdate}
                disabled={checkState === 'checking'}
                className="px-3 py-1 text-xs rounded-lg bg-[var(--accent)] text-white disabled:opacity-50"
              >
                {checkState === 'checking' ? '检查中...' : '检查更新'}
              </button>
            </div>
          </div>

          {statusText && checkState !== 'idle' && checkState !== 'checking' && (
            <div className={`text-xs px-4 ${
              checkState === 'up-to-date' ? 'text-green-600' : 'text-red-500'
            }`}>
              {statusText}
            </div>
          )}

          <div className="flex items-center justify-between gap-4 py-2 px-4 rounded-lg bg-[var(--bg-secondary)]">
            <span className="text-sm text-[var(--text-secondary)]">仓库地址</span>
            <a
              href={REPOSITORY_URL}
              onClick={openRepository}
              className="text-sm font-medium text-[var(--accent)] hover:underline truncate"
            >
              {REPOSITORY_URL}
            </a>
          </div>
        </div>
      </div>

      {updateInfo && (
        <UpdateDialog
          info={updateInfo}
          onClose={() => setUpdateInfo(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify build compiles**

Run: `npx electron-vite build 2>&1 | tail -5`

Expected: Build succeeds.

---

### Task 7: Update NotificationSettings and SettingsPage

**Files:**
- Modify: `src/components/settings/NotificationSettings.tsx`
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: Add toggle to NotificationSettings**

Add `checkUpdateOnStart` prop to the component. Replace the full content of `src/components/settings/NotificationSettings.tsx` with:

```tsx
import type { ConfigKey } from '@shared/types'

type NotifyWhenForeground = 'inactive' | 'always'

interface NotificationSettingsProps {
  notifyOnComplete: boolean
  notifyWhenForeground: NotifyWhenForeground
  checkUpdateOnStart: boolean
  onConfigChange: (key: ConfigKey, value: unknown) => void
}

export function NotificationSettings({
  notifyOnComplete,
  notifyWhenForeground,
  checkUpdateOnStart,
  onConfigChange,
}: NotificationSettingsProps) {
  return (
    <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-6">
      <h3 className="text-base font-medium text-[var(--text-primary)] border-b border-[var(--border)] pb-3">
        通知
      </h3>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-[var(--text-primary)]">下载完成通知</label>
          <button
            onClick={() => onConfigChange('notifyOnComplete', !notifyOnComplete)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              notifyOnComplete ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
            }`}
          >
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
              notifyOnComplete ? 'left-7' : 'left-1'
            }`} />
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">前台通知</label>
          <div className="flex gap-3">
            {(['inactive', 'always'] as NotifyWhenForeground[]).map((mode) => (
              <button
                key={mode}
                onClick={() => onConfigChange('notifyWhenForeground', mode)}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  notifyWhenForeground === mode
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]'
                }`}
              >
                {mode === 'inactive' ? '仅后台时' : '始终通知'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <label className="text-sm font-medium text-[var(--text-primary)]">启动时检查更新</label>
          <button
            onClick={() => onConfigChange('checkUpdateOnStart', !checkUpdateOnStart)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              checkUpdateOnStart ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
            }`}
          >
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
              checkUpdateOnStart ? 'left-7' : 'left-1'
            }`} />
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add checkUpdateOnStart to SettingsPage ConfigState**

In `src/pages/SettingsPage.tsx`:

In the `ConfigState` interface, add:

```typescript
  checkUpdateOnStart: boolean
```

In the initial state of `config` useState, add to the object:

```typescript
  checkUpdateOnStart: true,
```

In the `loadConfig` function's `setConfigState` call, add:

```typescript
  checkUpdateOnStart: result.config.checkUpdateOnStart !== false,
```

- [ ] **Step 3: Pass checkUpdateOnStart to NotificationSettings**

In the `<NotificationSettings>` JSX in SettingsPage, add the prop:

```tsx
<NotificationSettings
  notifyOnComplete={config.notifyOnComplete}
  notifyWhenForeground={config.notifyWhenForeground}
  checkUpdateOnStart={config.checkUpdateOnStart}
  onConfigChange={handleConfigChange}
/>
```

- [ ] **Step 4: Verify build compiles**

Run: `npx electron-vite build 2>&1 | tail -5`

Expected: Build succeeds.

---

### Task 8: Update App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add import for UpdateDialog and onUpdateAvailable**

At the top of `src/App.tsx`, add to the imports:

```typescript
import { UpdateDialog } from './components/UpdateDialog'
import type { UpdateInfo } from '@shared/types'
```

- [ ] **Step 2: Add state and listener for update notifications**

Inside the `App` function, add after the existing state declarations:

```typescript
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)

  useEffect(() => {
    const unsubscribe = window.hcomic?.onUpdateAvailable((info: UpdateInfo) => {
      setUpdateInfo(info)
    })
    return () => { unsubscribe?.() }
  }, [])
```

- [ ] **Step 3: Render UpdateDialog**

Inside the return JSX, add after the `<ComicReaderModal>` element:

```tsx
      {updateInfo && (
        <UpdateDialog
          info={updateInfo}
          onClose={() => setUpdateInfo(null)}
        />
      )}
```

- [ ] **Step 4: Verify full build compiles**

Run: `npx electron-vite build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 5: Run all tests**

Run: `npx vitest run 2>&1 | tail -20`

Expected: All existing tests plus the new update-checker tests pass.

---

### Task 9: Manual verification

- [ ] **Step 1: Start dev server and verify UI**

Run: `npm run dev`

Verify:
1. App starts normally (no crash from new code)
2. Settings → Notification section shows "启动时检查更新" toggle
3. About page shows "检查更新" button next to version number
4. Clicking "检查更新" shows "已是最新版本" or error (since current version may match latest release)
5. About page auto-check dialog does NOT show (because version may be current)

- [ ] **Step 2: Verify auto-check triggers on startup**

To test the auto-check path, temporarily change `compareVersions` to always return 1, rebuild, and verify the dialog appears on startup. Then revert the change.
