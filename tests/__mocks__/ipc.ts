import { vi } from 'vitest'
import type { HcomicAPI } from '../../shared/types'

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

/**
 * Create a mock window.hcomic API with individual method mocks.
 * Each method is a vi.fn that you can assert against.
 */
export function createMockHcomic(overrides: Partial<Record<keyof HcomicAPI, any>> = {}) {
  const mockMethods: HcomicAPI = {
    search: vi.fn().mockResolvedValue({ comics: [], pagination: { currentPage: 1, totalPages: 0, totalItems: 0 } }),
    download: vi.fn().mockResolvedValue({ taskId: 'mock-task', status: 'queued' }),
    checkDownloadConflict: vi.fn().mockResolvedValue({ hasConflict: false, path: '' }),
    getFavourites: vi.fn().mockResolvedValue({ comics: [], pagination: null, needsLogin: false }),
    getConfig: vi.fn().mockResolvedValue({ config: {} }),
    setConfig: vi.fn().mockResolvedValue({ success: true }),
    getDownloads: vi.fn().mockResolvedValue({ tasks: [] }),
    cancelDownload: vi.fn().mockResolvedValue({ success: true }),
    applyAuth: vi.fn().mockResolvedValue({ success: true }),
    verifyAuth: vi.fn().mockResolvedValue({ valid: false, message: '' }),
    shutdown: vi.fn().mockResolvedValue({ success: true, cancelledTasks: 0 }),
    fetchCover: vi.fn().mockResolvedValue({ dataUri: 'data:image/png;base64,mock' }),
    fetchPreviewImage: vi.fn().mockResolvedValue({ dataUri: 'data:image/png;base64,mock' }),
    openUrl: vi.fn().mockResolvedValue(undefined),
    onDownloadProgress: vi.fn().mockReturnValue(vi.fn()),
    pauseTask: vi.fn().mockResolvedValue({ success: true }),
    resumeTask: vi.fn().mockResolvedValue({ success: true }),
    retryTask: vi.fn().mockResolvedValue({ success: true }),
    toggleGlobalPause: vi.fn().mockResolvedValue({ isPaused: false }),
    getProxyStatus: vi.fn().mockResolvedValue({ http: '', https: '', noProxy: '' }),
    getAvailableFonts: vi.fn().mockResolvedValue({ fonts: [] }),
    openDownloadDir: vi.fn().mockResolvedValue({ success: true }),
    getDownloadDetail: vi.fn().mockResolvedValue({ taskId: '', tempDir: '', errorMessage: '', outputPath: '' }),
    getPreviewUrls: vi.fn().mockResolvedValue({ imageUrls: [], totalPages: 0 }),
    ...overrides,
  }

  Object.defineProperty(window, 'hcomic', {
    value: mockMethods,
    writable: true,
    configurable: true,
  })

  return mockMethods
}

/** @deprecated Use createMockHcomic instead */
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
