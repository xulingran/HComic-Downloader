import { useState } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MigrationDialog } from '@/components/settings/MigrationDialog'
import { createMockHcomic } from '../../../__mocks__/ipc'

const readyStatus = {
  status: 'ready' as const,
  id: 'ready-id',
  mode: 'repair' as const,
  completed_items: 0,
  total_items: 5,
  failed_items: [],
  source_dir: '',
  target_dir: 'E:/library',
  is_same_drive: false,
}

const dialogProps = {
  currentDownloadDir: 'C:/old-library',
  onSelectDirectory: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
}

describe('MigrationDialog ready plan lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as Record<string, unknown>).hcomic
  })

  it('restores a ready preview and confirms the recovered migration id', async () => {
    const api = createMockHcomic({
      getMigrationStatus: vi.fn().mockResolvedValue(readyStatus),
      confirmMigration: vi.fn().mockResolvedValue({ started: true }),
    })

    render(<MigrationDialog isOpen onClose={vi.fn()} {...dialogProps} />)

    expect(await screen.findByText('迁移文件数')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.queryByText('新的下载目录')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('开始迁移'))

    await waitFor(() => expect(api.confirmMigration).toHaveBeenCalledWith('ready-id'))
    expect(await screen.findByText('后台运行')).toBeInTheDocument()
  })

  it('cancels the ready plan before returning to selection', async () => {
    const api = createMockHcomic({
      getMigrationStatus: vi.fn().mockResolvedValue(readyStatus),
      cancelMigration: vi.fn().mockResolvedValue({ cancelled: true }),
    })

    render(<MigrationDialog isOpen onClose={vi.fn()} {...dialogProps} />)
    expect(await screen.findByText('迁移文件数')).toBeInTheDocument()
    fireEvent.click(screen.getByText('返回'))

    expect(await screen.findByText('下一步')).toBeInTheDocument()
    expect(screen.getByDisplayValue('E:/library')).toBeInTheDocument()
    expect(api.cancelMigration).toHaveBeenCalledTimes(1)
  })

  it('cancels the ready plan before closing the dialog', async () => {
    const api = createMockHcomic({
      getMigrationStatus: vi.fn().mockResolvedValue(readyStatus),
      cancelMigration: vi.fn().mockResolvedValue({ cancelled: true }),
    })
    const onClose = vi.fn()

    render(<MigrationDialog isOpen onClose={onClose} {...dialogProps} />)
    expect(await screen.findByText('迁移文件数')).toBeInTheDocument()
    fireEvent.click(screen.getByText('✕'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(api.cancelMigration).toHaveBeenCalledTimes(1)
  })

  it('keeps the preview visible when abandoning the plan fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onClose = vi.fn()
    createMockHcomic({
      getMigrationStatus: vi.fn().mockResolvedValue(readyStatus),
      cancelMigration: vi.fn().mockRejectedValue(new Error('cancel IPC failed')),
    })

    render(<MigrationDialog isOpen onClose={onClose} {...dialogProps} />)
    expect(await screen.findByText('迁移文件数')).toBeInTheDocument()
    fireEvent.click(screen.getByText('✕'))

    expect(await screen.findByText('cancel IPC failed')).toBeInTheDocument()
    expect(screen.getByText('迁移文件数')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('hides a running migration without cancelling it', async () => {
    const api = createMockHcomic({
      getMigrationStatus: vi.fn().mockResolvedValue({
        status: 'running',
        id: 'running-id',
        mode: 'full',
        completed_items: 2,
        total_items: 5,
        failed_items: [],
        source_dir: 'C:/old-library',
        target_dir: 'E:/library',
        is_same_drive: false,
      }),
    })

    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <span>{open ? 'dialog-open' : 'dialog-closed'}</span>
          <MigrationDialog isOpen={open} onClose={() => setOpen(false)} {...dialogProps} />
        </>
      )
    }

    render(<Harness />)
    fireEvent.click(await screen.findByText('后台运行'))

    expect(await screen.findByText('dialog-closed')).toBeInTheDocument()
    expect(api.cancelMigration).not.toHaveBeenCalled()
  })
})
