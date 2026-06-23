import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OrphanCleanupPanel } from '@/components/maintenance/OrphanCleanupPanel'

const mockScanOrphanTemps = vi.fn()
const mockCleanupOrphanTemps = vi.fn()
const mockSuccess = vi.fn()
const mockError = vi.fn()

vi.mock('@/hooks/useIpc', () => ({
  useMaintenance: () => ({
    scanOrphanTemps: mockScanOrphanTemps,
    cleanupOrphanTemps: mockCleanupOrphanTemps,
  }),
}))

vi.mock('@/stores/useToastStore', () => ({
  useToastStore: () => ({
    success: mockSuccess,
    error: mockError,
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}))

describe('OrphanCleanupPanel', () => {
  beforeEach(() => {
    mockScanOrphanTemps.mockReset()
    mockCleanupOrphanTemps.mockReset()
    mockSuccess.mockReset()
    mockError.mockReset()
  })

  it('renders scan button', () => {
    render(<OrphanCleanupPanel />)
    expect(screen.getByRole('button', { name: /扫描临时目录/i })).toBeInTheDocument()
  })

  it('scans and lists orphan temp dirs', async () => {
    mockScanOrphanTemps.mockResolvedValue({
      orphans: [
        { path: '/downloads/temp_abc', sizeBytes: 1024 * 1024, modifiedAt: 1700000000 },
        { path: '/downloads/temp_xyz', sizeBytes: 2048 * 1024, modifiedAt: 1700000100 },
      ],
      totalSizeBytes: 3072 * 1024,
    })

    render(<OrphanCleanupPanel />)
    await userEvent.click(screen.getByRole('button', { name: /扫描临时目录/i }))

    await waitFor(() => expect(mockScanOrphanTemps).toHaveBeenCalled())
    expect(screen.getByText('/downloads/temp_abc')).toBeInTheDocument()
    expect(screen.getByText('/downloads/temp_xyz')).toBeInTheDocument()
    expect(screen.getByText('共 2 个，合计 3.0 MB')).toBeInTheDocument()
  })

  it('supports select all and cleanup', async () => {
    mockScanOrphanTemps.mockResolvedValue({
      orphans: [
        { path: '/downloads/temp_abc', sizeBytes: 1024 * 1024, modifiedAt: 1700000000 },
      ],
      totalSizeBytes: 1024 * 1024,
    })
    mockCleanupOrphanTemps.mockResolvedValue({ removed: 1, freedBytes: 1024 * 1024, failed: [] })

    render(<OrphanCleanupPanel />)
    await userEvent.click(screen.getByRole('button', { name: /扫描临时目录/i }))
    await screen.findByText('/downloads/temp_abc')

    await userEvent.click(screen.getByRole('checkbox', { name: /选择/i }))
    const cleanButton = screen.getByRole('button', { name: /清理选中/i })
    expect(cleanButton).not.toBeDisabled()

    await userEvent.click(cleanButton)
    await waitFor(() => expect(mockCleanupOrphanTemps).toHaveBeenCalledWith(['/downloads/temp_abc']))
    expect(mockSuccess).toHaveBeenCalledWith('已清理 1 个目录，释放 1.0 MB')
  })

  it('shows empty hint when no orphans', async () => {
    mockScanOrphanTemps.mockResolvedValue({ orphans: [], totalSizeBytes: 0 })

    render(<OrphanCleanupPanel />)
    await userEvent.click(screen.getByRole('button', { name: /扫描临时目录/i }))

    await waitFor(() => expect(mockSuccess).toHaveBeenCalledWith('未发现孤儿临时目录'))
  })
})
