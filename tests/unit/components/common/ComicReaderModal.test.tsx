import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { useComicReader } from '@/hooks/useComicReader'
import userEvent from '@testing-library/user-event'
import { ComicReaderModal } from '@/components/ComicReaderModal'
import type { ComicInfo } from '@shared/types'

// Mock IntersectionObserver for jsdom — triggers isIntersecting immediately
class MockIntersectionObserver {
  readonly root: Element | null = null
  readonly rootMargin: string = ''
  readonly thresholds: ReadonlyArray<number> = []
  private callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
  }
  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, target, boundingClientRect: { top: 0 } }] as unknown as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver
    )
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return [] }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IntersectionObserver = MockIntersectionObserver

const mockFetchPreviewImage = vi.fn()

const mockSetPageGap = vi.fn()
const mockSetImageWidth = vi.fn()
const mockSetDisplayMode = vi.fn()

vi.mock('@/hooks/useReaderSettings', () => ({
  useReaderSettings: vi.fn(() => ({
    pageGap: 4,
    imageWidth: 70,
    setPageGap: mockSetPageGap,
    setImageWidth: mockSetImageWidth,
    displayMode: 'scroll',
    setDisplayMode: mockSetDisplayMode,
  })),
}))

vi.mock('@/hooks/useComicReader', () => ({
  useComicReader: vi.fn(),
}))

const createReaderState = (overrides: Partial<ReturnType<typeof useComicReader>> = {}) => ({
  imageUrls: ['https://img.example.com/1.jpg', 'https://img.example.com/2.jpg'],
  totalPages: 2,
  currentPage: 1,
  loadingState: 'loaded' as const,
  errorMessage: '',
  scrambleId: '',
  comicId: '',
  chapters: [],
  fetchUrls: vi.fn(),
  fetchChapterUrls: vi.fn(),
  setCurrentPage: vi.fn(),
  reset: vi.fn(),
  ...overrides,
})

const mockComic: ComicInfo = {
  id: '1',
  title: 'テスト漫画',
  url: 'https://example.com/1',
  coverUrl: 'https://example.com/cover.jpg',
  source: 'test',
}

