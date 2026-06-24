import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useDrawerStore } from '@/stores/useDrawerStore'
import type { ComicInfo } from '@shared/types'

// --- Mocks（必须用 @/ 别名，相对路径 mock 会失效导致真实模块加载、jsdom 下渲染循环 OOM）---

vi.mock('@/components/common/Toast', () => ({
  Toast: ({ message, visible }: { message: string; visible: boolean }) =>
    visible ? <div>{message}</div> : null,
}))
vi.mock('@/utils/auth', () => ({
  isAuthError: () => false,
}))
vi.mock('@/utils/source', () => ({
  normalizeSourceKey: (s: string) => s,
  sourceSupportsFavourites: () => false,
  sourceSupportsTagRecommendation: () => false,
  sourceNeedsDetailEnrich: () => false,
}))
vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: () => ({
    tagBlacklist: { hcomic: [], moeimg: [], jmcomic: [], bika: [], copymanga: [] },
    favouriteTagHighlight: false,
    addTag: () => {},
    removeTag: () => {},
  }),
}))
const mockCheckFavourite = vi.fn().mockResolvedValue({ isFavourited: false })
const mockGetComicDetail = vi.fn().mockResolvedValue({ comic: null })
const mockGetFavouriteTags = vi.fn().mockResolvedValue({ tags: [] })
vi.mock('@/hooks/useIpc', () => ({
  useAddToFavourites: () => ({ addToFavourites: () => Promise.resolve() }),
  useRemoveFromFavourites: () => ({ removeFromFavourites: () => Promise.resolve() }),
  useCheckFavourite: () => ({ checkFavourite: mockCheckFavourite }),
  useComicDetail: () => ({ getComicDetail: mockGetComicDetail }),
  useFavouriteTags: () => ({ getFavouriteTags: mockGetFavouriteTags }),
}))

const { ComicInfoDrawer } = await import('@/components/ComicInfoDrawer')

// --- Fixtures -------------------------------------------------------------

const comicWithTags: ComicInfo = {
  id: '1',
  title: '测试漫画',
  url: 'https://example.com/1',
  coverUrl: 'https://example.com/cover.jpg',
  source: 'hcomic',
  sourceSite: 'hcomic',
  author: '作者A',
  tags: ['NTR', '魔法少女'],
  parodies: ['原作X'],
  characters: ['角色Y'],
}

// 用真实 store，把 actions 替换为 spy，同时保留 store 内部一致性。
const store = useDrawerStore
const setPendingSearchSpy = vi.fn()
const closeDrawerSpy = vi.fn()

const openDrawerWith = (comic: ComicInfo) => {
  store.setState({
    drawerComic: comic,
    isOpen: true,
    pendingSearch: null,
    setPendingSearch: (...args: never[]) => setPendingSearchSpy(...args),
    closeDrawer: () => closeDrawerSpy(),
  })
}

beforeEach(() => {
  setPendingSearchSpy.mockClear()
  closeDrawerSpy.mockClear()
})

afterEach(() => {
  store.setState({
    drawerComic: null,
    isOpen: false,
    pendingSearch: null,
  })
})

// --- Tests ----------------------------------------------------------------

// 等待异步 effect（mock 的 IPC hook resolve 触发的 state 更新）沉淀，避免 act() 警告
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('ComicInfoDrawer - 点击 tag 加入搜索', () => {
  beforeEach(async () => {
    openDrawerWith(comicWithTags)
    await settle()
  })

  it('点击标签调用 setPendingSearch(tag, "tag", true)，不关闭抽屉', async () => {
    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    await user.click(screen.getByText('NTR'))

    expect(setPendingSearchSpy).toHaveBeenCalledWith('NTR', 'tag', true)
    expect(closeDrawerSpy).not.toHaveBeenCalled()
  })

  it('点击标签后显示「已加入搜索」Toast 提示', async () => {
    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    await user.click(screen.getByText('NTR'))

    expect(screen.getByText('已加入搜索：NTR')).toBeInTheDocument()
  })

  it('连续点击多个标签都追加搜索且抽屉保持打开', async () => {
    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    await user.click(screen.getByText('NTR'))
    await user.click(screen.getByText('魔法少女'))

    expect(setPendingSearchSpy).toHaveBeenCalledTimes(2)
    expect(setPendingSearchSpy).toHaveBeenNthCalledWith(1, 'NTR', 'tag', true)
    expect(setPendingSearchSpy).toHaveBeenNthCalledWith(2, '魔法少女', 'tag', true)
    expect(screen.getByText('已加入搜索：魔法少女')).toBeInTheDocument()
    expect(closeDrawerSpy).not.toHaveBeenCalled()
  })

  it('点击「原著」走 handleSearch（替换模式 + 关闭抽屉）', async () => {
    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    await user.click(screen.getByText('原作X'))

    expect(setPendingSearchSpy).toHaveBeenCalledWith('原作X', 'tag', false)
    expect(closeDrawerSpy).toHaveBeenCalledTimes(1)
  })

  it('点击「角色」走 handleSearch（替换模式 + 关闭抽屉）', async () => {
    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    await user.click(screen.getByText('角色Y'))

    expect(setPendingSearchSpy).toHaveBeenCalledWith('角色Y', 'tag', false)
    expect(closeDrawerSpy).toHaveBeenCalledTimes(1)
  })

  it('点击「作者」走 handleSearch author 模式 + 关闭抽屉', async () => {
    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    await user.click(screen.getByText('作者A'))

    expect(setPendingSearchSpy).toHaveBeenCalledWith('作者A', 'author', false)
    expect(closeDrawerSpy).toHaveBeenCalledTimes(1)
  })
})

describe('ComicInfoDrawer - 元数据信息渲染', () => {
  it('显示 Category 并可点击触发 category 搜索', async () => {
    openDrawerWith({
      ...comicWithTags,
      category: 'artist cg',
      publishDate: '2026-06-01',
      language: 'chinese',
    })
    await settle()

    const user = userEvent.setup()
    render(<ComicInfoDrawer />)
    await settle()

    // Category 文案渲染为可点击按钮
    const categoryBtn = screen.getByText('artist cg')
    await user.click(categoryBtn)

    expect(setPendingSearchSpy).toHaveBeenCalledWith('artist cg', 'category', false)
    expect(closeDrawerSpy).toHaveBeenCalledTimes(1)
  })

  it('信息行显示更新时间与语言', async () => {
    openDrawerWith({
      ...comicWithTags,
      publishDate: '2026-06-01',
      language: 'chinese',
    })
    await settle()

    render(<ComicInfoDrawer />)
    await settle()

    expect(screen.getByText(/更新 2026-06-01/)).toBeInTheDocument()
    expect(screen.getByText(/chinese/)).toBeInTheDocument()
  })

  it('元数据缺失时不渲染对应空标签', async () => {
    // comicWithTags 无 category/publishDate/language
    openDrawerWith(comicWithTags)
    await settle()

    render(<ComicInfoDrawer />)
    await settle()

    expect(screen.queryByText(/更新/)).not.toBeInTheDocument()
    // category 文案不渲染
    expect(screen.queryByText('artist cg')).not.toBeInTheDocument()
  })
})
