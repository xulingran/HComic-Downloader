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
}))

vi.mock('@/stores/useDrawerStore', () => ({
  useDrawerStore: (selector: (state: { openDrawer: () => void }) => unknown) =>
    selector({ openDrawer: vi.fn() }),
}))

import { ToolboxPage } from '@/pages/ToolboxPage'

describe('ToolboxPage', () => {
  it('renders page title', () => {
    render(<ToolboxPage />)
    expect(screen.getByText('工具箱')).toBeInTheDocument()
  })

  it('renders the duplicate detector tool', () => {
    render(<ToolboxPage />)
    expect(screen.getByText('重复检测')).toBeInTheDocument()
  })
})
