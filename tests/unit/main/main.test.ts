// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Use vi.hoisted to create all shared state and mock functions
// These are hoisted to the top of the file, before vi.mock factories run
const { mockBridgeCall, mockBridgeKill, handleCalls } = vi.hoisted(() => ({
  mockBridgeCall: vi.fn().mockResolvedValue({ success: true }),
  mockBridgeKill: vi.fn(),
  handleCalls: [] as Array<{ channel: string; handler: Function }>
}))

// Mock electron module
vi.mock('electron', () => {
  const mockHandle = vi.fn((channel: string, handler: Function) => {
    handleCalls.push({ channel, handler })
  })

  // BrowserWindow must be a class (constructable with `new`)
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
      quit: vi.fn()
    },
    BrowserWindow: MockBrowserWindow,
    ipcMain: {
      handle: mockHandle
    }
  }
})

// Mock python-bridge
vi.mock('../../../electron/python-bridge', () => ({
  getPythonBridge: () => ({ call: mockBridgeCall, kill: mockBridgeKill })
}))

// Import after mocks - this triggers side effects
import { app } from 'electron'

// Import main.ts to trigger all side effects
// Note: app.whenReady() resolves immediately but .then() runs as microtask
import '../../../electron/main'

// Helper to flush microtasks so that app.whenReady().then() callback runs
async function flushMicrotasks(): Promise<void> {
  // Multiple rounds to ensure all chained promises resolve
  await new Promise(resolve => setTimeout(resolve, 10))
}

describe('main.ts', () => {
  beforeEach(async () => {
    mockBridgeCall.mockResolvedValue({ success: true })
    mockBridgeCall.mockClear()
    // Flush microtasks from import to ensure registerIPCHandlers has run
    await flushMicrotasks()
  })

  describe('IPC handler registration', () => {
    it('should register all 11 IPC handlers', () => {
      expect(handleCalls.length).toBe(11)
    })

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

    expectedChannels.forEach(channel => {
      it(`should register ${channel} handler`, () => {
        const handler = handleCalls.find(h => h.channel === channel)
        expect(handler).toBeDefined()
      })
    })
  })

  describe('IPC handler delegation', () => {
    it('python:search delegates to bridge.call with correct params', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:search')!
      await handler.handler({}, 'test query', 'title', 1)

      expect(mockBridgeCall).toHaveBeenCalledWith('search', {
        query: 'test query',
        mode: 'title',
        page: 1
      })
    })

    it('python:download delegates with comicId transformed to comic_id', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:download')!
      const comicData = { title: 'Test Comic', url: 'http://example.com' }
      await handler.handler({}, 'comic-123', comicData)

      expect(mockBridgeCall).toHaveBeenCalledWith('download', {
        comic_id: 'comic-123',
        comic_data: comicData
      })
    })

    it('python:get-favourites delegates with no params', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:get-favourites')!
      await handler.handler({})

      expect(mockBridgeCall).toHaveBeenCalledWith('get_favourites', { page: 1 })
    })

    it('python:get-config delegates with no params', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:get-config')!
      await handler.handler({})

      expect(mockBridgeCall).toHaveBeenCalledWith('get_config')
    })

    it('python:set-config delegates with key and value', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await handler.handler({}, 'theme', 'dark')

      expect(mockBridgeCall).toHaveBeenCalledWith('set_config', {
        key: 'theme',
        value: 'dark'
      })
    })

    it('python:get-downloads delegates with no params', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:get-downloads')!
      await handler.handler({})

      expect(mockBridgeCall).toHaveBeenCalledWith('get_downloads')
    })

    it('python:cancel-download delegates with taskId transformed to task_id', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:cancel-download')!
      await handler.handler({}, 'task-456')

      expect(mockBridgeCall).toHaveBeenCalledWith('cancel_download', {
        task_id: 'task-456'
      })
    })

    it('python:get-statistics delegates with no params', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:get-statistics')!
      await handler.handler({})

      expect(mockBridgeCall).toHaveBeenCalledWith('get_statistics')
    })

    it('python:apply-auth delegates with curlText transformed to curl_text', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:apply-auth')!
      const curlStr = 'curl -H "Cookie: test=123" https://example.com'
      await handler.handler({}, curlStr)

      expect(mockBridgeCall).toHaveBeenCalledWith('apply_auth', {
        curl_text: curlStr
      })
    })

    it('python:verify-auth delegates with no params', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:verify-auth')!
      await handler.handler({})

      expect(mockBridgeCall).toHaveBeenCalledWith('verify_auth')
    })
  })

  describe('app lifecycle', () => {
    it('should call app.whenReady on import', () => {
      expect(app.whenReady).toHaveBeenCalled()
    })

    it('should register window-all-closed listener', () => {
      expect(app.on).toHaveBeenCalledWith('window-all-closed', expect.any(Function))
    })

    it('should register activate listener', () => {
      expect(app.on).toHaveBeenCalledWith('activate', expect.any(Function))
    })

    it('should register before-quit listener that kills bridge', () => {
      expect(app.on).toHaveBeenCalledWith('before-quit', expect.any(Function))

      // Find the before-quit handler and invoke it
      const beforeQuitCall = vi.mocked(app.on).mock.calls.find(
        call => call[0] === 'before-quit'
      )
      expect(beforeQuitCall).toBeDefined()
      const beforeQuitHandler = beforeQuitCall![1]
      beforeQuitHandler()

      expect(mockBridgeKill).toHaveBeenCalled()
    })
  })

  describe('Input validation', () => {
    it('python:search should reject invalid query', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:search')!
      await expect(handler.handler({}, 123, 'title', 1)).rejects.toThrow('Invalid search parameters')
    })

    it('python:search should reject invalid page', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:search')!
      await expect(handler.handler({}, 'test', 'title', 'not-a-number')).rejects.toThrow('Invalid search parameters')
    })

    it('python:download should reject non-string comicId', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:download')!
      await expect(handler.handler({}, 123, { title: 'test' })).rejects.toThrow('Invalid download parameters')
    })

    it('python:download should reject null comicData', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:download')!
      await expect(handler.handler({}, 'id', null)).rejects.toThrow('Invalid download parameters')
    })

    it('python:set-config should reject non-string key', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await expect(handler.handler({}, 123, 'value')).rejects.toThrow('Invalid set_config parameters')
    })

    it('python:cancel-download should reject non-string taskId', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:cancel-download')!
      await expect(handler.handler({}, 123)).rejects.toThrow('Invalid cancel_download parameters')
    })

    it('python:apply-auth should reject non-string curlText', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:apply-auth')!
      await expect(handler.handler({}, 123)).rejects.toThrow('Invalid apply_auth parameters')
    })
  })
})
