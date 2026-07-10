import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// 模块级 mock：保留真实 DURATION/variants，仅替换 useReducedMotionPreference 为可切换 stub。
// 默认返回 false（与真实默认一致），reduced-motion 用例通过 reducedMotionOverride 翻转。
const { reducedMotionOverride } = vi.hoisted(() => ({ reducedMotionOverride: { current: false } }))
vi.mock('@/lib/anim', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/anim')>()
  return { ...actual, useReducedMotionPreference: () => reducedMotionOverride.current }
})

import { Sidebar } from '@/components/Sidebar'
import { useSidebarStore } from '@/stores/useSidebarStore'

describe('Sidebar', () => {
  const menuItems = [
    { id: 'search', label: '搜索', icon: '🔍' },
    { id: 'downloads', label: '漫画库', icon: '📥' },
    { id: 'favourites', label: '收藏夹', icon: '⭐' },
    { id: 'history', label: '历史记录', icon: '🕐' },
    { id: 'toolbox', label: '工具箱', icon: '🧰' },
    { id: 'maintenance', label: '维护', icon: '🧹' },
    { id: 'settings', label: '设置', icon: '⚙️' },
    { id: 'about', label: '关于', icon: 'ℹ️' }
  ]

  beforeEach(() => {
    // 隔离用例：每个测试前重置为默认收起态与默认 reduced-motion
    useSidebarStore.setState({ isOpen: false })
    reducedMotionOverride.current = false
  })

  afterEach(() => {
    cleanup()
  })

  it('renders all navigation items', () => {
    render(<Sidebar activePage="search" onPageChange={vi.fn()} />)

    // 8 个菜单项 + 1 个 toggle 按钮 = 9 个 button
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(9)

    for (const item of menuItems) {
      const button = screen.getByTitle(item.label)
      expect(button).toBeInTheDocument()
      expect(button).toHaveTextContent(item.icon)
    }
  })

  it('highlights the active page', () => {
    render(<Sidebar activePage="search" onPageChange={vi.fn()} />)

    const activeButton = screen.getByTitle('搜索')
    expect(activeButton).toHaveClass('bg-[var(--accent)]')
    expect(activeButton).toHaveClass('text-white')

    const inactiveButton = screen.getByTitle('设置')
    expect(inactiveButton).not.toHaveClass('bg-[var(--accent)]')
  })

  it('calls onPageChange when clicking a nav item', async () => {
    const onPageChange = vi.fn()
    render(<Sidebar activePage="search" onPageChange={onPageChange} />)

    await userEvent.click(screen.getByTitle('设置'))
    expect(onPageChange).toHaveBeenCalledWith('settings')
  })

  it('switches active page highlighting', () => {
    const { rerender } = render(
      <Sidebar activePage="search" onPageChange={vi.fn()} />
    )

    expect(screen.getByTitle('搜索')).toHaveClass('bg-[var(--accent)]')
    expect(screen.getByTitle('收藏夹')).not.toHaveClass('bg-[var(--accent)]')

    rerender(<Sidebar activePage="favourites" onPageChange={vi.fn()} />)

    expect(screen.getByTitle('搜索')).not.toHaveClass('bg-[var(--accent)]')
    expect(screen.getByTitle('收藏夹')).toHaveClass('bg-[var(--accent)]')
  })

  // ── 收起/展开两态（add-sidebar-collapse）──────────────────────────────

  it('默认为收起态：容器 w-16，菜单标签不渲染，按钮保留 title', () => {
    const { container } = render(<Sidebar activePage="search" onPageChange={vi.fn()} />)

    const sidebarRoot = container.firstElementChild as HTMLElement
    expect(sidebarRoot).toHaveClass('w-16')
    expect(sidebarRoot).not.toHaveClass('w-52')

    // 标签文本不在 DOM 中（仅 title tooltip）
    expect(screen.queryByText('漫画库')).not.toBeInTheDocument()
    expect(screen.getByTitle('漫画库')).toBeInTheDocument()
  })

  it('点击 toggle 后展开：容器变为 w-52，标签出现，菜单 title 被移除', async () => {
    const { container } = render(<Sidebar activePage="search" onPageChange={vi.fn()} />)
    const sidebarRoot = container.firstElementChild as HTMLElement

    expect(sidebarRoot).toHaveClass('w-16')
    expect(screen.queryByText('漫画库')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTitle('展开侧边栏'))

    expect(sidebarRoot).toHaveClass('w-52')
    expect(sidebarRoot).not.toHaveClass('w-16')
    // 标签现在可见
    expect(screen.getByText('漫画库')).toBeInTheDocument()
    // 展开态菜单按钮不再设置 title（避免与可见标签重复）
    expect(screen.queryByTitle('漫画库')).not.toBeInTheDocument()
  })

  it('展开态再次点击 toggle 回到收起态', async () => {
    const { container } = render(<Sidebar activePage="search" onPageChange={vi.fn()} />)
    const sidebarRoot = container.firstElementChild as HTMLElement

    await userEvent.click(screen.getByTitle('展开侧边栏'))
    expect(sidebarRoot).toHaveClass('w-52')

    await userEvent.click(screen.getByTitle('收起侧边栏'))

    expect(sidebarRoot).toHaveClass('w-16')
    expect(screen.queryByText('漫画库')).not.toBeInTheDocument()
    expect(screen.getByTitle('漫画库')).toBeInTheDocument()
  })

  it('toggle 按钮位于菜单项之后，且图标反映即将执行的动作', () => {
    render(<Sidebar activePage="search" onPageChange={vi.fn()} />)

    // 收起态：toggle 显示 »（即将展开），title=展开侧边栏
    const collapseToggle = screen.getByTitle('展开侧边栏')
    expect(collapseToggle).toHaveTextContent('»')

    // toggle 是最后一个 button（在 8 个菜单项之后）
    const allButtons = screen.getAllByRole('button')
    expect(allButtons[allButtons.length - 1]).toBe(collapseToggle)
  })

  it('reduced-motion 下展开仍可切换且标签渲染为纯 span', async () => {
    // 翻转 reduced-motion 偏好为 true
    reducedMotionOverride.current = true

    const { container } = render(<Sidebar activePage="search" onPageChange={vi.fn()} />)
    const sidebarRoot = container.firstElementChild as HTMLElement

    // 功能仍可用：点击 toggle 展开
    await userEvent.click(screen.getByTitle('展开侧边栏'))
    expect(sidebarRoot).toHaveClass('w-52')
    expect(screen.getByText('漫画库')).toBeInTheDocument()
  })
})
