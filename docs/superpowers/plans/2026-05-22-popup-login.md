# Popup Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an embedded BrowserWindow popup login for h-comic.com (Auth0) that auto-extracts cookies, coexisting with the existing cURL paste method.

**Architecture:** Open a separate BrowserWindow loading h-comic.com. The user clicks the login button on the page, goes through Auth0 login, and after redirect back to h-comic.com, the main process extracts cookies from the window session, constructs a cURL string, and applies it via the existing `apply_auth` Python IPC method. No Python changes needed.

**Tech Stack:** Electron (BrowserWindow, session.cookies), TypeScript, React, existing IPC architecture.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `shared/types.ts` | Add `OPEN_LOGIN_WINDOW` IPC channel constant and `openLoginWindow` to `HcomicAPI` type |
| `electron/main.ts` | Add `openLoginWindow()` function + IPC handler registration |
| `electron/preload.ts` | Expose `openLoginWindow` to renderer via `contextBridge` |
| `src/components/settings/AuthSettings.tsx` | Add "弹窗登录" button with loading state |
| `src/pages/SettingsPage.tsx` | Add `handleOpenLoginWindow` handler and wire to `AuthSettings` |

---

### Task 1: Add IPC channel and type definitions

**Files:**
- Modify: `shared/types.ts`

- [ ] **Step 1: Add `OPEN_LOGIN_WINDOW` to `IPC_CHANNELS`**

In `shared/types.ts`, find the `IPC_CHANNELS` object (around line 401) and add a new entry after the `OPEN_EXTERNAL` line:

```typescript
OPEN_LOGIN_WINDOW: 'open-login-window',
```

Insert it right after `OPEN_EXTERNAL: 'open-external',` (line 414).

- [ ] **Step 2: Add `openLoginWindow` to `HcomicAPI` interface**

In the `HcomicAPI` interface (around line 346), add after the `openUrl` method (line 359):

```typescript
openLoginWindow(): Promise<{ success: boolean; message?: string }>
```

- [ ] **Step 3: Commit**

```bash
git add shared/types.ts
git commit -m "feat(login): add IPC channel and type for popup login window"
```

---

### Task 2: Implement `openLoginWindow()` in Electron main process

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Add `openLoginWindow` function**

Add the following function in `electron/main.ts`, right before the `registerIPCHandlers` function (around line 408). This is a standalone function, not inside any other function:

```typescript
const LOGIN_WINDOW_TIMEOUT_MS = 5 * 60 * 1_000
const LOGIN_COOKIE_SETTLE_MS = 1_000

function openLoginWindow(): Promise<{ success: boolean; message?: string }> {
  const parent = mainWindow
  if (!parent) {
    return Promise.resolve({ success: false, message: '主窗口不存在' })
  }

  return new Promise((resolve) => {
    let settled = false
    let hasVisitedAuth0 = false

    const loginWin = new BrowserWindow({
      width: 500,
      height: 700,
      title: '登录 H-Comic',
      parent: parent,
      modal: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    const done = (result: { success: boolean; message?: string }) => {
      if (settled) return
      settled = true
      if (!loginWin.isDestroyed()) {
        loginWin.close()
      }
      resolve(result)
    }

    // Timeout after 5 minutes
    const timeout = setTimeout(() => {
      done({ success: false, message: '登录超时，请重试' })
    }, LOGIN_WINDOW_TIMEOUT_MS)

    loginWin.on('closed', () => {
      clearTimeout(timeout)
      if (!settled) {
        done({ success: false, message: '已取消' })
      }
    })

    loginWin.webContents.on('did-navigate', (_event, url) => {
      if (url.includes('auth0.com')) {
        hasVisitedAuth0 = true
      }
      if (hasVisitedAuth0 && (url.startsWith('https://h-comic.com') || url.startsWith('https://www.h-comic.com'))) {
        hasVisitedAuth0 = false
        setTimeout(async () => {
          clearTimeout(timeout)
          try {
            const cookies = await loginWin.webContents.session.cookies.get({ url: 'https://h-comic.com' })
            if (cookies.length === 0) {
              done({ success: false, message: '未获取到登录信息' })
              return
            }
            const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ')
            const userAgent = loginWin.webContents.userAgent

            const bridge = getPythonBridge()
            await bridge.call('apply_auth', {
              curl_text: `curl 'https://h-comic.com' -b '${cookieStr}' -H 'User-Agent: ${userAgent}'`,
            })
            const verifyResult = await bridge.call('verify_auth') as { valid: boolean; message: string }
            done({ success: verifyResult.valid, message: verifyResult.message })
          } catch (err: any) {
            done({ success: false, message: err?.message || '登录处理失败' })
          }
        }, LOGIN_COOKIE_SETTLE_MS)
      }
    })

    loginWin.loadURL('https://h-comic.com').catch(() => {
      done({ success: false, message: '无法打开登录页面' })
    })
  })
}
```

- [ ] **Step 2: Register IPC handler**

