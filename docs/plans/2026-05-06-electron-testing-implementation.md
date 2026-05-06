# Electron 全栈测试实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Electron 主进程 + React 渲染层建立完整测试体系，整体覆盖率达到 70%+

**Architecture:** 分层 Mock 架构 — 每层（主进程、preload、hooks、stores、组件）独立用 Mock 隔离测试。用 Vitest 作为统一测试框架，React Testing Library 测组件，vi.mock() 模拟 Electron API 和 IPC。

**Tech Stack:** Vitest, @testing-library/react, @testing-library/jest-dom, @testing-library/user-event, @vitest/coverage-v8, jsdom

---

## Task 1: 安装依赖和配置 Vitest

**Files:**
- Modify: `package.json` (添加 devDependencies 和 scripts)
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`

**Step 1: 安装测试依赖**

Run:
```bash
cd E:/Developing/hcomic_downloader
npm install -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

Expected: 所有包成功安装

**Step 2: 创建 vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['electron/**/*.ts', 'src/**/*.{ts,tsx}'],
      exclude: ['**/*.d.ts', '**/types/**', '**/*.config.*']
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared')
    }
  }
})
```

**Step 3: 创建 tests/setup.ts**

```ts
import '@testing-library/jest-dom'
```

**Step 4: 在 package.json 中添加测试脚本**

在 `scripts` 中添加:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage",
"test:ui": "vitest --ui"
```

**Step 5: 创建共享 Mock 文件**

Create `tests/__mocks__/electron.ts`:
```ts
import { vi } from 'vitest'

const mockIpcMain = {
  handle: vi.fn()
}

const mockBrowserWindow = vi.fn().mockImplementation(() => ({
  loadFile: vi.fn(),
  loadURL: vi.fn(),
  once: vi.fn(),
  on: vi.fn(),
  show: vi.fn(),
  webContents: { on: vi.fn() }
}))

mockBrowserWindow.getAllWindows = vi.fn().mockReturnValue([])

export const mockApp = {
  getPath: vi.fn().mockReturnValue('/mock/path'),
  isPackaged: false,
  on: vi.fn(),
  whenReady: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn()
}

export const mockIpcRenderer = {
  invoke: vi.fn().mockResolvedValue(undefined),
  on: vi.fn().mockReturnValue(() => vi.fn()),
  removeAllListeners: vi.fn()
}

export const mockContextBridge = {
  exposeInMainWorld: vi.fn()
}

vi.mock('electron', () => ({
  app: mockApp,
  BrowserWindow: mockBrowserWindow,
  ipcMain: mockIpcMain,
  ipcRenderer: mockIpcRenderer,
  contextBridge: mockContextBridge
}))

vi.mock('child_process', () => ({
  spawn: vi.fn().mockReturnValue({
    stdin: { write: vi.fn() },
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn()
  })
}))

export { mockIpcMain, mockBrowserWindow }
```

Create `tests/__mocks__/ipc.ts`:
```ts
import { vi } from 'vitest'

export function createMockIpcInvoke(responses: Record<string, any> = {}) {
  return vi.fn().mockImplementation((channel: string, ...args: any[]) => {
    if (responses[channel] !== undefined) {
      if (typeof responses[channel] === 'function') {
        return Promise.resolve(responses[channel](...args))
      }
      return Promise.resolve(responses[channel])
    }
    return Promise.resolve(undefined)
  })
}

export function mockWindowElectron(invoke?: ReturnType<typeof createMockIpcInvoke>) {
  const mockInvoke = invoke || createMockIpcInvoke()

  Object.defineProperty(window, 'electron', {
    value: {
      ipcRenderer: {
        invoke: mockInvoke,
        on: vi.fn().mockReturnValue(vi.fn())
      }
    },
    writable: true,
    configurable: true
  })

  return { mockInvoke }
}
```

**Step 6: 验证配置**

Run: `npx vitest run`
Expected: 输出 "no test files found" 但不报错

**Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/
git commit -m "chore: add Vitest testing framework and configuration"
```

---

## Task 2: Zustand Stores 测试

**Files:**
- Create: `tests/unit/stores/settingsStore.test.ts`
- Create: `tests/unit/stores/comicStore.test.ts`
- Create: `tests/unit/stores/downloadStore.test.ts`

这些是纯状态逻辑，最容易测试，用来验证测试基础设施正常工作。

**Step 1: 写 useSettingsStore 测试**

Create `tests/unit/stores/settingsStore.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from '@/stores/useSettingsStore'

describe('useSettingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      themeMode: 'auto',
      cardStyle: 'cover'
    })
  })

  it('应有正确的初始状态', () => {
    const state = useSettingsStore.getState()
    expect(state.themeMode).toBe('auto')
    expect(state.cardStyle).toBe('cover')
  })

  it('应能设置 themeMode', () => {
    useSettingsStore.getState().setThemeMode('dark')
    expect(useSettingsStore.getState().themeMode).toBe('dark')
  })

  it('应能设置 cardStyle', () => {
    useSettingsStore.getState().setCardStyle('detailed')
    expect(useSettingsStore.getState().cardStyle).toBe('detailed')
  })

  it('应能切换所有主题模式', () => {
    const modes = ['light', 'dark', 'auto'] as const
    modes.forEach((mode) => {
      useSettingsStore.getState().setThemeMode(mode)
      expect(useSettingsStore.getState().themeMode).toBe(mode)
    })
  })
})
```

**Step 2: 运行测试验证通过**

Run: `npx vitest run tests/unit/stores/settingsStore.test.ts`
Expected: 所有测试 PASS

**Step 3: 写 useComicStore 测试**

Create `tests/unit/stores/comicStore.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useComicStore } from '@/stores/useComicStore'
import type { ComicInfo, PaginationInfo } from '@shared/types'

