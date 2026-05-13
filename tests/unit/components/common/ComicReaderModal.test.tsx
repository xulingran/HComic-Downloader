import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
      [{ isIntersecting: true, target, boundingClientRect: { top: 0 } } as any],
      this as any
    )
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return [] }
}
(globalThis as any).IntersectionObserver = MockIntersectionObserver

const mockFetchPreviewImage = vi.fn()

const mockSetPageGap = vi.fn()
const mockSetImageWidth = vi.fn()

vi.mock('@/hooks/useReaderSettings', () => ({
  useReaderSettings: vi.fn(() => ({
    pageGap: 4,
    imageWidth: 70,
    setPageGap: mockSetPageGap,
    setImageWidth: mockSetImageWidth,
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
  fetchUrls: vi.fn(),
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
    vi.mocked(useComicReader).mockReturnValue(createReaderState())
    mockFetchPreviewImage.mockResolvedValue({ dataUri: 'data:image/webp;base64,page' })
    Object.defineProperty(window, 'hcomic', {
      value: { fetchPreviewImage: mockFetchPreviewImage },
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
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
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
      expect(mockFetchPreviewImage).toHaveBeenCalledWith('https://img.example.com/1.jpg')
      expect(mockFetchPreviewImage).toHaveBeenCalledWith('https://img.example.com/2.jpg')
    })
  })

  it('renders proxied data URI images for all pages', async () => {
    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )

    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2))
    for (const image of screen.getAllByRole('img')) {
      expect(image).toHaveAttribute('src', 'data:image/webp;base64,page')
    }
  })

  it('shows proxied image as soon as the data URI is returned', async () => {
    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )

    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2))
    for (const image of screen.getAllByRole('img')) {
      expect(image).toHaveAttribute('src', 'data:image/webp;base64,page')
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
      .mockResolvedValueOnce({ dataUri: 'data:image/webp;base64,page' })

    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )

    expect(await screen.findByText('第 1 页加载失败')).toBeInTheDocument()
    await userEvent.click(screen.getByText('重试'))

    await waitFor(() => expect(mockFetchPreviewImage).toHaveBeenCalledTimes(2))
    expect(mockFetchPreviewImage).toHaveBeenLastCalledWith('https://img.example.com/1.jpg')

    consoleErrorSpy.mockRestore()
  })

  it('renders progress bar', () => {
    render(
      <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
    )
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  describe('ReaderPage cache and priority', () => {
    it('uses cachedDataUri when provided', async () => {
      vi.mocked(useComicReader).mockReturnValue(createReaderState({
        imageUrls: ['https://img.example.com/1.jpg', 'https://img.example.com/2.jpg', 'https://img.example.com/3.jpg'],
        totalPages: 3,
        currentPage: 1,
      }))
      mockFetchPreviewImage.mockResolvedValue({ dataUri: 'data:image/webp;base64,cached-page-1' })

      render(
        <ComicReaderModal comic={mockComic} open={true} onClose={vi.fn()} />
      )

      await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(3))
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
})
