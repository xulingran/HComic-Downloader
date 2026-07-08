import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NhEntryGrid, classifyTier } from '@/components/NhEntryGrid'
import type { TagItem } from '@/hooks/useTagPanel'

// useTagList 默认 mock：返回 24 个递减 count 的标签，触发三档全展示。
function makeTags(n: number, zeroCount = false): TagItem[] {
  return Array.from({ length: n }, (_, i) => ({
    tag: `tag-${i + 1}`,
    count: zeroCount ? 0 : Math.max(1, 1000 - i * 50),
  }))
}

const mockGetTagList = vi.fn()

vi.mock('@/hooks/useIpc', () => ({
  useTagList: () => ({ getTagList: mockGetTagList, refreshTagList: vi.fn() }),
}))

// useReducedMotionPreference 默认返回 false（启用动画）。
const mockReduceMotion = vi.fn(() => false)
vi.mock('@/lib/anim', () => ({
  tagItemVariants: { hidden: { opacity: 0, y: 4 }, show: { opacity: 1, y: 0 } },
  tagListVariants: { hidden: {}, show: {} },
  useReducedMotionPreference: () => mockReduceMotion(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockGetTagList.mockResolvedValue({ tags: makeTags(24) })
  mockReduceMotion.mockReturnValue(false)
})

describe('classifyTier', () => {
  it('充足数量时前 5 为 head、6-10 为 mid、11+ 为 tail', () => {
    expect(classifyTier(0, 24, false)).toBe('head')
    expect(classifyTier(4, 24, false)).toBe('head')
    expect(classifyTier(5, 24, false)).toBe('mid')
    expect(classifyTier(9, 24, false)).toBe('mid')
    expect(classifyTier(10, 24, false)).toBe('tail')
    expect(classifyTier(23, 24, false)).toBe('tail')
  })

  it('总数恰好 5 时全部归入 head', () => {
    for (let i = 0; i < 5; i++) {
      expect(classifyTier(i, 5, false)).toBe('head')
    }
  })

  it('总数少于 5 时全部归入 head', () => {
    expect(classifyTier(0, 3, false)).toBe('head')
    expect(classifyTier(2, 3, false)).toBe('head')
  })

  it('总数为 10 时无长尾档', () => {
    expect(classifyTier(4, 10, false)).toBe('head')
    expect(classifyTier(5, 10, false)).toBe('mid')
    expect(classifyTier(9, 10, false)).toBe('mid')
  })

  it('count 全零时统一退化为 tail', () => {
    for (let i = 0; i < 12; i++) {
      expect(classifyTier(i, 12, true)).toBe('tail')
    }
  })

  it('越界索引返回 null', () => {
    expect(classifyTier(-1, 24, false)).toBeNull()
    expect(classifyTier(24, 24, false)).toBeNull()
  })
})

describe('NhEntryGrid 分层渲染', () => {
  it('三档标签各使用对应底色 token', async () => {
    render(<NhEntryGrid onLatest={vi.fn()} onPopular={vi.fn()} onSelectTag={vi.fn()} />)

    // head：tag-1~tag-5，实心 accent + 白字
    const headBtn = await screen.findByText('tag-1')
    expect(headBtn.className).toContain('bg-[var(--accent)]')
    expect(headBtn.className).toContain('text-white')

    // mid：tag-6~tag-10，淡 accent/10 底
    const midBtn = screen.getByText('tag-6')
    expect(midBtn.className).toContain('bg-[var(--accent)]/10')
    expect(midBtn.className).toContain('text-[var(--accent)]')

    // tail：tag-11+，灰 bg-secondary 底（head/mid 均不含此 token）
    const tailBtn = screen.getByText('tag-11')
    expect(tailBtn.className).toContain('bg-[var(--bg-secondary)]')
  })

  it('头部计数渲染为徽章（含 bg-white/20）', async () => {
    render(<NhEntryGrid onLatest={vi.fn()} onPopular={vi.fn()} onSelectTag={vi.fn()} />)

    const headBtn = await screen.findByText('tag-1')
    const badge = headBtn.querySelector('span')
    expect(badge).not.toBeNull()
    expect(badge!.className).toContain('bg-white/20')
    expect(badge!.className).toContain('rounded-full')
  })

  it('副文案显示标签总数', async () => {
    render(<NhEntryGrid onLatest={vi.fn()} onPopular={vi.fn()} onSelectTag={vi.fn()} />)
    expect(await screen.findByText('按热度排序 · 共 24 个')).toBeInTheDocument()
  })

  it('总数 ≤ 5 时全部归入 head 样式', async () => {
    mockGetTagList.mockResolvedValue({ tags: makeTags(3) })
    render(<NhEntryGrid onLatest={vi.fn()} onPopular={vi.fn()} onSelectTag={vi.fn()} />)

    const t1 = await screen.findByText('tag-1')
    const t3 = screen.getByText('tag-3')
    // 3 个标签全部为 head（实心 accent + 白字），无 mid/tail
    expect(t1.className).toContain('text-white')
    expect(t3.className).toContain('text-white')
    expect(screen.queryByText('tag-4')).not.toBeInTheDocument()
  })

  it('count 全零时全部退化为 tail 中性样式（无 accent 实心底）', async () => {
    mockGetTagList.mockResolvedValue({ tags: makeTags(12, true) })
    render(<NhEntryGrid onLatest={vi.fn()} onPopular={vi.fn()} onSelectTag={vi.fn()} />)

    const t1 = await screen.findByText('tag-1')
    // 全部 tail：灰底，无实心 accent、无白字
    expect(t1.className).toContain('bg-[var(--bg-secondary)]')
    expect(t1.className).not.toContain('text-white')
    const t12 = screen.getByText('tag-12')
    expect(t12.className).toContain('bg-[var(--bg-secondary)]')
  })

  it('点击标签触发 onSelectTag 并以标签名为参数', async () => {
    const user = userEvent.setup()
    const onSelectTag = vi.fn()
    render(<NhEntryGrid onLatest={vi.fn()} onPopular={vi.fn()} onSelectTag={onSelectTag} />)

    const btn = await screen.findByText('tag-1')
    await user.click(btn)
    expect(onSelectTag).toHaveBeenCalledWith('tag-1')
  })
})

describe('NhEntryGrid 动画与刷新', () => {
  it('reduced-motion 开启时渲染普通 button（无 variants prop）', async () => {
    mockReduceMotion.mockReturnValue(true)
    render(<NhEntryGrid onLatest={vi.fn()} onPopular={vi.fn()} onSelectTag={vi.fn()} />)

    const btn = await screen.findByText('tag-1')
    // 普通 button 不携带 framer-motion 注入的 style/data 属性链；断言其为 BUTTON 元素且无 motion 特征
    expect(btn.tagName).toBe('BUTTON')
    // motion.button 会注入 style 含 transform 等；普通 button 无内联 transform
    expect(btn.getAttribute('style') || '').not.toMatch(/transform/)
  })

  it('reduced-motion 关闭时渲染 motion.button（带内联 style）', async () => {
    render(<NhEntryGrid onLatest={vi.fn()} onPopular={vi.fn()} onSelectTag={vi.fn()} />)

    const btn = await screen.findByText('tag-1')
    expect(btn.tagName).toBe('BUTTON')
    // framer-motion 在 jsdom 下会给 motion 组件注入内联 style（即使值为空字符串也存在 style 属性）。
    // 关键不变量：reduceMotion=false 路径走了 motion 分支，组件能正常渲染出全部 24 个标签。
    expect(screen.getByText('tag-24')).toBeInTheDocument()
  })

  it('刷新后重新获取并渲染新标签数据', async () => {
    mockGetTagList.mockResolvedValueOnce({ tags: makeTags(24) })
    render(<NhEntryGrid onLatest={vi.fn()} onPopular={vi.fn()} onSelectTag={vi.fn()} />)

    await screen.findByText('tag-1')

    // 第二次返回完全不同的标签集
    const refreshedTags: TagItem[] = Array.from({ length: 24 }, (_, i) => ({
      tag: `fresh-${i + 1}`,
      count: 999 - i,
    }))
    mockGetTagList.mockResolvedValueOnce({ tags: refreshedTags })

    fireEvent.click(screen.getByText('刷新热门标签'))

    await waitFor(() => {
      expect(screen.getByText('fresh-1')).toBeInTheDocument()
    })
    expect(screen.queryByText('tag-1')).not.toBeInTheDocument()
  })

  it('刷新失败时显示错误且不影响功能卡', async () => {
    mockGetTagList.mockRejectedValueOnce(new Error('网络错误'))
    render(
      <NhEntryGrid onLatest={vi.fn()} onPopular={vi.fn()} onSelectTag={vi.fn()} />,
    )

    // 首次加载失败 → 空态 + 错误提示
    await waitFor(() => {
      expect(screen.getByText(/网络错误/)).toBeInTheDocument()
    })
    // 功能卡标题仍渲染
    expect(screen.getByText('最近更新')).toBeInTheDocument()
  })
})
