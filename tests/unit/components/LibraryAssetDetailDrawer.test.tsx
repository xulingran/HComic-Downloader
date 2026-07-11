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

function Harness() {
  const [open, setOpen] = useState(true)
  return <><Toaster /><LibraryAssetDetailDrawer asset={asset} open={open} onClose={() => setOpen(false)} onOpenReader={() => {}} onChanged={() => {}} /></>
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
})
