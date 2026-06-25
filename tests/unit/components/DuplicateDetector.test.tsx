import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DuplicateDetector } from '@/components/tools/DuplicateDetector'
import type { DuplicateBlacklist } from '@shared/types'

const mockGetFavourites = vi.fn()

vi.mock('@/hooks/useIpc', () => ({
  useFavourites: () => ({ getFavourites: mockGetFavourites }),
}))

vi.mock('@/stores/useDrawerStore', () => ({
  useDrawerStore: (selector: (state: { openDrawer: () => void }) => unknown) =>
    selector({ openDrawer: vi.fn() }),
}))

vi.mock('@/stores/useReaderStore', () => ({
  useReaderStore: (selector: (state: { openReader: () => void }) => unknown) =>
    selector({ openReader: vi.fn() }),
}))

// Mock useCoverImage — DuplicateGroup 内部使用它渲染封面，避免 IntersectionObserver 依赖
vi.mock('@/hooks/useCoverImage', () => ({
  useCoverImage: () => ({ coverSrc: 'data:image/png;base64,mock', retry: vi.fn() }),
}))

// 可变的状态镜像，便于在每个用例里配置 duplicateBlacklist
let storeState: {
  duplicateBlacklist: DuplicateBlacklist
  sfwMode: boolean
  addDuplicateIgnore: ReturnType<typeof vi.fn>
  removeDuplicateIgnore: ReturnType<typeof vi.fn>
  confirmMemberCount: ReturnType<typeof vi.fn>
}

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}))

describe('DuplicateDetector', () => {
  beforeEach(() => {
    mockGetFavourites.mockReset()
    mockGetFavourites.mockResolvedValue({
      comics: [],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 0 },
      needsLogin: false,
    })
    storeState = {
      duplicateBlacklist: { hcomic: [], moeimg: [], jm: [], bika: [], copymanga: [] },
      sfwMode: false,
      addDuplicateIgnore: vi.fn(),
      removeDuplicateIgnore: vi.fn(),
      confirmMemberCount: vi.fn(),
    }
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

  it('shows stats text without ignored suffix when none ignored', async () => {
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

    // 统计文案不含"已忽略"后缀
    const stats = await screen.findByText('已分析 2 本漫画，发现 1 组疑似重复')
    expect(stats).toBeInTheDocument()
    expect(stats.textContent).not.toMatch(/已忽略/)
  })

  it('splits groups into active and ignored by fingerprint', async () => {
    // 两组重复：组A（魔法少女物语，指纹=魔法少女物语）已忽略；组B（异世界冒险记）active
    storeState.duplicateBlacklist = {
      ...storeState.duplicateBlacklist,
      hcomic: [{ fingerprint: '魔法少女物语', memberCount: 2 }],
    }
    const comics = [
      { id: '1', title: '魔法少女物语', url: '', coverUrl: '', source: 'hcomic' },
      { id: '2', title: '魔法少女物语（全彩）', url: '', coverUrl: '', source: 'hcomic' },
      { id: '3', title: '异世界冒险记', url: '', coverUrl: '', source: 'hcomic' },
      { id: '4', title: '异世界冒险记（汉化）', url: '', coverUrl: '', source: 'hcomic' },
    ]
    mockGetFavourites.mockResolvedValueOnce({
      comics,
      pagination: { currentPage: 1, totalPages: 1, totalItems: 4 },
      needsLogin: false,
    })

    render(<DuplicateDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))

    // 统计文案含"其中 1 组已忽略"
    const stats = await screen.findByText('已分析 4 本漫画，发现 2 组疑似重复（其中 1 组已忽略）')
    expect(stats).toBeInTheDocument()
    // ignored 区段分隔标题可见
    expect(screen.getByText('已忽略（1 组，点击展开可取消忽略）')).toBeInTheDocument()
    // ignored 组带"取消忽略"按钮
    expect(screen.getByRole('button', { name: '取消忽略' })).toBeInTheDocument()
    // active 组带"忽略此组"按钮
    expect(screen.getByRole('button', { name: '忽略此组' })).toBeInTheDocument()
  })

  it('ignored group is collapsed by default (titles hidden until expanded)', async () => {
    storeState.duplicateBlacklist = {
      ...storeState.duplicateBlacklist,
      hcomic: [{ fingerprint: '魔法少女物语', memberCount: 2 }],
    }
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

    await screen.findByText('已分析 2 本漫画，发现 1 组疑似重复（其中 1 组已忽略）')
    // ignored 组默认折叠：漫画标题不可见
    expect(screen.queryByText('魔法少女物语', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByText('魔法少女物语（全彩）')).not.toBeInTheDocument()
  })

  it('calls addDuplicateIgnore when "忽略此组" clicked', async () => {
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
    await screen.findByText(/疑似重复组 1/)

    await userEvent.click(screen.getByRole('button', { name: '忽略此组' }))
    expect(storeState.addDuplicateIgnore).toHaveBeenCalledWith('hcomic', '魔法少女物语', 2)
  })

  it('opens manager panel when "管理已忽略" clicked', async () => {
    render(<DuplicateDetector />)
    await userEvent.click(screen.getByRole('button', { name: /管理已忽略/ }))
    expect(await screen.findByText('已忽略的重复组')).toBeInTheDocument()
  })
})
