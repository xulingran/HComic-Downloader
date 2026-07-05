// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Use vi.hoisted to create all shared state and mock functions
// These are hoisted to the top of the file, before vi.mock factories run
const { mockBridgeCall, mockBridgeKill, mockBridgeShutdown, mockShouldPreferSilentJmSnapshotRecovery, mockBuildSilentJmFavouritesUrl, mockRecoverJmFavouritesSilently, handleCalls, capturedInstances, notificationHandlers, MockNotification } = vi.hoisted(() => {
  const mockNotify = vi.fn().mockImplementation(function () { return { on: vi.fn(), show: vi.fn() } })
  mockNotify.isSupported = vi.fn().mockReturnValue(true)
  return {
    mockBridgeCall: vi.fn().mockResolvedValue({ success: true }),
    mockBridgeKill: vi.fn(),
    mockBridgeShutdown: vi.fn().mockResolvedValue(undefined),
    mockShouldPreferSilentJmSnapshotRecovery: vi.fn().mockReturnValue(false),
    mockBuildSilentJmFavouritesUrl: vi.fn().mockReturnValue(null),
    mockRecoverJmFavouritesSilently: vi.fn(),
    handleCalls: [] as Array<{ channel: string; handler: (...args: unknown[]) => unknown }>,
    capturedInstances: [] as unknown[],
    notificationHandlers: {} as Record<string, (...args: unknown[]) => unknown>,
    MockNotification: mockNotify,
  }
})

// Mock electron module
vi.mock('electron', () => {
  const mockHandle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    handleCalls.push({ channel, handler })
  })

  // BrowserWindow must be a class (constructable with `new`)
  class MockBrowserWindow {
    webContents = {
      on: vi.fn(),
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      session: {
        webRequest: {
          onBeforeSendHeaders: vi.fn(),
          onHeadersReceived: vi.fn(),
        },
      },
    }
    loadURL = vi.fn()
    loadFile = vi.fn()
    once = vi.fn()
    on = vi.fn()
    show = vi.fn()
    isFocused = vi.fn().mockReturnValue(false)
    isMinimized = vi.fn().mockReturnValue(false)
    isDestroyed = vi.fn().mockReturnValue(false)
    destroy = vi.fn()
    restore = vi.fn()
    focus = vi.fn()
    static getAllWindows = vi.fn().mockReturnValue([])
    constructor(public options?: unknown) {
      capturedInstances.push(this)
    }
  }

  return {
    app: {
      whenReady: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      quit: vi.fn(),
      getName: vi.fn().mockReturnValue('HComicDownloader'),
      setAsDefaultProtocolClient: vi.fn(),
      setAppUserModelId: vi.fn(),
      requestSingleInstanceLock: vi.fn().mockReturnValue(true),
      commandLine: {
        appendSwitch: vi.fn(),
      },
    },
    BrowserWindow: MockBrowserWindow,
    ipcMain: {
      handle: mockHandle
    },
    shell: {
      openExternal: vi.fn().mockResolvedValue(undefined)
    },
    dialog: {
      showErrorBox: vi.fn(),
      showMessageBoxSync: vi.fn().mockReturnValue(1),
    },
    Notification: MockNotification,
    crashReporter: {
      start: vi.fn(),
    },
    clipboard: {
      writeText: vi.fn(),
    },
    session: {
      defaultSession: {
        cookies: { get: vi.fn().mockResolvedValue([]) },
        webRequest: { onHeadersReceived: vi.fn() },
      },
      fromPartition: vi.fn().mockReturnValue({
        cookies: { get: vi.fn().mockResolvedValue([]) },
        webRequest: { onHeadersReceived: vi.fn() },
      }),
    },
    protocol: {
      handle: vi.fn(),
    },
    net: {
      fetch: vi.fn(),
    },
  }
})

// Mock python-bridge
vi.mock('../../../electron/python-bridge', () => ({
  getPythonBridge: () => ({
    call: mockBridgeCall,
    kill: mockBridgeKill,
    shutdown: mockBridgeShutdown,
    setNotificationHandler: (method: string, handler: (...args: unknown[]) => unknown) => {
      notificationHandlers[method] = handler
    }
  })
}))