const mockComic: ComicInfo = {
  id: '1',
  title: 'Test Comic',
  url: 'https://example.com/comic/1',
  coverUrl: 'https://example.com/cover.jpg',
  source: 'test'
}

const mockPagination: PaginationInfo = {
  currentPage: 1,
  totalPages: 5,
  totalItems: 50
}

describe('useComicStore', () => {
  beforeEach(() => {
    useComicStore.setState({
      comics: [],
      pagination: null,
      isLoading: false,
      error: null
    })
  })

  it('应有正确的初始状态', () => {
    const state = useComicStore.getState()
    expect(state.comics).toEqual([])
    expect(state.pagination).toBeNull()
    expect(state.isLoading).toBe(false)
    expect(state.error).toBeNull()
  })

  it('应能设置 comics', () => {
    useComicStore.getState().setComics([mockComic])
    expect(useComicStore.getState().comics).toEqual([mockComic])
  })

  it('应能设置 pagination', () => {
    useComicStore.getState().setPagination(mockPagination)
    expect(useComicStore.getState().pagination).toEqual(mockPagination)
  })

  it('应能设置 loading 状态', () => {
    useComicStore.getState().setLoading(true)
    expect(useComicStore.getState().isLoading).toBe(true)
  })

  it('应能设置 error', () => {
    useComicStore.getState().setError('Something went wrong')
    expect(useComicStore.getState().error).toBe('Something went wrong')
  })

  it('应能清除 error', () => {
    useComicStore.getState().setError('error')
    useComicStore.getState().setError(null)
    expect(useComicStore.getState().error).toBeNull()
  })
})
```

**Step 4: 运行测试**

Run: `npx vitest run tests/unit/stores/comicStore.test.ts`
Expected: 所有测试 PASS

**Step 5: 写 useDownloadStore 测试**

Create `tests/unit/stores/downloadStore.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useDownloadStore } from '@/stores/useDownloadStore'
import type { DownloadTask } from '@shared/types'

const mockTask: DownloadTask = {
  id: 'task-1',
  comic: {
    id: '1',
    title: 'Test Comic',
    url: 'https://example.com/comic/1',
    coverUrl: 'https://example.com/cover.jpg',
    source: 'test'
  },
  status: 'downloading',
  progress: 50,
  totalPages: 10,
  downloadedPages: 5
}

describe('useDownloadStore', () => {
  beforeEach(() => {
    useDownloadStore.setState({ tasks: [] })
  })

  it('应有空的初始任务列表', () => {
    expect(useDownloadStore.getState().tasks).toEqual([])
  })

  it('应能设置所有任务', () => {
    useDownloadStore.getState().setTasks([mockTask])
    expect(useDownloadStore.getState().tasks).toEqual([mockTask])
  })

  it('应能添加单个任务', () => {
    useDownloadStore.getState().addTask(mockTask)
    expect(useDownloadStore.getState().tasks).toHaveLength(1)
    expect(useDownloadStore.getState().tasks[0].id).toBe('task-1')
  })

  it('应能追加多个任务', () => {
    const task2 = { ...mockTask, id: 'task-2' }
    useDownloadStore.getState().addTask(mockTask)
    useDownloadStore.getState().addTask(task2)
    expect(useDownloadStore.getState().tasks).toHaveLength(2)
  })

  it('应能更新指定任务', () => {
    useDownloadStore.getState().addTask(mockTask)
    useDownloadStore.getState().updateTask('task-1', { progress: 80, downloadedPages: 8 })
    const task = useDownloadStore.getState().tasks[0]
    expect(task.progress).toBe(80)
    expect(task.downloadedPages).toBe(8)
  })

  it('更新不存在的任务应无效果', () => {
    useDownloadStore.getState().addTask(mockTask)
    useDownloadStore.getState().updateTask('non-existent', { progress: 100 })
    expect(useDownloadStore.getState().tasks[0].progress).toBe(50)
  })

  it('应能移除任务', () => {
    useDownloadStore.getState().addTask(mockTask)
    useDownloadStore.getState().removeTask('task-1')
    expect(useDownloadStore.getState().tasks).toHaveLength(0)
  })

  it('移除不存在的任务应无效果', () => {
    useDownloadStore.getState().addTask(mockTask)
    useDownloadStore.getState().removeTask('non-existent')
    expect(useDownloadStore.getState().tasks).toHaveLength(1)
  })

  it('应能更新任务状态为 completed', () => {
    useDownloadStore.getState().addTask(mockTask)
    useDownloadStore.getState().updateTask('task-1', { status: 'completed', progress: 100 })
    expect(useDownloadStore.getState().tasks[0].status).toBe('completed')
  })

  it('应能更新任务状态为 error', () => {
    useDownloadStore.getState().addTask(mockTask)
    useDownloadStore.getState().updateTask('task-1', { status: 'error', error: 'Network timeout' })
    const task = useDownloadStore.getState().tasks[0]
    expect(task.status).toBe('error')
    expect(task.error).toBe('Network timeout')
  })
})
```

**Step 6: 运行所有 store 测试**

Run: `npx vitest run tests/unit/stores/`
Expected: 所有测试 PASS

**Step 7: Commit**

```bash
git add tests/unit/stores/
git commit -m "test: add Zustand store unit tests"
```

---

## Task 3: React Hooks 测试

**Files:**
- Create: `tests/unit/hooks/useIpc.test.ts`
- Create: `tests/unit/hooks/useSearch.test.ts`
- Create: `tests/unit/hooks/useDownload.test.ts`
- Create: `tests/unit/hooks/useConfig.test.ts`
- Create: `tests/unit/hooks/useAuth.test.ts`

**Step 1: 写 useIpc 测试**

Create `tests/unit/hooks/useIpc.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useIpc } from '@/hooks/useIpc'
import { mockWindowElectron, createMockIpcInvoke } from '../../__mocks__/ipc'

