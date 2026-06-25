/**
 * FavouritesPage 来源选择器三态分支测试。
 *
 * 覆盖 design.md 决策 3 的三态：
 *   ① defaultFavouriteSource 非空 → 直接加载，不弹窗
 *   ② 空 + sessionPickerShown=false → 弹出选择器，不加载
 *   ③ 空 + sessionPickerShown=true → 走缓存/空状态逻辑
 * 以及 onSelect/onClose 回调流转。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { ComicInfo } from '@shared/types'

const { mockGetFavourites, mockCheckDownloadedStatus } = vi.hoisted(() => ({
  mockGetFavourites: vi.fn(),
  mockCheckDownloadedStatus: vi.fn().mockResolvedValue({ statusMap: {} }),
}))

vi.mock('@/hooks/useIpc', () => ({
  useFavourites: vi.fn().mockReturnValue({
    getFavourites: mockGetFavourites,
    checkDownloadedStatus: mockCheckDownloadedStatus,
  }),
  useDownloadCommands: vi.fn().mockReturnValue({
    startDownload: vi.fn().mockResolvedValue({ taskId: 'test-id' }),
    cancelDownload: vi.fn(),
    getDownloads: vi.fn().mockResolvedValue({ tasks: [] }),
    checkDownloadConflict: vi.fn().mockResolvedValue({ hasConflict: false, path: '' }),
    pauseTask: vi.fn(),
    resumeTask: vi.fn(),
    retryTask: vi.fn(),
    toggleGlobalPause: vi.fn(),
    getDownloadDetail: vi.fn(),
  }),
  useAlbumCommands: vi.fn().mockReturnValue({
    forcePackAlbum: vi.fn(),
    getAlbumProgress: vi.fn(),
    pauseAlbum: vi.fn(),
    resumeAlbum: vi.fn(),
    cancelAlbum: vi.fn(),
  }),
  useDownload: vi.fn().mockReturnValue({
    startDownload: vi.fn(),
    cancelDownload: vi.fn(),
    getDownloads: vi.fn().mockResolvedValue({ tasks: [] }),
  }),
  useComicDetail: vi.fn().mockReturnValue({ getComicDetail: vi.fn().mockResolvedValue({ comic: null }) }),
  useDownloadProgress: vi.fn().mockReturnValue({ progress: {} }),
}))

const { mockSettingsStore } = vi.hoisted(() => ({
  mockSettingsStore: {
    cardStyle: 'cover' as const,
    defaultFavouriteSource: '',
    tagBlacklist: { hcomic: [], moeimg: [], jm: [], bika: [], copymanga: [] },
    filterEnabled: true,
    setFilterEnabled: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
  },
}))

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: vi.fn().mockImplementation((selector?: (s: typeof mockSettingsStore) => unknown) => {
    if (typeof selector === 'function') return selector(mockSettingsStore)
    return mockSettingsStore
  }),
}))

vi.mock('@/stores/useDownloadStore', () => ({
  useDownloadStore: vi.fn().mockReturnValue([]),
}))

const { mockFavouritesStore } = vi.hoisted(() => ({
  mockFavouritesStore: {
    caches: {} as Record<string, unknown>,
    currentSource: 'hcomic',
    currentPage: 1,
    hasCache: false,
    sessionPickerShown: false,
    setPage: vi.fn(),
    getPage: vi.fn(),
    hasPage: vi.fn().mockReturnValue(false),
    clearCache: vi.fn(),
    setCurrentSource: vi.fn(),
    markPickerShown: vi.fn(),
  },
}))

vi.mock('@/stores/useFavouritesStore', () => ({
  useFavouritesStore: vi.fn().mockImplementation((selector?: (s: typeof mockFavouritesStore) => unknown) => {
    if (typeof selector === 'function') return selector(mockFavouritesStore)
    return mockFavouritesStore
  }),
}))

vi.mock('@/components/common/ComicCard', () => ({
  ComicCard: ({ comic }: { comic: ComicInfo }) => (
    <div data-testid="comic-card">{comic.title}</div>
  ),
}))

import { FavouritesPage } from '@/pages/FavouritesPage'

describe('FavouritesPage 来源选择器三态分支', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetFavourites.mockResolvedValue({ comics: [] })
    mockCheckDownloadedStatus.mockResolvedValue({ statusMap: {} })
    mockSettingsStore.defaultFavouriteSource = ''
    mockFavouritesStore.caches = {}
    mockFavouritesStore.currentSource = 'hcomic'
    mockFavouritesStore.currentPage = 1
    mockFavouritesStore.hasCache = false
    mockFavouritesStore.sessionPickerShown = false
    mockFavouritesStore.getPage.mockReset().mockReturnValue(undefined)
    mockFavouritesStore.hasPage.mockReset().mockReturnValue(false)
    mockFavouritesStore.setCurrentSource.mockReset()
    mockFavouritesStore.markPickerShown.mockReset()
  })

  describe('① 已设默认来源：直接加载，不弹窗', () => {
    it('设置 defaultFavouriteSource=bika 时直接加载 bika 且不弹选择器', async () => {
      mockSettingsStore.defaultFavouriteSource = 'bika'
      mockGetFavourites.mockResolvedValue({ comics: [] })

      render(<FavouritesPage />)

      // 不应出现选择器
      expect(screen.queryByText('选择收藏夹来源')).not.toBeInTheDocument()
      // 应直接以 bika 加载
      await waitFor(() => {
        expect(mockGetFavourites).toHaveBeenCalledWith(1, 'bika')
      })
    })

    it('再次进入（已设默认）不弹窗', async () => {
      mockSettingsStore.defaultFavouriteSource = 'jm'
      mockGetFavourites.mockResolvedValue({ comics: [] })

      render(<FavouritesPage />)

      expect(screen.queryByText('选择收藏夹来源')).not.toBeInTheDocument()
      await waitFor(() => {
        expect(mockGetFavourites).toHaveBeenCalledWith(1, 'jm')
      })
    })
  })

  describe('② 未设默认 + 本会话首次：弹出选择器', () => {
    it('defaultFavouriteSource 为空且未弹过时显示选择器', async () => {
      mockSettingsStore.defaultFavouriteSource = ''
      mockFavouritesStore.sessionPickerShown = false

      render(<FavouritesPage />)

      await screen.findByText('选择收藏夹来源')
      // 不应发起加载
      expect(mockGetFavourites).not.toHaveBeenCalled()
    })

    it('选择来源后调用加载并标记已弹', async () => {
      mockSettingsStore.defaultFavouriteSource = ''
      mockFavouritesStore.sessionPickerShown = false
      mockGetFavourites.mockResolvedValue({
        comics: [{ id: '1', title: 'JM Fav', url: '', coverUrl: '', source: 'jm' }],
        pagination: { currentPage: 1, totalPages: 1, totalItems: 1 },
      })

      render(<FavouritesPage />)
      await screen.findByText('选择收藏夹来源')

      // 弹窗内的 JM 按钮（顶部下拉框也有同名 option，需用 dialog scope 定位）
      const dialog = screen.getByRole('dialog')
      fireEvent.click(within(dialog).getByText('JM'))

      await waitFor(() => {
        expect(mockGetFavourites).toHaveBeenCalledWith(1, 'jm')
      })
      expect(mockFavouritesStore.setCurrentSource).toHaveBeenCalledWith('jm')
      expect(mockFavouritesStore.markPickerShown).toHaveBeenCalled()
    })

    it('跳过选择器（稍后再说）后显示空状态与重开按钮，并标记已弹', async () => {
      mockSettingsStore.defaultFavouriteSource = ''
      mockFavouritesStore.sessionPickerShown = false

      render(<FavouritesPage />)
      await screen.findByText('选择收藏夹来源')

      const dialog = screen.getByRole('dialog')
      fireEvent.click(within(dialog).getByText('稍后再说'))

      // 标记已弹
      expect(mockFavouritesStore.markPickerShown).toHaveBeenCalled()
      // 不应加载
      expect(mockGetFavourites).not.toHaveBeenCalled()
      // 显示空状态与重开按钮
      await screen.findByText('请选择收藏夹来源')
      expect(screen.getByText('选择来源')).toBeInTheDocument()
    })
  })

  describe('③ 未设默认 + 已弹过：走缓存逻辑', () => {
    it('已弹过且有缓存时显示缓存内容', async () => {
      mockSettingsStore.defaultFavouriteSource = ''
      mockFavouritesStore.sessionPickerShown = true
      mockFavouritesStore.getPage.mockImplementation((_source: string, _page: number) => ({
        comics: [{ id: '2', title: 'Cached', url: '', coverUrl: '', source: 'hcomic' }],
        pagination: { currentPage: 1, totalPages: 1, totalItems: 1 },
        currentPage: 1,
        downloadedStatus: {},
      }))

      render(<FavouritesPage />)

      // 不弹窗
      expect(screen.queryByText('选择收藏夹来源')).not.toBeInTheDocument()
      // 显示缓存内容
      await screen.findByText('Cached')
    })

    it('已弹过且无缓存时不自动加载（保持空状态）', async () => {
      mockSettingsStore.defaultFavouriteSource = ''
      mockFavouritesStore.sessionPickerShown = true
      mockFavouritesStore.getPage.mockReturnValue(undefined)

      render(<FavouritesPage />)

      expect(screen.queryByText('选择收藏夹来源')).not.toBeInTheDocument()
      // 不应发起加载（等待若干 tick 确认）
      await waitFor(() => {
        expect(mockGetFavourites).not.toHaveBeenCalled()
      })
    })
  })
})