In the `registerIPCHandlers` function, add the following handler. A good place is right after the existing `IPC_CHANNELS.VERIFY_AUTH` handler (around line 537):

```typescript
ipcMain.handle(IPC_CHANNELS.OPEN_LOGIN_WINDOW, async () => {
  return openLoginWindow()
})
```

- [ ] **Step 3: Commit**

```bash
git add electron/main.ts
git commit -m "feat(login): implement openLoginWindow with Auth0 cookie extraction"
```

---

### Task 3: Expose `openLoginWindow` in preload

**Files:**
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add `openLoginWindow` method**

In `electron/preload.ts`, add the following entry to the `contextBridge.exposeInMainWorld('hcomic', { ... })` object. A good place is right after the `openUrl` method (around line 73):

```typescript
openLoginWindow: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_LOGIN_WINDOW),
```

- [ ] **Step 2: Commit**

```bash
git add electron/preload.ts
git commit -m "feat(login): expose openLoginWindow in preload contextBridge"
```

---

### Task 4: Add "弹窗登录" button to AuthSettings UI

**Files:**
- Modify: `src/components/settings/AuthSettings.tsx`

- [ ] **Step 1: Add `onOpenLoginWindow` to props interface**

Replace the `AuthSettingsProps` interface (lines 3-9) with:

```typescript
interface AuthSettingsProps {
  loginSectionRef: RefObject<HTMLDivElement>
  loginStatus: 'idle' | 'verifying' | 'valid' | 'invalid' | 'error'
  loginMessage: string
  onApplyAuth: (curlText: string) => Promise<void>
  onTestAuth: () => Promise<void>
  onOpenLoginWindow: () => Promise<void>
}
```

- [ ] **Step 2: Destructure new prop**

Update the destructuring in the function signature (line 11-17) to include `onOpenLoginWindow`:

```typescript
export function AuthSettings({
  loginSectionRef,
  loginStatus,
  loginMessage,
  onApplyAuth,
  onTestAuth,
  onOpenLoginWindow,
}: AuthSettingsProps) {
```

- [ ] **Step 3: Add "弹窗登录" button UI**

Insert the following block in the JSX, right before the `<div>` that contains the `<textarea>` (before line 43, inside the `<div className="space-y-4">` block). Place it after the status badge `</div>`:

```tsx
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenLoginWindow}
            disabled={loginStatus === 'verifying'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                       bg-[var(--accent)] text-white hover:opacity-90
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loginStatus === 'verifying' ? '登录中...' : '弹窗登录'}
          </button>
          <span className="text-xs text-[var(--text-secondary)]">在弹窗中登录 H-Comic 账号</span>
        </div>
```

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/AuthSettings.tsx
git commit -m "feat(login): add popup login button to AuthSettings UI"
```

---

### Task 5: Wire up `handleOpenLoginWindow` in SettingsPage

**Files:**
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: Add `handleOpenLoginWindow` function**

Add the following function in `SettingsPage.tsx`, right after the `handleTestAuth` function (after line 217):

```typescript
  const handleOpenLoginWindow = async () => {
    const prevStatus = loginStatus
    setLoginStatus('verifying')
    setLoginMessage('')
    try {
      const result = await window.hcomic?.openLoginWindow()
      if (!result) {
        setLoginStatus(prevStatus)
        return
      }
      if (result.success) {
        setLoginStatus('valid')
        setLoginMessage(result.message || '登录成功')
      } else {
        if (result.message === '已取消') {
          setLoginStatus(prevStatus)
        } else {
          setLoginStatus('error')
          setLoginMessage(result.message || '登录失败')
        }
      }
    } catch (err: any) {
      setLoginStatus('error')
      setLoginMessage(err?.message || '登录失败')
    }
  }
```

- [ ] **Step 2: Pass `onOpenLoginWindow` to AuthSettings**

Update the `<AuthSettings>` JSX (around line 326) to include the new prop:

```tsx
      <AuthSettings
        loginSectionRef={loginSectionRef}
        loginStatus={loginStatus}
        loginMessage={loginMessage}
        onApplyAuth={handleApplyAuth}
        onTestAuth={handleTestAuth}
        onOpenLoginWindow={handleOpenLoginWindow}
      />
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/SettingsPage.tsx
git commit -m "feat(login): wire handleOpenLoginWindow in SettingsPage"
```

---

### Task 6: Build and smoke test

**Files:**
- No file changes

- [ ] **Step 1: Run TypeScript type check**

```bash
npx tsc --noEmit
```

Expected: No type errors. If there are errors related to the new code, fix them and re-run.

- [ ] **Step 2: Build the application**

```bash
npm run build
```

Expected: Build succeeds without errors.

- [ ] **Step 3: Manual smoke test**

Launch the app, navigate to Settings page, and verify:
1. "弹窗登录" button is visible above the cURL textarea
2. Clicking it opens a BrowserWindow loading h-comic.com
3. Clicking the login button on the page navigates to Auth0
4. After Auth0 login, the window closes and login status updates
5. Closing the popup without logging in restores the previous status

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(login): address issues from smoke test"
```