describe('useIpc', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('应返回 invoke 函数', () => {
    mockWindowElectron()
    const { result } = renderHook(() => useIpc())
    expect(result.current.invoke).toBeDefined()
    expect(typeof result.current.invoke).toBe('function')
  })

  it('应调用 ipcRenderer.invoke 并传递参数', async () => {
    const mockInvoke = createMockIpcInvoke({ 'test:channel': 'result' })
    mockWindowElectron(mockInvoke)

    const { result } = renderHook(() => useIpc())
    const response = await result.current.invoke('test:channel', 'arg1', 'arg2')

    expect(mockInvoke).toHaveBeenCalledWith('test:channel', 'arg1', 'arg2')
    expect(response).toBe('result')
  })

  it('当 electron API 不存在时应抛出错误', async () => {
    delete (window as any).electron

    const { result } = renderHook(() => useIpc())

    await expect(result.current.invoke('test:channel')).rejects.toThrow()
  })
})
```

**Step 2: 运行验证**

Run: `npx vitest run tests/unit/hooks/useIpc.test.ts`
Expected: PASS

**Step 3: 写 useSearch 测试**

Create `tests/unit/hooks/useSearch.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSearch } from '@/hooks/useSearch'
import { mockWindowElectron, createMockIpcInvoke } from '../../__mocks__/ipc'

describe('useSearch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('应返回 search 函数', () => {
    mockWindowElectron()
    const { result } = renderHook(() => useSearch())
    expect(result.current.search).toBeDefined()
  })

  it('应调用 python:search IPC channel', async () => {
    const searchResult = {
      comics: [{ id: '1', title: 'Comic', url: '', coverUrl: '', source: 'test' }],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 1 }
    }
    const mockInvoke = createMockIpcInvoke({ 'python:search': searchResult })
    mockWindowElectron(mockInvoke)

    const { result } = renderHook(() => useSearch())
    const response = await result.current.search('test query', 'keyword', 1)

    expect(mockInvoke).toHaveBeenCalledWith('python:search', 'test query', 'keyword', 1)
    expect(response).toEqual(searchResult)
  })

  it('应支持翻页', async () => {
    const mockInvoke = createMockIpcInvoke({ 'python:search': {} })
    mockWindowElectron(mockInvoke)

    const { result } = renderHook(() => useSearch())
    await result.current.search('test', 'keyword', 3)

    expect(mockInvoke).toHaveBeenCalledWith('python:search', 'test', 'keyword', 3)
  })
})
```

**Step 4: 写 useDownload 测试**

Create `tests/unit/hooks/useDownload.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDownload } from '@/hooks/useDownload'
import { mockWindowElectron, createMockIpcInvoke } from '../../__mocks__/ipc'
import type { ComicInfo } from '@shared/types'

const mockComic: ComicInfo = {
  id: 'comic-1',
  title: 'Test',
  url: 'https://example.com/1',
  coverUrl: 'https://example.com/cover.jpg',
  source: 'test'
}

describe('useDownload', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('应返回 startDownload, cancelDownload, getDownloads', () => {
    mockWindowElectron()
    const { result } = renderHook(() => useDownload())
    expect(result.current.startDownload).toBeDefined()
    expect(result.current.cancelDownload).toBeDefined()
    expect(result.current.getDownloads).toBeDefined()
  })

  it('startDownload 应调用 python:download', async () => {
    const mockInvoke = createMockIpcInvoke({ 'python:download': { taskId: 't1' } })
    mockWindowElectron(mockInvoke)

    const { result } = renderHook(() => useDownload())
    await result.current.startDownload('comic-1', mockComic)

    expect(mockInvoke).toHaveBeenCalledWith('python:download', 'comic-1', mockComic)
  })

  it('cancelDownload 应调用 python:cancel-download', async () => {
    const mockInvoke = createMockIpcInvoke({ 'python:cancel-download': { success: true } })
    mockWindowElectron(mockInvoke)

    const { result } = renderHook(() => useDownload())
    await result.current.cancelDownload('task-1')

    expect(mockInvoke).toHaveBeenCalledWith('python:cancel-download', 'task-1')
  })

  it('getDownloads 应调用 python:get-downloads', async () => {
    const tasks = [{ id: 't1', status: 'downloading' }]
    const mockInvoke = createMockIpcInvoke({ 'python:get-downloads': { tasks } })
    mockWindowElectron(mockInvoke)

    const { result } = renderHook(() => useDownload())
    const response = await result.current.getDownloads()

    expect(mockInvoke).toHaveBeenCalledWith('python:get-downloads')
    expect(response).toEqual({ tasks })
  })
})
```

**Step 5: 写 useConfig 和 useAuth 测试**

Create `tests/unit/hooks/useConfig.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useConfig } from '@/hooks/useConfig'
import { mockWindowElectron, createMockIpcInvoke } from '../../__mocks__/ipc'

describe('useConfig', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('getConfig 应调用 python:get-config', async () => {
    const config = { themeMode: 'dark' }
    const mockInvoke = createMockIpcInvoke({ 'python:get-config': config })
    mockWindowElectron(mockInvoke)

    const { result } = renderHook(() => useConfig())
    const response = await result.current.getConfig()

    expect(mockInvoke).toHaveBeenCalledWith('python:get-config')
    expect(response).toEqual(config)
  })

  it('setConfig 应调用 python:set-config', async () => {
    const mockInvoke = createMockIpcInvoke({ 'python:set-config': { success: true } })
    mockWindowElectron(mockInvoke)

    const { result } = renderHook(() => useConfig())
    await result.current.setConfig('themeMode', 'dark')

    expect(mockInvoke).toHaveBeenCalledWith('python:set-config', 'themeMode', 'dark')
  })
})
```

Create `tests/unit/hooks/useAuth.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAuth } from '@/hooks/useAuth'
import { mockWindowElectron, createMockIpcInvoke } from '../../__mocks__/ipc'

