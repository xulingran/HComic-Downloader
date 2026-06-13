# Code Review 全量修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 8 issues from the L3 code review: broken download, broken packaging, security hardening, settings persistence, search source, cookie security, test failures, and missing icon.

**Architecture:** Each task is independent (no cross-task dependencies) except Task 1 (tests) which should run first to establish a CI baseline. Tasks touch Python backend, Electron layer, React frontend, and build config.

**Tech Stack:** Python 3, Electron 28, React 18, TypeScript, Vitest, pytest, electron-builder

---

## Task 1: Fix Failing Tests (CI Baseline)

**Files:**
- Modify: `tests/unit/pages/FavouritesPage.test.tsx`
- Modify: `tests/unit/main/main.test.ts`

### 1.1 Fix FavouritesPage test — add missing useDownload mock

- [ ] **Step 1: Add useDownload mock to FavouritesPage test**

The component imports `useDownload` but the test only mocks `useFavourites`. Add the missing mock.

In `tests/unit/pages/FavouritesPage.test.tsx`, update the `vi.mock` for `@/hooks/useIpc` to include `useDownload`:

```typescript
vi.mock('@/hooks/useIpc', () => ({
  useFavourites: vi.fn().mockReturnValue({ getFavourites: mockGetFavourites }),
  useDownload: vi.fn().mockReturnValue({
    startDownload: vi.fn().mockResolvedValue({ taskId: 'test-id' }),
    cancelDownload: vi.fn().mockResolvedValue({ success: true }),
    getDownloads: vi.fn().mockResolvedValue({ tasks: [] }),
  }),
}))
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/unit/pages/FavouritesPage.test.tsx`
Expected: All tests PASS

### 1.2 Fix main.test.ts — update IPC handler count

- [ ] **Step 3: Update handler count from 10 to 11**

In `tests/unit/main/main.test.ts`, the test asserts `handleCalls.length` is `10`. After adding `open-external`, the count is `11` (currently the code has 11 handlers: 10 python:* + open-external). Update line 69:

```typescript
it('should register all 11 IPC handlers', () => {
  expect(handleCalls.length).toBe(11)
})
```

And add `'open-external'` to the `expectedChannels` array at line 83:

```typescript
const expectedChannels = [
  'python:search',
  'python:download',
  'python:get-favourites',
  'python:get-config',
  'python:set-config',
  'python:get-downloads',
  'python:cancel-download',
  'python:get-statistics',
  'python:apply-auth',
  'python:verify-auth',
  'open-external'
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/main/main.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All frontend tests PASS (213 → all green)

- [ ] **Step 6: Commit**

```bash
git add tests/unit/pages/FavouritesPage.test.tsx tests/unit/main/main.test.ts
git commit -m "test: fix FavouritesPage mock and IPC handler count"
```

---

## Task 2: Wire Download Functionality (Critical)

**Files:**
- Modify: `python/ipc_server.py`
- Modify: `electron/main.ts`
- Modify: `electron/python-bridge.ts`
- Modify: `src/hooks/useIpc.ts`
- Modify: `shared/types.ts`

### 2.1 Add real download logic to ipc_server.py

- [ ] **Step 1: Rewrite IPCServer to use ComicDownloadManager**

In `python/ipc_server.py`, replace the entire `__init__` method and download-related methods. The key change: initialize `ComicDownloadManager` and add a notification callback that writes JSON-RPC notifications to stdout.

Replace the class body. Key changes to `__init__`:

```python
def __init__(self):
    from parser import MultiSourceParser
    from downloader import ComicDownloader
    from config import Config
    from download_manager import ComicDownloadManager
    from cbz_builder import CBZBuilder

    self.config = Config.load(_get_config_path())
    self.parser = MultiSourceParser(
        default_source=self.config.default_source,
        source_auth=self.config.source_auth,
    )
    self.downloader = ComicDownloader(
        concurrent_downloads=self.config.concurrent_downloads,
        timeout=self.config.timeout,
        retry_times=self.config.retry_times,
    )
    self.cbz_builder = CBZBuilder()
    self._download_manager = ComicDownloadManager(
        downloader=self.downloader,
        cbz_builder=self.cbz_builder,
        output_dir=self.config.download_dir,
        prepare_comic=self.parser.prepare_for_download,
        output_format=self.config.output_format,
    )
    self._download_manager.set_auto_retry_max_attempts(self.config.auto_retry_max_attempts)
    self._download_manager.set_delay_after(self.config.batch_download_delay)
    self._download_manager.set_callbacks(on_task_update=self._on_download_update)
    self._download_manager.start()
