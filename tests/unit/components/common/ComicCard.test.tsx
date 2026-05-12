import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComicCard } from '@/components/common/ComicCard'
import { useSettingsStore } from '@/stores/useSettingsStore'
import type { ComicInfo } from '@shared/types'

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: vi.fn().mockReturnValue({ cardStyle: 'cover', sfwMode: false })
}))

vi.mock('@/hooks/useCoverImage', () => ({
  useCoverImage: vi.fn().mockReturnValue({ coverSrc: 'data:image/png;base64,mock', retry: vi.fn() })
}))

const mockComic: ComicInfo = {
  id: '1',
  title: '测试漫画',
  url: 'https://example.com/comic/1',
  coverUrl: 'https://example.com/cover.jpg',
  source: 'test'
}

describe('ComicCard', () => {
  it('renders comic title', () => {
    render(<ComicCard comic={mockComic} />)
    expect(screen.getByText('测试漫画')).toBeInTheDocument()
  })

  it('renders cover image', () => {
    render(<ComicCard comic={mockComic} />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'data:image/png;base64,mock')
    expect(img).toHaveAttribute('alt', mockComic.title)
  })

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn()
    const { container } = render(<ComicCard comic={mockComic} onClick={onClick} />)

    // Click the card container div instead of the title text (title has stopPropagation)
    const card = container.querySelector('div[class*="rounded-xl"]')!
    await userEvent.click(card)
    expect(onClick).toHaveBeenCalledWith(mockComic)
  })

  it('shows checkbox in batchMode', () => {
    render(<ComicCard comic={mockComic} batchMode={true} />)
    // In CoverCard batchMode, a circular checkbox div is rendered with rounded-full class
    const card = screen.getByText('测试漫画').closest('div[class*="rounded-xl"]')!
    const checkbox = card.querySelector('.rounded-full.border-2')
    expect(checkbox).toBeInTheDocument()
  })

  it('checkbox reflects selected state', () => {
    const { container } = render(
      <ComicCard comic={mockComic} batchMode={true} selected={true} />
    )
    // When selected, the checkbox has bg-[var(--accent)] and contains an SVG checkmark
    const checkmark = container.querySelector('svg.w-3.h-3')
    expect(checkmark).toBeInTheDocument()
  })

  it('calls onToggleSelect when checkbox clicked in batchMode', async () => {
    const onToggleSelect = vi.fn()
    const { container } = render(
      <ComicCard
        comic={mockComic}
        batchMode={true}
        onToggleSelect={onToggleSelect}
      />
    )

    // Click the card container div instead of the title text (title has stopPropagation)
    const card = container.querySelector('div[class*="rounded-xl"]')!
    await userEvent.click(card)
    expect(onToggleSelect).toHaveBeenCalledWith(mockComic)
  })

  it('shows download button when onDownload provided', () => {
    render(
      <ComicCard comic={mockComic} onDownload={vi.fn()} />
    )
    const button = screen.getByRole('button')
    expect(button).toBeInTheDocument()
  })

  it('clicking download calls onDownload without triggering onClick', async () => {
    const onClick = vi.fn()
    const onDownload = vi.fn()
    render(
      <ComicCard
        comic={mockComic}
        onClick={onClick}
        onDownload={onDownload}
      />
    )

    const downloadButton = screen.getByRole('button')
    await userEvent.click(downloadButton)
    expect(onDownload).toHaveBeenCalledWith(mockComic)
    expect(onClick).not.toHaveBeenCalled()
  })

  describe('DetailedCard (detailed mode)', () => {
    const comicWithAllFields: ComicInfo = {
      id: '1',
      title: 'テスト漫画タイトル',
      url: 'https://example.com/1',
      coverUrl: 'https://example.com/cover.jpg',
      source: 'test',
      author: '作者A',
      pages: 128,
      tags: ['NTR', '魔法少女', '触手', '女体化', '種付け', '魔物']
    }

    beforeEach(() => {
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'detailed', sfwMode: false })
    })

    it('renders as a flex row', () => {
      const { container } = render(<ComicCard comic={comicWithAllFields} />)
      const row = container.firstElementChild as HTMLElement
      expect(row.className).toContain('flex')
      expect(row.className).toContain('items-center')
    })

    it('renders square thumbnail', () => {
      render(<ComicCard comic={comicWithAllFields} />)
      const img = screen.getByRole('img')
      const thumbWrapper = img.parentElement!
      expect(thumbWrapper.className).toContain('w-14')
      expect(thumbWrapper.className).toContain('h-14')
    })

    it('renders author and page count as subtitle', () => {
      render(<ComicCard comic={comicWithAllFields} />)
      expect(screen.getByText('作者A')).toBeInTheDocument()
      expect(screen.getByText(/128/)).toBeInTheDocument()
    })

    it('renders tags as pill elements', () => {
      render(<ComicCard comic={comicWithAllFields} />)
      expect(screen.getByText('NTR')).toBeInTheDocument()
      expect(screen.getByText('魔法少女')).toBeInTheDocument()
      expect(screen.getByText('触手')).toBeInTheDocument()
      expect(screen.getByText('+3')).toBeInTheDocument()
    })

    it('shows download button always visible (no opacity-0)', () => {
      const onDownload = vi.fn()
      const { container } = render(
        <ComicCard comic={comicWithAllFields} onDownload={onDownload} />
      )
      // Find the download button — it's the last button in the row, contains an SVG with download path
      const buttons = container.querySelectorAll('button')
      const downloadButton = Array.from(buttons).find(b => b.querySelector('svg path[d*="M4 16v1"]'))
      expect(downloadButton).toBeTruthy()
      expect(downloadButton!.className).not.toContain('opacity-0')
    })

    it('selected state uses border-l accent', () => {
      const { container } = render(
        <ComicCard comic={comicWithAllFields} batchMode={true} selected={true} />
      )
      const row = container.firstElementChild as HTMLElement
      expect(row.className).toContain('border-l-2')
      expect(row.className).toContain('border-l-[var(--accent)]')
    })
  })

  describe('SFW mode', () => {
    beforeEach(() => {
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'cover', sfwMode: true })
    })

    afterEach(() => {
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'cover', sfwMode: false })
    })

    it('shows SFW placeholder in CoverCard', () => {
      const { container } = render(<ComicCard comic={mockComic} />)
      expect(screen.getByText('SFW')).toBeInTheDocument()
      expect(container.querySelector('img')).not.toBeInTheDocument()
    })

    it('shows SFW placeholder in DetailedCard', () => {
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'detailed', sfwMode: true })
      const { container } = render(<ComicCard comic={mockComic} />)
      expect(container.querySelector('img')).not.toBeInTheDocument()
    })
  })
})
