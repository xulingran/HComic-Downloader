import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { CacheSettings } from '@/components/settings/CacheSettings'
import * as toastStore from '@/stores/useToastStore'

const baseStats = {
  cover: { file_count: 3, total_size_bytes: 1024 },
  preview: { file_count: 5, total_size_bytes: 2048 },
  total: { file_count: 8, total_size_bytes: 3072 },
}

function setWindowHcomic(overrides: Record<string, unknown> = {}) {
  Object.defineProperty(window, 'hcomic', {
    value: {
      getCacheStats: vi.fn().mockResolvedValue(baseStats),
      getCacheDir: vi.fn().mockResolvedValue({ dir: '/home/user/.hcomic_downloader' }),
      openCacheDir: vi.fn().mockResolvedValue({ success: true }),
      clearPreviewCache: vi.fn().mockResolvedValue({ success: true }),
      clearAllCache: vi.fn().mockResolvedValue({ success: true }),
      ...overrides,
    },
    writable: true,
    configurable: true,
  })
}

describe('CacheSettings - 缓存目录展示与打开', () => {
  beforeEach(() => {
    setWindowHcomic()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const props = {
    onSizeLimitChange: vi.fn(),
    sizeLimitMB: 500,
    previewPreloadForward: 8,
    previewPreloadBackward: 2,
    previewPreloadConcurrency: 3,
    previewPreloadAdaptive: false,
    onConfigChange: vi.fn(),
  }

  it('显示后端返回的缓存目录绝对路径', async () => {
    render(<CacheSettings {...props} />)
    await waitFor(() => {
      expect(screen.getByText('/home/user/.hcomic_downloader')).toBeInTheDocument()
    })
  })

  it('getCacheDir 失败时降级显示「无法获取缓存目录」并禁用打开按钮', async () => {
    setWindowHcomic({ getCacheDir: vi.fn().mockRejectedValue(new Error('boom')) })
    render(<CacheSettings {...props} />)
    await waitFor(() => {
      expect(screen.getByText('无法获取缓存目录')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: '打开目录' })).toBeDisabled()
  })

  it('点击「打开目录」调用 openCacheDir 并传入显示的路径', async () => {
    const user = userEvent.setup()
    render(<CacheSettings {...props} />)
    await waitFor(() => {
      expect(screen.getByText('/home/user/.hcomic_downloader')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: '打开目录' }))
    await waitFor(() => {
      expect(window.hcomic!.openCacheDir).toHaveBeenCalledWith('/home/user/.hcomic_downloader')
    })
  })

  it('openCacheDir 失败时显示错误 toast', async () => {
    const user = userEvent.setup()
    const errorSpy = vi.spyOn(toastStore.useToastStore.getState(), 'error').mockImplementation(() => {})
    setWindowHcomic({ openCacheDir: vi.fn().mockRejectedValue(new Error('open failed')) })
    render(<CacheSettings {...props} />)
    await waitFor(() => {
      expect(screen.getByText('/home/user/.hcomic_downloader')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: '打开目录' }))
    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith('无法打开缓存目录')
    })
  })

  it('缓存目录取回失败不阻塞缓存统计正常显示', async () => {
    setWindowHcomic({ getCacheDir: vi.fn().mockRejectedValue(new Error('boom')) })
    render(<CacheSettings {...props} />)
    // 统计仍应正常渲染（封面/预览/合计）
    await waitFor(() => {
      expect(screen.getByText('封面缓存')).toBeInTheDocument()
    })
    expect(screen.getByText('无法获取缓存目录')).toBeInTheDocument()
  })
})
