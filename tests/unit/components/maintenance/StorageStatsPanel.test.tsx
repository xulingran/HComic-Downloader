import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { StorageStatsPanel } from '@/components/maintenance/StorageStatsPanel'

const mockGetStorageStats = vi.fn()
const mockError = vi.fn()

vi.mock('@/hooks/useIpc', () => ({
  useMaintenance: () => ({ getStorageStats: mockGetStorageStats }),
}))

vi.mock('@/stores/useToastStore', () => ({
  useToastStore: () => ({
    success: vi.fn(),
    error: mockError,
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}))

describe('StorageStatsPanel', () => {
  beforeEach(() => {
    mockGetStorageStats.mockReset()
    mockError.mockReset()
  })

  it('loads and displays storage stats on mount', async () => {
    mockGetStorageStats.mockResolvedValue({
      totalSizeBytes: 1024 * 1024 * 100,
      totalFiles: 10,
      bySource: { hcomic: 1024 * 1024 * 60, moeimg: 1024 * 1024 * 40 },
      byFormat: { folder: 1024 * 1024 * 30, cbz: 1024 * 1024 * 50, zip: 1024 * 1024 * 20 },
      byAuthor: [{ name: 'Author A', sizeBytes: 1024 * 1024 * 50, itemCount: 5 }],
      topItems: [
        {
          path: '/downloads/a.cbz',
          title: 'Top Comic',
          author: 'Author A',
          sourceSite: 'hcomic',
          sizeBytes: 1024 * 1024 * 30,
          pageCount: 20,
        },
      ],
      orphanFiles: { count: 1, sizeBytes: 1024 * 1024 },
      untrackedFiles: { count: 2, sizeBytes: 1024 * 1024 * 2 },
    })

    render(<StorageStatsPanel />)

    await waitFor(() => expect(mockGetStorageStats).toHaveBeenCalled())
    expect(await screen.findByText('100.0 MB')).toBeInTheDocument()
    expect(screen.getByText('10 个文件/目录')).toBeInTheDocument()
    expect(screen.getByText('2 个')).toBeInTheDocument() // untracked count（未在历史记录中）
    expect(screen.getByText('Top Comic')).toBeInTheDocument()
    expect(screen.getByText('Author A')).toBeInTheDocument()
  })

  it('shows error toast on failure', async () => {
    mockGetStorageStats.mockRejectedValue(new Error('load failed'))

    render(<StorageStatsPanel />)

    await waitFor(() => expect(mockError).toHaveBeenCalledWith('加载存储统计失败：load failed'))
  })
})
