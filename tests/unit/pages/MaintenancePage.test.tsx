import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MaintenancePage } from '@/pages/MaintenancePage'

vi.mock('@/components/maintenance/HealthCheckPanel', () => ({
  HealthCheckPanel: () => <div data-testid="health-panel">HealthCheckPanel</div>,
}))

vi.mock('@/components/maintenance/OrphanCleanupPanel', () => ({
  OrphanCleanupPanel: () => <div data-testid="orphan-panel">OrphanCleanupPanel</div>,
}))

vi.mock('@/components/maintenance/StorageStatsPanel', () => ({
  StorageStatsPanel: () => <div data-testid="storage-panel">StorageStatsPanel</div>,
}))

describe('MaintenancePage', () => {
  it('renders navigation tabs and default panel', () => {
    render(<MaintenancePage />)

    expect(screen.getByRole('tab', { name: /健康检查/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /临时目录清理/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /存储分析/i })).toBeInTheDocument()
    expect(screen.getByTestId('health-panel')).toBeInTheDocument()
  })

  it('switches to orphan cleanup panel', async () => {
    render(<MaintenancePage />)
    await userEvent.click(screen.getByRole('tab', { name: /临时目录清理/i }))
    expect(screen.getByTestId('orphan-panel')).toBeInTheDocument()
  })

  it('switches to storage stats panel', async () => {
    render(<MaintenancePage />)
    await userEvent.click(screen.getByRole('tab', { name: /存储分析/i }))
    expect(screen.getByTestId('storage-panel')).toBeInTheDocument()
  })
})