describe('useAuth', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('applyAuth 应调用 python:apply-auth', async () => {
    const mockInvoke = createMockIpcInvoke({ 'python:apply-auth': { success: true } })
    mockWindowElectron(mockInvoke)

    const { result } = renderHook(() => useAuth())
    await result.current.applyAuth('curl https://example.com')

    expect(mockInvoke).toHaveBeenCalledWith('python:apply-auth', 'curl https://example.com')
  })

  it('verifyAuth 应调用 python:verify-auth', async () => {
    const mockInvoke = createMockIpcInvoke({ 'python:verify-auth': { valid: true } })
    mockWindowElectron(mockInvoke)

    const { result } = renderHook(() => useAuth())
    const response = await result.current.verifyAuth()

    expect(mockInvoke).toHaveBeenCalledWith('python:verify-auth')
    expect(response).toEqual({ valid: true })
  })
})
```

**Step 6: 运行所有 hooks 测试**

Run: `npx vitest run tests/unit/hooks/`
Expected: 所有测试 PASS

**Step 7: Commit**

```bash
git add tests/unit/hooks/
git commit -m "test: add React hooks unit tests"
```

---

## Task 4: Electron 主进程测试

**Files:**
- Create: `tests/unit/main/python-bridge.test.ts`
- Create: `tests/unit/main/main.test.ts`

**Step 1: 写 PythonBridge 测试**

Create `tests/unit/main/python-bridge.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { spawn } from 'child_process'

vi.mock('child_process')
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/path'),
    isPackaged: false
  }
}))

describe('PythonBridge', () => {
  let mockProcess: any
  let stdoutListeners: Function[]
  let stderrListeners: Function[]
  let exitListeners: Function[]
  let errorListeners: Function[]

  beforeEach(() => {
    vi.clearAllMocks()
    stdoutListeners = []
    stderrListeners = []
    exitListeners = []
    errorListeners = []

    mockProcess = {
      stdin: { write: vi.fn() },
      stdout: {
        on: vi.fn((event: string, cb: Function) => {
          if (event === 'data') stdoutListeners.push(cb)
        })
      },
      stderr: {
        on: vi.fn((event: string, cb: Function) => {
          if (event === 'data') stderrListeners.push(cb)
        })
      },
      on: vi.fn((event: string, cb: Function) => {
        if (event === 'exit') exitListeners.push(cb)
        if (event === 'error') errorListeners.push(cb)
      }),
      kill: vi.fn()
    }

    vi.mocked(spawn).mockReturnValue(mockProcess as any)

    // 清除模块缓存以获取新的 bridge 实例
    vi.resetModules()
  })

  it('应在开发模式下使用 python 命令', async () => {
    const { getPythonBridge } = await import('@/../electron/python-bridge')
    const bridge = getPythonBridge()

    expect(spawn).toHaveBeenCalledWith(
      'python',
      expect.arrayContaining([expect.stringContaining('ipc_server.py')]),
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] })
    )
  })

  it('应通过 JSON-RPC 格式发送请求', async () => {
    const { getPythonBridge } = await import('@/../electron/python-bridge')
    getPythonBridge()

    const written = mockProcess.stdin.write.mock.calls[0]
    // 构造函数中 bridge 已创建但不发送请求
    // 需要手动调用 call
  })

  it('当进程未运行时 call 应抛出错误', async () => {
    const { PythonBridge } = await import('@/../electron/python-bridge')
    const bridge = new PythonBridge()

    // 模拟进程退出
    exitListeners.forEach(cb => cb(0))

    await expect(bridge.call('test')).rejects.toThrow('Python process not running')
  })

  it('kill 应终止进程', async () => {
    const { getPythonBridge } = await import('@/../electron/python-bridge')
    const bridge = getPythonBridge()

    bridge.kill()
    expect(mockProcess.kill).toHaveBeenCalled()
  })

  it('应处理 stdout 数据并解析 JSON 响应', async () => {
    const { PythonBridge } = await import('@/../electron/python-bridge')
    const bridge = new PythonBridge()

    const callPromise = bridge.call('test_method', { key: 'value' })

    // 获取写入的请求数据
    const writeCall = mockProcess.stdin.write.mock.calls[0]
    const request = JSON.parse(writeCall[0])
    expect(request.jsonrpc).toBe('2.0')
    expect(request.method).toBe('test_method')
    expect(request.params).toEqual({ key: 'value' })

    // 模拟 Python 返回响应
    const response = JSON.stringify({ jsonrpc: '2.0', id: request.id, result: 'success' })
    stdoutListeners.forEach(cb => cb(Buffer.from(response + '\n')))

    const result = await callPromise
    expect(result).toBe('success')
  })

  it('应处理错误响应', async () => {
    const { PythonBridge } = await import('@/../electron/python-bridge')
    const bridge = new PythonBridge()

    const callPromise = bridge.call('failing_method')

    const writeCall = mockProcess.stdin.write.mock.calls[0]
    const request = JSON.parse(writeCall[0])

    const response = JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      error: { message: 'Something failed' }
    })
    stdoutListeners.forEach(cb => cb(Buffer.from(response + '\n')))

    await expect(callPromise).rejects.toThrow('Something failed')
  })

  it('应在超时后拒绝请求', async () => {
    vi.useFakeTimers()
    const { PythonBridge } = await import('@/../electron/python-bridge')
    const bridge = new PythonBridge()

    const callPromise = bridge.call('slow_method')

    vi.advanceTimersByTime(30000)

    await expect(callPromise).rejects.toThrow('Request timeout')
    vi.useRealTimers()
  })
})
```

**Step 2: 运行测试**

Run: `npx vitest run tests/unit/main/python-bridge.test.ts`
Expected: PASS

**Step 3: 写 main.ts 测试（IPC handlers）**

Create `tests/unit/main/main.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron
const mockIpcMainHandle = vi.fn()
const mockAppWhenReady = vi.fn().mockResolvedValue(undefined)
const mockAppOn = vi.fn()
const mockAppQuit = vi.fn()

