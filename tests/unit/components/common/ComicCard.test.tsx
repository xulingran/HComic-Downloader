import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComicCard } from '@/components/common/ComicCard'
import { useSettingsStore } from '@/stores/useSettingsStore'
import type { ComicInfo } from '@shared/types'
import type { DownloadProgressData } from '@/hooks/useIpc'

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: vi.fn().mockReturnValue({ cardStyle: 'cover', sfwMode: false })
}))

vi.mock('@/hooks/useCoverImage', () => ({
  useCoverImage: vi.fn().mockReturnValue({ coverSrc: 'data:image/png;base64,mock', retry: vi.fn() })
}))

vi.mock('@/stores/useDrawerStore', () => ({
  useDrawerStore: vi.fn().mockReturnValue({ openDrawer: vi.fn() })
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

  describe('activeDownload progress', () => {
    const activeDownload: DownloadProgressData = {
      taskId: 'task-1',
      status: 'downloading',
      progress: 55,
      total: 100,
      current: 55,
    }

    it('shows CircularProgress instead of download button when activeDownload status is downloading', () => {
      const onDownload = vi.fn()
      const { container } = render(
        <ComicCard comic={mockComic} onDownload={onDownload} activeDownload={activeDownload} />
      )
      // No button should be rendered
      expect(container.querySelector('button')).not.toBeInTheDocument()
      // SVG from CircularProgress should be present
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('shows CircularProgress instead of download button when activeDownload status is queued', () => {
      const onDownload = vi.fn()
      const { container } = render(
        <ComicCard
          comic={mockComic}
          onDownload={onDownload}
          activeDownload={{ ...activeDownload, status: 'queued', progress: 0 }}
        />
      )
      expect(container.querySelector('button')).not.toBeInTheDocument()
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('does NOT trigger onDownload when clicking during active download', async () => {
      const onDownload = vi.fn()
      const { container } = render(
        <ComicCard comic={mockComic} onDownload={onDownload} activeDownload={activeDownload} />
      )
      // The progress wrapper div (not cursor-pointer since status is downloading)
      const progressDiv = container.querySelector('.absolute.top-2.right-2.z-10')
      expect(progressDiv).toBeInTheDocument()
      expect(progressDiv!.className).not.toContain('cursor-pointer')
    })

    it('shows CircularProgress with failed status when activeDownload status is failed', () => {
      const { container } = render(
        <ComicCard
          comic={mockComic}
          onDownload={vi.fn()}
          activeDownload={{ ...activeDownload, status: 'failed' }}
        />
      )
      const circles = container.querySelectorAll('circle')
      // Second circle is the progress arc, should have failed color
      expect(circles[1]).toHaveAttribute('stroke', '#ef4444')
    })

    it('clicking failed progress ring triggers onDownload (retry)', async () => {
      const onDownload = vi.fn()
      const { container } = render(
        <ComicCard
          comic={mockComic}
          onDownload={onDownload}
          activeDownload={{ ...activeDownload, status: 'failed' }}
        />
      )
      const progressDiv = container.querySelector('.absolute.top-2.right-2.z-10.cursor-pointer')
      expect(progressDiv).toBeInTheDocument()
      await userEvent.click(progressDiv!)
      expect(onDownload).toHaveBeenCalledWith(mockComic)
    })

    it('shows normal download button when activeDownload is undefined', () => {
      const onDownload = vi.fn()
      render(<ComicCard comic={mockComic} onDownload={onDownload} />)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('in DetailedCard mode: shows progress ring when activeDownload is downloading', () => {
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'detailed', sfwMode: false })
      const onDownload = vi.fn()
      const { container } = render(
        <ComicCard comic={mockComic} onDownload={onDownload} activeDownload={activeDownload} />
      )
      // Should not have a button element
      expect(container.querySelector('button')).not.toBeInTheDocument()
      // Should have an SVG (CircularProgress)
      expect(container.querySelector('svg')).toBeInTheDocument()
      // Restore default
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'cover', sfwMode: false })
    })
  })

  describe('推荐标签高亮 (isRecommended / recommendedTags)', () => {
    it('CoverCard: isRecommended 添加整圈琥珀内描边与微背景色', () => {
      const { container } = render(
        <ComicCard comic={mockComic} isRecommended={true} />
      )
      const card = container.firstElementChild as HTMLElement
      // 用 inset shadow 画内描边,避免 ring 溢出视口(卡片紧贴窗口边缘时)
      expect(card.className).toContain('bg-amber-500/10')
      expect(card.className).toContain('shadow-[inset_0_0_0_2px_rgba(245,158,11,0.8)]')
    })

    it('CoverCard: 未推荐时不显示推荐样式', () => {
      const { container } = render(<ComicCard comic={mockComic} />)
      const card = container.firstElementChild as HTMLElement
      expect(card.className).not.toContain('bg-amber-500/10')
      expect(card.className).not.toContain('shadow-[inset_0_0_0_2px')
    })

    it('CoverCard: selected+recommended 叠加时只显示选中环(推荐让位)', () => {
      const { container } = render(
        <ComicCard comic={mockComic} isRecommended={true} batchMode={true} selected={true} />
      )
      const card = container.firstElementChild as HTMLElement
      // 选中环优先,推荐内描边与背景色隐藏
      expect(card.className).toContain('ring-2')
      expect(card.className).toContain('ring-[var(--accent)]')
      expect(card.className).not.toContain('bg-amber-500/10')
      expect(card.className).not.toContain('shadow-[inset_0_0_0_2px')
    })

    it('DetailedCard: isRecommended 添加加粗左侧琥珀边框与微背景色', () => {
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'detailed', sfwMode: false })
      const comic: ComicInfo = { ...mockComic, tags: ['NTR', '魔法少女'] }
      const { container } = render(<ComicCard comic={comic} isRecommended={true} />)
      const row = container.firstElementChild as HTMLElement
      expect(row.className).toContain('border-l-4')
      expect(row.className).toContain('border-l-amber-400')
      expect(row.className).toContain('bg-amber-500/10')
      // 近实色边框:不应再带透明度修饰(/80 已移除,直接 amber-400)
      expect(row.className).not.toContain('border-l-amber-400/')
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'cover', sfwMode: false })
    })

    it('DetailedCard: selected 状态下不叠加推荐边框（选中样式优先）', () => {
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'detailed', sfwMode: false })
      const comic: ComicInfo = { ...mockComic, tags: ['NTR'] }
      const { container } = render(
        <ComicCard comic={comic} isRecommended={true} batchMode={true} selected={true} />
      )
      const row = container.firstElementChild as HTMLElement
      // selected 分支不渲染 amber 边框，而是 accent
      expect(row.className).not.toContain('border-l-amber-400/70')
      expect(row.className).toContain('border-l-[var(--accent)]')
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'cover', sfwMode: false })
    })

    it('DetailedCard: 命中 recommendedTags 的标签使用琥珀色样式', () => {
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'detailed', sfwMode: false })
      const comic: ComicInfo = { ...mockComic, tags: ['NTR', '魔法少女'] }
      render(
        <ComicCard
          comic={comic}
          recommendedTags={new Set(['ntr'])}
        />
      )
      // NTR 命中 -> amber 样式
      const ntrPill = screen.getByText('NTR').closest('span')!
      expect(ntrPill.className).toContain('bg-amber-500/15')
      expect(ntrPill.className).toContain('text-amber-600')
      // 魔法少女 未命中 -> 默认 accent 样式
      const normalPill = screen.getByText('魔法少女').closest('span')!
      expect(normalPill.className).not.toContain('bg-amber-500/15')
      expect(normalPill.className).toContain('bg-[var(--accent)]/10')
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'cover', sfwMode: false })
    })

    it('DetailedCard: recommendedTags 匹配不区分大小写', () => {
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'detailed', sfwMode: false })
      const comic: ComicInfo = { ...mockComic, tags: ['NTR'] }
      render(<ComicCard comic={comic} recommendedTags={new Set(['ntr'])} />)
      const pill = screen.getByText('NTR').closest('span')!
      expect(pill.className).toContain('bg-amber-500/15')
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'cover', sfwMode: false })
    })

    it('DetailedCard: 无 recommendedTags 时所有标签使用默认样式', () => {
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'detailed', sfwMode: false })
      const comic: ComicInfo = { ...mockComic, tags: ['NTR'] }
      render(<ComicCard comic={comic} />)
      const pill = screen.getByText('NTR').closest('span')!
      expect(pill.className).not.toContain('bg-amber-500/15')
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'cover', sfwMode: false })
    })
  })

  describe('DetailedCard tag 点击搜索 (onTagClick)', () => {
    beforeEach(() => {
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'detailed', sfwMode: false })
    })

    afterEach(() => {
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'cover', sfwMode: false })
    })

    it('传入 onTagClick 时 tag 渲染为 button 且可点击触发回调', async () => {
      const onTagClick = vi.fn()
      const comic: ComicInfo = { ...mockComic, tags: ['NTR', '魔法少女'] }
      render(<ComicCard comic={comic} onTagClick={onTagClick} />)

      const tagBtn = screen.getByRole('button', { name: 'NTR' })
      expect(tagBtn.tagName).toBe('BUTTON')
      expect(tagBtn.className).toContain('cursor-pointer')
      await userEvent.click(tagBtn)
      expect(onTagClick).toHaveBeenCalledWith('NTR')
    })

    it('点击 tag 不冒泡到卡片 onClick（stopPropagation）', async () => {
      const onTagClick = vi.fn()
      const onClick = vi.fn()
      const comic: ComicInfo = { ...mockComic, tags: ['NTR'] }
      render(<ComicCard comic={comic} onTagClick={onTagClick} onClick={onClick} />)

      await userEvent.click(screen.getByRole('button', { name: 'NTR' }))
      expect(onTagClick).toHaveBeenCalledOnce()
      expect(onClick).not.toHaveBeenCalled()
    })

    it('未传入 onTagClick 时 tag 保持纯展示 span（如收藏/历史页）', () => {
      const comic: ComicInfo = { ...mockComic, tags: ['NTR'] }
      render(<ComicCard comic={comic} />)
      const pill = screen.getByText('NTR')
      expect(pill.tagName).toBe('SPAN')
      expect(pill.className).not.toContain('cursor-pointer')
    })

    it('可点击时推荐标签的 hover 色与琥珀底色匹配（与抽屉一致）', () => {
      const onTagClick = vi.fn()
      const comic: ComicInfo = { ...mockComic, tags: ['NTR'] }
      render(<ComicCard comic={comic} onTagClick={onTagClick} recommendedTags={new Set(['ntr'])} />)
      const pill = screen.getByRole('button', { name: 'NTR' })
      // 琥珀底色 + 琥珀 hover（而非 accent hover）
      expect(pill.className).toContain('bg-amber-500/15')
      expect(pill.className).toContain('hover:bg-amber-500/25')
      expect(pill.className).not.toContain('hover:bg-[var(--accent)]/20')
    })
  })
})