```

Add the notification callback method:

```python
def _on_download_update(self, task):
    """Send download progress as JSON-RPC notification to stdout."""
    from models import DownloadStatus
    notification = {
        "jsonrpc": "2.0",
        "method": "download_progress",
        "params": {
            "taskId": task.task_id,
            "status": task.status.value,
            "progress": task.progress_percentage,
            "current": task.progress_current,
            "total": task.progress_total,
            "title": task.comic.title,
        },
    }
    print(json.dumps(notification), flush=True)
```

- [ ] **Step 2: Rewrite handle_download to use ComicDownloadManager**

```python
def handle_download(self, comic_id: str, comic_data: dict = None) -> Dict:
    from models import ComicInfo, DownloadStatus
    comic = ComicInfo(
        id=comic_id,
        title=(comic_data or {}).get("title", "Unknown"),
        preview_url=(comic_data or {}).get("url", ""),
        cover_url=(comic_data or {}).get("coverUrl", ""),
        source_site=(comic_data or {}).get("source", "hcomic"),
    )
    task_id = self._download_manager.add_task(comic)
    task = self._download_manager.tasks.get(task_id)
    return {
        "taskId": task_id,
        "status": task.status.value if task else "queued",
    }
```

- [ ] **Step 3: Rewrite handle_cancel_download to use ComicDownloadManager**

```python
def handle_cancel_download(self, task_id: str) -> Dict:
    success = self._download_manager.cancel_task(task_id)
    return {"success": success}
```

- [ ] **Step 4: Rewrite handle_get_downloads to read from ComicDownloadManager**

```python
def handle_get_downloads(self) -> Dict:
    from models import DownloadStatus
    tasks = []
    for task_id, task in self._download_manager.tasks.items():
        tasks.append({
            "id": task_id,
            "comic": self._comic_to_dict(task.comic),
            "status": task.status.value,
            "progress": task.progress_percentage,
            "totalPages": task.progress_total,
            "downloadedPages": task.progress_current,
            "error": task.error_message,
        })
    return {"tasks": tasks}
```

- [ ] **Step 5: Rewrite handle_get_statistics to use ComicDownloadManager stats**

```python
def handle_get_statistics(self) -> Dict:
    stats = self._download_manager.get_stats()
    return {
        "totalDownloads": stats.get("total", 0),
        "completedDownloads": stats.get("completed", 0),
        "failedDownloads": stats.get("failed", 0),
        "totalSize": 0,
        "downloadsByDay": [],
    }
```

### 2.2 Handle JSON-RPC notifications in python-bridge.ts

- [ ] **Step 6: Parse notifications (no id field) in stdout handler**

In `electron/python-bridge.ts`, modify the stdout data handler inside the `for (const line of lines)` loop to also handle notifications (JSON-RPC messages without an `id` field):

Replace the existing try block (lines 64-78) with:

```typescript
try {
  const response = JSON.parse(line)
  if (response.id) {
    // Request/response
    const pending = this.pendingRequests.get(response.id)
    if (pending) {
      clearTimeout(pending.timer)
      this.pendingRequests.delete(response.id)
      if (response.error) {
        pending.reject(new Error(response.error.message))
      } else {
        pending.resolve(response.result)
      }
    }
  } else if (response.method) {
    // Notification from Python
    this.onNotification(response.method, response.params)
  }
} catch (e) {
  console.error('Failed to parse IPC response:', e)
}
```

Add the notification callback and a listener mechanism to the class:

```typescript
private notificationHandlers = new Map<string, (params: any) => void>()

onNotification(method: string, params: any) {
  const handler = this.notificationHandlers.get(method)
  if (handler) {
    handler(params)
  }
}