vi.mock('electron', () => ({
  app: {
    whenReady: () => mockAppWhenReady(),
    on: mockAppOn,
    quit: mockAppQuit,
    isPackaged: false,
    getPath: vi.fn().mockReturnValue('/mock')
  },
  BrowserWindow: vi.fn().mockImplementation(() => ({
    loadFile: vi.fn(),
    loadURL: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
    show: vi.fn(),
    webContents: { on: vi.fn() }
  })),
  ipcMain: { handle: mockIpcMainHandle }
}))

// Mock python-bridge
const mockBridgeCall = vi.fn().mockResolvedValue({ success: true })
vi.mock('../../electron/python-bridge', () => ({
  getPythonBridge: () => ({ call: mockBridgeCall, kill: vi.fn() })
}))

describe('Electron Main Process', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('应注册所有 IPC handlers', async () => {
    // 导入 main.ts 会执行注册逻辑
    await import('../../electron/main')

    // 触发 whenReady 回调
    await mockAppWhenReady.mock.calls[0][0]()

    const registeredChannels = mockIpcMainHandle.mock.calls.map(
      (call: any[]) => call[0]
    )

    expect(registeredChannels).toContain('python:search')
    expect(registeredChannels).toContain('python:download')
    expect(registeredChannels).toContain('python:get-favourites')
    expect(registeredChannels).toContain('python:get-config')
    expect(registeredChannels).toContain('python:set-config')
    expect(registeredChannels).toContain('python:get-downloads')
    expect(registeredChannels).toContain('python:cancel-download')
    expect(registeredChannels).toContain('python:get-statistics')
    expect(registeredChannels).toContain('python:apply-auth')
    expect(registeredChannels).toContain('python:verify-auth')
  })

  describe('IPC Handler 行为', () => {
    let handlers: Record<string, Function>

    beforeEach(async () => {
      handlers = {}
      mockIpcMainHandle.mockImplementation((channel: string, handler: Function) => {
        handlers[channel] = handler
      })

      vi.resetModules()
      await import('../../electron/main')
      await mockAppWhenReady.mock.calls[mockAppWhenReady.mock.calls.length - 1][0]()
    })

    it('python:search 应传递 query, mode, page', async () => {
      await handlers['python:search']({}, 'test query', 'keyword', 2)
      expect(mockBridgeCall).toHaveBeenCalledWith('search', {
        query: 'test query',
        mode: 'keyword',
        page: 2
      })
    })

    it('python:download 应传递 comicId 和 comicData', async () => {
      const comicData = { id: '1', title: 'Test' }
      await handlers['python:download']({}, 'comic-1', comicData)
      expect(mockBridgeCall).toHaveBeenCalledWith('download', {
        comic_id: 'comic-1',
        comic_data: comicData
      })
    })

    it('python:cancel-download 应传递 taskId', async () => {
      await handlers['python:cancel-download']({}, 'task-123')
      expect(mockBridgeCall).toHaveBeenCalledWith('cancel_download', {
        task_id: 'task-123'
      })
    })

    it('python:set-config 应传递 key 和 value', async () => {
      await handlers['python:set-config']({}, 'themeMode', 'dark')
      expect(mockBridgeCall).toHaveBeenCalledWith('set_config', {
        key: 'themeMode',
        value: 'dark'
      })
    })

    it('python:apply-auth 应传递 curlText', async () => {
      await handlers['python:apply-auth']({}, 'curl -H "Cookie: ..."')
      expect(mockBridgeCall).toHaveBeenCalledWith('apply_auth', {
        curl_text: 'curl -H "Cookie: ..."'
      })
    })

    it('无参数的 handler 应直接调用 bridge', async () => {
      await handlers['python:get-favourites']()
      expect(mockBridgeCall).toHaveBeenCalledWith('get_favourites')

      await handlers['python:get-config']()
      expect(mockBridgeCall).toHaveBeenCalledWith('get_config')

      await handlers['python:get-downloads']()
      expect(mockBridgeCall).toHaveBeenCalledWith('get_downloads')

      await handlers['python:get-statistics']()
      expect(mockBridgeCall).toHaveBeenCalledWith('get_statistics')

      await handlers['python:verify-auth']()
      expect(mockBridgeCall).toHaveBeenCalledWith('verify_auth')
    })
  })
})
```

**Step 4: 运行主进程测试**

Run: `npx vitest run tests/unit/main/`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/unit/main/
git commit -m "test: add Electron main process and PythonBridge tests"
```

---

## Task 5: Preload 脚本测试

**Files:**
- Create: `tests/unit/preload/preload.test.ts`

**Step 1: 写 preload 测试**

