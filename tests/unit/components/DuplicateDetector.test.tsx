import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DuplicateDetector } from '@/components/tools/DuplicateDetector'

const mockGetFavourites = vi.fn()

vi.mock('@/hooks/useIpc', () => ({
  useFavourites: () => ({ getFavourites: mockGetFavourites }),
}))

vi.mock('@/stores/useDrawerStore', () => ({
  useDrawerStore: (selector: (state: { openDrawer: () => void }) => unknown) =>
    selector({ openDrawer: vi.fn() }),
}))

describe('DuplicateDetector', () => {
  beforeEach(() => {
    mockGetFavourites.mockReset()
    mockGetFavourites.mockResolvedValue({
      comics: [],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 0 },
      needsLogin: false,
    })
  })

  it('renders source selector and start button', () => {
    render(<DuplicateDetector />)
    expect(screen.getByText('重复检测')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始检测' })).toBeInTheDocument()
  })

  it('shows empty state before detection', () => {
    render(<DuplicateDetector />)
    expect(screen.getByText('选择来源并点击开始检测')).toBeInTheDocument()
  })

  it('fetches all pages when detection starts', async () => {
    const comics = Array.from({ length: 5 }, (_, i) => ({
      id: String(i + 1),
      title: `作品${i + 1}`,
      url: '',
      coverUrl: '',
      source: 'hcomic',
    }))

    mockGetFavourites
      .mockResolvedValueOnce({
        comics: comics.slice(0, 3),
        pagination: { currentPage: 1, totalPages: 2, totalItems: 5 },
        needsLogin: false,
      })
      .mockResolvedValueOnce({
        comics: comics.slice(3),
        pagination: { currentPage: 2, totalPages: 2, totalItems: 5 },
        needsLogin: false,
      })

    render(<DuplicateDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))

    expect(mockGetFavourites).toHaveBeenCalledTimes(2)
    expect(mockGetFavourites).toHaveBeenNthCalledWith(1, 1, 'hcomic')
    expect(mockGetFavourites).toHaveBeenNthCalledWith(2, 2, 'hcomic')
  })

  it('shows no-duplicates message when none found', async () => {
    const comics = [
      { id: '1', title: '魔法少女物语', url: '', coverUrl: '', source: 'hcomic' },
      { id: '2', title: '异世界冒险记', url: '', coverUrl: '', source: 'hcomic' },
    ]
    mockGetFavourites.mockResolvedValueOnce({
      comics,
      pagination: { currentPage: 1, totalPages: 1, totalItems: 2 },
      needsLogin: false,
    })

    render(<DuplicateDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))

    expect(await screen.findByText('未发现疑似重复的漫画')).toBeInTheDocument()
  })

  it('displays duplicate groups when found', async () => {
    const comics = [
      { id: '1', title: '魔法少女物语', url: '', coverUrl: '', source: 'hcomic' },
      { id: '2', title: '魔法少女物语（全彩）', url: '', coverUrl: '', source: 'hcomic' },
    ]
    mockGetFavourites.mockResolvedValueOnce({
      comics,
      pagination: { currentPage: 1, totalPages: 1, totalItems: 2 },
      needsLogin: false,
    })

    render(<DuplicateDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))

    expect(await screen.findByText(/疑似重复组 1/)).toBeInTheDocument()
    expect(screen.getByText('魔法少女物语')).toBeInTheDocument()
    expect(screen.getByText('魔法少女物语（全彩）')).toBeInTheDocument()
  })
})