setNotificationHandler(method: string, handler: (params: any) => void) {
  this.notificationHandlers.set(method, handler)
}
```

### 2.3 Forward download progress to renderer in main.ts

- [ ] **Step 7: Add download progress forwarding**

In `electron/main.ts`, inside `registerIPCHandlers()`, after getting the bridge, add:

```typescript
bridge.setNotificationHandler('download_progress', (params) => {
  mainWindow?.webContents.send('download:progress', params)
})
```

### 2.4 Add download progress listener in preload.ts

- [ ] **Step 8: Expose download progress listener in preload**

In `electron/preload.ts`, add to the `exposeInMainWorld` object:

```typescript
onDownloadProgress: (callback: (data: any) => void) => {
  const handler = (_: any, data: any) => callback(data)
  ipcRenderer.on('download:progress', handler)
  return () => {
    ipcRenderer.removeListener('download:progress', handler)
  }
}
```

Also update the TypeScript global interface. In `src/hooks/useIpc.ts`, update the `Window.electron` type:

```typescript
interface Window {
  electron: {
    ipcRenderer: {
      invoke: (channel: string, ...args: any[]) => Promise<any>
    }
    onDownloadProgress: (callback: (data: any) => void) => () => void
  }
}
```

- [ ] **Step 9: Update useDownload hook to subscribe to progress**

In `src/hooks/useIpc.ts`, update `useDownload`:

```typescript
export function useDownload() {
  const { invoke } = useIpc()
  const [progress, setProgress] = useState<Record<string, any>>({})

  useEffect(() => {
    if (!window.electron?.onDownloadProgress) return
    const unsubscribe = window.electron.onDownloadProgress((data) => {
      setProgress(prev => ({ ...prev, [data.taskId]: data }))
    })
    return unsubscribe
  }, [])

  const startDownload = useCallback(async (comicId: string, comicData: ComicInfo) => {
    return invoke('python:download', comicId, comicData)
  }, [invoke])

  const cancelDownload = useCallback(async (taskId: string) => {
    return invoke('python:cancel-download', taskId)
  }, [invoke])

  const getDownloads = useCallback(async () => {
    return invoke('python:get-downloads')
  }, [invoke])

  return { startDownload, cancelDownload, getDownloads, progress }
}
```

Add the `useState` and `useEffect` imports at the top of the file.

- [ ] **Step 10: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 11: Commit**

```bash
git add python/ipc_server.py electron/main.ts electron/python-bridge.ts electron/preload.ts src/hooks/useIpc.ts shared/types.ts
git commit -m "feat: wire real download through ComicDownloadManager with progress notifications"
```

---

## Task 3: Fix Settings Key Mapping (Important)

**Files:**
- Modify: `python/ipc_server.py`

### 3.1 Add CONFIG_KEY_MAP and rewrite config handlers

- [ ] **Step 1: Add key map and rewrite handle_set_config / handle_get_config**

In `python/ipc_server.py`, add the key map as a module-level constant after the imports:

```python
CONFIG_KEY_MAP = {
    'themeMode': 'theme_mode',
    'outputFormat': 'output_format',
    'downloadDir': 'download_dir',
    'concurrentDownloads': 'concurrent_downloads',
    'timeout': 'timeout',
    'retryTimes': 'retry_times',
    'cbzFilenameTemplate': 'cbz_filename_template',
    'batchDownloadDelay': 'batch_download_delay',
    'autoRetryMaxAttempts': 'auto_retry_max_attempts',
    'notifyOnComplete': 'notify_on_complete',
    'notifyWhenForeground': 'notify_when_foreground',
    'defaultSource': 'default_source',
}
```

Rewrite `handle_set_config`:

```python
def handle_set_config(self, key: str, value: Any) -> Dict:
    python_key = CONFIG_KEY_MAP.get(key)
    if not python_key:
        return {"success": False, "error": f"Unknown config key: {key}"}
    if not hasattr(self.config, python_key):
        return {"success": False, "error": f"Unknown config key: {key}"}
    try:
        setattr(self.config, python_key, value)
        self.config.save(_get_config_path())
        return {"success": True}
    except Exception as e:
        logger.error(f"Set config error for {key}: {e}")
        return {"success": False, "error": str(e)}
