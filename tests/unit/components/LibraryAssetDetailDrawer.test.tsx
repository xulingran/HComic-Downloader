import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HcomicAPI, LibraryAssetDetail } from '@shared/types'
import { LibraryAssetDetailDrawer } from '@/components/library/LibraryAssetDetailDrawer'
import { Toaster } from '@/components/common/Toaster'

const asset: LibraryAssetDetail = {
  assetId: 'asset-1', title: 'Old Title', author: 'Old Author', tags: ['old'], sourceSite: '', comicId: '',
  comicSource: '', albumId: '', albumTotalChapters: 1, format: 'cbz', pageCount: 2, sizeBytes: 100,
  modifiedAt: 1, chapters: [], coverKey: null, healthStatus: 'unknown', lastReadAt: null, readingPage: null,
  readingChapterId: null, pathSummary: 'Old Title.cbz', metadataOverridden: false, version: 1,
}

function Harness({ currentAsset = asset, onOpenReader = () => {} }: {
  currentAsset?: LibraryAssetDetail
  onOpenReader?: (assetId: string, mode: 'resume' | 'restart') => void
}) {
  const [open, setOpen] = useState(true)
  return <><Toaster /><LibraryAssetDetailDrawer asset={currentAsset} open={open} onClose={() => setOpen(false)} onOpenReader={onOpenReader} onChanged={() => {}} /></>
}

describe('LibraryAssetDetailDrawer', () => {
  beforeEach(() => {
    window.hcomic = {
      libraryEditMetadata: vi.fn().mockResolvedValue({ success: true, assetId: 'asset-1', writtenToFile: true, version: 2 }),
    } as unknown as HcomicAPI
  })

  it('edits CBZ metadata and closes after the atomic write succeeds', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByTestId('detail-edit-metadata-btn'))
    const title = screen.getByLabelText('标题')
    await userEvent.clear(title)
    await userEvent.type(title, 'New Title')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('元数据已写入 ComicInfo.xml')).toBeInTheDocument()
    // onClose 翻 open=false 后，AnimatePresence 会在退场动画窗口内保留面板节点，
    // 需用 waitFor 等待退场动画结束、面板真正从 DOM 移除
    await waitFor(() => {
      expect(screen.queryByTestId('library-detail-drawer')).not.toBeInTheDocument()
    })
  })

  it('offers resume and restart when the saved progress is valid', async () => {
    const onOpenReader = vi.fn()
    const resumedAsset = { ...asset, readingPage: 2, lastReadAt: 10 }
    render(<Harness currentAsset={resumedAsset} onOpenReader={onOpenReader} />)

    expect(screen.getByTestId('detail-reading-progress')).toHaveTextContent('上次读到第 2 页')
    await userEvent.click(screen.getByRole('button', { name: '从头开始' }))
    await userEvent.click(screen.getByRole('button', { name: '继续阅读' }))

    expect(onOpenReader).toHaveBeenNthCalledWith(1, 'asset-1', 'restart')
    expect(onOpenReader).toHaveBeenNthCalledWith(2, 'asset-1', 'resume')
  })

  it('does not offer resume when the saved chapter is no longer valid', async () => {
    const onOpenReader = vi.fn()
    const invalidAsset = {
      ...asset,
      albumTotalChapters: 2,
      readingPage: 2,
      readingChapterId: 'missing',
      chapters: [
        { chapterId: 'ch1', name: '第一章', index: 0, pageCount: 2 },
        { chapterId: 'ch2', name: '第二章', index: 1, pageCount: 2 },
      ],
    }
    render(<Harness currentAsset={invalidAsset} onOpenReader={onOpenReader} />)

    expect(screen.queryByRole('button', { name: '继续阅读' })).not.toBeInTheDocument()
    expect(screen.getByTestId('detail-invalid-progress')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '从头开始' }))
    expect(onOpenReader).toHaveBeenCalledWith('asset-1', 'restart')
  })

  it('shows a single start action when there is no progress', async () => {
    const onOpenReader = vi.fn()
    render(<Harness onOpenReader={onOpenReader} />)
    expect(screen.queryByRole('button', { name: '继续阅读' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    expect(onOpenReader).toHaveBeenCalledWith('asset-1', 'restart')
  })
})
