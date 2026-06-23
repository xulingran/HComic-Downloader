import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HealthCheckPanel } from '@/components/maintenance/HealthCheckPanel'

const mockRunHealthCheck = vi.fn()
const mockSuccess = vi.fn()
const mockError = vi.fn()

vi.mock('@/hooks/useIpc', () => ({
  useMaintenance: () => ({ runHealthCheck: mockRunHealthCheck }),
  useMaintenanceProgress: () => ({ progress: null, clear: vi.fn() }),
}))

vi.mock('@/stores/useToastStore', () => ({
  useToastStore: () => ({
    success: mockSuccess,
    error: mockError,
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}))

describe('HealthCheckPanel', () => {
  beforeEach(() => {
    mockRunHealthCheck.mockReset()
    mockSuccess.mockReset()
    mockError.mockReset()
  })

  it('renders start button', () => {
    render(<HealthCheckPanel />)
    expect(screen.getByRole('button', { name: /开始检查/i })).toBeInTheDocument()
  })

  it('runs health check and shows issues', async () => {
    mockRunHealthCheck.mockResolvedValue({
      scanned: 2,
      issues: [
        {
          key: ['hcomic', '1', 'NH'],
          title: 'Test Comic',
          outputPath: '/tmp/test',
          outputFormat: 'cbz',
          expectedPages: 10,
          actualPages: 8,
          checks: [{ kind: 'incomplete_pages', detail: '期望 10 页，实际 8 页' }],
        },
      ],
    })

    render(<HealthCheckPanel />)
    await userEvent.click(screen.getByRole('button', { name: /开始检查/i }))

    await waitFor(() => expect(mockRunHealthCheck).toHaveBeenCalledWith('all'))
    expect(await screen.findByText('Test Comic')).toBeInTheDocument()
    await userEvent.click(screen.getByText('展开'))
    expect(screen.getByText('incomplete_pages')).toBeInTheDocument()
    expect(mockError).toHaveBeenCalledWith('发现 1 项异常')
  })

  it('shows success message when no issues', async () => {
    mockRunHealthCheck.mockResolvedValue({ scanned: 3, issues: [] })

    render(<HealthCheckPanel />)
    await userEvent.click(screen.getByRole('button', { name: /开始检查/i }))

    await waitFor(() => expect(screen.getByText(/所有下载项均健康/i)).toBeInTheDocument())
    expect(mockSuccess).toHaveBeenCalledWith('健康检查完成：3 项全部正常')
  })

  it('shows error toast on failure', async () => {
    mockRunHealthCheck.mockRejectedValue(new Error('IPC error'))

    render(<HealthCheckPanel />)
    await userEvent.click(screen.getByRole('button', { name: /开始检查/i }))

    await waitFor(() => expect(mockError).toHaveBeenCalledWith('健康检查失败：IPC error'))
  })
})
