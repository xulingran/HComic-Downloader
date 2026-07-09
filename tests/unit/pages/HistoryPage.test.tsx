import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComicInfo, HistoryItem } from '@shared/types'

const { mockGetHistory, mockDeleteHistory, mockClearHistory, mockOpenReader } = vi.hoisted(() => ({
  mockGetHistory: vi.fn(),
  mockDeleteHistory: vi.fn(),
  mockClearHistory: vi.fn(),
  mockOpenReader: vi.fn(),
}))

vi.mock('@/hooks/useIpc', () => ({
  useHistory: vi.fn().mockReturnValue({
    getHistory: mockGetHistory,
    deleteHistory: mockDeleteHistory,
    clearHistory: mockClearHistory,
  }),
  useDownloadProgress: vi.fn().mockReturnValue({ progress: {} }),
}))

vi.mock('@/hooks/useDownloadHelper', () => ({
  useDownloadHelper: vi.fn().mockReturnValue({
    downloadWithConflictCheck: vi.fn(),
    downloadChapters: vi.fn(),
  }),
  useChapterProbe: vi.fn().mockReturnValue({
    probeChaptersBeforeDownload: vi.fn().mockResolvedValue(null),
  }),
}))

vi.mock('@/stores/useDownloadStore', () => ({
  useDownloadStore: vi.fn().mockReturnValue([]),
}))

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: vi.fn(),
}))

vi.mock('@/hooks/useCoverImage', () => ({
  useCoverImage: vi.fn().mockReturnValue({ coverSrc: null, retry: vi.fn() }),
}))

const { mockHistoryStore } = vi.hoisted(() => ({
  mockHistoryStore: {
    pages: {} as Record<number, unknown>,
    currentPage: 1,
    hasCache: false,
    setPage: vi.fn(),
    getPage: vi.fn(),
    hasPage: vi.fn().mockReturnValue(false),
    clearCache: vi.fn(),
  },
}))

vi.mock('@/stores/useHistoryStore', () => ({
  useHistoryStore: vi.fn().mockReturnValue(mockHistoryStore),
}))

vi.mock('@/stores/useReaderStore', () => ({
  useReaderStore: vi.fn().mockReturnValue({
    openReader: mockOpenReader,
  }),
}))

vi.mock('@/components/common/ComicCard', () => ({
  ComicCard: ({ comic }: { comic: ComicInfo }) => (
    <div data-testid="comic-card">{comic.title}</div>
  ),
  CoverImage: ({ coverUrl }: { coverUrl: string }) => (
    <div data-testid="cover-image" data-cover-url={coverUrl || ''} />
  ),
  DownloadAction: () => (
    <div data-testid="download-action" />
  ),
}))

import { HistoryPage } from '@/pages/HistoryPage'
import { useSettingsStore } from '@/stores/useSettingsStore'

const mockUseSettingsStore = vi.mocked(useSettingsStore)

