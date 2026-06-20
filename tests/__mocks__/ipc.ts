import { vi } from 'vitest'
import type { HcomicAPI } from '../../shared/types'

export function createMockIpcInvoke(responses: Record<string, unknown> = {}) {
  return vi.fn().mockImplementation((channel: string, ...args: unknown[]) => {
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
export function createMockHcomic(overrides: Partial<Record<keyof HcomicAPI, unknown>> = {}) {
  const mockMethods: HcomicAPI = {
    search: vi.fn().mockResolvedValue({ comics: [], pagination: { currentPage: 1, totalPages: 0, totalItems: 0 } }),
    random: vi.fn().mockResolvedValue({ comics: [], pagination: { currentPage: 1, totalPages: 0, totalItems: 0 } }),
    downloadBatchAsAlbum: vi.fn().mockResolvedValue({ taskIds: [], queuedTasks: [], status: 'queued' }),
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
    selectDirectory: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
    getDownloadDetail: vi.fn().mockResolvedValue({ taskId: '', tempDir: '', errorMessage: '', outputPath: '' }),
    getPreviewUrls: vi.fn().mockResolvedValue({ imageUrls: [], totalPages: 0 }),
    getChapterPreviewUrls: vi.fn().mockResolvedValue({ imageUrls: [], totalPages: 0 }),
    checkDownloadedStatus: vi.fn().mockResolvedValue({ statusMap: {} }),
    getComicDetail: vi.fn().mockResolvedValue({ comic: null }),
    checkFavourite: vi.fn().mockResolvedValue({ isFavourited: false }),
    addToFavourites: vi.fn().mockResolvedValue({ success: true }),
    removeFromFavourites: vi.fn().mockResolvedValue({ success: true }),
    startMigration: vi.fn().mockResolvedValue({ migrationId: '', totalItems: 0, sourceDir: '', targetDir: '', isSameDrive: true }),
    confirmMigration: vi.fn().mockResolvedValue({ started: true }),
    pauseMigration: vi.fn().mockResolvedValue({ paused: true }),
    resumeMigration: vi.fn().mockResolvedValue({ resumed: true }),
    cancelMigration: vi.fn().mockResolvedValue({ cancelled: true }),
    getMigrationStatus: vi.fn().mockResolvedValue({ status: 'none' }),
    resolveUnmatched: vi.fn().mockResolvedValue({ resolved: 0 }),
    onMigrationProgress: vi.fn().mockReturnValue(vi.fn()),
    onMigrationComplete: vi.fn().mockReturnValue(vi.fn()),
    onMigrationError: vi.fn().mockReturnValue(vi.fn()),
    onStartupProgress: vi.fn().mockReturnValue(vi.fn()),
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