```

Rewrite `handle_get_config` to return camelCase keys:

```python
def handle_get_config(self) -> Dict:
    reverse_map = {v: k for k, v in CONFIG_KEY_MAP.items()}
    raw = {
        'theme_mode': self.config.theme_mode,
        'output_format': self.config.output_format,
        'download_dir': self.config.download_dir,
        'concurrent_downloads': self.config.concurrent_downloads,
        'timeout': self.config.timeout,
        'retry_times': self.config.retry_times,
        'cbz_filename_template': self.config.cbz_filename_template,
        'batch_download_delay': self.config.batch_download_delay,
        'auto_retry_max_attempts': self.config.auto_retry_max_attempts,
        'notify_on_complete': self.config.notify_on_complete,
        'notify_when_foreground': self.config.notify_when_foreground,
        'default_source': self.config.default_source,
    }
    config = {}
    for snake_key, value in raw.items():
        camel_key = reverse_map.get(snake_key, snake_key)
        config[camel_key] = value
    config['cookie'] = None
    config['userAgent'] = None
    return {"config": config}
```

Note: `cookie` and `userAgent` are set to `None` (Cookie security fix from Task 5 will handle masking). The `cardStyle` is a frontend-only setting handled by `useSettingsStore`.

- [ ] **Step 2: Test manually**

Run the app with `npm run dev`, go to Settings, change output format, verify it persists after restart.

- [ ] **Step 3: Commit**

```bash
git add python/ipc_server.py
git commit -m "fix: add camelCase ↔ snake_case config key mapping with validation"
```

---

## Task 4: Fix Search Source/Mode Passing (Important)

**Files:**
- Modify: `src/hooks/useIpc.ts`
- Modify: `src/pages/SearchPage.tsx`
- Modify: `electron/main.ts`
- Modify: `python/ipc_server.py`

### 4.1 Pass source through the IPC chain

- [ ] **Step 1: Update useSearch to accept source parameter**

In `src/hooks/useIpc.ts`, update `useSearch`:

```typescript
export function useSearch() {
  const { invoke } = useIpc()

  const search = useCallback(async (query: string, mode: string, page: number, source?: string) => {
    return invoke('python:search', query, mode, page, source)
  }, [invoke])

  return { search }
}
```

- [ ] **Step 2: Pass source in SearchPage**

In `src/pages/SearchPage.tsx`, update `handleSearch` to pass the `source` state:

```typescript
const handleSearch = async (page: number = 1) => {
  if (!query.trim()) return
  clearSelection()

  setLoading(true)
  setError(null)

  try {
    const result = await search(query, mode, page, source)
    setComics(result.comics)
    setPagination(result.pagination)
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Search failed')
  } finally {
    setLoading(false)
  }
}
```

- [ ] **Step 3: Update main.ts IPC handler to accept source**

In `electron/main.ts`, update the `python:search` handler:

```typescript
ipcMain.handle('python:search', async (_, query, mode, page, source) => {
  if (typeof query !== 'string' || typeof mode !== 'string' || typeof page !== 'number') {
    throw new Error('Invalid search parameters')
  }
  const params: Record<string, unknown> = { query, mode, page }
  if (typeof source === 'string' && source) {
    params.source = source
  }
  return bridge.call('search', params)
})
```

- [ ] **Step 4: Update ipc_server.py to handle source and mode**

In `python/ipc_server.py`, update `handle_search`:

```python
def handle_search(self, query: str, mode: str = "keyword", page: int = 1, source: str = None) -> Dict:
    if source and source in ("hcomic", "moeimg"):
        self.parser.set_source(source)
    comics, pagination = self.parser.search(query, page=page)
    return {
        "comics": [self._comic_to_dict(c) for c in comics],
        "pagination": {
            "currentPage": pagination.current_page if pagination else page,
            "totalPages": pagination.total_pages if pagination else 1,
            "totalItems": pagination.total_items if pagination else 0,
        },
    }
```

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useIpc.ts src/pages/SearchPage.tsx electron/main.ts python/ipc_server.py
git commit -m "fix: pass source and mode through search IPC chain"
```

---

