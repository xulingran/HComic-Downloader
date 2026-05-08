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
  contextBridge: mockContextBridge,
  dialog: {
    showErrorBox: vi.fn(),
    showMessageBoxSync: vi.fn().mockReturnValue(1),
  },
  Notification: {
    isSupported: vi.fn().mockReturnValue(false),
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
    openPath: vi.fn().mockResolvedValue(''),
  },
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
