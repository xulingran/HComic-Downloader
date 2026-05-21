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
    webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      session: {
        webRequest: {
          onBeforeSendHeaders: vi.fn(),
          onHeadersReceived: vi.fn(),
        },
      },
    }
    static getAllWindows = vi.fn().mockReturnValue([])
  }

  return {
    app: {
      whenReady: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      quit: vi.fn(),
      setAsDefaultProtocolClient: vi.fn(),
    },
    BrowserWindow: MockBrowserWindow,
    ipcMain: { handle: mockHandle },
    shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
    dialog: { showErrorBox: vi.fn(), showMessageBoxSync: vi.fn().mockReturnValue(1), },
    Notification: { isSupported: vi.fn().mockReturnValue(false), },
  }
})

vi.mock('../../../electron/python-bridge', () => ({
  getPythonBridge: () => ({
    call: vi.fn().mockResolvedValue({}),
    kill: vi.fn(),
    setNotificationHandler: vi.fn(),
  }),
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
  })

  it('should reject invalid URL format', async () => {
    const handler = handleCalls.find(h => h.channel === 'open-external')!
    await expect(handler!.handler({}, 'not-a-url')).rejects.toThrow()
  })
})