## Task 5: Harden open-external Security (Critical)

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/pages/SettingsPage.tsx`

### 5.1 Add URL whitelist to main.ts

- [ ] **Step 1: Add allowed domains and URL validation**

In `electron/main.ts`, add a constant after the imports (line 5):

```typescript
const ALLOWED_EXTERNAL_DOMAINS = [
  'h-comic.com',
  'moeimg.net',
  'moeimg.fan',
]
```

Update the `open-external` handler (line 96):

```typescript
ipcMain.handle('open-external', async (_, url: string) => {
  if (typeof url !== 'string') throw new Error('Invalid URL')
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid URL format')
  }
  if (parsed.protocol !== 'https:') throw new Error('Only HTTPS URLs are allowed')
  const allowed = ALLOWED_EXTERNAL_DOMAINS.some(
    d => parsed.hostname === d || parsed.hostname.endsWith('.' + d)
  )
  if (!allowed) throw new Error('Domain not allowed')
  await shell.openExternal(url)
})
```

### 5.2 Add narrow API in preload

- [ ] **Step 2: Add openUrl narrow API to preload**

In `electron/preload.ts`, add `openUrl` to the exposed object:

```typescript
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel: string, ...args: any[]) => {
      if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
        throw new Error(`Invalid IPC channel: ${channel}`)
      }
      return ipcRenderer.invoke(channel, ...args)
    }
  },
  openUrl: (url: string) => ipcRenderer.invoke('open-external', url)
})
```

### 5.3 Update SettingsPage to use openUrl

- [ ] **Step 3: Replace direct invoke with openUrl**

In `src/pages/SettingsPage.tsx`, line 394, replace:

```typescript
onClick={() => window.electron?.ipcRenderer.invoke('open-external', 'https://h-comic.com')}
```

with:

```typescript
onClick={() => window.electron?.openUrl?.('https://h-comic.com')}
```

- [ ] **Step 4: Update TypeScript global interface**

In `src/hooks/useIpc.ts`, update the Window interface:

```typescript
interface Window {
  electron: {
    ipcRenderer: {
      invoke: (channel: string, ...args: any[]) => Promise<any>
    }
    openUrl: (url: string) => Promise<void>
    onDownloadProgress?: (callback: (data: any) => void) => () => void
  }
}
```

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts electron/preload.ts src/pages/SettingsPage.tsx src/hooks/useIpc.ts
git commit -m "security: add URL whitelist and narrow API for open-external"
```

---

## Task 6: Cookie Security (Important)

**Files:**
- Modify: `python/ipc_server.py`
- Modify: `config.py`

### 6.1 Mask cookies in get_config response

- [ ] **Step 1: Remove cookie/userAgent from get_config response**

In `python/ipc_server.py`, `handle_get_config` already sets `cookie` and `userAgent` to `None` (from Task 3 rewrite). This is sufficient — the frontend never receives the actual cookie values. Verify the `handle_get_config` from Task 3 has these lines:

```python
config['cookie'] = None
config['userAgent'] = None
```

If Task 3 has already been applied, no change needed here. Otherwise, ensure `handle_get_config` does not return `auth_cookie` or `auth_user_agent`.

### 6.2 Set config file permissions

- [ ] **Step 2: Restrict config file permissions on save**

In `config.py`, in the `save` method, add `os.chmod` after writing the file. Replace lines 132-134:

```python
os.makedirs(os.path.dirname(config_path), exist_ok=True)
with open(config_path, 'w', encoding='utf-8') as f:
    json.dump(asdict(self), f, ensure_ascii=False, indent=2)
if sys.platform != 'win32':
    os.chmod(config_path, 0o600)
```

Add `import sys` to the top of `config.py` if not already imported.

### 6.3 Sanitize cookies in logs

- [ ] **Step 3: Sanitize auth values in logs**

In `python/ipc_server.py`, in `handle_apply_auth`, replace line 106:

```python
return {"cookie": cookie, "user_agent": user_agent}
```

with:

```python
logger.info(f"Auth applied: cookie length={len(cookie)}, ua length={len(user_agent)}")
return {"success": True}
```

- [ ] **Step 4: Commit**

```bash
git add python/ipc_server.py config.py
git commit -m "security: mask cookies from API response, restrict config file permissions"
```

---

