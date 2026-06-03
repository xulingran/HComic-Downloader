import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DuplicateGroup } from '@/components/tools/DuplicateGroup'
import type { ComicInfo } from '@shared/types'

const mockOpenDrawer = vi.fn()
vi.mock('@/stores/useDrawerStore', () => ({
  useDrawerStore: (selector: (state: { openDrawer: typeof mockOpenDrawer }) => unknown) =>
    selector({ openDrawer: mockOpenDrawer }),
}))

function makeComic(id: string, title: string): ComicInfo {
  return { id, title, url: '', coverUrl: `https://example.com/${id}.jpg`, source: 'hcomic' }
}

const sampleGroup = {
  comics: [makeComic('1', '标题A'), makeComic('2', '标题A（全彩）')],
  scores: new Map([['1', 0.85], ['2', 0.85]]),
}

describe('DuplicateGroup', () => {
  beforeEach(() => { mockOpenDrawer.mockClear() })

  it('renders group header with comic count', () => {
    render(<DuplicateGroup groupIndex={0} group={sampleGroup} />)
    expect(screen.getByText(/疑似重复组 1/)).toBeInTheDocument()
    expect(screen.getByText(/2 本/)).toBeInTheDocument()
  })

  it('renders all comic titles in full', () => {
    render(<DuplicateGroup groupIndex={0} group={sampleGroup} />)
    expect(screen.getByText('标题A')).toBeInTheDocument()
    expect(screen.getByText('标题A（全彩）')).toBeInTheDocument()
  })

  it('displays similarity percentage for each comic', () => {
    render(<DuplicateGroup groupIndex={0} group={sampleGroup} />)
    const badges = screen.getAllByText('85%')
    expect(badges).toHaveLength(2)
  })

  it('calls openDrawer when a comic row is clicked', async () => {
    render(<DuplicateGroup groupIndex={0} group={sampleGroup} />)
    await userEvent.click(screen.getByText('标题A'))
    expect(mockOpenDrawer).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1', title: '标题A' })
    )
  })

  it('collapses and expands when header is clicked', async () => {
    render(<DuplicateGroup groupIndex={0} group={sampleGroup} />)
    expect(screen.getByText('标题A')).toBeInTheDocument()

    await userEvent.click(screen.getByText(/疑似重复组 1/))
    expect(screen.queryByText('标题A')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText(/疑似重复组 1/))
    expect(screen.getByText('标题A')).toBeInTheDocument()
  })
})