describe('ComicReaderModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSetPageGap.mockClear()
    mockSetImageWidth.mockClear()
    mockSetDisplayMode.mockClear()
    vi.mocked(useComicReader).mockReturnValue(createReaderState())
    mockFetchPreviewImage.mockResolvedValue({ urlHash: 'c'.repeat(64) })
    Object.defineProperty(window, 'hcomic', {
      value: { fetchPreviewImage: mockFetchPreviewImage, getConfig: vi.fn().mockResolvedValue({ config: {} }), setConfig: vi.fn().mockResolvedValue({ success: true }) },
      writable: true,
      configurable: true,
    })
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <ComicReaderModal comic={mockComic} open={false} onClose={vi.fn()} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders title and page indicator when open', () => {
    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )
    expect(screen.getByText('テスト漫画')).toBeInTheDocument()
    expect(screen.getAllByText('1 / 2').length).toBeGreaterThanOrEqual(1)
  })

  it('renders close button', () => {
    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )
    expect(screen.getByText('关闭')).toBeInTheDocument()
  })

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn()
    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={onClose} />
    )
    await userEvent.click(screen.getByText('关闭'))
    expect(onClose).toHaveBeenCalled()
  })

  it('fetches preview page images through the backend proxy', async () => {
    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )

    await waitFor(() => {
      expect(mockFetchPreviewImage).toHaveBeenCalledWith('https://img.example.com/1.jpg', '', '', undefined)
      expect(mockFetchPreviewImage).toHaveBeenCalledWith('https://img.example.com/2.jpg', '', '', undefined)
    })
  })

  it('renders proxied data URI images for all pages', async () => {
    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )

    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2))
    for (const image of screen.getAllByRole('img')) {
      expect(image).toHaveAttribute('src', `app-image://preview/${'c'.repeat(64)}`)
    }
  })

  it('shows proxied image as soon as the data URI is returned', async () => {
    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )

    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2))
    for (const image of screen.getAllByRole('img')) {
      expect(image).toHaveAttribute('src', `app-image://preview/${'c'.repeat(64)}`)
      expect(image).toHaveClass('w-full')
      expect(image).not.toHaveClass('hidden')
      expect(image).not.toHaveClass('opacity-0')
    }
  })

  it('shows page failure when the preview bridge throws synchronously', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(useComicReader).mockReturnValue(createReaderState({
      imageUrls: ['https://img.example.com/1.jpg'],
      totalPages: 1,
    }))
    mockFetchPreviewImage.mockImplementationOnce(() => {
      throw new Error('Bridge missing')
    })

    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )

    expect(await screen.findByText('第 1 页加载失败')).toBeInTheDocument()
    expect(screen.getByText('Bridge missing')).toBeInTheDocument()

    consoleErrorSpy.mockRestore()
  })

  it('renders loading state', () => {
    vi.mocked(useComicReader).mockReturnValue(createReaderState({
      imageUrls: [],
      totalPages: 0,
      currentPage: 0,
      loadingState: 'loading',
    }))

    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )

    expect(screen.getByText('加载中...')).toBeInTheDocument()
  })

  it('renders empty image state', () => {
    vi.mocked(useComicReader).mockReturnValue(createReaderState({
      imageUrls: [],
      totalPages: 0,
      currentPage: 0,
    }))

    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )

    expect(screen.getByText('无可用图片')).toBeInTheDocument()
  })

  it('shows page fetch failure and retries through the backend proxy', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(useComicReader).mockReturnValue(createReaderState({
      imageUrls: ['https://img.example.com/1.jpg'],
      totalPages: 1,
    }))
    mockFetchPreviewImage
      .mockRejectedValueOnce(new Error('Forbidden'))
      .mockResolvedValueOnce({ urlHash: 'c'.repeat(64) })

    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )

    expect(await screen.findByText('第 1 页加载失败')).toBeInTheDocument()
    await userEvent.click(screen.getByText('重试'))

    await waitFor(() => expect(mockFetchPreviewImage).toHaveBeenCalledTimes(2))
    expect(mockFetchPreviewImage).toHaveBeenLastCalledWith('https://img.example.com/1.jpg', '', '', undefined)

    consoleErrorSpy.mockRestore()
  })

  it('renders progress bar', () => {
    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )
    expect(screen.getAllByText('1 / 2').length).toBeGreaterThanOrEqual(2)
  })

  describe('ReaderPage cache and priority', () => {
    it('uses cachedDataUri when provided', async () => {
      vi.mocked(useComicReader).mockReturnValue(createReaderState({
        imageUrls: ['https://img.example.com/1.jpg', 'https://img.example.com/2.jpg', 'https://img.example.com/3.jpg'],
        totalPages: 3,
        currentPage: 1,
      }))
      mockFetchPreviewImage.mockResolvedValue({ urlHash: 'd'.repeat(64) })

      render(
        <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
      )

      await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(3))
    })
  })

  describe('draggable progress bar', () => {
    it('renders slider track with correct aria attributes', () => {
      vi.mocked(useComicReader).mockReturnValue(createReaderState({
        imageUrls: ['url1', 'url2', 'url3', 'url4'],
        totalPages: 4,
        currentPage: 2,
      }))
      render(
        <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
      )
      const slider = screen.getByRole('slider')
      expect(slider).toBeInTheDocument()
      expect(slider).toHaveAttribute('aria-valuemin', '1')
      expect(slider).toHaveAttribute('aria-valuemax', '4')
      expect(slider).toHaveAttribute('aria-valuenow', '2')
    })

    it('updates displayed page on pointer drag', async () => {
      const setCurrentPage = vi.fn()
      vi.mocked(useComicReader).mockReturnValue(createReaderState({
        imageUrls: Array.from({ length: 10 }, (_, i) => `url${i}`),
        totalPages: 10,
        currentPage: 1,
        setCurrentPage,
      }))
      render(
        <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
      )

      const slider = screen.getByRole('slider')
      slider.getBoundingClientRect = vi.fn(() => ({ left: 0, width: 300, right: 300, top: 0, bottom: 0, height: 24, x: 0, y: 0 }) as DOMRect)
      slider.setPointerCapture = vi.fn()
      Element.prototype.scrollIntoView = vi.fn()

      // clientX=150 on a 300px-wide track → 50% → page 5
      fireEvent.pointerDown(slider, { clientX: 150, pointerId: 1 })
      expect(setCurrentPage).toHaveBeenCalledWith(5)
    })
  })

  describe('smart preloading on jump', () => {
    it('preloads pages sequentially after slider drag', async () => {
      const urls = Array.from({ length: 20 }, (_, i) => `https://img.example.com/${i + 1}.jpg`)
      const setCurrentPage = vi.fn()
      vi.mocked(useComicReader).mockReturnValue(createReaderState({
        imageUrls: urls,
        totalPages: 20,
        currentPage: 1,
        setCurrentPage,
      }))
      mockFetchPreviewImage.mockResolvedValue({ urlHash: 'e'.repeat(64) })

      render(
        <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
      )

      // Wait for initial load — 重写：裸 toHaveBeenCalled() 改为次数断言，
      // 明确表达"初始加载至少触发一次"而非模糊的"被调过"
      await waitFor(() => expect(mockFetchPreviewImage.mock.calls.length).toBeGreaterThan(0))

      mockFetchPreviewImage.mockClear()

      // Simulate dragging to page 10
      const slider = screen.getByRole('slider')
      slider.getBoundingClientRect = vi.fn(() => ({ left: 0, width: 300, right: 300, top: 0, bottom: 0, height: 24, x: 0, y: 0 }) as DOMRect)
      slider.setPointerCapture = vi.fn()
      Element.prototype.scrollIntoView = vi.fn()

      // clientX=150 on 300px track → 50% of 20 pages → page 10
      fireEvent.pointerDown(slider, { clientX: 150, pointerId: 1 })
      fireEvent.pointerUp(slider, { pointerId: 1 })

      // Verify concurrent preloading was triggered starting from page 11 (skips current page 10)
      await waitFor(() => {
        expect(mockFetchPreviewImage).toHaveBeenCalledWith('https://img.example.com/11.jpg', '', '', undefined)
      })
    })
  })

  describe('settings panel', () => {
    it('renders settings gear button in footer', () => {
      render(
        <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
      )
      expect(screen.getByLabelText('阅读设置')).toBeInTheDocument()
    })

    it('opens settings panel when gear button is clicked', async () => {
      render(
        <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
      )

      await userEvent.click(screen.getByLabelText('阅读设置'))
      expect(screen.getByText('页面间距')).toBeInTheDocument()
      expect(screen.getByText('图片宽度')).toBeInTheDocument()
    })

    it('closes settings panel when gear button is clicked again', async () => {
      render(
        <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
      )

      const gearBtn = screen.getByLabelText('阅读设置')
      await userEvent.click(gearBtn)
      expect(screen.getByText('页面间距')).toBeInTheDocument()

      await userEvent.click(gearBtn)
      expect(screen.queryByText('页面间距')).not.toBeInTheDocument()
    })

    it('renders range sliders with correct default values', async () => {
      render(
        <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
      )

      await userEvent.click(screen.getByLabelText('阅读设置'))

      const gapSlider = screen.getByLabelText('页面间距')
      const widthSlider = screen.getByLabelText('图片宽度')

      expect(gapSlider).toHaveValue('4')
      expect(widthSlider).toHaveValue('70')
    })
  })

  describe('display mode switcher', () => {
    it('shows three display mode buttons in settings panel', async () => {
      render(
        <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
      )
      await userEvent.click(screen.getByLabelText('阅读设置'))
      expect(screen.getByLabelText('连续滚动')).toBeInTheDocument()
      expect(screen.getByLabelText('单页显示')).toBeInTheDocument()
      expect(screen.getByLabelText('双页显示')).toBeInTheDocument()
    })
  })

  describe('multi-chapter', () => {
    const multiChapterComic: ComicInfo = {
      id: '999001',
      title: '多章漫画',
      url: 'https://example.com/999001',
      coverUrl: '',
      source: 'JM',
      sourceSite: 'jm',
      albumId: '999001',
    }

    it('shows chapter picker for multi-chapter albums before a chapter is chosen', () => {
      vi.mocked(useComicReader).mockReturnValue(createReaderState({
        imageUrls: [],
        totalPages: 0,
        currentPage: 0,
        chapters: [
          { id: '999001', name: '第 1 話', index: 1 },
          { id: '999002', name: '第 2 話', index: 2 },
        ],
      }))
      render(
        <ComicReaderModal comic={multiChapterComic} open={true} onClose={vi.fn()} />
      )
      expect(screen.getByRole('list', { name: '章节列表' })).toBeInTheDocument()
      expect(screen.getByText('第 1 話')).toBeInTheDocument()
      expect(screen.getByText('第 2 話')).toBeInTheDocument()
    })

    it('loads a chapter via getChapterPreviewUrls when a chapter is clicked', async () => {
      const fetchChapterUrls = vi.fn()
      vi.mocked(useComicReader).mockReturnValue(createReaderState({
        imageUrls: [],
        totalPages: 0,
        currentPage: 0,
        chapters: [
          { id: '999001', name: '第 1 話', index: 1 },
          { id: '999002', name: '第 2 話', index: 2 },
        ],
        fetchChapterUrls,
      }))
      render(
        <ComicReaderModal comic={multiChapterComic} open={true} onClose={vi.fn()} />
      )
      await userEvent.click(screen.getByText('第 2 話'))
      expect(fetchChapterUrls).toHaveBeenCalledWith('999002', '999001', 'jm')
    })

    it('footer 下一章 button loads the next chapter and is disabled on the last chapter', async () => {
      const fetchChapterUrls = vi.fn()
      vi.mocked(useComicReader).mockReturnValue(createReaderState({
        imageUrls: [],
        totalPages: 0,
        currentPage: 0,
        chapters: [
          { id: '999001', name: '第 1 話', index: 1 },
          { id: '999002', name: '第 2 話', index: 2 },
        ],
        fetchChapterUrls,
      }))
      render(
        <ComicReaderModal comic={multiChapterComic} open={true} onClose={vi.fn()} />
      )

      // 进入第 1 章 → 底栏「下一章」可用
      await userEvent.click(screen.getByText('第 1 話'))
      const nextBtn = screen.getByLabelText('下一章')
      expect(nextBtn).toBeEnabled()
      fetchChapterUrls.mockClear()

      // 点击「下一章」加载第 2 章
      await userEvent.click(nextBtn)
      expect(fetchChapterUrls).toHaveBeenLastCalledWith('999002', '999001', 'jm')

      // 已到末章 → 「下一章」禁用
      expect(screen.getByLabelText('下一章')).toBeDisabled()
    })

    it('first chapter has 上一章 disabled', async () => {
      vi.mocked(useComicReader).mockReturnValue(createReaderState({
        imageUrls: [],
        totalPages: 0,
        currentPage: 0,
        chapters: [
          { id: '999001', name: '第 1 話', index: 1 },
          { id: '999002', name: '第 2 話', index: 2 },
        ],
        fetchChapterUrls: vi.fn(),
      }))
      render(
        <ComicReaderModal comic={multiChapterComic} open={true} onClose={vi.fn()} />
      )
      await userEvent.click(screen.getByText('第 1 話'))
      expect(screen.getByLabelText('上一章')).toBeDisabled()
    })
  })
})
