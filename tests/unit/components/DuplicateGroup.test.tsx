import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DuplicateGroup } from '@/components/tools/DuplicateGroup'
import type { ComicInfo } from '@shared/types'

const mockOpenDrawer = vi.fn()
const mockOpenReader = vi.fn()
vi.mock('@/stores/useDrawerStore', () => ({
  useDrawerStore: (selector: (state: { openDrawer: typeof mockOpenDrawer }) => unknown) =>
    selector({ openDrawer: mockOpenDrawer }),
}))
vi.mock('@/stores/useReaderStore', () => ({
  useReaderStore: (selector: (state: { openReader: typeof mockOpenReader }) => unknown) =>
    selector({ openReader: mockOpenReader }),
}))

function makeComic(id: string, title: string): ComicInfo {
  return { id, title, url: '', coverUrl: `https://example.com/${id}.jpg`, source: 'hcomic' }
}

const sampleGroup = {
  comics: [makeComic('1', '标题A'), makeComic('2', '标题A（全彩）')],
  scores: new Map([['1', 0.85], ['2', 0.85]]),
}

describe('DuplicateGroup', () => {
  beforeEach(() => { mockOpenDrawer.mockClear(); mockOpenReader.mockClear() })

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

  it('calls openDrawer when a comic title is clicked', async () => {
    render(<DuplicateGroup groupIndex={0} group={sampleGroup} />)
    await userEvent.click(screen.getByText('标题A'))
    expect(mockOpenDrawer).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1', title: '标题A' })
    )
  })

  it('calls openReader when cover button is clicked', async () => {
    render(<DuplicateGroup groupIndex={0} group={sampleGroup} />)
    const coverButtons = screen.getAllByTitle('预览漫画')
    expect(coverButtons).toHaveLength(2)
    await userEvent.click(coverButtons[0])
    expect(mockOpenReader).toHaveBeenCalledWith(
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

  it('renders collapsed by default when initialExpanded is false', () => {
    render(<DuplicateGroup groupIndex={0} group={sampleGroup} initialExpanded={false} />)
    // 折叠态下漫画标题不可见
    expect(screen.queryByText('标题A')).not.toBeInTheDocument()
  })

  it('shows "忽略此组" button for active group and triggers onIgnore', async () => {
    const onIgnore = vi.fn()
    render(<DuplicateGroup groupIndex={0} group={sampleGroup} onIgnore={onIgnore} />)
    const btn = screen.getByRole('button', { name: '忽略此组' })
    expect(btn).toBeInTheDocument()
    await userEvent.click(btn)
    expect(onIgnore).toHaveBeenCalledTimes(1)
  })

  it('shows "取消忽略" button for ignored group and triggers onUnignore', async () => {
    const onUnignore = vi.fn()
    render(
      <DuplicateGroup
        groupIndex={0}
        group={sampleGroup}
        ignored
        initialExpanded={false}
        onUnignore={onUnignore}
      />
    )
    const btn = screen.getByRole('button', { name: '取消忽略' })
    expect(btn).toBeInTheDocument()
    await userEvent.click(btn)
    expect(onUnignore).toHaveBeenCalledTimes(1)
  })

  it('shows "已忽略" marker for ignored group', () => {
    render(
      <DuplicateGroup groupIndex={0} group={sampleGroup} ignored initialExpanded={false} />
    )
    expect(screen.getByText(/已忽略/)).toBeInTheDocument()
  })
})
