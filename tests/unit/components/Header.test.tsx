import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Header } from '@/components/Header'

describe('Header', () => {
  it('renders search input', () => {
    render(<Header onSearch={vi.fn()} />)

    expect(screen.getByPlaceholderText('搜索漫画...')).toBeInTheDocument()
  })

  it('renders submit button', () => {
    render(<Header onSearch={vi.fn()} />)

    expect(screen.getByRole('button', { name: '搜索' })).toBeInTheDocument()
  })

  it('calls onSearch when form submitted with text', async () => {
    const onSearch = vi.fn()
    render(<Header onSearch={onSearch} />)

    const input = screen.getByPlaceholderText('搜索漫画...')
    await userEvent.type(input, 'test query')
    await userEvent.click(screen.getByRole('button', { name: '搜索' }))

    expect(onSearch).toHaveBeenCalledWith('test query')
  })

  it('calls onSearch when Enter key pressed', async () => {
    const onSearch = vi.fn()
    render(<Header onSearch={onSearch} />)

    const input = screen.getByPlaceholderText('搜索漫画...')
    await userEvent.type(input, 'hello world{Enter}')

    expect(onSearch).toHaveBeenCalledWith('hello world')
  })

  it('does not call onSearch with empty query', async () => {
    const onSearch = vi.fn()
    render(<Header onSearch={onSearch} />)

    await userEvent.click(screen.getByRole('button', { name: '搜索' }))

    expect(onSearch).not.toHaveBeenCalled()
  })

  it('does not call onSearch with whitespace-only query', async () => {
    const onSearch = vi.fn()
    render(<Header onSearch={onSearch} />)

    const input = screen.getByPlaceholderText('搜索漫画...')
    await userEvent.type(input, '   ')
    await userEvent.click(screen.getByRole('button', { name: '搜索' }))

    expect(onSearch).not.toHaveBeenCalled()
  })

  it('trims whitespace from query before calling onSearch', async () => {
    const onSearch = vi.fn()
    render(<Header onSearch={onSearch} />)

    const input = screen.getByPlaceholderText('搜索漫画...')
    await userEvent.type(input, '  padded  ')
    await userEvent.click(screen.getByRole('button', { name: '搜索' }))

    expect(onSearch).toHaveBeenCalledWith('padded')
  })

  it('updates input value when typing', async () => {
    render(<Header onSearch={vi.fn()} />)

    const input = screen.getByPlaceholderText('搜索漫画...') as HTMLInputElement
    await userEvent.type(input, 'abc')

    expect(input.value).toBe('abc')
  })
})