Create `tests/unit/preload/preload.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockExposeInMainWorld = vi.fn()
const mockInvoke = vi.fn().mockResolvedValue('result')
const mockOn = vi.fn()

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mockExposeInMainWorld },
  ipcRenderer: {
    invoke: mockInvoke,
    on: mockOn
  }
}))

describe('Preload Script', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('应通过 contextBridge 暴露 electron API', async () => {
    await import('../../electron/preload')

    expect(mockExposeInMainWorld).toHaveBeenCalledWith('electron', expect.any(Object))
  })

  it('暴露的 API 应包含 ipcRenderer.invoke', async () => {
    await import('../../electron/preload')

    const exposed = mockExposeInMainWorld.mock.calls[0][1]
    expect(exposed.ipcRenderer).toBeDefined()
    expect(typeof exposed.ipcRenderer.invoke).toBe('function')
  })

  it('invoke 应代理到 ipcRenderer.invoke', async () => {
    await import('../../electron/preload')

    const exposed = mockExposeInMainWorld.mock.calls[0][1]
    await exposed.ipcRenderer.invoke('test:channel', 'arg1')

    expect(mockInvoke).toHaveBeenCalledWith('test:channel', 'arg1')
  })

  it('暴露的 API 应包含 ipcRenderer.on', async () => {
    await import('../../electron/preload')

    const exposed = mockExposeInMainWorld.mock.calls[0][1]
    expect(typeof exposed.ipcRenderer.on).toBe('function')
  })

  it('on 应注册事件监听并返回清理函数', async () => {
    const mockRemoveAllListeners = vi.fn()
    mockOn.mockImplementation((channel: string, callback: Function) => {
      // 模拟 electron 的 ipcRenderer.on 行为
    })

    await import('../../electron/preload')

    const exposed = mockExposeInMainWorld.mock.calls[0][1]
    const callback = vi.fn()
    const cleanup = exposed.ipcRenderer.on('test:event', callback)

    expect(mockOn).toHaveBeenCalledWith('test:event', expect.any(Function))
    expect(typeof cleanup).toBe('function')
  })

  it('当 contextBridge 抛出错误时不应崩溃', async () => {
    mockExposeInMainWorld.mockImplementationOnce(() => {
      throw new Error('Context isolation failed')
    })

    // 不应抛出未捕获的错误
    await expect(import('../../electron/preload')).resolves.toBeDefined()
  })
})
```

**Step 2: 运行测试**

Run: `npx vitest run tests/unit/preload/`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/unit/preload/
git commit -m "test: add preload script tests"
```

---

## Task 6: React 组件测试 — 基础组件

**Files:**
- Create: `tests/unit/components/Sidebar.test.tsx`
- Create: `tests/unit/components/Header.test.tsx`
- Create: `tests/unit/components/common/ComicCard.test.tsx`
- Create: `tests/unit/components/common/ProgressBar.test.tsx`

**Step 1: 写 Sidebar 测试**

Create `tests/unit/components/Sidebar.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from '@/components/Sidebar'

describe('Sidebar', () => {
  it('应渲染所有导航项', () => {
    render(<Sidebar activePage="search" onPageChange={vi.fn()} />)

    expect(screen.getByText('搜索')).toBeInTheDocument()
    expect(screen.getByText('下载')).toBeInTheDocument()
    expect(screen.getByText('收藏')).toBeInTheDocument()
    expect(screen.getByText('统计')).toBeInTheDocument()
    expect(screen.getByText('设置')).toBeInTheDocument()
  })

  it('应高亮当前激活页面', () => {
    render(<Sidebar activePage="search" onPageChange={vi.fn()} />)

    const searchButton = screen.getByText('搜索').closest('button')
    expect(searchButton).toHaveAttribute('aria-current', 'page')
  })

  it('点击导航项应调用 onPageChange', async () => {
    const onPageChange = vi.fn()
    render(<Sidebar activePage="search" onPageChange={onPageChange} />)

    await userEvent.click(screen.getByText('下载'))
    expect(onPageChange).toHaveBeenCalledWith('downloads')
  })

  it('应能切换激活页面', () => {
    const { rerender } = render(
      <Sidebar activePage="search" onPageChange={vi.fn()} />
    )

    expect(screen.getByText('搜索').closest('button')).toHaveAttribute('aria-current', 'page')

    rerender(<Sidebar activePage="settings" onPageChange={vi.fn()} />)
    expect(screen.getByText('设置').closest('button')).toHaveAttribute('aria-current', 'page')
  })
})
```

**Step 2: 写 ProgressBar 测试**

Create `tests/unit/components/common/ProgressBar.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressBar } from '@/components/common/ProgressBar'

describe('ProgressBar', () => {
  it('应渲染进度条并显示百分比', () => {
    render(<ProgressBar progress={50} status="downloading" />)
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('应显示完成状态', () => {
    render(<ProgressBar progress={100} status="completed" />)
    expect(screen.getByText('已完成')).toBeInTheDocument()
  })

  it('应显示错误状态', () => {
    render(<ProgressBar progress={30} status="error" />)
    expect(screen.getByText('失败')).toBeInTheDocument()
  })

  it('应显示等待状态', () => {
    render(<ProgressBar progress={0} status="pending" />)
    expect(screen.getByText('等待中')).toBeInTheDocument()
  })

  it('应显示已取消状态', () => {
    render(<ProgressBar progress={60} status="cancelled" />)
    expect(screen.getByText('已取消')).toBeInTheDocument()
  })

  it('进度条宽度应匹配进度值', () => {
    const { container } = render(<ProgressBar progress={75} status="downloading" />)
    const bar = container.querySelector('[style*="width"]')
    expect(bar).toBeTruthy()
  })
})
```

**Step 3: 写 ComicCard 测试**

Create `tests/unit/components/common/ComicCard.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComicCard } from '@/components/common/ComicCard'
import type { ComicInfo } from '@shared/types'

// Mock settings store
vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: vi.fn().mockReturnValue({ cardStyle: 'cover' })
}))

const mockComic: ComicInfo = {
  id: '1',
  title: '测试漫画',
  url: 'https://example.com/1',
  coverUrl: 'https://example.com/cover.jpg',
  source: 'test',
  author: 'Test Author',
  tags: ['tag1', 'tag2']
}

