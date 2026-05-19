import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBar } from '@/components/StatusBar'
import { useDownloadStore } from '@/stores/useDownloadStore'
import type { DownloadTask } from '@shared/types'

function makeTask(overrides: Partial<DownloadTask>): DownloadTask {
  return {
    id: 't1',
    comic: { id: 'c1', title: 'Test Comic', url: '', coverUrl: '', source: 'hcomic' },
    status: 'downloading',
    progress: 50,
    totalPages: 10,
    downloadedPages: 5,
    ...overrides,
  }
}

beforeEach(() => {
  useDownloadStore.setState({ tasks: [] })
})

describe('StatusBar', () => {
  it('renders nothing when no tasks', () => {
    const { container } = render(<StatusBar />)
    expect(container.innerHTML).toBe('')
  })

  it('renders active count for downloading tasks', () => {
    useDownloadStore.getState().setTasks([makeTask({ status: 'downloading' })])
    render(<StatusBar />)
    expect(screen.getByText('下载中: 1 个任务')).toBeInTheDocument()
  })

  it('counts queued tasks as active', () => {
    useDownloadStore.getState().setTasks([makeTask({ status: 'queued' })])
    render(<StatusBar />)
    expect(screen.getByText('下载中: 1 个任务')).toBeInTheDocument()
  })

  it('counts pausing tasks as active', () => {
    useDownloadStore.getState().setTasks([makeTask({ status: 'pausing' })])
    render(<StatusBar />)
    expect(screen.getByText('下载中: 1 个任务')).toBeInTheDocument()
  })

  it('shows downloading task title and progress', () => {
    useDownloadStore.getState().setTasks([makeTask({ status: 'downloading', progress: 42 })])
    render(<StatusBar />)
    expect(screen.getByText('Test Comic')).toBeInTheDocument()
    expect(screen.getByText('5 / 10')).toBeInTheDocument()
  })
})