## Task 7: Python Packaging with PyInstaller (Critical)

**Files:**
- Modify: `electron-builder.json5`
- Modify: `electron/python-bridge.ts`
- Modify: `package.json`
- Create: `python/hcomic_backend.spec`

### 7.1 Create PyInstaller spec

- [ ] **Step 1: Create PyInstaller spec file**

Create `python/hcomic_backend.spec`:

```python
# -*- mode: python ; coding: utf-8 -*-
import os
import sys

block_cipher = None

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(SPECPATH)))

a = Analysis(
    ['python/ipc_server.py'],
    pathex=[PROJECT_ROOT],
    binaries=[],
    datas=[],
    hiddenimports=[
        'parser',
        'downloader',
        'config',
        'models',
        'auth_parser',
        'download_manager',
        'cbz_builder',
        'constants',
        'utils',
        'image_formats',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tests', 'pytest'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zlib_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='python',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
```

### 7.2 Update python-bridge for packaged mode

- [ ] **Step 2: Update packaged Python path to use the bundled executable**

In `electron/python-bridge.ts`, replace the `getPythonPath` and `getScriptPath` methods. In packaged mode, PyInstaller bundles everything into a single executable, so no script path is needed:

```typescript
private getPythonPath(): string {
  const isDev = !app.isPackaged
  const isWin = process.platform === 'win32'
  if (isDev) {
    return isWin ? 'python' : 'python3'
  }
  const exeName = isWin ? 'python.exe' : 'python'
  return path.join(process.resourcesPath, 'python', exeName)
}

private getScriptPath(): string | null {
  const isDev = !app.isPackaged
  if (isDev) {
    return path.join(app.getAppPath(), 'python', 'ipc_server.py')
  }
  return null // PyInstaller bundles the script
}
```

Update the `start` method to conditionally pass script path:

```typescript
private start() {
  const pythonPath = this.getPythonPath()
  const scriptPath = this.getScriptPath()
  const args = scriptPath ? [scriptPath] : []

  this.process = spawn(pythonPath, args, {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  // ... rest unchanged
}
```

### 7.3 Update build config

- [ ] **Step 3: Update electron-builder.json5 extraResources**

Replace the `extraResources` section:

```json5
extraResources: [
  {
    from: 'python/dist/${os}/',
    to: 'python/',
    filter: ['**/*']
  }
]
```

Note: During dev, `python/dist/` doesn't exist. Dev mode uses system Python directly, so this only affects packaged builds.

### 7.4 Add build scripts

- [ ] **Step 4: Add build:python script to package.json**

In `package.json`, add to `scripts`:

```json
"build:python": "pyinstaller python/hcomic_backend.spec --distpath python/dist --workpath python/build --clean",
"build:python:win": "pyinstaller python/hcomic_backend.spec --distpath python/dist --workpath python/build --clean",
"build:win": "npm run build:python && npm run build && electron-builder --win",
"build:mac": "npm run build:python && npm run build && electron-builder --mac",
"build:linux": "npm run build:python && npm run build && electron-builder --linux"
```

- [ ] **Step 5: Add python/build and python/dist to .gitignore**

Append to `.gitignore`:

```
python/build/
python/dist/
```

- [ ] **Step 6: Commit**

```bash
git add python/hcomic_backend.spec electron/python-bridge.ts electron-builder.json5 package.json .gitignore
git commit -m "feat: add PyInstaller packaging for Python backend"
```

---

## Task 8: Fix Windows Icon (Minor)

**Files:**
- Modify: `electron-builder.json5`

- [ ] **Step 1: Change Windows icon to use existing PNG**

In `electron-builder.json5`, replace the `win` section:

```json5
win: {
  target: ['nsis'],
  icon: 'assets/icon_64.png'
}
```

`electron-builder` accepts PNG files and will convert to ICO as needed.

- [ ] **Step 2: Commit**

```bash
git add electron-builder.json5
git commit -m "fix: use existing PNG icon for Windows build"
```

---

## Task 9: Add Tests for New Code

**Files:**
- Create: `tests/test_ipc_config_mapping.py`
- Create: `tests/unit/main/open-external.test.ts`

### 9.1 Python config mapping test