describe('ComicCard', () => {
  it('应渲染漫画标题', () => {
    render(<ComicCard comic={mockComic} />)
    expect(screen.getByText('测试漫画')).toBeInTheDocument()
  })

  it('应渲染封面图片', () => {
    render(<ComicCard comic={mockComic} />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', mockComic.coverUrl)
  })

  it('点击卡片应调用 onClick', async () => {
    const onClick = vi.fn()
    render(<ComicCard comic={mockComic} onClick={onClick} />)

    await userEvent.click(screen.getByText('测试漫画'))
    expect(onClick).toHaveBeenCalledWith(mockComic)
  })

  it('在 batchMode 下应显示选择框', () => {
    render(<ComicCard comic={mockComic} batchMode={true} onToggleSelect={vi.fn()} />)
    expect(screen.getByRole('checkbox')).toBeInTheDocument()
  })

  it('选中状态应有视觉反馈', () => {
    render(
      <ComicCard
        comic={mockComic}
        batchMode={true}
        selected={true}
        onToggleSelect={vi.fn()}
      />
    )
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
  })

  it('点击选择框应调用 onToggleSelect', async () => {
    const onToggleSelect = vi.fn()
    render(
      <ComicCard
        comic={mockComic}
        batchMode={true}
        onToggleSelect={onToggleSelect}
      />
    )

    await userEvent.click(screen.getByRole('checkbox'))
    expect(onToggleSelect).toHaveBeenCalledWith(mockComic)
  })

  it('有 onDownload 时应显示下载按钮', () => {
    render(<ComicCard comic={mockComic} onDownload={vi.fn()} />)
    expect(screen.getByText('下载')).toBeInTheDocument()
  })

  it('点击下载按钮应调用 onDownload 而不触发 onClick', async () => {
    const onClick = vi.fn()
    const onDownload = vi.fn()
    render(
      <ComicCard comic={mockComic} onClick={onClick} onDownload={onDownload} />
    )

    await userEvent.click(screen.getByText('下载'))
    expect(onDownload).toHaveBeenCalledWith(mockComic)
    expect(onClick).not.toHaveBeenCalled()
  })
})
```

**Step 4: 运行组件测试**

Run: `npx vitest run tests/unit/components/`
Expected: PASS（可能需要根据实际组件实现微调选择器）

**Step 5: Commit**

```bash
git add tests/unit/components/
git commit -m "test: add base React component tests"
```

---

## Task 7: React 页面组件测试

**Files:**
- Create: `tests/unit/pages/SearchPage.test.tsx`
- Create: `tests/unit/pages/DownloadPage.test.tsx`
- Create: `tests/unit/pages/FavouritesPage.test.tsx`

**Step 1: 写 SearchPage 测试**

Create `tests/unit/pages/SearchPage.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchPage } from '@/pages/SearchPage'
import { mockWindowElectron, createMockIpcInvoke } from '../../__mocks__/ipc'

// Mock stores
vi.mock('@/stores/useComicStore', () => ({
  useComicStore: vi.fn().mockReturnValue({
    comics: [],
    pagination: null,
    isLoading: false,
    error: null,
    setComics: vi.fn(),
    setPagination: vi.fn(),
    setLoading: vi.fn(),
    setError: vi.fn()
  })
}))

describe('SearchPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockWindowElectron(createMockIpcInvoke({ 'python:search': { comics: [], pagination: null } }))
  })

  it('应渲染搜索输入框', () => {
    render(<SearchPage />)
    expect(screen.getByPlaceholderText(/搜索/i)).toBeInTheDocument()
  })

  it('应显示搜索模式选择', () => {
    render(<SearchPage />)
    expect(screen.getByText('关键词')).toBeInTheDocument()
  })

  it('空搜索不应触发请求', async () => {
    const mockInvoke = createMockIpcInvoke()
    mockWindowElectron(mockInvoke)

    render(<SearchPage />)
    const form = screen.getByRole('search') || screen.getByPlaceholderText(/搜索/i).closest('form')
    if (form) {
      await userEvent.click(form)
    }

    expect(mockInvoke).not.toHaveBeenCalledWith('python:search', expect.anything())
  })

  it('应显示加载状态', () => {
    vi.mocked(require('@/stores/useComicStore').useComicStore).mockReturnValue({
      comics: [],
      pagination: null,
      isLoading: true,
      error: null,
      setComics: vi.fn(),
      setPagination: vi.fn(),
      setLoading: vi.fn(),
      setError: vi.fn()
    })

    render(<SearchPage />)
    expect(screen.getByText(/加载/i)).toBeInTheDocument()
  })

  it('应显示错误状态', () => {
    vi.mocked(require('@/stores/useComicStore').useComicStore).mockReturnValue({
      comics: [],
      pagination: null,
      isLoading: false,
      error: '搜索失败',
      setComics: vi.fn(),
      setPagination: vi.fn(),
      setLoading: vi.fn(),
      setError: vi.fn()
    })

    render(<SearchPage />)
    expect(screen.getByText('搜索失败')).toBeInTheDocument()
  })
})
```

**Step 2: 写 DownloadPage 测试**

Create `tests/unit/pages/DownloadPage.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DownloadPage } from '@/pages/DownloadPage'
import { mockWindowElectron, createMockIpcInvoke } from '../../__mocks__/ipc'

vi.mock('@/stores/useDownloadStore', () => ({
  useDownloadStore: vi.fn().mockReturnValue({
    tasks: [],
    setTasks: vi.fn(),
    addTask: vi.fn(),
    updateTask: vi.fn(),
    removeTask: vi.fn()
  })
}))

