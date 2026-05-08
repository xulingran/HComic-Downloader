// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Use vi.hoisted to create all shared state and mock functions
// These are hoisted to the top of the file, before vi.mock factories run
const { mockBridgeCall, mockBridgeKill, mockBridgeShutdown, handleCalls, capturedInstances } = vi.hoisted(() => ({
  mockBridgeCall: vi.fn().mockResolvedValue({ success: true }),
  mockBridgeKill: vi.fn(),
  mockBridgeShutdown: vi.fn().mockResolvedValue(undefined),
  handleCalls: [] as Array<{ channel: string; handler: Function }>,
  capturedInstances: [] as any[]
}))

// Mock electron module
vi.mock('electron', () => {
  const mockHandle = vi.fn((channel: string, handler: Function) => {
    handleCalls.push({ channel, handler })
  })

  // BrowserWindow must be a class (constructable with `new`)
  class MockBrowserWindow {
    webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn()
    }
    loadURL = vi.fn()
    loadFile = vi.fn()
    once = vi.fn()
    on = vi.fn()
    show = vi.fn()
    static getAllWindows = vi.fn().mockReturnValue([])
    constructor(public options?: any) {
      capturedInstances.push(this)
    }
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
    },
    shell: {
      openExternal: vi.fn().mockResolvedValue(undefined)
    }
  }
})

// Mock python-bridge
vi.mock('../../../electron/python-bridge', () => ({
  getPythonBridge: () => ({
    call: mockBridgeCall,
    kill: mockBridgeKill,
    shutdown: mockBridgeShutdown,
    setNotificationHandler: vi.fn()
  })
}))

// Import after mocks - this triggers side effects
import { app } from 'electron'

import '../../../electron/main'