function makeHistoryItem(overrides: Partial<HistoryItem>): HistoryItem {
  return {
    id: 1,
    comicId: 'comic-1',
    title: 'History Comic',
    coverUrl: '',
    source: 'NH',
    sourceSite: 'hcomic',
    mediaId: 'media-1',
    sourceUrl: 'https://example.com/comic-1',
    lastPage: 1,
    totalPages: 10,
    lastReadAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

// 控制某次 getHistory 的返回时机，用于让翻页加载挂起以观测遮罩
function createDeferredHistory() {
  let resolve!: (value: { items: HistoryItem[]; pagination: { currentPage: number; totalPages: number; totalItems: number } }) => void
  const promise = new Promise<{ items: HistoryItem[]; pagination: { currentPage: number; totalPages: number; totalItems: number } }>((res) => { resolve = res })
  return { promise, resolve }
}

describe('HistoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSettingsStore.mockReturnValue({ cardStyle: 'cover', sfwMode: false })
    mockGetHistory.mockResolvedValue({
      items: [],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 0 },
    })
    mockHistoryStore.pages = {}
    mockHistoryStore.currentPage = 1
    mockHistoryStore.hasCache = false
    mockHistoryStore.setPage.mockReset()
    mockHistoryStore.getPage.mockReset()
    mockHistoryStore.hasPage.mockReset()
    mockHistoryStore.hasPage.mockReturnValue(false)
    mockHistoryStore.clearCache.mockReset()
  })

  it('shows source site labels for history records', async () => {
    mockGetHistory.mockResolvedValue({
      items: [
        makeHistoryItem({ id: 1, comicId: 'h-1', title: 'HComic Item', sourceSite: 'hcomic' }),
        makeHistoryItem({ id: 2, comicId: 'm-1', title: 'Moeimg Item', sourceSite: 'moeimg' }),
        makeHistoryItem({ id: 3, comicId: 'j-1', title: 'JMComic Item', sourceSite: 'jm' }),
      ],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 3 },
    })

    render(<HistoryPage />)

    await screen.findByText('HComic Item')

    expect(screen.getByText('HComic')).toBeInTheDocument()
    expect(screen.getByText('Moeimg')).toBeInTheDocument()
    expect(screen.getByText('JM')).toBeInTheDocument()
  })

  it('shows cached history page immediately and refreshes it in background', async () => {
    mockHistoryStore.hasPage.mockReturnValue(true)
    mockGetHistory.mockResolvedValueOnce({
      items: [makeHistoryItem({ id: 1, comicId: 'current', title: 'Current History' })],
      pagination: { currentPage: 1, totalPages: 3, totalItems: 30 },
    }).mockReturnValueOnce(new Promise(() => {}))
    mockHistoryStore.getPage.mockImplementation((page: number) => {
      if (page !== 2) return undefined
      return {
        items: [makeHistoryItem({ id: 2, comicId: 'cached', title: 'Cached History' })],
        pagination: { currentPage: 2, totalPages: 3, totalItems: 30 },
        currentPage: 2,
      }
    })

    render(<HistoryPage />)

    await userEvent.click((await screen.findAllByText('下一页'))[0])

    expect(await screen.findByText('Cached History')).toBeInTheDocument()
    expect(mockGetHistory).toHaveBeenCalledWith(2)
  })

  it('preloads nearby history pages after current page is loaded', async () => {
    mockGetHistory.mockResolvedValue({
      items: [makeHistoryItem({ id: 5, comicId: 'current', title: 'Current History' })],
      pagination: { currentPage: 5, totalPages: 10, totalItems: 100 },
    })

    render(<HistoryPage />)

    await screen.findByText('Current History')
    await waitFor(() => expect(mockGetHistory).toHaveBeenCalledWith(6))
  })

  it('首次加载（无旧结果）显示居中 spinner，无遮罩层', async () => {
    // getHistory 挂起 → isLoading 持续 true，且 items 为空 → 走居中 spinner 分支
    mockGetHistory.mockReturnValue(new Promise(() => {}))

    render(<HistoryPage />)

    // 居中 spinner + 文案可见
    expect(screen.getByText('加载中...')).toBeInTheDocument()
    expect(document.querySelector('.rounded-full.motion-safe\\:animate-spin')).not.toBeNull()
    // 无遮罩层（LoadingOverlay 的 fixed inset-0 backdrop-blur）
    expect(document.querySelector('.fixed.inset-0.backdrop-blur-\\[8px\\]')).toBeNull()
  })

  it('翻页未命中缓存时保留旧网格并叠加 light 档遮罩（backdrop-blur-[8px] + spinner）', async () => {
    // 首屏第 1 页立即返回带分页结果（旧内容 + 翻页按钮），第 2 页未命中缓存且加载挂起
    const deferredPage2 = createDeferredHistory()
    mockGetHistory.mockImplementation((page: number) =>
      page === 2
        ? deferredPage2.promise
        : Promise.resolve({
          items: [makeHistoryItem({ id: 1, comicId: 'old', title: 'Old History' })],
          pagination: { currentPage: 1, totalPages: 3, totalItems: 30 },
        })
    )

    render(<HistoryPage />)
    await screen.findByText('Old History')

    // 翻页到第 2 页（无缓存 → 加载挂起 → 旧网格保留 + 遮罩）
    await userEvent.click((await screen.findAllByText('下一页'))[0])

    // 旧结果仍渲染（未被卸载）
    expect(screen.getByText('Old History')).toBeInTheDocument()
    // LoadingOverlay light 档：backdrop-blur-[8px] + bg/80 + spinner
    const overlay = document.querySelector('.fixed.inset-0.backdrop-blur-\\[8px\\]') as HTMLElement | null
    expect(overlay).not.toBeNull()
    expect(overlay?.className).toContain('bg-[var(--bg-primary)]/80')
    expect(overlay?.querySelector('.rounded-full.motion-safe\\:animate-spin')).not.toBeNull()
    expect(overlay?.textContent).toContain('加载中')

    deferredPage2.resolve({ items: [], pagination: { currentPage: 2, totalPages: 3, totalItems: 30 } })
    await act(async () => { await deferredPage2.promise.catch(() => {}) })
  })

  it('renders cover thumbnail in detailed card style', async () => {
    mockUseSettingsStore.mockReturnValue({ cardStyle: 'detailed', sfwMode: false })
    mockGetHistory.mockResolvedValue({
      items: [makeHistoryItem({ id: 1, comicId: 'h-1', title: 'Detailed Comic', coverUrl: 'https://example.com/cover.jpg' })],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 1 },
    })

    render(<HistoryPage />)

    await screen.findByText('Detailed Comic')
    expect(screen.getByTestId('cover-image')).toBeInTheDocument()
  })
})
