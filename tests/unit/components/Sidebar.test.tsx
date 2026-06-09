import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from '@/components/Sidebar'

describe('Sidebar', () => {
  const menuItems = [
    { id: 'search', label: '搜索', icon: '🔍' },
    { id: 'downloads', label: '下载管理', icon: '📥' },
    { id: 'favourites', label: '收藏夹', icon: '⭐' },
    { id: 'history', label: '历史记录', icon: '🕐' },
    { id: 'toolbox', label: '工具箱', icon: '🧰' },
    { id: 'settings', label: '设置', icon: '⚙️' },
    { id: 'about', label: '关于', icon: 'ℹ️' }
  ]

  it('renders all navigation items', () => {
    render(<Sidebar activePage="search" onPageChange={vi.fn()} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(7)

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
})
