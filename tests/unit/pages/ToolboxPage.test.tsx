import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/hooks/useIpc', () => ({
  useFavourites: () => ({
    getFavourites: vi.fn().mockResolvedValue({
      comics: [],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 0 },
      needsLogin: false,
    }),
  }),
  useFavouriteTags: () => ({
    getFavouriteTags: vi.fn().mockResolvedValue({ tags: [] }),
    syncFavouriteTags: vi.fn(),
    removeFavouriteTag: vi.fn(),
  }),
}))

vi.mock('@/stores/useDrawerStore', () => ({
  useDrawerStore: (selector: (state: { openDrawer: () => void }) => unknown) =>
    selector({ openDrawer: vi.fn() }),
}))

vi.mock('@/stores/useReaderStore', () => ({
  useReaderStore: (selector: (state: { openReader: () => void }) => unknown) =>
    selector({ openReader: vi.fn() }),
}))

import { ToolboxPage } from '@/pages/ToolboxPage'

describe('ToolboxPage', () => {
  it('renders page title', () => {
    render(<ToolboxPage />)
    const headings = screen.getAllByText('工具箱')
    expect(headings).toHaveLength(2) // sidebar label + page heading
    expect(headings[0]).toBeInTheDocument()
  })

  it('renders the duplicate detector tool', () => {
    render(<ToolboxPage />)
    const matches = screen.getAllByText('重复检测')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('renders sidebar navigation buttons', () => {
    render(<ToolboxPage />)
    expect(screen.getAllByText('标签过滤').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('推荐标签').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('重复检测').length).toBeGreaterThanOrEqual(1)
  })

  it('renders all section anchors for smooth-scroll navigation', () => {
    render(<ToolboxPage />)
    expect(document.getElementById('section-tag-filter')).toBeInTheDocument()
    expect(document.getElementById('section-favourite-tags')).toBeInTheDocument()
    expect(document.getElementById('section-duplicate')).toBeInTheDocument()
  })
})
