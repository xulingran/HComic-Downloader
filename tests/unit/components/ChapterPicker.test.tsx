import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChapterPicker } from '@/components/ChapterPicker'

const chapters = [
  { id: '999001', name: '第 1 話', index: 1 },
  { id: '999002', name: '第 2 話', index: 2 },
]

describe('ChapterPicker', () => {
  it('renders chapters and fires onSelect with chapter id', () => {
    const onSelect = vi.fn()
    render(<ChapterPicker chapters={chapters} onSelect={onSelect} />)
    expect(screen.getByText('第 1 話')).toBeInTheDocument()
    fireEvent.click(screen.getByText('第 2 話'))
    expect(onSelect).toHaveBeenCalledWith('999002')
  })

  it('shows chapter count and optional title', () => {
    render(<ChapterPicker chapters={chapters} onSelect={vi.fn()} title="多章漫画" />)
    expect(screen.getByText(/多章漫画/)).toBeInTheDocument()
    expect(screen.getByText(/共 2 章/)).toBeInTheDocument()
  })
})
