import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FavouriteSourceSidebar } from '@/components/favourites/FavouriteSourceSidebar'

describe('FavouriteSourceSidebar', () => {
  it('只渲染支持收藏夹的四个来源', () => {
    render(<FavouriteSourceSidebar activeSource="hcomic" onSelect={vi.fn()} />)

    expect(screen.getAllByRole('button')).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'HComic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'MoeImg' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'JM' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '哔咔' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '拷贝漫画' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'NH' })).not.toBeInTheDocument()
  })

  it('仅为当前来源暴露选中语义', () => {
    render(<FavouriteSourceSidebar activeSource="jm" onSelect={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'JM' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'HComic' })).not.toHaveAttribute('aria-current')
  })

  it('未选择来源时不产生伪选中项', () => {
    render(<FavouriteSourceSidebar activeSource={null} onSelect={vi.fn()} />)

    expect(screen.queryByRole('button', { current: 'page' })).not.toBeInTheDocument()
  })

  it('鼠标点击会上报目标来源', async () => {
    const onSelect = vi.fn()
    render(<FavouriteSourceSidebar activeSource="hcomic" onSelect={onSelect} />)

    await userEvent.click(screen.getByRole('button', { name: 'MoeImg' }))

    expect(onSelect).toHaveBeenCalledWith('moeimg')
  })

  it('键盘可聚焦并激活来源按钮', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<FavouriteSourceSidebar activeSource="hcomic" onSelect={onSelect} />)

    await user.tab()
    await user.tab()
    expect(screen.getByRole('button', { name: 'MoeImg' })).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('moeimg')
  })
})
