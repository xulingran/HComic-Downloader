import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ComicInfo, HistoryItem } from '@shared/types'

const { mockGetHistory, mockDeleteHistory, mockClearHistory, mockOpenReader } = vi.hoisted(() => ({
  mockGetHistory: vi.fn(),
  mockDeleteHistory: vi.fn(),
  mockClearHistory: vi.fn(),
  mockOpenReader: vi.fn(),
}))

vi.mock('@/hooks/useIpc', () => ({
  useHistory: vi.fn().mockReturnValue({
    getHistory: mockGetHistory,
    deleteHistory: mockDeleteHistory,
    clearHistory: mockClearHistory,
  }),
}))

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: vi.fn().mockReturnValue({ cardStyle: 'cover' }),
}))

vi.mock('@/stores/useHistoryStore', () => ({
  useHistoryStore: vi.fn().mockReturnValue({
    items: [],
    pagination: null,
    currentPage: 1,
    hasCache: false,
    setCache: vi.fn(),
    clearCache: vi.fn(),
  }),
}))

vi.mock('@/stores/useReaderStore', () => ({
  useReaderStore: vi.fn().mockReturnValue({
    openReader: mockOpenReader,
  }),
}))

vi.mock('@/components/common/ComicCard', () => ({
  ComicCard: ({ comic }: { comic: ComicInfo }) => (
    <div data-testid="comic-card">{comic.title}</div>
  ),
}))

import { HistoryPage } from '@/pages/HistoryPage'

function makeHistoryItem(overrides: Partial<HistoryItem>): HistoryItem {
  return {
    id: 1,
    comicId: 'comic-1',
    title: 'History Comic',
    coverUrl: '',
    source: 'NH',
    sourceSite: 'hcomic',
    mediaId: 'media-1',
    sourceUrl: 'https://example.com/comic-1',
    lastPage: 1,
    totalPages: 10,
    lastReadAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('HistoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetHistory.mockResolvedValue({
      items: [],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 0 },
    })
  })

  it('shows source site labels for history records', async () => {
    mockGetHistory.mockResolvedValue({
      items: [
        makeHistoryItem({ id: 1, comicId: 'h-1', title: 'HComic Item', sourceSite: 'hcomic' }),
        makeHistoryItem({ id: 2, comicId: 'm-1', title: 'Moeimg Item', sourceSite: 'moeimg' }),
        makeHistoryItem({ id: 3, comicId: 'j-1', title: 'JMComic Item', sourceSite: 'jmcomic' }),
      ],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 3 },
    })

    render(<HistoryPage />)

    await screen.findByText('HComic Item')

    expect(screen.getByText('HComic')).toBeInTheDocument()
    expect(screen.getByText('Moeimg')).toBeInTheDocument()
    expect(screen.getByText('JMComic')).toBeInTheDocument()
  })
})
