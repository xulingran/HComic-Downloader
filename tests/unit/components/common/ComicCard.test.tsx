import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComicCard } from '@/components/common/ComicCard'
import type { ComicInfo } from '@shared/types'

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: vi.fn().mockReturnValue({ cardStyle: 'cover' })
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
    expect(img).toHaveAttribute('src', mockComic.coverUrl)
    expect(img).toHaveAttribute('alt', mockComic.title)
  })

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn()
    render(<ComicCard comic={mockComic} onClick={onClick} />)

    await userEvent.click(screen.getByText('测试漫画'))
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
    render(
      <ComicCard
        comic={mockComic}
        batchMode={true}
        onToggleSelect={onToggleSelect}
      />
    )

    // In batchMode, clicking the card triggers onToggleSelect instead of onClick
    await userEvent.click(screen.getByText('测试漫画'))
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
})