// Import PYTHON_IPC_CHANNEL_MAP for parity test
import { PYTHON_IPC_CHANNEL_MAP, IPC_CHANNELS } from '../../../shared/types'

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
    it('should register all 13 IPC handlers', () => {
      expect(handleCalls.length).toBe(13)
    })

    const expectedChannels = [
      'python:search',
      'python:download',
      'python:check-download-conflict',
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

    it('every python:* channel must exist in PYTHON_IPC_CHANNEL_MAP', () => {
      const registeredPythonChannels = handleCalls
        .map(h => h.channel)
        .filter(c => c.startsWith('python:'))

      const mapKeys = new Set(Object.keys(PYTHON_IPC_CHANNEL_MAP))
      const registeredSet = new Set(registeredPythonChannels)

      // Every registered python:* channel must be in the map
      for (const ch of registeredSet) {
        expect(mapKeys.has(ch), `Channel "${ch}" registered but not in PYTHON_IPC_CHANNEL_MAP`).toBe(true)
      }

      // Every PYTHON_IPC_CHANNEL_MAP key must be registered
      for (const ch of mapKeys) {
        expect(registeredSet.has(ch), `Channel "${ch}" in PYTHON_IPC_CHANNEL_MAP but not registered`).toBe(true)
      }
    })

    it('PYTHON_IPC_CHANNEL_MAP values must match Python handler method names', () => {
      const validMethods = new Set([
        'search', 'download', 'check_download_conflict', 'get_favourites', 'get_config', 'set_config',
        'get_downloads', 'cancel_download', 'get_statistics', 'apply_auth', 'verify_auth', 'shutdown',
      ])
      for (const [channel, method] of Object.entries(PYTHON_IPC_CHANNEL_MAP)) {
        expect(validMethods.has(method),
          `PYTHON_IPC_CHANNEL_MAP["${channel}"] = "${method}" is not a known Python handler`
        ).toBe(true)
      }
    })

    it('every IPC_CHANNELS value (including OPEN_EXTERNAL) must be registered', () => {
      const registeredSet = new Set(handleCalls.map(h => h.channel))
      for (const ch of Object.values(IPC_CHANNELS)) {
        expect(registeredSet.has(ch),
          `IPC_CHANNELS.${Object.keys(IPC_CHANNELS).find(k => IPC_CHANNELS[k as keyof typeof IPC_CHANNELS] === ch)} = "${ch}" not registered`
        ).toBe(true)
      }
    })
  })

  describe('IPC handler delegation', () => {
    it('python:search delegates to bridge.call with correct params', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:search')!
      await handler.handler({}, 'test query', 'keyword', 1)

      expect(mockBridgeCall).toHaveBeenCalledWith('search', {
        query: 'test query',
        mode: 'keyword',
        page: 1
      })
    })

    it('python:download delegates with comicId transformed to comic_id', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:download')!
      const comicData = { title: 'Test Comic', url: 'http://example.com', source: 'NH', sourceSite: 'hcomic' }
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
      await handler.handler({}, 'themeMode', 'dark')

      expect(mockBridgeCall).toHaveBeenCalledWith('set_config', {
        key: 'themeMode',
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

    it('should register before-quit listener that shuts down bridge', () => {
      expect(app.on).toHaveBeenCalledWith('before-quit', expect.any(Function))

      // Find the before-quit handler and invoke it with a mock event
      const beforeQuitCall = vi.mocked(app.on).mock.calls.find(
        call => call[0] === 'before-quit'
      )
      expect(beforeQuitCall).toBeDefined()
      const beforeQuitHandler = beforeQuitCall![1]
      const mockEvent = { preventDefault: vi.fn() }
      beforeQuitHandler(mockEvent)

      // Handler prevents default, starts async shutdown, then calls app.quit()
      expect(mockEvent.preventDefault).toHaveBeenCalled()
      expect(mockBridgeShutdown).toHaveBeenCalled()
    })
  })

  describe('Input validation', () => {
    it('python:search should reject invalid query', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:search')!
      await expect(handler.handler({}, 123, 'keyword', 1)).rejects.toThrow('Invalid search query')
    })

    it('python:search should reject invalid mode', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:search')!
      await expect(handler.handler({}, 'test', 'invalid', 1)).rejects.toThrow('Invalid search mode')
    })

    it('python:search should reject invalid page', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:search')!
      await expect(handler.handler({}, 'test', 'keyword', 'not-a-number')).rejects.toThrow('Invalid search page')
    })

    it('python:search should reject page 0', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:search')!
      await expect(handler.handler({}, 'test', 'keyword', 0)).rejects.toThrow('Invalid search page')
    })

    it('python:search should reject NaN page', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:search')!
      await expect(handler.handler({}, 'test', 'keyword', NaN)).rejects.toThrow('Invalid search page')
    })

    it('python:search should reject invalid source', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:search')!
      await expect(handler.handler({}, 'test', 'keyword', 1, 'evil')).rejects.toThrow('Invalid search source')
    })

    it('python:download should reject non-string comicId', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:download')!
      await expect(handler.handler({}, 123, { title: 'test' })).rejects.toThrow('Invalid download comicId')
    })

    it('python:download should reject null comicData', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:download')!
      await expect(handler.handler({}, 'id', null)).rejects.toThrow('Invalid download comicData')
    })

    it('python:download should reject comicId with path separators', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:download')!
      await expect(handler.handler({}, '../evil', { title: 'Test', source: 'hcomic' }))
        .rejects.toThrow('Invalid download comicId')
    })

    it('python:download should reject comicId with backslash', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:download')!
      await expect(handler.handler({}, 'evil\\path', { title: 'Test', source: 'hcomic' }))
        .rejects.toThrow('Invalid download comicId')
    })

    it('python:download should reject comicId with control characters', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:download')!
      await expect(handler.handler({}, 'evil\x00id', { title: 'Test', source: 'hcomic' }))
        .rejects.toThrow('Invalid download comicId')
    })

    it('python:download should reject comicId longer than 256 chars', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:download')!
      await expect(handler.handler({}, 'a'.repeat(257), { title: 'Test', source: 'hcomic' }))
        .rejects.toThrow('Invalid download comicId')
    })

    it('python:download should reject missing title', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:download')!
      await expect(handler.handler({}, 'valid-id', { source: 'hcomic' }))
        .rejects.toThrow('Invalid comicData.title')
    })

    it('python:download should reject pages exceeding max', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:download')!
      await expect(handler.handler({}, 'valid-id', { title: 'Test', source: 'hcomic', pages: 999999 }))
        .rejects.toThrow('Invalid comicData.pages')
    })

    it('python:download should reject non-integer pages', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:download')!
      await expect(handler.handler({}, 'valid-id', { title: 'Test', source: 'hcomic', pages: 1.5 }))
        .rejects.toThrow('Invalid comicData.pages')
    })

    it('python:download should reject invalid sourceSite', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:download')!
      await expect(handler.handler({}, 'valid-id', { title: 'Test', source: 'NH', sourceSite: 'evil' }))
        .rejects.toThrow('Invalid comicData.sourceSite')
    })

    it('python:download should accept real-world payload (source=NH, sourceSite=hcomic)', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:download')!
      await handler.handler({}, 'comic-999', { title: 'T', source: 'NH', sourceSite: 'hcomic' })
      expect(mockBridgeCall).toHaveBeenCalledWith('download', {
        comic_id: 'comic-999',
        comic_data: { title: 'T', source: 'NH', sourceSite: 'hcomic' },
      })
    })

    it('python:download should accept source=MMCG_SHORT', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:download')!
      await handler.handler({}, 'id', { title: 'T', source: 'MMCG_SHORT', sourceSite: 'hcomic' })
      expect(mockBridgeCall).toHaveBeenCalledWith('download', expect.objectContaining({
        comic_data: expect.objectContaining({ source: 'MMCG_SHORT', sourceSite: 'hcomic' }),
      }))
    })

    it('python:download should reject non-array tags', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:download')!
      await expect(handler.handler({}, 'valid-id', { title: 'Test', source: 'hcomic', tags: 'not-array' }))
        .rejects.toThrow('Invalid comicData.tags')
    })

    it('python:download should reject tags with overlong entries', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:download')!
      await expect(handler.handler({}, 'valid-id', { title: 'Test', source: 'hcomic', tags: ['a'.repeat(65)] }))
        .rejects.toThrow('Invalid comicData.tags')
    })

    it('python:download should accept valid payload', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:download')!
      await handler.handler({}, 'valid-id', {
        title: 'Test Comic',
        source: 'NH',
        sourceSite: 'hcomic',
        pages: 42,
        mediaId: 'media-123',
        tags: ['tag1', 'tag2'],
        author: 'Author Name',
      })
      expect(mockBridgeCall).toHaveBeenCalledWith('download', {
        comic_id: 'valid-id',
        comic_data: expect.objectContaining({ title: 'Test Comic', source: 'NH' }),
      })
    })

    it('python:download should accept payload with optional fields omitted', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:download')!
      await handler.handler({}, 'minimal-id', { title: 'Minimal', source: 'MMCG_LONG' })
      expect(mockBridgeCall).toHaveBeenCalledWith('download', {
        comic_id: 'minimal-id',
        comic_data: { title: 'Minimal', source: 'MMCG_LONG' },
      })
    })

    it('python:get-favourites should reject invalid page', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:get-favourites')!
      await expect(handler.handler({}, 0)).rejects.toThrow('Invalid favourites page')
    })

    it('python:set-config should reject non-string key', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await expect(handler.handler({}, 123, 'value')).rejects.toThrow('Invalid set_config parameters')
    })

    it('python:cancel-download should reject non-string taskId', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:cancel-download')!
      await expect(handler.handler({}, 123)).rejects.toThrow('Invalid cancel_download taskId')
    })

    it('python:cancel-download should reject empty taskId', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:cancel-download')!
      await expect(handler.handler({}, '')).rejects.toThrow('Invalid cancel_download taskId')
    })

    it('python:apply-auth should reject non-string curlText', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:apply-auth')!
      await expect(handler.handler({}, 123)).rejects.toThrow('Invalid apply_auth curlText')
    })

    it('python:apply-auth should reject empty curlText', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:apply-auth')!
      await expect(handler.handler({}, '   ')).rejects.toThrow('Invalid apply_auth curlText')
    })

    it('python:search should reject query over 512 chars', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:search')!
      await expect(handler.handler({}, 'a'.repeat(513), 'keyword', 1)).rejects.toThrow('Invalid search query')
    })

    it('python:cancel-download should reject taskId over 256 chars', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:cancel-download')!
      await expect(handler.handler({}, 'a'.repeat(257))).rejects.toThrow('Invalid cancel_download taskId')
    })

    it('python:apply-auth should reject curlText over 64KB', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:apply-auth')!
      await expect(handler.handler({}, 'c'.repeat(65537))).rejects.toThrow('Invalid apply_auth curlText')
    })
  })

  describe('Navigation security', () => {
    it('should include sandbox: true in webPreferences', async () => {
      await flushMicrotasks()
      const instance = capturedInstances[0]
      expect(instance).toBeDefined()
      expect(instance.options.webPreferences.sandbox).toBe(true)
    })

    it('should register will-navigate handler on webContents', async () => {
      await flushMicrotasks()
      const instance = capturedInstances[0]
      expect(instance).toBeDefined()
      const wcOnCalls = instance.webContents.on.mock.calls
      const willNavigateCall = wcOnCalls.find((c: any) => c[0] === 'will-navigate')
      expect(willNavigateCall).toBeDefined()
    })

    it('should register did-fail-load handler on webContents', async () => {
      await flushMicrotasks()
      const instance = capturedInstances[0]
      const wcOnCalls = instance.webContents.on.mock.calls
      const didFailLoadCall = wcOnCalls.find((c: any) => c[0] === 'did-fail-load')
      expect(didFailLoadCall).toBeDefined()
    })

    it('should set window open handler to deny all', async () => {
      await flushMicrotasks()
      const instance = capturedInstances[0]
      expect(instance.webContents.setWindowOpenHandler).toHaveBeenCalledWith(expect.any(Function))
      const handler = instance.webContents.setWindowOpenHandler.mock.calls[0][0]
      expect(handler()).toEqual({ action: 'deny' })
    })

    it('will-navigate handler should prevent default', async () => {
      await flushMicrotasks()
      const instance = capturedInstances[0]
      const wcOnCalls = instance.webContents.on.mock.calls
      const willNavigateCall = wcOnCalls.find((c: any) => c[0] === 'will-navigate')
      const event = { preventDefault: vi.fn() }
      willNavigateCall[1](event, 'https://evil.com')
      expect(event.preventDefault).toHaveBeenCalled()
    })
  })

  describe('Config validation', () => {
    it('should reject unknown config key', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await expect(handler.handler({}, 'unknownKey', 'value'))
        .rejects.toThrow('Unknown config key: unknownKey')
    })

    it('should reject wrong value type for config', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await expect(handler.handler({}, 'concurrentDownloads', 'not-a-number'))
        .rejects.toThrow('Invalid value type for concurrentDownloads')
    })

    it('should reject value outside valid range', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await expect(handler.handler({}, 'concurrentDownloads', 99))
        .rejects.toThrow('Invalid value for concurrentDownloads')
    })

    it('should accept valid config value', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await handler.handler({}, 'themeMode', 'dark')
      expect(mockBridgeCall).toHaveBeenCalledWith('set_config', { key: 'themeMode', value: 'dark' })
    })

    it('should reject invalid themeMode value', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await expect(handler.handler({}, 'themeMode', 'invalid'))
        .rejects.toThrow('Invalid value for themeMode')
    })

    it('should reject downloadDir with path traversal', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await expect(handler.handler({}, 'downloadDir', '/safe/../etc'))
        .rejects.toThrow('Invalid value for downloadDir')
    })

    it('should reject downloadDir with relative path', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await expect(handler.handler({}, 'downloadDir', 'relative/path'))
        .rejects.toThrow('Invalid value for downloadDir')
    })

    it('should reject downloadDir with control characters', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await expect(handler.handler({}, 'downloadDir', '/tmp\n/etc'))
        .rejects.toThrow('Invalid value for downloadDir')
    })

    it('should accept valid downloadDir', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await handler.handler({}, 'downloadDir', '/home/user/Downloads')
      expect(mockBridgeCall).toHaveBeenCalledWith('set_config', { key: 'downloadDir', value: '/home/user/Downloads' })
    })

    it('should accept Windows downloadDir', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await handler.handler({}, 'downloadDir', 'C:\\Users\\test\\Downloads')
      expect(mockBridgeCall).toHaveBeenCalledWith('set_config', { key: 'downloadDir', value: 'C:\\Users\\test\\Downloads' })
    })

    it('should reject cbzFilenameTemplate with format specifier', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await expect(handler.handler({}, 'cbzFilenameTemplate', '{author}-{id:>10}.cbz'))
        .rejects.toThrow('Invalid value for cbzFilenameTemplate')
    })

    it('should reject cbzFilenameTemplate with unclosed brace', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await expect(handler.handler({}, 'cbzFilenameTemplate', '{author}-{title'))
        .rejects.toThrow('Invalid value for cbzFilenameTemplate')
    })

    it('should reject cbzFilenameTemplate with path separators', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await expect(handler.handler({}, 'cbzFilenameTemplate', '../{author}-{title}.cbz'))
        .rejects.toThrow('Invalid value for cbzFilenameTemplate')
    })

    it('should reject cbzFilenameTemplate with invalid placeholders', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await expect(handler.handler({}, 'cbzFilenameTemplate', '{author}-{evil}.cbz'))
        .rejects.toThrow('Invalid value for cbzFilenameTemplate')
    })

    it('should accept valid cbzFilenameTemplate', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await handler.handler({}, 'cbzFilenameTemplate', '{author}-{title}.cbz')
      expect(mockBridgeCall).toHaveBeenCalledWith('set_config', { key: 'cbzFilenameTemplate', value: '{author}-{title}.cbz' })
    })

    it('should reject cbzFilenameTemplate with stray closing brace', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await expect(handler.handler({}, 'cbzFilenameTemplate', '{author}}'))
        .rejects.toThrow('Invalid value for cbzFilenameTemplate')
    })

    it('should reject cbzFilenameTemplate with stray opening brace', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await expect(handler.handler({}, 'cbzFilenameTemplate', '{author'))
        .rejects.toThrow('Invalid value for cbzFilenameTemplate')
    })

    it('should reject cbzFilenameTemplate with extra trailing brace', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await expect(handler.handler({}, 'cbzFilenameTemplate', '{author}-{title}}.cbz'))
        .rejects.toThrow('Invalid value for cbzFilenameTemplate')
    })

    it('should reject cbzFilenameTemplate with empty placeholder', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await expect(handler.handler({}, 'cbzFilenameTemplate', '{}.cbz'))
        .rejects.toThrow('Invalid value for cbzFilenameTemplate')
    })

    it('should accept cbzFilenameTemplate with all three placeholders', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await handler.handler({}, 'cbzFilenameTemplate', '{author}-{title}-{id}.cbz')
      expect(mockBridgeCall).toHaveBeenCalledWith('set_config', { key: 'cbzFilenameTemplate', value: '{author}-{title}-{id}.cbz' })
    })

    it('should accept cbzFilenameTemplate with no placeholders', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await handler.handler({}, 'cbzFilenameTemplate', 'comic.cbz')
      expect(mockBridgeCall).toHaveBeenCalledWith('set_config', { key: 'cbzFilenameTemplate', value: 'comic.cbz' })
    })
  })
})