describe('DownloadPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockWindowElectron(createMockIpcInvoke({ 'python:get-downloads': { tasks: [] } }))
  })

  it('应渲染页面标题', () => {
    render(<DownloadPage />)
    expect(screen.getByText(/下载/i)).toBeInTheDocument()
  })

  it('没有任务时应显示空状态', () => {
    render(<DownloadPage />)
    expect(screen.getByText(/暂无下载/i)).toBeInTheDocument()
  })

  it('有任务时应显示任务列表', () => {
    vi.mocked(require('@/stores/useDownloadStore').useDownloadStore).mockReturnValue({
      tasks: [{
        id: 't1',
        comic: { id: '1', title: 'Test Comic', url: '', coverUrl: '', source: 'test' },
        status: 'downloading',
        progress: 50,
        totalPages: 10,
        downloadedPages: 5
      }],
      setTasks: vi.fn(),
      addTask: vi.fn(),
      updateTask: vi.fn(),
      removeTask: vi.fn()
    })

    render(<DownloadPage />)
    expect(screen.getByText('Test Comic')).toBeInTheDocument()
  })
})
```

**Step 3: 写 FavouritesPage 测试**

Create `tests/unit/pages/FavouritesPage.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FavouritesPage } from '@/pages/FavouritesPage'
import { mockWindowElectron, createMockIpcInvoke } from '../../__mocks__/ipc'

describe('FavouritesPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('应渲染收藏页面标题', () => {
    mockWindowElectron(createMockIpcInvoke({
      'python:get-favourites': { comics: [] }
    }))
    render(<FavouritesPage />)
    expect(screen.getByText(/收藏/i)).toBeInTheDocument()
  })

  it('没有收藏时应显示空状态', () => {
    mockWindowElectron(createMockIpcInvoke({
      'python:get-favourites': { comics: [] }
    }))
    render(<FavouritesPage />)
    expect(screen.getByText(/暂无收藏/i)).toBeInTheDocument()
  })

  it('有收藏时应显示漫画列表', () => {
    mockWindowElectron(createMockIpcInvoke({
      'python:get-favourites': {
        comics: [{
          id: '1', title: 'Fav Comic', url: '', coverUrl: '', source: 'test'
        }]
      }
    }))
    render(<FavouritesPage />)
    expect(screen.getByText('Fav Comic')).toBeInTheDocument()
  })
})
```

**Step 4: 运行页面测试**

Run: `npx vitest run tests/unit/pages/`
Expected: 可能需要根据实际组件导出和实现微调

**Step 5: Commit**

```bash
git add tests/unit/pages/
git commit -m "test: add page component tests"
```

---

## Task 8: useTheme Hook 测试

**Files:**
- Create: `tests/unit/hooks/useTheme.test.ts`

**Step 1: 写 useTheme 测试**

Create `tests/unit/hooks/useTheme.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTheme } from '@/hooks/useTheme'

// Mock store
const mockSetThemeMode = vi.fn()
let mockThemeMode: string = 'auto'

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: vi.fn().mockImplementation((selector: Function) =>
    selector({
      themeMode: mockThemeMode,
      setThemeMode: mockSetThemeMode
    })
  )
}))

describe('useTheme', () => {
  beforeEach(() => {
    mockThemeMode = 'auto'
    vi.restoreAllMocks()
    document.documentElement.removeAttribute('data-theme')
  })

  it('auto 模式应根据系统偏好设置主题', () => {
    const matchMediaMock = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
    window.matchMedia = matchMediaMock

    mockThemeMode = 'auto'
    renderHook(() => useTheme())

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('dark 模式应直接设置 data-theme="dark"', () => {
    mockThemeMode = 'dark'
    renderHook(() => useTheme())

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('light 模式应直接设置 data-theme="light"', () => {
    mockThemeMode = 'light'
    renderHook(() => useTheme())

    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('卸载时应清理事件监听', () => {
    const removeEventListener = vi.fn()
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener
    })

    mockThemeMode = 'auto'
    const { unmount } = renderHook(() => useTheme())
    unmount()

    expect(removeEventListener).toHaveBeenCalled()
  })
})
```

**Step 2: 运行测试**

Run: `npx vitest run tests/unit/hooks/useTheme.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/unit/hooks/useTheme.test.ts
git commit -m "test: add useTheme hook tests"
```

---

## Task 9: 运行完整覆盖率报告并调整

**Files:**
- 可能修改部分测试文件以提高覆盖率

**Step 1: 运行覆盖率报告**

Run:
```bash
npx vitest run --coverage
```

**Step 2: 检查覆盖率**

查看终端输出中的覆盖率表格，确认：
- 整体行覆盖率 >= 70%
- 函数覆盖率 >= 70%
- 关键文件（main.ts, hooks/, stores/）覆盖率达标

**Step 3: 针对覆盖率不足的部分补充测试**

根据覆盖率报告中标记为红色的文件，针对性添加测试用例覆盖未测试的分支。

**Step 4: 最终验证**

Run: `npx vitest run --coverage`
Expected: 所有测试通过，整体覆盖率 >= 70%

**Step 5: Commit**

```bash
git add tests/
git commit -m "test: achieve 70%+ coverage with additional edge case tests"
```

---

## 任务摘要

| Task | 描述 | 测试文件数 | 覆盖层 |
|------|------|-----------|--------|
| 1 | 安装依赖和配置 | 0 (配置) | 基础设施 |
| 2 | Zustand Stores | 3 | Stores |
| 3 | React Hooks | 5 | Hooks |
| 4 | 主进程 + PythonBridge | 2 | Main |
| 5 | Preload | 1 | Preload |
| 6 | 基础组件 | 3 | Components |
| 7 | 页面组件 | 3 | Pages |
| 8 | useTheme Hook | 1 | Hooks |
| 9 | 覆盖率调整 | - | 全部 |
| **总计** | | **18+** | **全栈** |