// Mock JM challenge recovery
vi.mock('../../../electron/jm-challenge-recovery', () => ({
  isJmChallengeError: vi.fn().mockReturnValue(false),
  recoverJmChallenge: vi.fn(),
  recoverJmFavouritesSilently: mockRecoverJmFavouritesSilently,
  shouldPreferSilentJmSnapshotRecovery: mockShouldPreferSilentJmSnapshotRecovery,
  buildSilentJmFavouritesUrl: mockBuildSilentJmFavouritesUrl,
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
    mockShouldPreferSilentJmSnapshotRecovery.mockReturnValue(false)
    mockBuildSilentJmFavouritesUrl.mockReturnValue(null)
    mockRecoverJmFavouritesSilently.mockReset()
    // Flush microtasks from import to ensure registerIPCHandlers has run
    await flushMicrotasks()
  })

  describe('IPC handler registration', () => {
    let initBridgeCalls: unknown[][] = []

    beforeAll(() => {
      initBridgeCalls = [...mockBridgeCall.mock.calls]
    })

    it('should register all IPC handlers', () => {
      // 74 total
      const count = handleCalls.length
      expect(count).toBe(74)
    })

    it('should call get_config on startup to sync notification settings', () => {
      expect(initBridgeCalls.some(call => call[0] === 'get_config')).toBe(true)
    })

    const expectedChannels = [
      'python:search',
      'python:random',
      'python:download-batch-as-album',
      'python:download',
      'python:check-download-conflict',
      'python:get-favourites',
      'python:get-config',
      'python:set-config',
      'python:get-downloads',
      'python:cancel-download',
      'python:apply-auth',
      'python:verify-auth',
      'python:shutdown',
      'python:fetch-cover',
      'python:fetch-preview-image',
      'open-external',
      'python:pause-task',
      'python:resume-task',
      'python:retry-task',
      'python:toggle-global-pause',
      'python:get-proxy-status',
      'python:get-available-fonts',
      'python:open-download-dir',
      'python:get-download-detail',
      'python:get-preview-urls',
      'python:check-downloaded-status',
      'python:get-comic-detail',
      'python:start-migration',
      'python:confirm-migration',
      'python:pause-migration',
      'python:resume-migration',
      'python:cancel-migration',
      'python:get-migration-status',
      'python:resolve-unmatched',
      'python:add-to-favourites',
      'python:get-cache-stats',
      'python:get-cache-dir',
      'python:open-cache-dir',
      'python:clear-preview-cache',
      'python:clear-all-cache',
      'python:get-favourite-tags',
      'python:clear-favourite-tags',
      'python:remove-favourite-tag',
      'python:sync-favourite-tags',
      'python:get-tag-list',
      'python:refresh-tag-list',
      'select-directory',
      'open-login-window',
      'python:force-pack-album',
      'python:get-album-progress',
      'python:get-chapter-preview-urls',
      'python:check-favourite',
      'python:get-history',
      'python:add-history',
      'python:delete-history',
      'python:clear-history',
      'python:bika-categories',
      'python:moeimg-login',
      'python:bika-login',
      'python:hcomic-login',
      'python:nh-login',
      'python:run-health-check',
      'python:scan-orphan-temps',
      'python:cleanup-orphan-temps',
      'python:get-storage-stats',
      'update:check',
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
        'search', 'random', 'download', 'download_batch_as_album', 'check_download_conflict', 'get_favourites', 'get_config', 'set_config',
        'get_downloads', 'cancel_download', 'apply_auth', 'verify_auth', 'shutdown',
        'fetch_cover', 'fetch_preview_image', 'pause_task', 'resume_task', 'retry_task', 'toggle_global_pause',
        'get_proxy_status', 'get_available_fonts', 'open_download_dir', 'get_download_detail', 'get_preview_urls',
        'get_chapter_preview_urls',
        'check_downloaded_status', 'start_migration', 'confirm_migration', 'pause_migration', 'resume_migration',
        'cancel_migration', 'get_migration_status', 'resolve_unmatched',
        'add_to_favourites', 'check_favourite', 'remove_from_favourites',
        'get_cache_stats', 'get_cache_dir', 'get_image_cache_dirs', 'open_cache_dir', 'clear_preview_cache', 'clear_all_cache',
        'get_history', 'add_history', 'delete_history', 'clear_history',
        'get_comic_detail', 'get_favourite_tags', 'clear_favourite_tags', 'remove_favourite_tag',
        'sync_favourite_tags', 'get_tag_list', 'refresh_tag_list',
        'moeimg_login', 'bika_login', 'bika_categories', 'hcomic_login', 'nh_login', 'get_jm_domains',
        'force_pack_album', 'get_album_progress',
        'pause_album', 'resume_album', 'cancel_album',
        'run_health_check', 'scan_orphan_temps', 'cleanup_orphan_temps', 'get_storage_stats',
      ])
      for (const [channel, method] of Object.entries(PYTHON_IPC_CHANNEL_MAP)) {
        expect(validMethods.has(method),
          `PYTHON_IPC_CHANNEL_MAP["${channel}"] = "${method}" is not a known Python handler`
        ).toBe(true)
      }
    })

    it('every IPC_CHANNELS value (including OPEN_EXTERNAL) must be registered', () => {
      const registeredSet = new Set(handleCalls.map(h => h.channel))
      // 登录弹窗叠层专用通道：在 login-window.ts 的 openLoginWindow 内按需注册
      // （模态、单窗口、随窗口生命周期反注册），不在 main.ts 的 registerIPCHandlers。
      const loginOverlayChannels = new Set<string>([
        IPC_CHANNELS.LOGIN_EXTRACT,
        IPC_CHANNELS.LOGIN_FINISH,
      ])
      for (const ch of Object.values(IPC_CHANNELS)) {
        if (loginOverlayChannels.has(ch)) continue
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

    it('python:fetch-preview-image delegates with imageUrl transformed to image_url', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:fetch-preview-image')!
      const imageUrl = 'https://h-comic.link/api/nh/media123/pages/1'
      await handler.handler({}, imageUrl)

      expect(mockBridgeCall).toHaveBeenCalledWith('fetch_preview_image', {
        image_url: imageUrl
      })
    })

    it('python:fetch-preview-image accepts h-comic.com image URLs', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:fetch-preview-image')!
      const imageUrl = 'https://h-comic.com/api/nh/media123/pages/1'
      await handler.handler({}, imageUrl)

      expect(mockBridgeCall).toHaveBeenCalledWith('fetch_preview_image', {
        image_url: imageUrl
      })
    })

    it('python:get-preview-urls delegates comicData to bridge', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:get-preview-urls')!
      const comicData = {
        id: 'comic-123',
        title: 'Preview Comic',
        url: 'https://h-comic.com/comics/example?id=comic-123',
        source: 'NH',
        sourceSite: 'hcomic',
        pages: 0,
        mediaId: '',
      }
      await handler.handler({}, comicData)

      expect(mockBridgeCall).toHaveBeenCalledWith('get_preview_urls', {
        comic_data: comicData
      })
    })

    it('python:get-favourites delegates with no params', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:get-favourites')!
      await handler.handler({})

      expect(mockBridgeCall).toHaveBeenCalledWith('get_favourites', { page: 1 })
    })

    it('python:get-favourites uses silent JM snapshot recovery before Python when enabled', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:get-favourites')!
      const result = { comics: [{ id: '2' }], needsLogin: false }
      mockShouldPreferSilentJmSnapshotRecovery.mockReturnValue(true)
      mockBuildSilentJmFavouritesUrl.mockReturnValue('https://18comic.vip/user/u/favorite/albums?page=2')
      mockRecoverJmFavouritesSilently.mockResolvedValueOnce({ resolved: true, result })

      await expect(handler.handler({}, 2, 'jm', true)).resolves.toEqual(result)

      expect(mockBridgeCall).not.toHaveBeenCalledWith('get_favourites', expect.anything())
      expect(mockRecoverJmFavouritesSilently).toHaveBeenCalledWith(
        expect.objectContaining({ mainWindow: expect.anything() }),
        'https://18comic.vip/user/u/favorite/albums?page=2',
        2,
      )
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

    it('python:apply-auth delegates with curlText transformed to curl_text', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:apply-auth')!
      const curlStr = 'curl -H "Cookie: test=123" https://example.com'
      await handler.handler({}, curlStr)

      expect(mockBridgeCall).toHaveBeenCalledWith('apply_auth', {
        curl_text: curlStr
      })
    })

    it('python:apply-auth forwards source to bridge when provided', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:apply-auth')!
      const curlStr = 'curl -H "Cookie: test=123" https://example.com'
      await handler.handler({}, curlStr, 'jm')

      expect(mockBridgeCall).toHaveBeenCalledWith('apply_auth', {
        curl_text: curlStr,
        source: 'jm'
      })
    })

    it('python:verify-auth delegates with no params', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:verify-auth')!
      await handler.handler({})

      expect(mockBridgeCall).toHaveBeenCalledWith('verify_auth', {})
    })

    it('python:verify-auth forwards source to bridge when provided', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:verify-auth')!
      await handler.handler({}, 'jm')

      expect(mockBridgeCall).toHaveBeenCalledWith('verify_auth', { source: 'jm' })
    })
  })

  describe('app lifecycle', () => {
    // 注：已移除 'should call app.whenReady on import' 用例 —— 裸 toHaveBeenCalled()
    // 同义反复：import '../../../electron/main' 已隐式触发 whenReady 调用，此断言不提供
    // 超越 import 行为的独立信号。下方监听器注册断言验证真实副作用，保留。

    it('should register window-all-closed listener', () => {
      expect(app.on).toHaveBeenCalledWith('window-all-closed', expect.any(Function))
    })

    it('should register activate listener', () => {
      expect(app.on).toHaveBeenCalledWith('activate', expect.any(Function))
    })

    it('should register before-quit listener that shuts down bridge', () => {
      expect(app.on).toHaveBeenCalledWith('before-quit', expect.any(Function))
    })
  })

  describe('Input validation', () => {
    it('python:search should reject invalid query', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:search')!
      await expect(handler.handler({}, 123, 'keyword', 1)).rejects.toThrow('Invalid search query')
    })

    it('python:search should allow empty query for homepage search', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:search')!
      await handler.handler({}, '', 'keyword', 1)
      expect(mockBridgeCall).toHaveBeenCalledWith('search', {
        query: '',
        mode: 'keyword',
        page: 1
      })
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

    it('python:run-health-check should reject non-array comicKeys (object)', async () => {
      // Critical #3 回归：旧实现用 object() 断言会让 {foo:1} 这类非数组对象误判通过
      const handler = handleCalls.find(h => h.channel === 'python:run-health-check')!
      await expect(handler.handler({}, 'selected', { foo: 1 }))
        .rejects.toThrow('comicKeys must be an array')
    })

    it('python:run-health-check should reject comicKey with control chars', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:run-health-check')!
      await expect(
        handler.handler({}, 'selected', [['hcomic', 'id\ninjection', 'NH']])
      ).rejects.toThrow('runHealthCheck comicKey element')
    })

    it('python:run-health-check should reject comicKey with wrong arity', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:run-health-check')!
      // key.length 必须 3-8
      await expect(handler.handler({}, 'selected', [['only-one']]))
        .rejects.toThrow('Each comicKey must be an array of 3-8 strings')
    })

    it('python:run-health-check should accept valid payload', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:run-health-check')!
      await handler.handler({}, 'all')
      expect(mockBridgeCall).toHaveBeenCalledWith('run_health_check', { scope: 'all' })
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

    // 回归：WRITE_CLIPBOARD 必须在主进程独立校验，不依赖 preload 透传的 TS 类型签名
    // （IPC 间类型签名不是安全边界）。校验与项目其他 IPC handler 的"主进程权威校验"契约对齐。
    it('system:write-clipboard should reject non-string text', async () => {
      const handler = handleCalls.find(h => h.channel === 'system:write-clipboard')!
      await expect(handler.handler({}, { foo: 'bar' })).rejects.toThrow('Invalid clipboard text')
      await expect(handler.handler({}, 12345)).rejects.toThrow('Invalid clipboard text')
    })

    it('system:write-clipboard should reject empty text', async () => {
      const handler = handleCalls.find(h => h.channel === 'system:write-clipboard')!
      await expect(handler.handler({}, '')).rejects.toThrow('Invalid clipboard text')
    })

    it('system:write-clipboard should reject text over 2MB', async () => {
      const handler = handleCalls.find(h => h.channel === 'system:write-clipboard')!
      await expect(handler.handler({}, 'x'.repeat(2_000_001))).rejects.toThrow('Invalid clipboard text')
    })

    it('system:write-clipboard should accept valid text and call clipboard.writeText', async () => {
      const { clipboard } = await import('electron')
      const handler = handleCalls.find(h => h.channel === 'system:write-clipboard')!
      await handler.handler({}, 'normal text')
      expect(clipboard.writeText).toHaveBeenCalledWith('normal text')
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
      const willNavigateCall = wcOnCalls.find((c: unknown[]) => c[0] === 'will-navigate')
      expect(willNavigateCall).toBeDefined()
    })

    it('should register did-fail-load handler on webContents', async () => {
      await flushMicrotasks()
      const instance = capturedInstances[0]
      const wcOnCalls = instance.webContents.on.mock.calls
      const didFailLoadCall = wcOnCalls.find((c: unknown[]) => c[0] === 'did-fail-load')
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
      const willNavigateCall = wcOnCalls.find((c: unknown[]) => c[0] === 'will-navigate')
      const event = { preventDefault: vi.fn() }
      willNavigateCall[1](event, 'https://evil.com')
      // 断言性次数：will-navigate 对外部 URL 恰好阻止一次（安全行为，防导航绕过）
      expect(event.preventDefault).toHaveBeenCalledTimes(1)
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
        .rejects.toThrow('Invalid value for concurrentDownloads')
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

    it('should accept and forward missingBlacklist (regression: was rejected as unknown key)', async () => {
      // 回归：012fdbb 新增 missingBlacklist 时漏在主进程 CONFIG_VALIDATORS 注册，
      // 导致 setConfig('missingBlacklist') 抛 "Unknown config key: missingBlacklist"，
      // 持久化静默失败（subscribeToMissingBlacklistChanges 用 .catch(()=>{}) 吞错）。
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      const value = { hcomic: [{ fingerprint: 'fp', memberCount: 3 }] }
      await handler.handler({}, 'missingBlacklist', value)
      expect(mockBridgeCall).toHaveBeenCalledWith('set_config', { key: 'missingBlacklist', value })
    })

    it('should reject invalid missingBlacklist value', async () => {
      const handler = handleCalls.find(h => h.channel === 'python:set-config')!
      await expect(handler.handler({}, 'missingBlacklist', { hcomic: 'not-array' }))
        .rejects.toThrow('Invalid value for missingBlacklist')
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

  describe('notification behavior', () => {
    beforeEach(() => {
      MockNotification.mockClear()
      MockNotification.isSupported.mockReturnValue(true)
    })

    it('should NOT send notification when notifyOnComplete is false', async () => {
      const setConfigHandler = handleCalls.find(h => h.channel === 'python:set-config')!.handler
      await setConfigHandler({}, 'notifyOnComplete', false)

      const callback = notificationHandlers['download_progress']
      expect(callback).toBeDefined()
      callback({
        taskId: 'test-notify-off',
        status: 'completed',
        progress: 100,
        current: 10,
        total: 10,
        title: 'Test Comic',
      })

      expect(MockNotification).not.toHaveBeenCalled()
    })

    it('should send notification when notifyOnComplete is true and all tasks done', async () => {
      const setConfigHandler = handleCalls.find(h => h.channel === 'python:set-config')!.handler
      await setConfigHandler({}, 'notifyOnComplete', true)

      const callback = notificationHandlers['download_progress']

      // Add active task to the set
      callback({
        taskId: 'test-notify-on',
        status: 'downloading',
        progress: 50,
        current: 5,
        total: 10,
        title: 'Active Comic',
      })

      // Complete the task — should trigger batch notification
      callback({
        taskId: 'test-notify-on',
        status: 'completed',
        progress: 100,
        current: 10,
        total: 10,
        title: 'Active Comic',
      })

      expect(MockNotification).toHaveBeenCalledTimes(1)
      expect(MockNotification).toHaveBeenCalledWith({
        title: 'HComicDownloader',
        body: '下载完成：Active Comic',
      })
    })

    it('should NOT send notification when isSupported returns false', async () => {
      MockNotification.isSupported.mockReturnValue(false)
      const setConfigHandler = handleCalls.find(h => h.channel === 'python:set-config')!.handler
      await setConfigHandler({}, 'notifyOnComplete', true)

      const callback = notificationHandlers['download_progress']
      callback({ taskId: 'test-unsupported', status: 'downloading', progress: 50, current: 5, total: 10, title: 'Any' })
      callback({ taskId: 'test-unsupported', status: 'completed', progress: 100, current: 10, total: 10, title: 'Any' })

      expect(MockNotification).not.toHaveBeenCalled()
    })

    it('should batch multiple completed tasks into a single notification', async () => {
      const setConfigHandler = handleCalls.find(h => h.channel === 'python:set-config')!.handler
      await setConfigHandler({}, 'notifyOnComplete', true)

      const callback = notificationHandlers['download_progress']

      // Start two tasks
      callback({ taskId: 't1', status: 'downloading', progress: 50, current: 5, total: 10, title: 'Comic A' })
      callback({ taskId: 't2', status: 'downloading', progress: 30, current: 3, total: 10, title: 'Comic B' })

      // Complete both
      callback({ taskId: 't1', status: 'completed', progress: 100, current: 10, total: 10, title: 'Comic A' })
      callback({ taskId: 't2', status: 'completed', progress: 100, current: 10, total: 10, title: 'Comic B' })

      expect(MockNotification).toHaveBeenCalledTimes(1)
      expect(MockNotification).toHaveBeenCalledWith({
        title: 'HComicDownloader',
        body: '批量下载完成：成功 2 本',
      })
    })

    it('should include failed tasks in batch notification body', async () => {
      const setConfigHandler = handleCalls.find(h => h.channel === 'python:set-config')!.handler
      await setConfigHandler({}, 'notifyOnComplete', true)

      const callback = notificationHandlers['download_progress']

      // Start an active task to prevent premature notification
      callback({ taskId: 't-active', status: 'downloading', progress: 0, current: 0, total: 10, title: 'Active' })
      callback({ taskId: 't1', status: 'completed', progress: 100, current: 10, total: 10, title: 'Comic A' })
      callback({ taskId: 't2', status: 'failed', progress: 50, current: 5, total: 10, title: 'Comic B' })

      // Complete the active task to trigger batch
      callback({ taskId: 't-active', status: 'completed', progress: 100, current: 10, total: 10, title: 'Active' })

      expect(MockNotification).toHaveBeenCalledTimes(1)
      expect(MockNotification).toHaveBeenCalledWith({
        title: 'HComicDownloader',
        body: '批量下载完成：成功 2 本，失败 1 本',
      })
    })

    it('should not notify while tasks are still active', async () => {
      const setConfigHandler = handleCalls.find(h => h.channel === 'python:set-config')!.handler
      await setConfigHandler({}, 'notifyOnComplete', true)

      const callback = notificationHandlers['download_progress']

      // One task completes, one still downloading
      callback({ taskId: 't1', status: 'downloading', progress: 50, current: 5, total: 10, title: 'Comic A' })
      callback({ taskId: 't2', status: 'completed', progress: 100, current: 10, total: 10, title: 'Comic B' })

      // No notification yet — t1 is still active
      expect(MockNotification).not.toHaveBeenCalled()

      // Now t1 completes — triggers batch
      callback({ taskId: 't1', status: 'completed', progress: 100, current: 10, total: 10, title: 'Comic A' })
      expect(MockNotification).toHaveBeenCalledTimes(1)
    })

    it('should not send notification when window is focused and mode is inactive', async () => {
      const setConfigHandler = handleCalls.find(h => h.channel === 'python:set-config')!.handler
      await setConfigHandler({}, 'notifyWhenForeground', 'inactive')

      const instance = capturedInstances[0]
      instance.isFocused = vi.fn().mockReturnValue(true)

      const callback = notificationHandlers['download_progress']
      callback({ taskId: 't1', status: 'completed', progress: 100, current: 10, total: 10, title: 'Comic A' })

      expect(MockNotification).not.toHaveBeenCalled()
    })

    it('should send notification when window is focused and mode is always', async () => {
      const setConfigHandler = handleCalls.find(h => h.channel === 'python:set-config')!.handler
      await setConfigHandler({}, 'notifyWhenForeground', 'always')

      const instance = capturedInstances[0]
      instance.isFocused = vi.fn().mockReturnValue(true)

      const callback = notificationHandlers['download_progress']
      callback({ taskId: 't1', status: 'completed', progress: 100, current: 10, total: 10, title: 'Comic A' })

      expect(MockNotification).toHaveBeenCalledTimes(1)
    })
  })

  describe('window close flow', () => {
    it('should destroy window immediately when no active downloads', async () => {
      mockBridgeCall.mockResolvedValue({ tasks: [] })
      const instance = capturedInstances[0]

      // Find the close handler
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const closeCall = instance.on.mock.calls.find((c: any) => c[0] === 'close')
      expect(closeCall).toBeDefined()
      const closeHandler = closeCall![1]

      const mockEvent = { preventDefault: vi.fn() }
      await closeHandler(mockEvent)

      expect(mockEvent.preventDefault).toHaveBeenCalled()
    })

    it('should show dialog when active downloads exist', async () => {
      mockBridgeCall.mockResolvedValue({
        tasks: [{ status: 'downloading' }, { status: 'queued' }]
      })

      const { dialog } = await import('electron')
      vi.mocked(dialog.showMessageBoxSync).mockReturnValue(1) // User cancels quit

      const instance = capturedInstances[0]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const closeCall = instance.on.mock.calls.find((c: any) => c[0] === 'close')
      const closeHandler = closeCall![1]

      const mockEvent = { preventDefault: vi.fn() }
      await closeHandler(mockEvent)

      expect(dialog.showMessageBoxSync).toHaveBeenCalledWith(
        instance,
        expect.objectContaining({
          type: 'question',
          buttons: ['取消下载并退出', '继续下载'],
        })
      )
    })

    it('should trigger app.quit when user confirms exit with active downloads', async () => {
      mockBridgeCall.mockResolvedValue({
        tasks: [{ status: 'downloading' }]
      })

      const { dialog, app } = await import('electron')
      vi.mocked(dialog.showMessageBoxSync).mockReturnValue(0) // User confirms quit

      const instance = capturedInstances[0]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const closeCall = instance.on.mock.calls.find((c: any) => c[0] === 'close')
      const closeHandler = closeCall![1]

      const mockEvent = { preventDefault: vi.fn() }
      await closeHandler(mockEvent)

      // 断言性次数：用户确认退出（有活跃下载）恰好触发一次 app.quit
      expect(app.quit).toHaveBeenCalledTimes(1)
    })
  })

  describe('favourite tags progress forwarding', () => {
    it('should register favourite_tags_progress notification handler', () => {
      // registerNotificationHandlers 必须为 favourite_tags_progress 注册专用转发处理器
      expect(notificationHandlers['favourite_tags_progress']).toBeDefined()
    })

    it('should forward favourite_tags_progress to FAVOURITE_TAGS_PROGRESS renderer channel', () => {
      const instance = capturedInstances[0]
      const callback = notificationHandlers['favourite_tags_progress']
      const payload = { source: 'hcomic', phase: 'fetching', current: 1, total: 3 }

      callback(payload)

      // 必须转发到专用 FAVOURITE_TAGS_PROGRESS 通道（而非 TAG_LIST_PROGRESS）
      expect(instance.webContents.send).toHaveBeenCalledWith('favourite-tags:progress', payload)
      expect(instance.webContents.send).not.toHaveBeenCalledWith('tag-list:progress', payload)
    })
  })

})
