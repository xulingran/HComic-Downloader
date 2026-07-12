import { beforeEach, describe, expect, it } from 'vitest'
import type { ComicInfo, LibraryAssetDetail } from '@shared/types'
import { useReaderStore } from '@/stores/useReaderStore'
import { useLocalReaderStore } from '@/stores/useLocalReaderStore'

const comicA = { id: 'a', title: 'A' } as ComicInfo
const comicB = { id: 'b', title: 'B' } as ComicInfo
const assetA = { assetId: 'asset-a', title: 'A' } as LibraryAssetDetail
const assetB = { assetId: 'asset-b', title: 'B' } as LibraryAssetDetail

describe('reader close lifecycle stores', () => {
  beforeEach(() => {
    useReaderStore.setState({
      readerComic: null,
      open: false,
      sessionId: 0,
      closingSessionId: null,
      initialPage: null,
      initialChapterId: null,
    })
    useLocalReaderStore.setState({
      readerAsset: null,
      open: false,
      sessionId: 0,
      closingSessionId: null,
      justClosedAssetId: null,
    })
  })

  it('retains the online comic until the matching exit completes', () => {
    const store = useReaderStore.getState()
    store.openReader(comicA, 3, 'chapter-a')
    const sessionId = useReaderStore.getState().sessionId

    useReaderStore.getState().closeReader()
    expect(useReaderStore.getState()).toMatchObject({
      readerComic: comicA,
      open: false,
      closingSessionId: sessionId,
      initialPage: 3,
      initialChapterId: 'chapter-a',
    })

    useReaderStore.getState().finalizeClose(sessionId)
    expect(useReaderStore.getState()).toMatchObject({
      readerComic: null,
      closingSessionId: null,
      initialPage: null,
      initialChapterId: null,
    })
  })

  it('ignores repeated closes and a stale online exit callback', () => {
    useReaderStore.getState().openReader(comicA)
    const oldSessionId = useReaderStore.getState().sessionId
    useReaderStore.getState().closeReader()
    useReaderStore.getState().closeReader()
    useReaderStore.getState().openReader(comicB)

    useReaderStore.getState().finalizeClose(oldSessionId)
    expect(useReaderStore.getState()).toMatchObject({ readerComic: comicB, open: true })
  })

  it('retains a local asset and publishes its refresh id before final cleanup', () => {
    useLocalReaderStore.getState().openReader(assetA)
    const sessionId = useLocalReaderStore.getState().sessionId
    useLocalReaderStore.getState().closeReader()

    expect(useLocalReaderStore.getState()).toMatchObject({
      readerAsset: assetA,
      open: false,
      closingSessionId: sessionId,
      justClosedAssetId: 'asset-a',
    })

    useLocalReaderStore.getState().finalizeClose(sessionId)
    expect(useLocalReaderStore.getState()).toMatchObject({
      readerAsset: null,
      closingSessionId: null,
      justClosedAssetId: 'asset-a',
    })
  })

  it('does not let an old local exit callback clear a newly opened asset', () => {
    useLocalReaderStore.getState().openReader(assetA)
    const oldSessionId = useLocalReaderStore.getState().sessionId
    useLocalReaderStore.getState().closeReader()
    useLocalReaderStore.getState().openReader(assetB)

    useLocalReaderStore.getState().finalizeClose(oldSessionId)
    expect(useLocalReaderStore.getState()).toMatchObject({ readerAsset: assetB, open: true })
  })
})
