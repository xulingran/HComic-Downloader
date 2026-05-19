import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { PageFlipView } from '@/components/PageFlipView'
import type { DisplayMode } from '@/hooks/useReaderSettings'

const mockFetchPreviewImage = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchPreviewImage.mockResolvedValue({ dataUri: 'data:image/webp;base64,page' })
  Object.defineProperty(window, 'hcomic', {
    value: { fetchPreviewImage: mockFetchPreviewImage },
    writable: true,
    configurable: true,
  })
})

class MockIntersectionObserver {
  readonly root: Element | null = null
  readonly rootMargin: string = ''
  readonly thresholds: ReadonlyArray<number> = []
  private callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return [] }
}
;(globalThis as any).IntersectionObserver = MockIntersectionObserver

const defaultProps = {
  imageUrls: ['url1', 'url2', 'url3', 'url4'],
  totalPages: 4,
  currentPage: 1,
  setCurrentPage: vi.fn(),
  displayMode: 'single' as DisplayMode,
  imageWidth: 70,
  imageCacheRef: { current: new Map<number, string>() },
  cacheVersion: 0,
  onPageChange: vi.fn(),
}

describe('PageFlipView', () => {
  it('renders the current page image in single mode', async () => {
    render(<PageFlipView {...defaultProps} />)
    await waitFor(() => expect(mockFetchPreviewImage).toHaveBeenCalledWith('url1'))
  })

  it('renders two pages side by side in double mode', async () => {
    render(<PageFlipView {...defaultProps} displayMode="double" />)
    await waitFor(() => {
      expect(mockFetchPreviewImage).toHaveBeenCalledWith('url1')
      expect(mockFetchPreviewImage).toHaveBeenCalledWith('url2')
    })
  })

  it('renders only left page when currentPage is the last odd page in double mode', async () => {
    render(
      <PageFlipView
        {...defaultProps}
        imageUrls={['url1', 'url2', 'url3']}
        totalPages={3}
        currentPage={3}
        displayMode="double"
      />
    )
    await waitFor(() => expect(mockFetchPreviewImage).toHaveBeenCalledWith('url3'))
    expect(mockFetchPreviewImage).not.toHaveBeenCalledWith('url4')
  })

  it('shows click-to-flip navigation areas', () => {
    render(<PageFlipView {...defaultProps} />)
    expect(screen.getByLabelText('上一页')).toBeInTheDocument()
    expect(screen.getByLabelText('下一页')).toBeInTheDocument()
  })

  it('disables previous button on first page', () => {
    render(<PageFlipView {...defaultProps} currentPage={1} />)
    const prevBtn = screen.getByLabelText('上一页')
    expect(prevBtn).toHaveAttribute('aria-disabled', 'true')
  })

  it('disables next button on last page in single mode', () => {
    render(
      <PageFlipView
        {...defaultProps}
        imageUrls={['url1', 'url2', 'url3']}
        totalPages={3}
        currentPage={3}
        displayMode="single"
      />
    )
    const nextBtn = screen.getByLabelText('下一页')
    expect(nextBtn).toHaveAttribute('aria-disabled', 'true')
  })

  it('calls setCurrentPage with +1 on next click in single mode', () => {
    const setCurrentPage = vi.fn()
    render(<PageFlipView {...defaultProps} setCurrentPage={setCurrentPage} />)
    fireEvent.click(screen.getByLabelText('下一页'))
    expect(setCurrentPage).toHaveBeenCalledWith(2)
  })

  it('calls setCurrentPage with -1 on prev click in single mode', () => {
    const setCurrentPage = vi.fn()
    render(
      <PageFlipView {...defaultProps} currentPage={2} setCurrentPage={setCurrentPage} />
    )
    fireEvent.click(screen.getByLabelText('上一页'))
    expect(setCurrentPage).toHaveBeenCalledWith(1)
  })

  it('calls setCurrentPage with +2 on next click in double mode', () => {
    const setCurrentPage = vi.fn()
    render(
      <PageFlipView
        {...defaultProps}
        displayMode="double"
        setCurrentPage={setCurrentPage}
      />
    )
    fireEvent.click(screen.getByLabelText('下一页'))
    expect(setCurrentPage).toHaveBeenCalledWith(3)
  })

  it('calls setCurrentPage with -2 on prev click in double mode', () => {
    const setCurrentPage = vi.fn()
    render(
      <PageFlipView
        {...defaultProps}
        currentPage={3}
        displayMode="double"
        setCurrentPage={setCurrentPage}
      />
    )
    fireEvent.click(screen.getByLabelText('上一页'))
    expect(setCurrentPage).toHaveBeenCalledWith(1)
  })

  it('clamps next page to totalPages in double mode', () => {
    const setCurrentPage = vi.fn()
    render(
      <PageFlipView
        {...defaultProps}
        imageUrls={['url1', 'url2', 'url3']}
        totalPages={3}
        currentPage={1}
        displayMode="double"
        setCurrentPage={setCurrentPage}
      />
    )
    fireEvent.click(screen.getByLabelText('下一页'))
    expect(setCurrentPage).toHaveBeenCalledWith(3)
  })
})