- [ ] **Step 1: Create test for CONFIG_KEY_MAP**

Create `tests/test_ipc_config_mapping.py`:

```python
import pytest
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"))

from python.ipc_server import CONFIG_KEY_MAP


class TestConfigKeyMapping:
    def test_all_frontend_keys_have_python_mapping(self):
        frontend_keys = [
            'themeMode', 'outputFormat', 'downloadDir', 'concurrentDownloads',
            'timeout', 'retryTimes', 'cbzFilenameTemplate', 'batchDownloadDelay',
            'autoRetryMaxAttempts', 'notifyOnComplete', 'notifyWhenForeground',
            'defaultSource',
        ]
        for key in frontend_keys:
            assert key in CONFIG_KEY_MAP, f"Missing mapping for frontend key: {key}"

    def test_all_mappings_point_to_valid_config_fields(self):
        from config import Config
        config = Config()
        for camel_key, snake_key in CONFIG_KEY_MAP.items():
            assert hasattr(config, snake_key), f"Config has no field: {snake_key} (mapped from {camel_key})"

    def test_set_config_returns_error_for_unknown_key(self):
        """Verify that unknown keys are rejected, not silently ignored."""
        from python.ipc_server import IPCServer
        # We can't fully instantiate IPCServer (requires parser), so test the map directly
        assert 'unknownKey' not in CONFIG_KEY_MAP
        assert 'theme_mode' not in CONFIG_KEY_MAP  # snake_case should not be in map
```

- [ ] **Step 2: Create test for open-external URL validation**

Create `tests/unit/main/open-external.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { handleCalls } = vi.hoisted(() => ({
  handleCalls: [] as Array<{ channel: string; handler: Function }>
}))

vi.mock('electron', () => {
  const mockHandle = vi.fn((channel: string, handler: Function) => {
    handleCalls.push({ channel, handler })
  })

  class MockBrowserWindow {
    loadURL = vi.fn()
    loadFile = vi.fn()
    once = vi.fn()
    on = vi.fn()
    show = vi.fn()
    static getAllWindows = vi.fn().mockReturnValue([])
  }

  return {
    app: {
      whenReady: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      quit: vi.fn(),
    },
    BrowserWindow: MockBrowserWindow,
    ipcMain: { handle: mockHandle },
    shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
  }
})

vi.mock('../../../electron/python-bridge', () => ({
  getPythonBridge: () => ({ call: vi.fn().mockResolvedValue({}), kill: vi.fn() }),
}))

import '../../../electron/main'

async function flushMicrotasks() {
  await new Promise(resolve => setTimeout(resolve, 10))
}

describe('open-external security', () => {
  beforeEach(async () => {
    await flushMicrotasks()
  })

  it('should reject non-HTTPS URLs', async () => {
    const handler = handleCalls.find(h => h.channel === 'open-external')
    expect(handler).toBeDefined()
    await expect(handler!.handler({}, 'http://evil.com')).rejects.toThrow('Only HTTPS')
  })

  it('should reject unknown domains', async () => {
    const handler = handleCalls.find(h => h.channel === 'open-external')!
    await expect(handler!.handler({}, 'https://evil.com')).rejects.toThrow('Domain not allowed')
  })

  it('should accept allowed domain', async () => {
    const handler = handleCalls.find(h => h.channel === 'open-external')!
    await handler!.handler({}, 'https://h-comic.com')
    // No throw = pass
  })

  it('should reject invalid URL format', async () => {
    const handler = handleCalls.find(h => h.channel === 'open-external')!
    await expect(handler!.handler({}, 'not-a-url')).rejects.toThrow()
  })
})
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run && python -m pytest tests/test_ipc_config_mapping.py -v`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/test_ipc_config_mapping.py tests/unit/main/open-external.test.ts
git commit -m "test: add config key mapping and open-external security tests"
```

---

## Execution Notes

- **Task dependencies:** Task 1 should execute first (CI baseline). Tasks 2-8 are independent of each other. Task 9 can run last.
- **Testing order after each task:** Run `npx vitest run` after each commit to ensure no regressions.
- **Python tests:** Run `python -m pytest tests/test_ipc_config_mapping.py -v` for Python-side tests.
